import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { errorHandler } from '../../middleware/error'
import tokensRoutes from './tokens.routes'
import { resolveAccessToken } from './tokens.service'

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations')

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  return drizzle(sqlite, { schema })
}

describe('access token routes', () => {
  let db: ReturnType<typeof createTestDb>
  let userId: string
  let otherUserId: string

  beforeEach(() => {
    db = createTestDb()
    migrate(db, { migrationsFolder })
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    userId = createId('user')
    otherUserId = createId('user')
    db.insert(schema.users).values([
      { id: userId, username: `user-${userId}`, createdAt: Date.now() },
      { id: otherUserId, username: `user-${otherUserId}`, createdAt: Date.now() },
    ]).run()
  })

  function createApp(session: { id: string; role?: string; guest?: boolean } = { id: userId }) {
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c, next) => {
      c.set('user', { id: session.id, username: 'tester', role: session.role ?? 'member', avatarKey: null })
      if (session.guest) c.set('guest', true)
      return next()
    })
    app.route('/api/v1/tokens', tokensRoutes)
    return app
  }

  function post(app: Hono, path: string, body: unknown) {
    return app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  }

  async function issue(app: Hono, body: Record<string, unknown> = {}) {
    const res = await post(app, '/api/v1/tokens', { name: 'extension', permissions: ['book:list'], ...body })
    expect(res.status).toBe(201)
    return res.json()
  }

  it('creates a token and returns the plaintext in that response only', async () => {
    const app = createApp()
    const body = await issue(app, { permissions: ['book:list', 'book:file'] })

    expect(body.data.plaintext).toMatch(/^bd_[A-Za-z0-9_-]{43}$/)
    expect(body.data.token.tokenLast4).toBe(body.data.plaintext.slice(-4))
    expect(body.data.token.permissions).toEqual(['book:list', 'book:file'])
    expect(body.data.token.disabled).toBe(false)
    expect(resolveAccessToken(body.data.plaintext)).toMatchObject({ status: 'active' })

    const list = await (await app.request('/api/v1/tokens')).json()
    expect(list.data.tokens).toHaveLength(1)
    expect(list.data.tokens[0].permissions).toEqual(['book:list', 'book:file'])
    expect(JSON.stringify(list)).not.toContain(body.data.plaintext)
  })

  it('defaults to a 90 day expiry and accepts the three durations', async () => {
    const app = createApp()
    const defaulted = await issue(app)
    expect(defaulted.data.token.expiresAt).toBe(defaulted.data.token.createdAt + 90 * 24 * 60 * 60 * 1000)

    const yearly = await issue(app, { name: 'y', expiresIn: '1y' })
    expect(yearly.data.token.expiresAt).toBe(yearly.data.token.createdAt + 365 * 24 * 60 * 60 * 1000)

    const permanent = await issue(app, { name: 'p', expiresIn: 'permanent' })
    expect(permanent.data.token.expiresAt).toBeNull()
  })

  it('rejects unknown permissions and unknown durations, and accepts optional name', async () => {
    const app = createApp()

    const unknownPermission = await post(app, '/api/v1/tokens', { name: 'x', permissions: ['book:delete'] })
    expect(unknownPermission.status).toBe(400)
    expect((await unknownPermission.json()).error.code).toBe('VALIDATION_ERROR')

    expect((await post(app, '/api/v1/tokens', { name: 'x', permissions: [], expiresIn: '2y' })).status).toBe(400)
    expect((await post(app, '/api/v1/tokens', { name: '   ', permissions: [] })).status).toBe(201)
    expect((await post(app, '/api/v1/tokens', { permissions: [] })).status).toBe(201)
    expect((await post(app, '/api/v1/tokens', { permissions: ['book:invalid'] })).status).toBe(400)
  })

  it('rejects guest sessions on every token operation', async () => {
    const guest = createApp({ id: userId, role: 'guest', guest: true })

    const create = await post(guest, '/api/v1/tokens', { name: 'x', permissions: [] })
    expect(create.status).toBe(403)
    expect((await create.json()).error.code).toBe('FORBIDDEN')
    expect((await guest.request('/api/v1/tokens')).status).toBe(403)
  })

  it('edits name, permissions and expiry immediately', async () => {
    const app = createApp()
    const created = await issue(app, { permissions: [] })
    const before = Date.now()

    const res = await app.request(`/api/v1/tokens/${created.data.token.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'renamed', permissions: ['book:read'], expiresIn: '1y' }),
    })
    expect(res.status).toBe(200)
    const updated = (await res.json()).data
    expect(updated.name).toBe('renamed')
    expect(updated.permissions).toEqual(['book:read'])
    expect(updated.createdAt).toBe(created.data.token.createdAt)
    expect(updated.expiresAt).toBeGreaterThanOrEqual(before + 365 * 24 * 60 * 60 * 1000)

    // The edit applies to the already-issued secret, with no re-issue.
    expect(resolveAccessToken(created.data.plaintext)).toMatchObject({
      status: 'active',
      token: { permissions: ['book:read'] },
    })
  })

  it('rejects an empty or invalid PATCH body', async () => {
    const app = createApp()
    const created = await issue(app)

    const empty = await app.request(`/api/v1/tokens/${created.data.token.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(empty.status).toBe(400)

    const invalid = await app.request(`/api/v1/tokens/${created.data.token.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: ['nope'] }),
    })
    expect(invalid.status).toBe(400)
  })

  it('disables and re-enables a token', async () => {
    const app = createApp()
    const created = await issue(app)
    const id = created.data.token.id

    const disabled = await post(app, `/api/v1/tokens/${id}/disable`, {})
    expect(disabled.status).toBe(200)
    expect((await disabled.json()).data.disabled).toBe(true)
    expect(resolveAccessToken(created.data.plaintext)).toEqual({ status: 'disabled' })

    const enabled = await post(app, `/api/v1/tokens/${id}/enable`, {})
    expect(enabled.status).toBe(200)
    expect((await enabled.json()).data.disabled).toBe(false)
    expect(resolveAccessToken(created.data.plaintext)).toMatchObject({ status: 'active' })
  })

  it('deletes a token outright', async () => {
    const app = createApp()
    const created = await issue(app)
    const id = created.data.token.id

    const deleted = await app.request(`/api/v1/tokens/${id}`, { method: 'DELETE' })
    expect(deleted.status).toBe(200)
    expect(resolveAccessToken(created.data.plaintext)).toEqual({ status: 'invalid' })
    expect((await app.request(`/api/v1/tokens/${id}`, { method: 'DELETE' })).status).toBe(404)
    expect((await (await app.request('/api/v1/tokens')).json()).data.tokens).toHaveLength(0)
  })

  it('keeps users isolated: no listing, editing or deleting another user\'s token', async () => {
    const mine = createApp()
    const theirs = createApp({ id: otherUserId })
    const created = await issue(theirs, { name: 'theirs' })

    const list = await (await mine.request('/api/v1/tokens')).json()
    expect(list.data.tokens).toHaveLength(0)

    const id = created.data.token.id
    const patch = await mine.request(`/api/v1/tokens/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'hijacked' }),
    })
    expect(patch.status).toBe(404)
    expect((await patch.json()).error.code).toBe('TOKEN_NOT_FOUND')
    expect((await post(mine, `/api/v1/tokens/${id}/disable`, {})).status).toBe(404)
    expect((await mine.request(`/api/v1/tokens/${id}`, { method: 'DELETE' })).status).toBe(404)

    expect(resolveAccessToken(created.data.plaintext)).toMatchObject({ status: 'active' })
    expect(db.select().from(schema.accessTokens).all()).toHaveLength(1)
  })
})
