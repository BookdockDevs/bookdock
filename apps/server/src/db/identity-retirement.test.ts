import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as client from './client'
import * as schema from './schema'
import { LEGACY_IDENTITY_RETIREMENT_TAG, migrationTagWhen } from './migration-stage'
import { authGuard, requireOwner, resetAuthCaches } from '../middleware/auth.guard'
import { errorHandler } from '../middleware/error'
import authRoutes from '../modules/auth/auth.routes'
import { createSession, isInstanceOwner, setupUser, updateInstanceSettings } from '../modules/auth/auth.service'
import { createLibrary } from '../modules/libraries/libraries.service'
import { requireLibraryRelation, resolveLibraryRelation, resolveSharedVersionRead } from '../modules/libraries/library-access'
import settingsRoutes from '../modules/settings/settings.routes'
import { transferInstanceOwnership } from '../modules/users/users.service'

let db: ReturnType<typeof client.getDb>
let ownerId: string
let ownerToken: string

beforeEach(async () => {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  db = drizzle(sqlite, { schema })
  vi.spyOn(client, 'getDb').mockReturnValue(db)
  await client.runDatabaseMigrations(db)
  resetAuthCaches()
  const result = await setupUser('owner', 'password123')
  ownerId = result.user.id
  ownerToken = result.token
})

afterEach(() => {
  resetAuthCaches()
  db.$client.close()
  vi.restoreAllMocks()
})

function legacyIdentityCutoff() {
  return migrationTagWhen(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations'),
    LEGACY_IDENTITY_RETIREMENT_TAG,
  )
}

