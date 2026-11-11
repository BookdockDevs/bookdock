import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { INSTANCE_INVITE_CODE_ALPHABET } from '@bookdock/shared'

import * as client from '../../db/client'
import * as schema from '../../db/schema'
import { migrateBeforeBookRetirement, migrateTestBaseWithStorage, migrateWithTagFilter } from '../../db/migration-stage'
import { createId } from '../../lib/id'
import * as passwordLib from '../../lib/password'
import { generateSessionToken, hashSessionToken } from '../../lib/token'
import { authGuard, resetAuthCaches } from '../../middleware/auth.guard'
import { errorHandler } from '../../middleware/error'
import { transferInstanceOwnership, deleteUser } from '../users/users.service'
import { resetLoginRateLimit } from './auth.rate-limit'
import authRoutes from './auth.routes'
import {
  createInstanceInvite,
  deleteInstanceInvite,
  getInstanceInfo,
  listInstanceInvites,
  register,
  updateInstanceSettings,
} from './auth.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsFolder = path.join(__dirname, '..', '..', 'db', 'migrations')

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrateTestBaseWithStorage(db, { migrationsFolder })
  return db
}

type TestDb = ReturnType<typeof createTestDb>

async function seedOwner(db: TestDb, username = 'owner') {
  const ownerId = createId('user')
  const now = Date.now()
  db.insert(schema.users).values({
    id: ownerId,
    username,
    usernameNormalized: username.toLowerCase(),
    passwordHash: await passwordLib.hashPassword('password123'),
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(schema.libraries).values({
    id: createId('lib'),
    userId: ownerId,
    type: 'private',
    name: '',
    description: '',
    visibility: null,
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(schema.instance).values({
    id: 'instance',
    ownerUserId: ownerId,
    registrationMode: 'invite',
    allowRegistration: false,
    allowGuestAccess: false,
    uploadMaxBytes: null,
    createdAt: now,
    updatedAt: now,
  }).run()
  return ownerId
}

async function createMember(db: TestDb, username: string) {
  const userId = createId('user')
  const now = Date.now()
  db.insert(schema.users).values({
    id: userId,
    username,
    usernameNormalized: username.toLowerCase(),
    passwordHash: await passwordLib.hashPassword('password123'),
    createdAt: now,
    updatedAt: now,
  }).run()
  db.insert(schema.libraries).values({
    id: createId('lib'),
    userId,
    type: 'private',
    name: '',
    description: '',
    visibility: null,
    createdAt: now,
    updatedAt: now,
  }).run()
  return userId
}

function createSharedLibrary(db: TestDb, ownerId: string, name: string, visibility: 'public' | 'password' | 'private' = 'private') {
  const id = createId('lib')
  const now = Date.now()
  db.insert(schema.libraries).values({
    id,
    userId: ownerId,
    type: 'shared',
    name,
    description: '',
    visibility,
    createdAt: now,
    updatedAt: now,
  }).run()
  return id
}

function createSessionToken(db: TestDb, userId: string) {
  const token = generateSessionToken()
  const now = Date.now()
  db.insert(schema.sessions).values({
    id: createId('session'),
    userId,
    tokenHash: hashSessionToken(token),
    createdAt: now,
    expiresAt: now + 3600_000,
  }).run()
  return token
}

function createGuardedApp() {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('/api/v1/*', authGuard())
  app.route('/api/v1/auth', authRoutes)
  return app
}

describe('instance invites and registration modes', () => {
  let db: TestDb
  let ownerId: string

  beforeEach(async () => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db as unknown as ReturnType<typeof client.getDb>)
    resetAuthCaches()
    resetLoginRateLimit()
    ownerId = await seedOwner(db)
  })

  it('enforces closed, invite, and open registration modes and legacy compatibility', async () => {
    const invite = createInstanceInvite(ownerId, { code: 'OPEN2026' })

    updateInstanceSettings({ registrationMode: 'closed' })
    expect(getInstanceInfo().allowRegistration).toBe(false)
    await expect(register('u1', 'password123', invite.code)).rejects.toMatchObject({ code: 'REGISTRATION_DISABLED' })

    updateInstanceSettings({ registrationMode: 'invite' })
    await expect(register('u2', 'password123')).rejects.toMatchObject({ code: 'INVITE_CODE_REQUIRED' })
    await expect(register('u2', 'password123', 'BADCODE')).rejects.toMatchObject({ code: 'INVITE_CODE_INVALID' })
    const invited = await register('u2', 'password123', ' open2026 ')
    expect(invited.user.username).toBe('u2')

    updateInstanceSettings({ registrationMode: 'open' })
    expect(getInstanceInfo().allowRegistration).toBe(true)
    await expect(register('u3', 'password123', 'NONEXISTENT')).rejects.toMatchObject({ code: 'INVITE_CODE_INVALID' })
    const openUser = await register('u3', 'password123')
    expect(openUser.user.username).toBe('u3')

    // Legacy allowRegistration mapping & conflict check
    expect(updateInstanceSettings({ allowRegistration: false }).registrationMode).toBe('closed')
    expect(updateInstanceSettings({ allowRegistration: true }).registrationMode).toBe('open')
    const app = createGuardedApp()
    const token = createSessionToken(db, ownerId)
    const conflictRes = await app.request('/api/v1/auth/instance', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ registrationMode: 'invite', allowRegistration: true }),
    })
    expect(conflictRes.status).toBe(400)
  })

  it('generates 6-char Crockford Base32 codes and validates custom Chinese/ASCII codes', async () => {
    const generated = createInstanceInvite(ownerId, {})
    expect(generated.code).toHaveLength(6)
    for (const ch of generated.code) {
      expect(INSTANCE_INVITE_CODE_ALPHABET).toContain(ch)
    }

    const chinese = createInstanceInvite(ownerId, { code: '  书香门第_2026-ab  ', label: '群口令' })
    expect(chinese.code).toBe('书香门第_2026-AB')

    // Case-insensitive duplicate rejection
    expect(() => createInstanceInvite(ownerId, { code: '书香门第_2026-Ab' })).toThrowError(
      expect.objectContaining({ code: 'INVITE_CODE_TAKEN' }),
    )

    // Internal whitespace, too short, and invalid punctuation rejected by route schema
    const app = createGuardedApp()
    const token = createSessionToken(db, ownerId)
    for (const badCode of ['ab c', '书 坞', 'abc', 'bad!code']) {
      const res = await app.request('/api/v1/auth/invites', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: badCode }),
      })
      expect(res.status).toBe(400)
    }

    // Redeem Chinese code case-insensitively
    const redeemed = await register('reader1', 'password123', '书香门第_2026-ab')
    expect(redeemed.user.username).toBe('reader1')
  })

  it('handles concurrent one-time invite redemption atomically and rolls back all writes on post-consume DB failure', async () => {
    const sharedLibId = createSharedLibrary(db, ownerId, 'Rollback Club')
    const oneTime = createInstanceInvite(ownerId, { maxUses: 1, autoJoinLibraryIds: [sharedLibId] })
    const usersBefore = db.select().from(schema.users).all().length
    const libsBefore = db.select().from(schema.libraries).all().length
    const membershipsBefore = db.select().from(schema.libraryMemberships).all().length

    // Failure after used_count increment, user insert, and private library insert
    // (simulating a membership insert error inside the same transaction).
    db.$client.exec(`
      CREATE TRIGGER test_fail_membership_insert
      BEFORE INSERT ON library_memberships
      WHEN NEW.library_id = '${sharedLibId}'
      BEGIN
        SELECT RAISE(ABORT, 'simulated membership failure');
      END;
    `)
    await expect(register('rollback-member', 'password123', oneTime.code)).rejects.toThrow(/simulated membership failure/)
    expect(db.select().from(schema.instanceInvites).where(eq(schema.instanceInvites.id, oneTime.id)).get()?.usedCount).toBe(0)
    expect(db.select().from(schema.users).all()).toHaveLength(usersBefore)
    expect(db.select().from(schema.libraries).all()).toHaveLength(libsBefore)
    expect(db.select().from(schema.libraryMemberships).all()).toHaveLength(membershipsBefore)
    db.$client.exec('DROP TRIGGER test_fail_membership_insert;')

    // Failure on private library insert after used_count increment and user insert
    db.$client.exec(`
      CREATE TRIGGER test_fail_private_lib_insert
      BEFORE INSERT ON libraries
      WHEN NEW.type = 'private'
      BEGIN
        SELECT RAISE(ABORT, 'simulated private library failure');
      END;
    `)
    await expect(register('rollback-priv', 'password123', oneTime.code)).rejects.toThrow(/simulated private library failure/)
    expect(db.select().from(schema.instanceInvites).where(eq(schema.instanceInvites.id, oneTime.id)).get()?.usedCount).toBe(0)
    expect(db.select().from(schema.users).all()).toHaveLength(usersBefore)
    expect(db.select().from(schema.libraries).all()).toHaveLength(libsBefore)
    db.$client.exec('DROP TRIGGER test_fail_private_lib_insert;')

    // Concurrent race on maxUses=1 allows exactly one winner and leaves usedCount at 1
    const results = await Promise.allSettled([
      register('winner1', 'password123', oneTime.code),
      register('winner2', 'password123', oneTime.code),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'INVITE_CODE_INVALID' } })
    expect(db.select().from(schema.instanceInvites).where(eq(schema.instanceInvites.id, oneTime.id)).get()?.usedCount).toBe(1)
  })

  it('enforces expiration and deletion', async () => {
    const expired = createInstanceInvite(ownerId, { code: 'EXPIRED1', expiresAt: Date.now() + 5_000 })
    db.update(schema.instanceInvites).set({ expiresAt: Date.now() - 1000 }).where(eq(schema.instanceInvites.id, expired.id)).run()
    expect(listInstanceInvites(ownerId).find((i) => i.id === expired.id)?.status).toBe('expired')
    await expect(register('expuser', 'password123', 'EXPIRED1')).rejects.toMatchObject({ code: 'INVITE_CODE_INVALID' })

    const libId = createSharedLibrary(db, ownerId, 'Delete Cascade Lib')
    const active = createInstanceInvite(ownerId, { code: 'DELETEME', autoJoinLibraryIds: [libId] })
    const deleted = deleteInstanceInvite(ownerId, active.id)
    expect(deleted).toEqual({ id: active.id })
    expect(listInstanceInvites(ownerId).some((i) => i.id === active.id)).toBe(false)
    expect(db.select().from(schema.instanceInviteLibraries).where(eq(schema.instanceInviteLibraries.inviteId, active.id)).all()).toHaveLength(0)
    await expect(register('deluser', 'password123', 'DELETEME')).rejects.toMatchObject({ code: 'INVITE_CODE_INVALID' })

    // Deleting frees the code so it can be re-created if desired
    const recreated = createInstanceInvite(ownerId, { code: 'DELETEME' })
    expect(recreated.code).toBe('DELETEME')
  })

  it('validates bindable shared libraries at creation, stays independent of later permission/ownership changes, and degrades cleanly if library is deleted', async () => {
    const otherUserId = await createMember(db, 'other')
    const privateLib = db.select().from(schema.libraries).where(eq(schema.libraries.userId, ownerId)).get()!
    const otherSharedLib = createSharedLibrary(db, otherUserId, 'Other Shared')
    const ownerSharedLib = createSharedLibrary(db, ownerId, 'Sci-Fi Club')
    const adminSharedLib = createSharedLibrary(db, otherUserId, 'Admin Shared')
    db.insert(schema.libraryMemberships).values({
      id: createId('lbm'),
      libraryId: adminSharedLib,
      userId: ownerId,
      role: 'admin',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run()

    // Cannot bind private library or another user's library without owner/admin role
    expect(() => createInstanceInvite(ownerId, { autoJoinLibraryIds: [privateLib.id] })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    )
    expect(() => createInstanceInvite(ownerId, { autoJoinLibraryIds: [otherSharedLib] })).toThrowError(
      expect.objectContaining({ code: 'FORBIDDEN' }),
    )

    // Can bind multiple own or admin-managed shared libraries (deduped cleanly)
    const invMulti = createInstanceInvite(ownerId, {
      code: 'MULTIJOIN',
      autoJoinLibraryIds: [adminSharedLib, ownerSharedLib, adminSharedLib],
    })
    expect(invMulti.autoJoinLibraries).toEqual([
      { id: adminSharedLib, name: 'Admin Shared' },
      { id: ownerSharedLib, name: 'Sci-Fi Club' },
    ])
    const invAdmin = createInstanceInvite(ownerId, { code: 'ADMINJOIN', autoJoinLibraryIds: [adminSharedLib] })
    createInstanceInvite(ownerId, { code: 'DELJOIN', autoJoinLibraryIds: [ownerSharedLib] })

    // Deleting one bound library leaves remaining libraries intact on multi-library invites
    // and keeps single-library invites valid without joinedLibraries
    db.delete(schema.libraries).where(eq(schema.libraries.id, ownerSharedLib)).run()
    expect(listInstanceInvites(ownerId).find((i) => i.id === invMulti.id)?.autoJoinLibraries).toEqual([
      { id: adminSharedLib, name: 'Admin Shared' },
    ])
    const multiJoined = await register('joiner_multi', 'password123', 'MULTIJOIN')
    expect(multiJoined.joinedLibraries).toEqual([{ id: adminSharedLib, name: 'Admin Shared' }])
    const noLibJoin = await register('joiner2', 'password123', 'DELJOIN')
    expect(noLibJoin.joinedLibraries).toBeUndefined()

    // Creator loses admin role in adminSharedLib, instance ownership transfers, and former owner is deleted:
    // invite remains active and redeemable!
    db.delete(schema.libraryMemberships).where(eq(schema.libraryMemberships.libraryId, adminSharedLib)).run()
    await transferInstanceOwnership(ownerId, otherUserId)
    await deleteUser(otherUserId, ownerId)

    const surviving = listInstanceInvites(otherUserId).find((i) => i.id === invAdmin.id)
    expect(surviving?.status).toBe('active')
    const joined = await register('joiner1', 'password123', 'ADMINJOIN')
    expect(joined.joinedLibraries).toEqual([{ id: adminSharedLib, name: 'Admin Shared' }])
    const membership = db.select().from(schema.libraryMemberships)
      .where(eq(schema.libraryMemberships.userId, joined.user.id)).get()
    expect(membership?.libraryId).toBe(adminSharedLib)
    expect(membership?.role).toBe('member')
  })

  it('enforces owner-only management and rate-limits guessing across usernames/codes', async () => {
    const sharedId = createSharedLibrary(db, ownerId, 'Book Club')
    const inv = createInstanceInvite(ownerId, { code: '中文口令', autoJoinLibraryIds: [sharedId], maxUses: 2 })
    const memberId = await createMember(db, 'member1')
    const memberToken = createSessionToken(db, memberId)
    const app = createGuardedApp()

    // Non-owners cannot list/create/delete invites
    expect((await app.request('/api/v1/auth/invites')).status).toBe(401)
    expect((await app.request('/api/v1/auth/invites', { headers: { Authorization: `Bearer ${memberToken}` } })).status).toBe(403)
    expect((await app.request('/api/v1/auth/invites', {
      method: 'POST',
      headers: { Authorization: `Bearer ${memberToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })).status).toBe(403)
    expect((await app.request(`/api/v1/auth/invites/${inv.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${memberToken}` },
    })).status).toBe(403)

    // Guessing different codes/usernames and spoofing X-Forwarded-For cannot bypass rate limit
    for (let i = 0; i < 5; i += 1) {
      const res = await app.request('/api/v1/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': `203.0.113.${i + 1}`,
        },
        body: JSON.stringify({ username: `attacker${i}`, password: 'password123', inviteCode: `GUESS${i}` }),
      })
      expect(res.status).toBe(400)
    }

    const blockedRegister = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.77' },
      body: JSON.stringify({ username: 'attacker99', password: 'password123', inviteCode: '中文口令' }),
    })
    expect(blockedRegister.status).toBe(429)
    expect((await blockedRegister.json()).error.code).toBe('AUTH_RATE_LIMITED')
  })

  it('isolates visitors behind a trusted proxy while rejecting untrusted or spoofed forwarding headers', async () => {
    createInstanceInvite(ownerId, { code: 'PROXYOK', maxUses: 10 })
    const app = createGuardedApp()
    const trustedProxyEnv = { incoming: { socket: { remoteAddress: '127.0.0.1' } } }
    const untrustedDirectEnv = { incoming: { socket: { remoteAddress: '198.51.100.50' } } }

    // Visitor A behind trusted proxy hits 5 invalid invite attempts -> 6th is throttled
    for (let i = 0; i < 5; i += 1) {
      const res = await app.request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.10' },
        body: JSON.stringify({ username: `bad-a-${i}`, password: 'password123', inviteCode: `BAD${i}` }),
      }, trustedProxyEnv)
      expect(res.status).toBe(400)
    }
    const visitorABlocked = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.10' },
      body: JSON.stringify({ username: 'good-a', password: 'password123', inviteCode: 'PROXYOK' }),
    }, trustedProxyEnv)
    expect(visitorABlocked.status).toBe(429)

    // Spoofing a changing leftmost X-Forwarded-For hop cannot bypass Visitor A's throttle
    const spoofedLeftRes = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.100.1, 203.0.113.10' },
      body: JSON.stringify({ username: 'spoof-a', password: 'password123', inviteCode: 'PROXYOK' }),
    }, trustedProxyEnv)
    expect(spoofedLeftRes.status).toBe(429)

    // Visitor B behind the exact same proxy is completely unaffected
    const visitorBRegister = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.11' },
      body: JSON.stringify({ username: 'visitor-b', password: 'password123', inviteCode: 'PROXYOK' }),
    }, trustedProxyEnv)
    expect(visitorBRegister.status).toBe(200)

    // Untrusted direct socket peer spoofing X-Forwarded-For cannot evade throttling
    for (let i = 0; i < 5; i += 1) {
      const res = await app.request('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${50 + i}` },
        body: JSON.stringify({ username: `direct-${i}`, password: 'password123', inviteCode: `DIRECT${i}` }),
      }, untrustedDirectEnv)
      expect(res.status).toBe(400)
    }
    const directBlocked = await app.request('/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.99' },
      body: JSON.stringify({ username: 'direct-good', password: 'password123', inviteCode: 'PROXYOK' }),
    }, untrustedDirectEnv)
    expect(directBlocked.status).toBe(429)
  })

  it('reserves invite rate-limit slots synchronously before async password hashing on concurrent bursts', async () => {
    createInstanceInvite(ownerId, { code: 'BURSTOK', maxUses: 20 })
    const app = createGuardedApp()
    const clientEnv = { incoming: { socket: { remoteAddress: '198.51.100.88' } } }

    const hashSpy = vi.spyOn(passwordLib, 'hashPassword')

    // 1) Concurrent burst of invalid codes: excess blocked synchronously, zero scrypt calls
    const invalidBurst = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        app.request('/api/v1/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: `badburst${i}`, password: 'password123', inviteCode: `NOPE${i}` }),
        }, clientEnv),
      ),
    )
    expect(invalidBurst.filter((r) => r.status === 400)).toHaveLength(5)
    expect(invalidBurst.filter((r) => r.status === 429)).toHaveLength(5)
    expect(hashSpy).toHaveBeenCalledTimes(0)

    // 2) Fresh source sending concurrent burst of valid codes: slots reserved before hashPassword,
    // capping concurrent in-flight registrations at AUTH_RPM (5)
    resetLoginRateLimit()
    const clientEnv2 = { incoming: { socket: { remoteAddress: '198.51.100.89' } } }
    const validBurst = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        app.request('/api/v1/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: `okburst${i}`, password: 'password123', inviteCode: 'BURSTOK' }),
        }, clientEnv2),
      ),
    )
    expect(validBurst.filter((r) => r.status === 200)).toHaveLength(5)
    expect(validBurst.filter((r) => r.status === 429)).toHaveLength(5)
    expect(hashSpy).toHaveBeenCalledTimes(5)
  })

  it('creates the consolidated invite schema on a fresh database and supports repeated startup', async () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const freshDb = drizzle(sqlite, { schema })
    await client.runDatabaseMigrations(freshDb)
    const ledger = sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all()
    expect(ledger.at(-1)).toMatchObject({ created_at: 1793900000000 })
    expect((sqlite.pragma('table_info(instance_invites)') as Array<{ name: string }>).map((column) => column.name))
      .not.toContain('auto_join_library_id')
    expect(freshDb.select().from(schema.instanceInviteLibraries).all()).toEqual([])
    await client.runDatabaseMigrations(freshDb)
    expect(sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all()).toEqual(ledger)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    expect(sqlite.pragma('quick_check')).toEqual([{ quick_check: 'ok' }])
    sqlite.close()
  })

  it.each([false, true])('upgrades 0060 with allowRegistration=%s using the single consolidated migration', async (allowRegistration) => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('foreign_keys = ON')
    const upgradeDb = drizzle(sqlite, { schema })
    migrateBeforeBookRetirement(upgradeDb, { migrationsFolder })
    client.retargetBookIdReferences(upgradeDb)
    migrateWithTagFilter(upgradeDb, { migrationsFolder }, (entry) => entry.tag < '0061_instance_invites')

    const now = Date.now()
    sqlite.prepare("INSERT INTO users (id, username, username_normalized, password_hash, created_at, updated_at) VALUES ('u-own', 'owner', 'owner', 'h', ?, ?)").run(now, now)
    sqlite.prepare("INSERT INTO instance (id, owner_user_id, allow_registration, allow_guest_access, created_at, updated_at) VALUES ('instance', 'u-own', ?, 0, ?, ?)").run(Number(allowRegistration), now, now)

    await client.runDatabaseMigrations(upgradeDb)

    const inst = upgradeDb.select().from(schema.instance).get()
    expect(inst?.registrationMode).toBe(allowRegistration ? 'open' : 'closed')
    expect(inst?.allowRegistration).toBe(allowRegistration)
    expect(upgradeDb.select().from(schema.instanceInviteLibraries).all()).toEqual([])
    expect((sqlite.pragma('table_info(instance_invites)') as Array<{ name: string }>).map((column) => column.name))
      .not.toContain('auto_join_library_id')
    const ledger = sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all()
    expect(ledger.at(-1)).toMatchObject({ created_at: 1793900000000 })
    await client.runDatabaseMigrations(upgradeDb)
    expect(sqlite.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all()).toEqual(ledger)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    expect(sqlite.pragma('quick_check')).toEqual([{ quick_check: 'ok' }])
    sqlite.close()
  })
})
