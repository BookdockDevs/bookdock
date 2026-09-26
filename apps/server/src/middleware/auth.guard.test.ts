import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import type { AccessTokenPermission } from '@bookdock/shared'

import * as schema from '../db/schema'
import * as client from '../db/client'
import { createId } from '../lib/id'
import { generateSessionToken, hashSessionToken } from '../lib/token'
import { createAccessToken, setAccessTokenDisabled } from '../modules/tokens/tokens.service'
import { authGuard, requireOwner, resetAuthCaches } from './auth.guard'
import { errorHandler } from './error'
import { tokenCors } from './token-cors'

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations')

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}

/** Mirrors the real app: CORS before the guard, then the token-facing routes. */
function createGuardApp() {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('/api/v1/*', tokenCors())
  app.use('/api/v1/*', authGuard())
  app.get('/api/v1/books', (c) => c.json({ data: 'list' }))
  app.post('/api/v1/books', (c) => c.json({ data: 'uploaded' }, 201))
  app.get('/api/v1/books/:id', (c) => c.json({ data: 'detail' }))
  app.on(['GET', 'HEAD'], '/api/v1/books/:id/file', (c) => c.body(null, 200))
  app.delete('/api/v1/books/:id', (c) => c.json({ data: 'deleted' }))
  app.get('/api/v1/auth/me', (c) => c.json({ data: c.get('user') }))
  app.patch('/api/v1/auth/instance', requireOwner(), (c) => c.json({ data: 'instance' }))
  app.get('/api/v1/tokens', (c) => c.json({ data: 'tokens' }))
  return app
}

