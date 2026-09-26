import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { SignJWT } from 'jose'
import { and, eq } from 'drizzle-orm'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { generateSessionToken, hashSessionToken } from '../../lib/token'
import { errorHandler } from '../../middleware/error'
import { authGuard, resetAuthCaches } from '../../middleware/auth.guard'
import { config } from '../../config'
import { hashPassword, verifyPassword } from '../../lib/password'
import authRoutes from './auth.routes'
import { resetLoginRateLimit } from './auth.rate-limit'
import {
  changePassword,
  createSession,
  effectiveUploadMaxBytes,
  getDefaultUser,
  getInstanceInfo,
  refreshSessionIfNeeded,
  register,
  resolveSession,
  revokeSession,
  revokeUserSessions,
  setupUser,
  updateInstanceSettings,
} from './auth.service'
import { issueLegadoAccessKey } from '../books/legado-access.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

type TestDb = ReturnType<typeof createTestDb>

async function seedInstance(
  db: TestDb,
  opts: { allowRegistration?: boolean; allowGuestAccess?: boolean; uploadMaxBytes?: number; ownerUsername?: string } = {},
) {
  const ownerId = createId('user')
  db.insert(schema.users).values({
    id: ownerId,
    username: opts.ownerUsername ?? 'seed-owner',
    role: 'owner',
    createdAt: Date.now(),
  }).run()
  db.insert(schema.instance).values({
    id: 'instance',
    ownerUserId: ownerId,
    allowRegistration: opts.allowRegistration ?? false,
    allowGuestAccess: opts.allowGuestAccess ?? false,
    uploadMaxBytes: opts.uploadMaxBytes ?? null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }).run()
  resetAuthCaches()
  return ownerId
}

async function insertUser(
  db: TestDb,
  opts: { username: string; role?: 'owner' | 'member' | 'guest'; password?: string; disabled?: number },
) {
  const id = createId('user')
  db.insert(schema.users).values({
    id,
    username: opts.username,
    passwordHash: opts.password ? await hashPassword(opts.password) : null,
    role: opts.role ?? 'member',
    disabled: opts.disabled ?? 0,
    createdAt: Date.now(),
  }).run()
  return id
}

function startSession(db: TestDb, userId: string, expiresAt: number = Date.now() + SESSION_TTL_MS): string {
  const token = generateSessionToken()
  db.insert(schema.sessions).values({
    id: createId('session'),
    userId,
    tokenHash: hashSessionToken(token),
    createdAt: Date.now(),
    expiresAt,
  }).run()
  return token
}

function createGuardApp() {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('/api/v1/*', authGuard())
  app.get('/api/v1/protected', (c) => c.json({ data: c.get('user') }))
  app.post('/api/v1/protected-write', (c) => c.json({ data: c.get('user') }))
  app.get('/api/v1/legado/protected', (c) => c.json({ data: c.get('user') }))
  return app
}

function createAuthApp(user: { id: string; username: string; role: string } | null) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('/api/v1/auth/*', async (c, next) => {
    if (user) c.set('user', { ...user, avatarKey: null })
    return next()
  })
  app.route('/api/v1/auth', authRoutes)
  return app
}

async function signLegacyToken(userId: string) {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(config.jwtSecret))
}

