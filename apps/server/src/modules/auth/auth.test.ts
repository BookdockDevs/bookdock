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
import { errorHandler } from '../../middleware/error'
import { authGuard, resetAuthCaches } from '../../middleware/auth.guard'
import { config } from '../../config'
import { hashPassword, verifyPassword } from '../../lib/password'
import authRoutes from './auth.routes'
import { resetLoginRateLimit } from './auth.rate-limit'
import { changePassword, effectiveUploadMaxBytes, getDefaultUser, getInstanceInfo, register, setupUser, updateInstanceSettings } from './auth.service'
import { issueLegadoAccessKey } from '../books/legado-access.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

type TestDb = ReturnType<typeof createTestDb>

function seedInstanceSettings(db: TestDb, allowRegistration: boolean, allowGuestAccess: boolean) {
  db.insert(schema.instanceSettings).values([
    { key: 'allowRegistration', value: String(allowRegistration) },
    { key: 'allowGuestAccess', value: String(allowGuestAccess) },
  ]).run()
  resetAuthCaches()
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

async function signToken(userId: string) {
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
      seedInstanceSettings(db, false, false)
      await expect(register('alice', 'secret6')).rejects.toMatchObject({ code: 'REGISTRATION_DISABLED' })
    })

    it('creates a member user when enabled', async () => {
      seedInstanceSettings(db, true, false)
      const result = await register('alice', 'secret6')
      expect(result.user.role).toBe('member')
      expect(result.token).toBeTruthy()
      const row = db.select().from(schema.users).where(eq(schema.users.username, 'alice')).get()
      expect(row?.role).toBe('member')
      expect(row?.passwordHash).toBeTruthy()
    })

    it('rejects a duplicate username', async () => {
      seedInstanceSettings(db, true, false)
      await register('alice', 'secret6')
      await expect(register('alice', 'other6')).rejects.toMatchObject({ code: 'USERNAME_TAKEN' })
    })

    it('rejects case, NFKC, and invisible-char near-duplicates', async () => {
      seedInstanceSettings(db, true, false)
      await register('alice', 'secret6')
      await expect(register('Alice', 'other6')).rejects.toMatchObject({ code: 'USERNAME_TAKEN' })
      await expect(register('Ａlice', 'other6')).rejects.toMatchObject({ code: 'USERNAME_TAKEN' })
      await expect(register('ali\u200Bce', 'other6')).rejects.toMatchObject({ code: 'USERNAME_TAKEN' })
    })

    it('rejects a password below the minimum length at the route layer', async () => {
      seedInstanceSettings(db, true, false)
      const app = createAuthApp(null)
      const res = await app.request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'shortpass', password: 'secret6' }),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error.code).toBe('VALIDATION_ERROR')
    })

    it('maps a concurrent duplicate username write to USERNAME_TAKEN', async () => {
      seedInstanceSettings(db, true, false)
      const results = await Promise.allSettled([
        register('race-user', 'secret6'),
        register('race-user', 'secret6'),
      ])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'USERNAME_TAKEN' } })
    })
  })

  describe('changePassword', () => {
    it('rejects a wrong old password', async () => {
      const id = await insertUser(db, { username: 'bob', password: 'oldpass6' })
      await expect(changePassword(id, 'wrong', 'newpass6')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    })

    it('updates the password on success', async () => {
      const id = await insertUser(db, { username: 'bob', password: 'oldpass6' })
      await changePassword(id, 'oldpass6', 'newpass6')
      const row = db.select().from(schema.users).where(eq(schema.users.id, id)).get()
      expect(await verifyPassword('newpass6', row!.passwordHash!)).toBe(true)
    })
  })

  describe('instance settings', () => {
    it('reads flags and reports initialized=false without a password user', () => {
      seedInstanceSettings(db, false, false)
      const info = getInstanceInfo()
      expect(info).toEqual({ initialized: false, allowRegistration: false, allowGuestAccess: false, uploadMaxBytes: config.uploadMaxBytes })
    })

    it('falls back to the env upload cap and honors the instance override', () => {
      seedInstanceSettings(db, false, false)
      expect(effectiveUploadMaxBytes()).toBe(config.uploadMaxBytes)
      updateInstanceSettings({ uploadMaxBytes: 524288000 })
      expect(effectiveUploadMaxBytes()).toBe(524288000)
      expect(getInstanceInfo().uploadMaxBytes).toBe(524288000)
    })

    it('ignores a malformed stored upload cap and falls back to env', () => {
      seedInstanceSettings(db, false, false)
      db.insert(schema.instanceSettings).values({ key: 'uploadMaxBytes', value: 'not-a-number' }).run()
      resetAuthCaches()
      expect(effectiveUploadMaxBytes()).toBe(config.uploadMaxBytes)
    })

    it('updates flags', async () => {
      seedInstanceSettings(db, false, false)
      const info = updateInstanceSettings({ allowRegistration: true, allowGuestAccess: true })
      expect(info.allowRegistration).toBe(true)
      expect(info.allowGuestAccess).toBe(true)
      expect(getInstanceInfo().allowRegistration).toBe(true)
    })

    it('reports initialized=false even when guest access is on', async () => {
      seedInstanceSettings(db, false, true)
      expect(getInstanceInfo().initialized).toBe(false)
      await insertUser(db, { username: 'own', password: 'secret6', role: 'owner' })
      expect(getInstanceInfo().initialized).toBe(true)
    })

    it('rejects PATCH /instance for a member', async () => {
      seedInstanceSettings(db, false, false)
      const app = createAuthApp({ id: 'u1', username: 'mem', role: 'member' })
      const res = await app.request('/api/v1/auth/instance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowRegistration: true }),
      })
      expect(res.status).toBe(403)
    })

    it('rejects PATCH /instance for a guest-injected session', async () => {
      seedInstanceSettings(db, false, true)
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
      seedInstanceSettings(db, false, false)
      const app = createAuthApp({ id: 'u1', username: 'own', role: 'owner' })
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
      seedInstanceSettings(db, false, false)
      const app = createAuthApp({ id: 'u1', username: 'own', role: 'owner' })
      const res = await app.request('/api/v1/auth/instance', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadMaxBytes: 1024 }),
      })
      expect(res.status).toBe(400)
    })

    it('persists an owner-set upload cap and returns the effective value', async () => {
      seedInstanceSettings(db, false, false)
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
    it('returns a token and sets the auth cookie', async () => {
      seedInstanceSettings(db, false, false)
      await insertUser(db, { username: 'carol', password: 'secret6', role: 'owner' })
      const app = createAuthApp(null)
      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'carol', password: 'secret6' }),
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('set-cookie')).toContain('bd_token=')
      const body = await res.json()
      expect(body.data.user.username).toBe('carol')
    })

    it('rejects invalid credentials without revealing whether the username exists', async () => {
      seedInstanceSettings(db, false, false)
      await insertUser(db, { username: 'carol', password: 'secret6', role: 'owner' })
      const app = createAuthApp(null)

      const wrongPassword = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'carol', password: 'wrong6' }),
      })
      const unknownUsername = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nobody', password: 'wrong6' }),
      })

      expect(wrongPassword.status).toBe(401)
      expect(unknownUsername.status).toBe(401)
      expect(await wrongPassword.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } })
      expect(await unknownUsername.json()).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } })
    })

    it('rejects a disabled account after verifying its password', async () => {
      seedInstanceSettings(db, false, false)
      await insertUser(db, { username: 'dave', password: 'secret6', disabled: 1 })
      const app = createAuthApp(null)

      const res = await app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'dave', password: 'secret6' }),
      })

      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: { code: 'ACCOUNT_DISABLED', message: 'Account is disabled' } })
    })

    it('returns validation errors for incomplete or malformed request bodies', async () => {
      seedInstanceSettings(db, false, false)
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
      seedInstanceSettings(db, false, false)
      const app = createAuthApp(null)
      const attempt = () => app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'nobody', password: 'wrong6' }),
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
      seedInstanceSettings(db, false, false)
      await insertUser(db, { username: 'erin', password: 'secret6', role: 'owner' })
      const app = createAuthApp(null)
      const request = (password: string) => app.request('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'erin', password }),
      })

      expect((await request('wrong6')).status).toBe(401)
      expect((await request('secret6')).status).toBe(200)
      for (let i = 0; i < config.authRpm; i += 1) {
        expect((await request('wrong6')).status).toBe(401)
      }
      expect((await request('wrong6')).status).toBe(429)
    })
  })

  describe('setup', () => {
    it('allows setup while guest access is on (no password user yet)', async () => {
      seedInstanceSettings(db, false, true)
      await getDefaultUser()
      const result = await setupUser('admin', 'secret6')
      expect(result.user.role).toBe('owner')
      expect(getInstanceInfo().initialized).toBe(true)
    })

    it('rejects setup once a password user exists', async () => {
      seedInstanceSettings(db, false, true)
      await setupUser('admin', 'secret6')
      await expect(setupUser('admin2', 'secret6')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('allows only one concurrent setup request to create an owner', async () => {
      seedInstanceSettings(db, false, false)
      const results = await Promise.allSettled([
        setupUser('owner-one', 'secret6'),
        setupUser('owner-two', 'secret6'),
      ])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'FORBIDDEN' } })
    })
  })

  describe('changeUsername', () => {
    it('renames the user and returns the fresh account', async () => {
      const id = await insertUser(db, { username: 'frank', password: 'secret6' })
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
    })

    it('rejects a taken username with 409', async () => {
      await insertUser(db, { username: 'grace', password: 'secret6' })
      const id = await insertUser(db, { username: 'heidi', password: 'secret6' })
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
      await insertUser(db, { username: 'grace', password: 'secret6' })
      const id = await insertUser(db, { username: 'heidi', password: 'secret6' })
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
      const id = await insertUser(db, { username: 'ivan', password: 'secret6' })
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
      const id = await insertUser(db, { username: 'ivan', password: 'secret6' })
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
      seedInstanceSettings(db, false, true)
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
      seedInstanceSettings(db, false, false)
      const app = createAuthApp({ id: 'u1', username: 'own', role: 'owner' })
      const res = await app.request('/api/v1/auth/me')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.guest).toBe(false)
    })
  })

  describe('authGuard', () => {
    it('rejects a disabled user with ACCOUNT_DISABLED', async () => {
      seedInstanceSettings(db, false, false)
      const id = await insertUser(db, { username: 'dave', disabled: 1 })
      const app = createGuardApp()
      const res = await app.request('/api/v1/protected', {
        headers: { Authorization: `Bearer ${await signToken(id)}` },
      })
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error.code).toBe('ACCOUNT_DISABLED')
    })

    it('rejects requests without a token when guest access is off', async () => {
      seedInstanceSettings(db, false, false)
      const app = createGuardApp()
      const res = await app.request('/api/v1/protected')
      expect(res.status).toBe(401)
    })

    it('injects the default user when guest access is on', async () => {
      seedInstanceSettings(db, false, true)
      const app = createGuardApp()
      const res = await app.request('/api/v1/protected')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.username).toMatch(/^user_/)
      expect(body.data.role).toBe('guest')
    })

    it('rejects mutations from a guest session before route handling', async () => {
      seedInstanceSettings(db, false, true)
      const app = createGuardApp()
      const res = await app.request('/api/v1/protected-write', { method: 'POST' })
      expect(res.status).toBe(403)
      const body = await res.json()
      expect(body.error).toEqual({ code: 'FORBIDDEN', message: 'Guest sessions are read-only' })
    })

    it('keeps mutations available to a signed-in owner', async () => {
      seedInstanceSettings(db, false, false)
      const id = await insertUser(db, { username: 'owner', role: 'owner', password: 'secret6' })
      const app = createGuardApp()
      const res = await app.request('/api/v1/protected-write', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await signToken(id)}` },
      })
      expect(res.status).toBe(200)
    })

    it('creates the default user with the guest role, never owner', async () => {
      seedInstanceSettings(db, false, true)
      const user = await getDefaultUser()
      expect(user.role).toBe('guest')
      expect(user.username).toBe(user.id)
      const row = db.select().from(schema.users).where(eq(schema.users.id, user.id)).get()
      expect(row?.role).toBe('guest')
    })

    it('reuses a legacy guest row as-is, without renaming or duplicating', async () => {
      seedInstanceSettings(db, false, true)
      const legacyId = await insertUser(db, { username: 'admin', role: 'guest' })
      const user = await getDefaultUser()
      expect(user.id).toBe(legacyId)
      expect(user.username).toBe('admin')
      const rows = db.select().from(schema.users).all()
      expect(rows).toHaveLength(1)
    })

    it('accepts a valid token from the cookie', async () => {
      seedInstanceSettings(db, false, false)
      const id = await insertUser(db, { username: 'erin', role: 'owner' })
      const app = createGuardApp()
      const res = await app.request('/api/v1/protected', {
        headers: { Cookie: `bd_token=${await signToken(id)}` },
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.id).toBe(id)
    })

    it('accepts a scoped access key only on Legado routes', async () => {
      seedInstanceSettings(db, false, false)
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
      const disabledModeResponse = await app.request('/api/v1/legado/protected', {
        headers: {
          Authorization: `Bearer ${key.token}`,
          Cookie: `bd_token=${await signToken(id)}`,
        },
      })
      expect(disabledModeResponse.status).toBe(401)
    })
  })
})