describe('authGuard access token branch', () => {
  let db: ReturnType<typeof createTestDb>
  let memberId: string
  let ownerId: string

  beforeEach(() => {
    db = createTestDb()
    migrate(db, { migrationsFolder })
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    resetAuthCaches()
    memberId = createId('user')
    ownerId = createId('user')
    db.insert(schema.users).values([
      { id: memberId, username: `member-${memberId}`, role: 'member', createdAt: Date.now() },
      { id: ownerId, username: `owner-${ownerId}`, role: 'owner', createdAt: Date.now() },
    ]).run()
  })

  function issue(permissions: AccessTokenPermission[], owner = memberId) {
    return createAccessToken(owner, { name: 'client', permissions, expiresIn: '90d' })
  }

  function bearer(plaintext: string) {
    return { Authorization: `Bearer ${plaintext}` }
  }

  function signSession(userId: string) {
    const token = generateSessionToken()
    db.insert(schema.sessions).values({
      id: createId('session'),
      userId,
      tokenHash: hashSessionToken(token),
      createdAt: Date.now(),
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    }).run()
    return token
  }

  it('lets a token through exactly the operations it was granted', async () => {
    const app = createGuardApp()
    const { plaintext } = issue(['book:list', 'book:read', 'book:file', 'book:upload'])
    const headers = bearer(plaintext)

    expect((await app.request('/api/v1/books', { headers })).status).toBe(200)
    expect((await app.request('/api/v1/books/b1', { headers })).status).toBe(200)
    expect((await app.request('/api/v1/books/b1/file', { headers })).status).toBe(200)
    expect((await app.request('/api/v1/books/b1/file', { method: 'HEAD', headers })).status).toBe(200)
    expect((await app.request('/api/v1/books', { method: 'POST', headers })).status).toBe(201)

    const me = await app.request('/api/v1/auth/me', { headers })
    expect(me.status).toBe(200)
    expect((await me.json()).data.id).toBe(memberId)
  })

  it('rejects an operation the token was not granted with 403', async () => {
    const app = createGuardApp()
    const { plaintext } = issue(['book:list'])
    const headers = bearer(plaintext)

    const upload = await app.request('/api/v1/books', { method: 'POST', headers })
    expect(upload.status).toBe(403)
    expect((await upload.json()).error.code).toBe('FORBIDDEN')
    expect((await app.request('/api/v1/books/b1/file', { headers })).status).toBe(403)
  })

  it('denies every endpoint missing from the registry, including owner-only ones', async () => {
    const app = createGuardApp()
    // Even a token minted by the owner must not reach owner-only surfaces.
    const { plaintext } = issue(['book:list', 'book:read', 'book:file', 'book:upload'], ownerId)
    const headers = bearer(plaintext)

    expect((await app.request('/api/v1/tokens', { headers })).status).toBe(403)
    expect((await app.request('/api/v1/auth/instance', { method: 'PATCH', headers })).status).toBe(403)
    expect((await app.request('/api/v1/books/b1', { method: 'DELETE', headers })).status).toBe(403)
  })

  it('rejects an expired token with 401', async () => {
    const app = createGuardApp()
    const { token, plaintext } = issue(['book:list'])
    db.update(schema.accessTokens).set({ expiresAt: Date.now() - 1 }).where(eq(schema.accessTokens.id, token.id)).run()

    const res = await app.request('/api/v1/books', { headers: bearer(plaintext) })
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('rejects a disabled token with 403 and accepts it again once enabled', async () => {
    const app = createGuardApp()
    const { token, plaintext } = issue(['book:list'])
    const headers = bearer(plaintext)

    setAccessTokenDisabled(memberId, token.id, true)
    const res = await app.request('/api/v1/books', { headers })
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('FORBIDDEN')

    setAccessTokenDisabled(memberId, token.id, false)
    expect((await app.request('/api/v1/books', { headers })).status).toBe(200)
  })

  it('rejects an unknown bd_ token with 401', async () => {
    const app = createGuardApp()
    const res = await app.request('/api/v1/books', { headers: bearer(`bd_${'z'.repeat(43)}`) })
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('rejects a token whose owner account was disabled, with ACCOUNT_DISABLED', async () => {
    const app = createGuardApp()
    const { plaintext } = issue(['book:list'])
    db.update(schema.users).set({ disabled: 1 }).where(eq(schema.users.id, memberId)).run()
    resetAuthCaches()

    const res = await app.request('/api/v1/books', { headers: bearer(plaintext) })
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('ACCOUNT_DISABLED')
  })

  it('stops resolving a deleted owner\'s tokens through the cascade delete', async () => {
    const app = createGuardApp()
    const { plaintext } = issue(['book:list'])
    db.delete(schema.users).where(eq(schema.users.id, memberId)).run()
    resetAuthCaches()

    expect((await app.request('/api/v1/books', { headers: bearer(plaintext) })).status).toBe(401)
  })

  it('leaves cookie and JWT session requests completely unaffected', async () => {
    const app = createGuardApp()
    const session = await signSession(memberId)

    // Registry gating must not apply: these routes are unreachable for tokens.
    expect((await app.request('/api/v1/tokens', { headers: { Cookie: `bd_token=${session}` } })).status).toBe(200)
    expect((await app.request('/api/v1/books/b1', { method: 'DELETE', headers: { Cookie: `bd_token=${session}` } })).status).toBe(200)
    expect((await app.request('/api/v1/books', { headers: bearer(session) })).status).toBe(200)

    const ownerSession = await signSession(ownerId)
    expect((await app.request('/api/v1/auth/instance', { method: 'PATCH', headers: { Cookie: `bd_token=${ownerSession}` } })).status).toBe(200)

    const me = await app.request('/api/v1/auth/me', { headers: { Cookie: `bd_token=${session}` } })
    expect(me.status).toBe(200)
    expect((await me.json()).data.id).toBe(memberId)
  })

  it('adds no CORS headers to session requests', async () => {
    const app = createGuardApp()
    const session = await signSession(memberId)
    const res = await app.request('/api/v1/books', {
      headers: { Cookie: `bd_token=${session}`, Origin: 'https://example.test' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