describe('auth module', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    resetAuthCaches()
    resetLoginRateLimit()
  })

  describe('register', () => {
    it('rejects when registration is disabled', async () => {
      await seedInstance(db, { allowRegistration: false })
      await expect(register('alice', 'password123')).rejects.toMatchObject({ code: 'REGISTRATION_DISABLED' })
    })

    it('creates a member user with a session and a private library when enabled', async () => {
      await seedInstance(db, { allowRegistration: true })
      const result = await register('alice', 'password123')
      expect(result.user.role).toBe('member')
      expect(result.token).toBeTruthy()
      const row = db.select().from(schema.users).where(eq(schema.users.username, 'alice')).get()
      expect(row?.role).toBe('member')
      expect(row?.passwordHash).toBeTruthy()
      expect(row?.usernameNormalized).toBe('alice')
      expect(db.select().from(schema.sessions).where(eq(schema.sessions.userId, row!.id)).all()).toHaveLength(1)
      expect(db.select().from(schema.libraries).where(eq(schema.libraries.userId, row!.id)).all()).toHaveLength(1)
    })

    it('rejects a duplicate username', async () => {
      await seedInstance(db, { allowRegistration: true })
      await register('alice', 'password123')
      await expect(register('alice', 'password456')).rejects.toMatchObject({ code: 'USERNAME_TAKEN' })
    })

    it('rejects case, NFKC, and invisible-char near-duplicates', async () => {
      await seedInstance(db, { allowRegistration: true })
      await register('alice', 'password123')
      await expect(register('Alice', 'password456')).rejects.toMatchObject({ code: 'USERNAME_TAKEN' })
      await expect(register('Ａlice', 'password456')).rejects.toMatchObject({ code: 'USERNAME_TAKEN' })
      await expect(register('ali\u200Bce', 'password456')).rejects.toMatchObject({ code: 'USERNAME_TAKEN' })
    })

    it('rejects a password below the minimum length at the route layer', async () => {
      await seedInstance(db, { allowRegistration: true })
      const app = createAuthApp(null)
      const res = await app.request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'shortpass', password: 'short12' }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })

    it('maps a concurrent duplicate username write to USERNAME_TAKEN', async () => {
      await seedInstance(db, { allowRegistration: true })
      const results = await Promise.allSettled([
        register('race-user', 'password123'),
        register('race-user', 'password456'),
      ])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'USERNAME_TAKEN' } })
    })
  })

  describe('changePassword', () => {
    it('rejects a wrong old password', async () => {
      const id = await insertUser(db, { username: 'bob', password: 'oldpass123' })
      await expect(changePassword(id, 'wrong', 'newpass123')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('updates the password and revokes every session', async () => {
      const id = await insertUser(db, { username: 'bob', password: 'oldpass123' })
      const token = startSession(db, id)
      expect(resolveSession(token)).not.toBeNull()
      await changePassword(id, 'oldpass123', 'newpass123')
      const row = db.select().from(schema.users).where(eq(schema.users.id, id)).get()
      expect(await verifyPassword('newpass123', row!.passwordHash!)).toBe(true)
      expect(resolveSession(token)).toBeNull()
      expect(db.select().from(schema.sessions).where(eq(schema.sessions.userId, id)).all()).toHaveLength(0)
    })
  })

  describe('instance settings', () => {
    it('reports initialized=false without an instance row', async () => {
      const info = getInstanceInfo()
      expect(info).toEqual({ initialized: false, allowRegistration: false, allowGuestAccess: false, uploadMaxBytes: config.uploadMaxBytes })
    })

    it('falls back to the env upload cap and honors the instance override', async () => {
      await seedInstance(db, {})
      expect(effectiveUploadMaxBytes()).toBe(config.uploadMaxBytes)
      updateInstanceSettings({ uploadMaxBytes: 524288000 })
      expect(effectiveUploadMaxBytes()).toBe(524288000)
      expect(getInstanceInfo().uploadMaxBytes).toBe(524288000)
    })

    it('updates flags', async () => {
      await seedInstance(db, {})
      const info = updateInstanceSettings({ allowRegistration: true, allowGuestAccess: true })
      expect(info.allowRegistration).toBe(true)
      expect(info.allowGuestAccess).toBe(true)
      expect(getInstanceInfo().allowRegistration).toBe(true)
    })

    it('reports initialized=true once the instance row exists', async () => {
      expect(getInstanceInfo().initialized).toBe(false)
      await seedInstance(db, { allowGuestAccess: true })
      expect(getInstanceInfo().initialized).toBe(true)
    })

    it('rejects settings writes before setup', async () => {
      expect(() => updateInstanceSettings({ allowRegistration: true })).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }))
    })

    it('rejects PATCH /instance for a member', async () => {
      await seedInstance(db, {})
      const app = createAuthApp({ id: 'u1', username: 'mem', role: 'member' })
      const res = await app.request('/api/v1/auth/instance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowRegistration: true }),
      })
      expect(res.status).toBe(403)
    })

    it('rejects PATCH /instance for a guest-injected session', async () => {
      await seedInstance(db, { allowGuestAccess: true })
      const app = new Hono()
      app.onError(errorHandler)
      app.use('/api/v1/auth/*', async (c, next) => {
        c.set('user', { id: 'u1', username: 'admin', role: 'guest', avatarKey: null })
        c.set('guest', true)
        return next()
      })
      app.route('/api/v1/auth', authRoutes)
      const res = await app.request('/api/v1/auth/instance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowRegistration: true }),
      })
      expect(res.status).toBe(403)
    })

    it('allows PATCH /instance for an owner', async () => {
      const ownerId = await seedInstance(db, {})
      const app = createAuthApp({ id: ownerId, username: 'own', role: 'owner' })
      const res = await app.request('/api/v1/auth/instance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowRegistration: true }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.allowRegistration).toBe(true)
    })

    it('rejects an out-of-range upload cap', async () => {
      await seedInstance(db, {})
      const app = createAuthApp({ id: 'u1', username: 'own', role: 'owner' })
      const res = await app.request('/api/v1/auth/instance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadMaxBytes: 1024 }),
      })
      expect(res.status).toBe(400)
    })

    it('persists an owner-set upload cap and returns the effective value', async () => {
      await seedInstance(db, {})
      const app = createAuthApp({ id: 'u1', username: 'own', role: 'owner' })
      const res = await app.request('/api/v1/auth/instance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadMaxBytes: 1073741824 }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.uploadMaxBytes).toBe(1073741824)
      expect(getInstanceInfo().uploadMaxBytes).toBe(1073741824)
    })
  })

  describe('login route', () => {
    it('sets the session cookie and returns the user without a token', async () => {
      await seedInstance(db, {})
      await insertUser(db, { username: 'carol', password: 'password123', role: 'owner' })
      const app = createAuthApp(null)
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'carol', password: 'password123' }),
      })
      expect(res.status).toBe(200)
      const cookie = res.headers.get('set-cookie') ?? ''
      expect(cookie).toContain('bd_token=')
      expect(cookie).toContain('HttpOnly')
      const body = await res.json()
      expect(body.data.user.username).toBe('carol')
      expect(body.data.token).toBeUndefined()
    })

    it('rejects invalid credentials without revealing whether the username exists', async () => {
      await seedInstance(db, {})
      await insertUser(db, { username: 'carol', password: 'password123', role: 'owner' })
      const app = createAuthApp(null)

      const wrongPassword = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'carol', password: 'wrongpass' }),
      })
      const unknownUsername = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nobody', password: 'wrongpass' }),
      })

      expect(wrongPassword.status).toBe(401)
      expect(unknownUsername.status).toBe(401)
      expect(await wrongPassword.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } })
      expect(await unknownUsername.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } })
    })

    it('rejects a disabled account after verifying its password', async () => {
      await seedInstance(db, {})
      await insertUser(db, { username: 'dave', password: 'password123', disabled: 1 })
      const app = createAuthApp(null)

      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'dave', password: 'password123' }),
      })

      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: { code: 'ACCOUNT_DISABLED', message: 'Account is disabled' } })
    })

    it('returns validation errors for incomplete or malformed request bodies', async () => {
      await seedInstance(db, {})
      const app = createAuthApp(null)

      const incomplete = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: '   ', password: '' }),
      })
      const malformed = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      })

      expect(incomplete.status).toBe(400)
      expect(malformed.status).toBe(400)
      expect((await incomplete.json()).error.code).toBe('VALIDATION_ERROR')
      expect((await malformed.json()).error.code).toBe('VALIDATION_ERROR')
    })

    it('rate-limits repeated credential failures with retry metadata', async () => {
      await seedInstance(db, {})
      const app = createAuthApp(null)
      const attempt = () => app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nobody', password: 'wrongpass' }),
      })

      for (let i = 0; i < config.authRpm; i += 1) {
        expect((await attempt()).status).toBe(401)
      }
      const limited = await attempt()

      expect(limited.status).toBe(429)
      expect(limited.headers.get('retry-after')).toMatch(/^\d+$/)
      expect(await limited.json()).toMatchObject({ error: { code: 'AUTH_RATE_LIMITED', details: { retryAfterSeconds: expect.any(Number) } } })
    })

    it('clears failed attempts after a successful login', async () => {
      await seedInstance(db, {})
      await insertUser(db, { username: 'erin', password: 'password123', role: 'owner' })
      const app = createAuthApp(null)
      const request = (password: string) => app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'erin', password }),
      })

      expect((await request('wrongpass')).status).toBe(401)
      expect((await request('password123')).status).toBe(200)
      for (let i = 0; i < config.authRpm; i += 1) {
        expect((await request('wrongpass')).status).toBe(401)
      }
      expect((await request('wrongpass')).status).toBe(429)
    })
  })

  describe('setup', () => {
    it('creates the owner, their private library and the instance atomically', async () => {
      const result = await setupUser('admin', 'password123')
      expect(result.user.role).toBe('owner')
      expect(getInstanceInfo().initialized).toBe(true)
      const libraries = db.select().from(schema.libraries).where(eq(schema.libraries.userId, result.user.id)).all()
      expect(libraries).toHaveLength(1)
      expect(libraries[0]).toMatchObject({ type: 'private' })
      const instanceRow = db.select().from(schema.instance).all()
      expect(instanceRow).toHaveLength(1)
      expect(instanceRow[0]?.ownerUserId).toBe(result.user.id)
    })

    it('rejects setup once the instance exists', async () => {
      await setupUser('admin', 'password123')
      await expect(setupUser('admin2', 'password123')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('allows only one concurrent setup request to create an owner', async () => {
      const results = await Promise.allSettled([
        setupUser('owner-one', 'password123'),
        setupUser('owner-two', 'password123'),
      ])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'FORBIDDEN' } })
    })
  })

  describe('changeUsername', () => {
    it('renames the user and returns the fresh account', async () => {
      const id = await insertUser(db, { username: 'frank', password: 'password123' })
      const app = createAuthApp({ id, username: 'frank', role: 'member' })
      const res = await app.request('/api/v1/auth/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'frank2' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.username).toBe('frank2')
      expect(body.data.avatarKey).toBeNull()
      const row = db.select().from(schema.users).where(eq(schema.users.id, id)).get()
      expect(row?.username).toBe('frank2')
      expect(row?.usernameNormalized).toBe('frank2')
    })

    it('rejects a taken username with 409', async () => {
      await insertUser(db, { username: 'grace', password: 'password123' })
      const id = await insertUser(db, { username: 'heidi', password: 'password123' })
      const app = createAuthApp({ id, username: 'heidi', role: 'member' })
      const res = await app.request('/api/v1/auth/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'grace' }),
      })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error.code).toBe('USERNAME_TAKEN')
    })

    it('rejects a case-variant near-duplicate with 409', async () => {
      await insertUser(db, { username: 'grace', password: 'password123' })
      const id = await insertUser(db, { username: 'heidi', password: 'password123' })
      const app = createAuthApp({ id, username: 'heidi', role: 'member' })
      const res = await app.request('/api/v1/auth/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'GRACE' }),
      })
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error.code).toBe('USERNAME_TAKEN')
    })

    it('stores the sanitized username, stripping invisible characters', async () => {
      const id = await insertUser(db, { username: 'ivan', password: 'password123' })
      const app = createAuthApp({ id, username: 'ivan', role: 'member' })
      const res = await app.request('/api/v1/auth/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: ' i\u200Bvan\uFEFF ' }),
      })
      expect(res.status).toBe(200)
      const row = db.select().from(schema.users).where(eq(schema.users.id, id)).get()
      expect(row?.username).toBe('ivan')
    })

    it('keeps the current username when unchanged', async () => {
      const id = await insertUser(db, { username: 'ivan', password: 'password123' })
      const app = createAuthApp({ id, username: 'ivan', role: 'member' })
      const res = await app.request('/api/v1/auth/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ivan' }),
      })
      expect(res.status).toBe(200)
    })

    it('rejects guest-injected sessions', async () => {
      const app = new Hono()
      app.onError(errorHandler)
      app.use('/api/v1/auth/*', async (c, next) => {
        c.set('user', { id: 'u1', username: 'admin', role: 'guest', avatarKey: null })
        c.set('guest', true)
        return next()
      })
      app.route('/api/v1/auth', authRoutes)
      const res = await app.request('/api/v1/auth/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'newname' }),
      })
      expect(res.status).toBe(401)
    })
  })

  describe('me route', () => {
    it('flags guest-injected sessions', async () => {
      await seedInstance(db, { allowGuestAccess: true })
      const app = new Hono()
      app.onError(errorHandler)
      app.use('/api/v1/auth/*', async (c, next) => {
        c.set('user', { id: 'u1', username: 'admin', role: 'owner', avatarKey: null })
        c.set('guest', true)
        return next()
      })
      app.route('/api/v1/auth', authRoutes)
      const res = await app.request('/api/v1/auth/me')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.guest).toBe(true)
    })

    it('flags real sessions as non-guest', async () => {
      await seedInstance(db, {})
      const app = createAuthApp({ id: 'u1', username: 'own', role: 'owner' })
      const res = await app.request('/api/v1/auth/me')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.guest).toBe(false)
    })
  })

  describe('sessions', () => {
    it('resolves a live session and drops unknown tokens', async () => {
      const id = await insertUser(db, { username: 'sess', password: 'password123' })
      const created = createSession(id)
      expect(resolveSession(created.token)).toMatchObject({ userId: id, sessionId: created.sessionId })
      expect(resolveSession('nope')).toBeNull()
    })

    it('expires sessions past their deadline and cleans the row', async () => {
      const id = await insertUser(db, { username: 'sess', password: 'password123' })
      const token = startSession(db, id, Date.now() - 1000)
      expect(resolveSession(token)).toBeNull()
      expect(db.select().from(schema.sessions).all()).toHaveLength(0)
    })

    it('refreshes sessions inside the 7-day window and leaves fresh ones alone', async () => {
      const id = await insertUser(db, { username: 'sess', password: 'password123' })
      const created = createSession(id)
      expect(refreshSessionIfNeeded(created.sessionId, created.expiresAt)).toBe(false)

      const nearExpiry = Date.now() + 6 * 24 * 60 * 60 * 1000
      db.update(schema.sessions).set({ expiresAt: nearExpiry }).where(eq(schema.sessions.id, created.sessionId)).run()
      expect(refreshSessionIfNeeded(created.sessionId, nearExpiry)).toBe(true)
      const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, created.sessionId)).get()
      expect(row!.expiresAt).toBeGreaterThan(nearExpiry)
    })

    it('revokes one session on logout and all on demand', async () => {
      const id = await insertUser(db, { username: 'sess', password: 'password123' })
      const first = createSession(id)
      const second = createSession(id)
      revokeSession(first.token)
      expect(resolveSession(first.token)).toBeNull()
      expect(resolveSession(second.token)).not.toBeNull()
      revokeUserSessions(id)
      expect(resolveSession(second.token)).toBeNull()
    })

    it('logs out through the route by revoking the presented session', async () => {
      const id = await insertUser(db, { username: 'sess', password: 'password123' })
      const token = startSession(db, id)
      const app = createAuthApp({ id, username: 'sess', role: 'member' })
      const res = await app.request('/api/v1/auth/logout', {
        method: 'POST',
        headers: { Cookie: `bd_token=${token}` },
      })
      expect(res.status).toBe(200)
      expect(resolveSession(token)).toBeNull()
      expect(res.headers.get('set-cookie')).toContain('bd_token=')
    })

    it('rejects legacy JWTs so old clients re-authenticate', async () => {
      await seedInstance(db, {})
      const id = await insertUser(db, { username: 'jwt', role: 'owner', password: 'password123' })
      const app = createGuardApp()
      const res = await app.request('/api/v1/protected', {
        headers: { Authorization: `Bearer ${await signLegacyToken(id)}` },
      })
      expect(res.status).toBe(401)
    })
  })

  describe('authGuard', () => {
    it('rejects a disabled user with ACCOUNT_DISABLED', async () => {
      await seedInstance(db, {})
      const id = await insertUser(db, { username: 'dave', disabled: 1 })
      const app = createGuardApp()
      const res = await app.request('/api/v1/protected', {
        headers: { Authorization: `Bearer ${startSession(db, id)}` },
      })
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error.code).toBe('ACCOUNT_DISABLED')
    })

    it('rejects requests without a token when guest access is off', async () => {
      await seedInstance(db, {})
      const app = createGuardApp()
      const res = await app.request('/api/v1/protected')
      expect(res.status).toBe(401)
    })

    it('injects the default user when guest access is on', async () => {
      await seedInstance(db, { allowGuestAccess: true })
      const app = createGuardApp()
      const res = await app.request('/api/v1/protected')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.username).toMatch(/^user_/)
      expect(body.data.role).toBe('guest')
    })

    it('rejects mutations from a guest session before route handling', async () => {
      await seedInstance(db, { allowGuestAccess: true })
      const app = createGuardApp()
      const res = await app.request('/api/v1/protected-write', { method: 'POST' })
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toEqual({ code: 'FORBIDDEN', message: 'Guest sessions are read-only' })
    })

    it('keeps mutations available to a signed-in owner', async () => {
      await seedInstance(db, {})
      const id = await insertUser(db, { username: 'owner', role: 'owner', password: 'password123' })
      const app = createGuardApp()
      const res = await app.request('/api/v1/protected-write', {
        method: 'POST',
        headers: { Authorization: `Bearer ${startSession(db, id)}` },
      })
      expect(res.status).toBe(200)
    })

    it('creates the default user with the guest role, never owner', async () => {
      await seedInstance(db, { allowGuestAccess: true })
      const user = await getDefaultUser()
      expect(user.role).toBe('guest')
      expect(user.username).toBe(user.id)
      const row = db.select().from(schema.users).where(eq(schema.users.id, user.id)).get()
      expect(row?.role).toBe('guest')
    })

    it('reuses a legacy guest row as-is, without renaming or duplicating', async () => {
      await seedInstance(db, { allowGuestAccess: true })
      const legacyId = await insertUser(db, { username: 'admin', role: 'guest' })
      const user = await getDefaultUser()
      expect(user.id).toBe(legacyId)
      expect(user.username).toBe('admin')
      const rows = db.select().from(schema.users).all()
      expect(rows).toHaveLength(2)
    })

    it('accepts a valid session from the cookie', async () => {
      await seedInstance(db, {})
      const id = await insertUser(db, { username: 'erin', role: 'owner' })
      const app = createGuardApp()
      const res = await app.request('/api/v1/protected', {
        headers: { Cookie: `bd_token=${startSession(db, id)}` },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.id).toBe(id)
    })

    it('rejects an expired session and cleans the row', async () => {
      await seedInstance(db, {})
      const id = await insertUser(db, { username: 'erin', role: 'owner' })
      const token = startSession(db, id, Date.now() - 1000)
      const app = createGuardApp()
      const res = await app.request('/api/v1/protected', {
        headers: { Cookie: `bd_token=${token}` },
      })
      expect(res.status).toBe(401)
      expect(db.select().from(schema.sessions).all()).toHaveLength(0)
    })

    it('accepts a scoped access key only on Legado routes', async () => {
      await seedInstance(db, {})
      const id = await insertUser(db, { username: 'frank', role: 'member' })
      db.insert(schema.settings).values({
        id: createId('setting'),
        userId: id,
        key: 'integrations',
        value: { legado: { enabled: true, authMode: 'accessKey' } },
      }).run()
      const key = issueLegadoAccessKey(id, '90d')
      const app = createGuardApp()

      const legadoResponse = await app.request('/api/v1/legado/protected', {
        headers: { Authorization: `Bearer ${key.token}` },
      })
      expect(legadoResponse.status).toBe(200)
      await expect(legadoResponse.json()).resolves.toMatchObject({ data: { id } })

      const regularResponse = await app.request('/api/v1/protected', {
        headers: { Authorization: `Bearer ${key.token}` },
      })
      expect(regularResponse.status).toBe(401)

      db.update(schema.settings)
        .set({ value: { legado: { enabled: true, authMode: 'login' } } })
        .where(and(eq(schema.settings.userId, id), eq(schema.settings.key, 'integrations')))
        .run()
      const sessionToken = startSession(db, id)
      const disabledModeResponse = await app.request('/api/v1/legado/protected', {
        headers: {
          Authorization: `Bearer ${key.token}`,
          Cookie: `bd_token=${sessionToken}`,
        },
      })
      expect(disabledModeResponse.status).toBe(401)
    })
  })
})