function makeLegacyIdentity() {
  // Strip the legacy-identity retirement and everything after it (idea
  // discussion tables included); the cutoff is derived from the journal so
  // later migrations stay covered without touching this file.
  const cutoff = legacyIdentityCutoff()
  db.$client.exec(`DROP TABLE IF EXISTS storage_connections;
    DROP TABLE IF EXISTS storage_transfer_tasks;
    ALTER TABLE blobs DROP COLUMN storage_tier;
    ALTER TABLE blobs DROP COLUMN last_accessed_at;
    ALTER TABLE instance DROP COLUMN storage_backend_enabled;
    ALTER TABLE instance DROP COLUMN storage_backend_connection_id;
    ALTER TABLE instance DROP COLUMN storage_backend_base_path;
    ALTER TABLE instance DROP COLUMN storage_backend_cache_max_mb;
    ALTER TABLE instance DROP COLUMN storage_backend_status;
    ALTER TABLE instance DROP COLUMN storage_backend_last_tested_at;
    ALTER TABLE instance DROP COLUMN storage_backend_latency_ms;
    DROP TRIGGER idea_comments_deleted_author;
    DROP TABLE idea_comment_likes; DROP TABLE idea_likes; DROP TABLE idea_comments;
    ALTER TABLE ideas DROP COLUMN source_library_book_version_id;
    ALTER TABLE ideas DROP COLUMN revision_id;
    ALTER TABLE ideas DROP COLUMN edited_at;
    DELETE FROM __drizzle_migrations WHERE created_at >= ${cutoff};`)
  db.$client.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'member'")
  db.$client.prepare("UPDATE users SET role = 'owner' WHERE id = ?").run(ownerId)
  db.$client.exec("CREATE TABLE instance_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
  db.$client.exec("INSERT INTO instance_settings VALUES ('allowGuestAccess', 'true'), ('obsolete', 'discard')")
  db.$client.exec(`DELETE FROM __drizzle_migrations WHERE created_at = ${cutoff}`)
}

function seedMember() {
  db.insert(schema.users).values({ id: 'member', username: 'member', passwordHash: 'test-credential', createdAt: 1 }).run()
  return createSession('member').token
}

function makeApp() {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('/api/v1/*', authGuard())
  app.route('/api/v1/auth', authRoutes)
  app.route('/api/v1/settings', settingsRoutes)
  app.get('/api/v1/owner', requireOwner(), (c) => c.json({ data: c.get('user') }))
  app.get('/api/v1/identity', (c) => c.json({ data: c.get('user') }))
  app.post('/api/v1/identity', (c) => c.json({ data: c.get('user') }))
  return app
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` })

describe('identity/configuration retirement', () => {
  it('creates a fresh database without legacy identity/configuration and requires setup once', async () => {
    expect(db.$client.pragma('table_info(users)')).not.toContainEqual(expect.objectContaining({ name: 'role' }))
    expect(db.$client.prepare("SELECT name FROM sqlite_master WHERE name = 'instance_settings'").get()).toBeUndefined()
    expect(isInstanceOwner(ownerId)).toBe(true)
    await expect(setupUser('second', 'password123')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(db.select().from(schema.instance).get()).toMatchObject({ allowRegistration: false, allowGuestAccess: false })
  })

  it('retains credentials, sessions, personal settings, ownership and effective limits on upgrade', async () => {
    seedMember()
    updateInstanceSettings({ uploadMaxBytes: 123456, allowUserCreateLibrary: false, allowUserUpload: false, allowGuestAccess: true })
    db.insert(schema.settings).values({ id: 'real-setting', userId: ownerId, key: 'library', value: '{"view":"list"}' }).run()
    makeLegacyIdentity()
    db.$client.prepare("INSERT INTO users (id, username, role, created_at) VALUES ('guest', 'guest', 'guest', 1)").run()
    db.$client.exec("INSERT INTO settings (id, user_id, key, value) VALUES ('seed', 'guest', 'tocRuleSeeded', '1')")
    const beforeUsers = db.select().from(schema.users).all().filter((u) => u.id !== 'guest')
    const beforeSessions = db.select().from(schema.sessions).all()
    const beforeLibraries = db.select().from(schema.libraries).all()
    await client.runDatabaseMigrations(db)
    expect(db.select().from(schema.users).all()).toEqual(beforeUsers)
    expect(db.select().from(schema.sessions).all()).toEqual(beforeSessions)
    expect(db.select().from(schema.libraries).all()).toEqual(beforeLibraries)
    expect(db.select().from(schema.settings).all()).toHaveLength(1)
    expect(db.select().from(schema.instance).get()).toMatchObject({ ownerUserId: ownerId, uploadMaxBytes: 123456, allowUserCreateLibrary: false, allowUserUpload: false, allowRegistration: false, allowGuestAccess: false })
    expect(db.$client.pragma('foreign_key_check')).toEqual([])
    expect(db.$client.pragma('quick_check')).toEqual([{ quick_check: 'ok' }])
    await client.runDatabaseMigrations(db)
    expect(db.select().from(schema.users).all()).toEqual(beforeUsers)
  })

  it.each(['missing-instance', 'disabled-owner', 'guest-credential', 'guest-library', 'guest-setting', 'guest-rule'])('refuses %s without deleting data or recording retirement', async (invalid) => {
    makeLegacyIdentity()
    db.$client.exec("INSERT INTO users (id, username, role, created_at) VALUES ('guest', 'guest', 'guest', 1)")
    if (invalid === 'missing-instance') db.$client.exec('DELETE FROM instance')
    if (invalid === 'disabled-owner') db.update(schema.users).set({ disabled: 1 }).where(eq(schema.users.id, ownerId)).run()
    if (invalid === 'guest-credential') db.$client.exec("UPDATE users SET password_hash = 'credential' WHERE id = 'guest'")
    if (invalid === 'guest-library') db.insert(schema.libraries).values({ id: 'guest-library', userId: 'guest', name: '', type: 'private', createdAt: 1, updatedAt: 1 }).run()
    if (invalid === 'guest-setting') db.$client.exec("INSERT INTO settings (id, user_id, key, value) VALUES ('custom', 'guest', 'ai', '{}')")
    if (invalid === 'guest-rule') db.insert(schema.tocRules).values({ id: 'custom-rule', userId: 'guest', name: 'custom', createdAt: 1, updatedAt: 2 }).run()
    const before = db.$client.prepare('SELECT * FROM users ORDER BY id').all()
    await expect(client.runDatabaseMigrations(db)).rejects.toMatchObject({ cause: { code: 'SQLITE_CONSTRAINT_CHECK' } })
    expect(db.$client.prepare('SELECT * FROM users ORDER BY id').all()).toEqual(before)
    expect(db.$client.prepare('SELECT * FROM instance_settings').all()).toHaveLength(2)
    expect(db.$client.prepare(`SELECT * FROM __drizzle_migrations WHERE created_at = ${legacyIdentityCutoff()}`).all()).toEqual([])
  })

  it('derives ownership from instance and updates cached identities immediately after transfer', async () => {
    const memberToken = seedMember()
    const app = makeApp()
    expect((await app.request('/api/v1/owner', { headers: bearer(ownerToken) })).status).toBe(200)
    expect((await app.request('/api/v1/owner', { headers: bearer(memberToken) })).status).toBe(403)
    await transferInstanceOwnership(ownerId, 'member')
    expect((await app.request('/api/v1/owner', { headers: bearer(ownerToken) })).status).toBe(403)
    expect((await app.request('/api/v1/owner', { headers: bearer(memberToken) })).status).toBe(200)
    const me = await (await app.request('/api/v1/auth/me', { headers: bearer(ownerToken) })).json()
    expect(me.data.role).toBe('member')
    db.delete(schema.instance).run()
    expect(isInstanceOwner(ownerId)).toBe(false)
    expect(isInstanceOwner('member')).toBe(false)
  })

  it('cannot bypass closed registration/guest switches and creates no anonymous account', async () => {
    const app = makeApp()
    for (const headers of [{}, { 'x-user-role': 'owner' }, { Authorization: 'Bearer invalid' }]) {
      expect((await app.request('/api/v1/identity', { headers })).status).toBe(401)
    }
    const registration = await app.request('/api/v1/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'newuser', password: 'password123' }) })
    expect(registration.status).toBe(403)
    expect(db.select().from(schema.users).all()).toHaveLength(1)
    updateInstanceSettings({ allowGuestAccess: true })
    const me = await (await app.request('/api/v1/auth/me')).json()
    expect(me.data).toEqual({ user: null, guest: true })
    expect((await app.request('/api/v1/owner')).status).toBe(403)
    expect((await app.request('/api/v1/settings')).status).toBe(401)
    expect((await app.request('/api/v1/identity', { method: 'POST' })).status).toBe(403)
    expect((await app.request('/api/v1/identity', { headers: bearer('invalid') })).status).toBe(401)
    expect(db.select().from(schema.users).all()).toHaveLength(1)
    updateInstanceSettings({ allowGuestAccess: false })
    expect((await app.request('/api/v1/auth/me')).status).toBe(401)
  })

  it('keeps shared Owner/Admin/Member roles separate and enforces anonymous triple gates', async () => {
    seedMember()
    db.insert(schema.users).values({ id: 'admin', username: 'admin', createdAt: 1 }).run()
    const library = await createLibrary({ userId: ownerId }, { name: 'Public', visibility: 'public' })
    db.insert(schema.libraryMemberships).values([
      { id: 'admin-seat', libraryId: library.id, userId: 'admin', role: 'admin', createdAt: 1, updatedAt: 1 },
      { id: 'member-seat', libraryId: library.id, userId: 'member', role: 'member', createdAt: 1, updatedAt: 1 },
    ]).run()
    for (const [userId, role] of [[ownerId, 'owner'], ['admin', 'admin'], ['member', 'member']] as const) {
      expect(await resolveLibraryRelation(library.id, { userId })).toBe(role)
    }
    expect(() => requireLibraryRelation('member', ['owner', 'admin'])).toThrow('Not allowed in this library')
    updateInstanceSettings({ allowUserUpload: false, allowUserCreateLibrary: false })
    await expect(createLibrary({ userId: 'member' }, { name: 'Denied', visibility: 'public' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    db.insert(schema.bookVersions).values({ id: 'version', format: 'txt', size: 1, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBooks).values({ id: 'work', libraryId: library.id, userId: ownerId, title: 'Book', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBookVersions).values({ id: 'listing', libraryId: library.id, libraryBookId: 'work', bookVersionId: 'version', kind: 'personal', guestReadable: true, createdAt: 1, updatedAt: 1 }).run()
    await expect(resolveSharedVersionRead(library.id, 'version', null)).rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
    updateInstanceSettings({ allowGuestAccess: true })
    await expect(resolveSharedVersionRead(library.id, 'version', null)).resolves.toMatchObject({ relation: 'guest' })
    db.update(schema.libraryBookVersions).set({ guestReadable: false }).run()
    await expect(resolveSharedVersionRead(library.id, 'version', null)).rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
    db.update(schema.libraryBookVersions).set({ guestReadable: true }).run()
    db.update(schema.libraries).set({ visibility: 'private' }).where(eq(schema.libraries.id, library.id)).run()
    await expect(resolveSharedVersionRead(library.id, 'version', null)).rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
  })
})
