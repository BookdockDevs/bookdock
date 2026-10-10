import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateTestBaseWithStorage as migrate } from '../../db/migration-stage'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret'
})

import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { sql } from 'drizzle-orm'
import { retargetBookIdReferences } from '../../db/client'

import { createId } from '../../lib/id'
import { avatarVariantKeys } from '../../lib/avatar'
import { errorHandler } from '../../middleware/error'
import { resetAuthCaches } from '../../middleware/auth.guard'
import { hashPassword, verifyPassword } from '../../lib/password'
import usersRoutes from './users.routes'
import { createUser, deleteUser, listUsers, transferInstanceOwnership, updateUser } from './users.service'
import { createSession, resolveSession } from '../auth/auth.service'

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

async function insertUser(
  db: TestDb,
  opts: { username: string; role?: 'owner' | 'member' | 'guest'; password?: string },
) {
  const id = createId('user')
  db.insert(schema.users).values({
    id,
    username: opts.username,
    passwordHash: opts.password ? await hashPassword(opts.password) : null,
    role: opts.role ?? 'member',
    createdAt: Date.now(),
  }).run()
  if (opts.role === 'owner' && !db.select().from(schema.instance).get()) {
    db.insert(schema.instance).values({ id: 'instance', ownerUserId: id, createdAt: 1, updatedAt: 1 }).run()
  }
  return id
}

function insertBook(db: TestDb, userId: string, deletedAt: number | null = null) {
  const now = Date.now()
  let library = db.select().from(schema.libraries).where(eq(schema.libraries.userId, userId)).get()
  if (!library) {
    const id = createId('lib')
    db.insert(schema.libraries).values({ id, userId, type: 'private', name: '', createdAt: now, updatedAt: now }).run()
    library = db.select().from(schema.libraries).where(eq(schema.libraries.id, id)).get()!
  }
  const bookId = createId('book')
  const workId = createId('lb')
  db.insert(schema.bookVersions).values({ id: bookId, format: 'txt', size: 100, createdAt: now, updatedAt: now }).run()
  db.insert(schema.libraryBooks).values({ id: workId, libraryId: library.id, userId, title: 'Book', createdAt: now, updatedAt: now, deletedAt }).run()
  db.insert(schema.libraryBookVersions).values({ id: createId('lbv'), libraryId: library.id, libraryBookId: workId, bookVersionId: bookId, kind: 'personal', createdAt: now, updatedAt: now }).run()
}

function createMemoryStorage() {
  const files = new Map<string, Buffer>()
  const driver: StorageDriver = {
    async put(key, data) {
      files.set(key, Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array))
    },
    async get(key) {
      const buf = files.get(key)
      if (!buf) throw new Error(`missing blob: ${key}`)
      const { Readable } = await import('node:stream')
      return Readable.from(buf)
    },
    async delete(key) {
      files.delete(key)
    },
    async exists(key) {
      return files.has(key)
    },
    async size(key) {
      return files.get(key)?.length ?? 0
    },
  }
  return { driver, files }
}

function createUsersApp(user: { id: string; username: string; role: string }) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('/api/v1/users/*', async (c, next) => {
    c.set('user', { ...user, avatarKey: null })
    return next()
  })
  app.route('/api/v1/users', usersRoutes)
  return app
}

describe('users module', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    resetAuthCaches()
    retargetBookIdReferences(db)
    db.run(sql.raw('DROP TABLE annotations'))
    db.run(sql.raw('DROP TABLE book_tags'))
    db.run(sql.raw('DROP TABLE books'))
    db.run(sql.raw('DROP TABLE shelves'))
    db.run(sql.raw('DROP TABLE tags'))
  })

  it('lists users with book counts (excluding trashed books)', async () => {
    await insertUser(db, { username: 'own', role: 'owner' })
    const memberId = await insertUser(db, { username: 'mem' })
    insertBook(db, memberId)
    insertBook(db, memberId)
    insertBook(db, memberId, Date.now())

    const list = listUsers()
    expect(list).toHaveLength(2)
    const member = list.find((u) => u.id === memberId)!
    expect(member.bookCount).toBe(2)
    expect(member.role).toBe('member')
    expect(member.disabled).toBe(false)
    expect(member.ownedLibraries).toEqual([])
  })

  it('lists owned shared libraries for the account-deletion guard', async () => {
    const memberId = await insertUser(db, { username: 'mem' })
    db.insert(schema.libraries).values({
      id: createId('lib'), userId: memberId, type: 'shared', name: 'City',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.libraries).values({
      id: createId('lib'), userId: memberId, type: 'private', name: 'mem',
      description: '', visibility: null, createdAt: 1, updatedAt: 1,
    }).run()

    const member = listUsers().find((u) => u.id === memberId)!
    // Only shared libraries block deletion; the private one goes with the account.
    expect(member.ownedLibraries).toEqual([{ id: expect.any(String), name: 'City' }])
  })

  it('creates an owner-managed account with exactly one private library', async () => {
    const created = await createUser('managed', 'password123')
    expect(created.role).toBe('member')
    const libraries = db.select().from(schema.libraries).where(eq(schema.libraries.userId, created.id)).all()
    expect(libraries).toHaveLength(1)
    expect(libraries[0]).toMatchObject({ type: 'private' })
  })

  it('disables and re-enables a user', async () => {
    const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
    const memberId = await insertUser(db, { username: 'mem' })
    const disabled = await updateUser(ownerId, memberId, { disabled: true })
    expect(disabled.disabled).toBe(true)
    const enabled = await updateUser(ownerId, memberId, { disabled: false })
    expect(enabled.disabled).toBe(false)
  })

  it('resets a user password', async () => {
    const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
    const memberId = await insertUser(db, { username: 'mem', password: 'oldpass6' })
    await updateUser(ownerId, memberId, { newPassword: 'newpass6' })
    const row = db.select().from(schema.users).where(eq(schema.users.id, memberId)).get()
    expect(await verifyPassword('newpass6', row!.passwordHash!)).toBe(true)
  })

  it('refuses management without an instance owner even if a legacy role says owner', async () => {
    const actorId = await insertUser(db, { username: 'own', role: 'owner' })
    const memberId = await insertUser(db, { username: 'mem' })
    db.delete(schema.instance).run()
    await expect(updateUser(actorId, memberId, { disabled: true })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects disabling oneself', async () => {
    const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
    await insertUser(db, { username: 'other', role: 'owner' })
    await expect(updateUser(ownerId, ownerId, { disabled: true })).rejects.toMatchObject({ code: 'CANNOT_MODIFY_SELF' })
  })

  it('rejects a stale legacy owner after instance ownership moves', async () => {
    const actorId = await insertUser(db, { username: 'actor', role: 'owner' })
    const targetId = await insertUser(db, { username: 'target', role: 'owner' })
    db.update(schema.instance).set({ ownerUserId: targetId }).run()
    db.update(schema.users).set({ disabled: 1 }).where(eq(schema.users.id, actorId)).run()
    await expect(updateUser(actorId, targetId, { disabled: true })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('rejects updates for a missing user', async () => {
    const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
    await expect(updateUser(ownerId, 'missing', { disabled: true })).rejects.toMatchObject({ code: 'USER_NOT_FOUND' })
  })

  describe('routes', () => {
    it('rejects members with 403', async () => {
      const app = createUsersApp({ id: 'u1', username: 'mem', role: 'member' })
      const res = await app.request('/api/v1/users')
      expect(res.status).toBe(403)
    })

    it('lists users for an owner', async () => {
      const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
      db.insert(schema.instance).values({
        id: 'instance', ownerUserId: ownerId, allowRegistration: false,
        allowGuestAccess: false, uploadMaxBytes: null, createdAt: 1, updatedAt: 1,
      }).onConflictDoUpdate({ target: schema.instance.id, set: { ownerUserId: ownerId } }).run()
      const app = createUsersApp({ id: ownerId, username: 'own', role: 'owner' })
      const res = await app.request('/api/v1/users')
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toHaveLength(1)
      expect(body.data[0].username).toBe('own')
    })

    it('lets an owner create a user without signing them in', async () => {
      const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
      db.insert(schema.instance).values({
        id: 'instance', ownerUserId: ownerId, allowRegistration: false,
        allowGuestAccess: false, uploadMaxBytes: null, createdAt: 1, updatedAt: 1,
      }).onConflictDoUpdate({ target: schema.instance.id, set: { ownerUserId: ownerId } }).run()
      const app = createUsersApp({ id: ownerId, username: 'own', role: 'owner' })
      const res = await app.request('/api/v1/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'newbie', password: 'password123' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data.username).toBe('newbie')
      expect(body.data.role).toBe('member')
      expect(db.select().from(schema.sessions).all()).toHaveLength(0)
    })

    it('refuses a stale role-owner who is not the instance owner', async () => {
      const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
      const staleId = await insertUser(db, { username: 'stale', role: 'owner' })
      db.insert(schema.instance).values({
        id: 'instance', ownerUserId: ownerId, allowRegistration: false,
        allowGuestAccess: false, uploadMaxBytes: null, createdAt: 1, updatedAt: 1,
      }).onConflictDoUpdate({ target: schema.instance.id, set: { ownerUserId: ownerId } }).run()
      // The legacy role column still says owner, but ownership lives on the
      // Instance row: a drifted role must grant nothing.
      const app = createUsersApp({ id: staleId, username: 'stale', role: 'owner' })
      const res = await app.request('/api/v1/users')
      expect(res.status).toBe(403)
    })

    it('lets an owner delete a user and transfer instance ownership', async () => {
      const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
      const memberId = await insertUser(db, { username: 'mem', password: 'password123' })
      db.insert(schema.instance).values({
        id: 'instance', ownerUserId: ownerId, allowRegistration: false,
        allowGuestAccess: false, uploadMaxBytes: null, createdAt: 1, updatedAt: 1,
      }).onConflictDoUpdate({ target: schema.instance.id, set: { ownerUserId: ownerId } }).run()
      const app = createUsersApp({ id: ownerId, username: 'own', role: 'owner' })
      const transfer = await app.request('/api/v1/users/instance-owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: memberId }),
      })
      expect(transfer.status).toBe(200)
      expect((await transfer.json()).data).toMatchObject({ ownerUserId: memberId })
      const app2 = createUsersApp({ id: memberId, username: 'mem', role: 'owner' })
      const del = await app2.request(`/api/v1/users/${ownerId}`, { method: 'DELETE' })
      expect(del.status).toBe(200)
      expect(db.select().from(schema.users).where(eq(schema.users.id, ownerId)).get()).toBeUndefined()
    })
  })

  it('revokes all sessions when disabling a user', async () => {
    const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
    const memberId = await insertUser(db, { username: 'mem', password: 'password123' })
    const { token } = createSession(memberId)
    expect(resolveSession(token)).not.toBeNull()
    await updateUser(ownerId, memberId, { disabled: true })
    expect(resolveSession(token)).toBeNull()
  })

  it('revokes all sessions when resetting a password', async () => {
    const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
    const memberId = await insertUser(db, { username: 'mem', password: 'password123' })
    const { token } = createSession(memberId)
    await updateUser(ownerId, memberId, { newPassword: 'password456' })
    expect(resolveSession(token)).toBeNull()
  })

  it('creates a user with a private library and no session', async () => {
    await insertUser(db, { username: 'own', role: 'owner' })
    const created = await createUser('newbie', 'password123')
    expect(created.username).toBe('newbie')
    expect(created.role).toBe('member')
    const libraries = db.select().from(schema.libraries).where(eq(schema.libraries.userId, created.id)).all()
    expect(libraries).toHaveLength(1)
    expect(libraries[0]).toMatchObject({ type: 'private' })
    expect(db.select().from(schema.sessions).all()).toHaveLength(0)
  })

  describe('instance ownership transfer', () => {
    function seedInstanceDb(ownerId: string) {
      db.insert(schema.instance).values({
        id: 'instance', ownerUserId: ownerId, allowRegistration: false,
        allowGuestAccess: false, uploadMaxBytes: null, createdAt: 1, updatedAt: 1,
      }).onConflictDoUpdate({ target: schema.instance.id, set: { ownerUserId: ownerId } }).run()
    }

    it('moves ownership and demotes the former owner atomically', async () => {
      const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
      const memberId = await insertUser(db, { username: 'mem' })
      seedInstanceDb(ownerId)
      expect(await transferInstanceOwnership(ownerId, memberId)).toMatchObject({ ownerUserId: memberId })
      expect(listUsers().find((user) => user.id === ownerId)?.role).toBe('member')
      expect(listUsers().find((user) => user.id === memberId)?.role).toBe('owner')
    })

    it('refuses non-owners and disabled targets', async () => {
      const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
      const memberId = await insertUser(db, { username: 'mem' })
      const otherId = await insertUser(db, { username: 'other' })
      seedInstanceDb(ownerId)
      await expect(transferInstanceOwnership(memberId, otherId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      const offId = await insertUser(db, { username: 'off' })
      db.update(schema.users).set({ disabled: 1 }).where(eq(schema.users.id, offId)).run()
      await expect(transferInstanceOwnership(ownerId, offId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(db.select().from(schema.instance).get()!.ownerUserId).toBe(ownerId)
    })
  })

  describe('user deletion', () => {
    let mem: ReturnType<typeof createMemoryStorage>

    beforeEach(() => {
      mem = createMemoryStorage()
      vi.spyOn(storage, 'getStorage').mockReturnValue(mem.driver)
    })

    function seedInstanceDb(ownerId: string) {
      db.insert(schema.instance).values({
        id: 'instance', ownerUserId: ownerId, allowRegistration: false,
        allowGuestAccess: false, uploadMaxBytes: null, createdAt: 1, updatedAt: 1,
      }).onConflictDoUpdate({ target: schema.instance.id, set: { ownerUserId: ownerId } }).run()
    }

    function seedPrivateLibrary(userId: string, bookId?: string) {
      const libraryId = createId('lib')
      const now = Date.now()
      db.insert(schema.libraries).values({
        id: libraryId, userId, type: 'private', name: userId,
        description: '', visibility: null, createdAt: now, updatedAt: now,
      }).run()
      if (bookId) {
        db.insert(schema.bookVersions).values({ id: bookId, format: 'txt', size: 8, createdAt: now, updatedAt: now }).run()
        const lbId = createId('lb')
        db.insert(schema.libraryBooks).values({
          id: lbId, libraryId, userId, title: 'T', createdAt: now, updatedAt: now,
        }).run()
        db.insert(schema.libraryBookVersions).values({
          id: createId('lbv'), libraryId, libraryBookId: lbId, bookVersionId: bookId,
          kind: 'personal', createdAt: now, updatedAt: now,
        }).run()
        db.insert(schema.bookStates).values({
          userId, bookVersionId: bookId, readStatus: 'reading', percent: 10,
          cfi: null, chapter: null, lastReadAt: null, updatedAt: now,
        }).run()
      }
      return libraryId
    }

    it('self-deletes with password and cleans rows and files', async () => {
      const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
      seedInstanceDb(ownerId)
      const memberId = await insertUser(db, { username: 'mem', password: 'password123' })
      const bookId = createId('book')
      mem.files.set('books/mm/book.epub', Buffer.from('data'))
      mem.files.set(`progress/${memberId}/${bookId}.json`, Buffer.from('{}'))
      seedPrivateLibrary(memberId, bookId)
      db.insert(schema.contentRevisions).values({ id: createId('rev'), bookVersionId: bookId, revisionNo: 1, blobKey: 'books/mm/book.epub', size: 8, chapterCount: 0, createdAt: 1 }).run()
      await insertUser(db, { username: 'ghost', role: 'guest' })

      expect((await deleteUser(memberId, memberId, 'password123')).id).toBe(memberId)
      expect(db.select().from(schema.users).where(eq(schema.users.id, memberId)).get()).toBeUndefined()
      expect(db.select().from(schema.libraries).where(eq(schema.libraries.userId, memberId)).all()).toHaveLength(0)
      expect(db.select().from(schema.bookStates).where(eq(schema.bookStates.userId, memberId)).all()).toHaveLength(0)
      expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, bookId)).get()).toBeUndefined()
      expect(mem.files.has('books/mm/book.epub')).toBe(false)
      expect(mem.files.has(`progress/${memberId}/${bookId}.json`)).toBe(false)
      // The owner, the guest row and other data survive.
      expect(db.select().from(schema.users).all()).toHaveLength(2)
    })

    it('rejects self-deletion with a wrong password and touches nothing', async () => {
      const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
      seedInstanceDb(ownerId)
      const memberId = await insertUser(db, { username: 'mem', password: 'password123' })
      await expect(deleteUser(memberId, memberId, 'wrongpass')).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
      expect(db.select().from(schema.users).where(eq(schema.users.id, memberId)).get()).toBeDefined()
    })

    it('refuses owners of the instance or a shared library', async () => {
      const ownerId = await insertUser(db, { username: 'own', role: 'owner', password: 'password123' })
      seedInstanceDb(ownerId)
      await expect(deleteUser(ownerId, ownerId, 'password123')).rejects.toMatchObject({ code: 'FORBIDDEN' })
      const memberId = await insertUser(db, { username: 'mem', password: 'password123' })
      const libId = createId('lib')
      db.insert(schema.libraries).values({
        id: libId, userId: memberId, type: 'shared', name: 'City',
        description: '', visibility: 'private', createdAt: 1, updatedAt: 1,
      }).run()
      await expect(deleteUser(memberId, memberId, 'password123')).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(deleteUser(ownerId, memberId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('lets owners delete ordinary members and keeps shared blobs by reference', async () => {
      const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
      seedInstanceDb(ownerId)
      const memberId = await insertUser(db, { username: 'mem' })
      const otherId = await insertUser(db, { username: 'other' })
      // Identical uploads share one content-addressed blob key.
      const sharedKey = 'books/ab/shared.epub'
      const bookA = createId('book')
      const bookB = createId('book')
      mem.files.set(sharedKey, Buffer.from('shared'))
      seedPrivateLibrary(memberId, bookA)
      seedPrivateLibrary(otherId, bookB)
      for (const bookId of [bookA, bookB]) {
        db.insert(schema.contentRevisions).values({ id: createId('rev'), bookVersionId: bookId, revisionNo: 1, blobKey: sharedKey, size: 8, chapterCount: 0, createdAt: 1 }).run()
      }

      expect((await deleteUser(ownerId, memberId)).id).toBe(memberId)
      expect(db.select().from(schema.users).where(eq(schema.users.id, memberId)).get()).toBeUndefined()
      // Other user's version keeps the blob alive.
      expect(mem.files.has(sharedKey)).toBe(true)
      expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, bookB)).get()).toBeDefined()
      expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, bookA)).get()).toBeUndefined()
    })

    it('cleans all avatar variants only after the last account reference is deleted', async () => {
      const ownerId = await insertUser(db, { username: 'owner', role: 'owner' })
      seedInstanceDb(ownerId)
      const firstId = await insertUser(db, { username: 'first' })
      const secondId = await insertUser(db, { username: 'second' })
      const key = `ab/${'ab'.repeat(32)}.gif`
      db.update(schema.users).set({ avatarKey: key }).where(eq(schema.users.id, firstId)).run()
      db.update(schema.users).set({ avatarKey: key }).where(eq(schema.users.id, secondId)).run()
      const keys = avatarVariantKeys(key).map((variant) => `avatars/${variant}`)
      for (const storageKey of keys) mem.files.set(storageKey, Buffer.from('image'))
      await deleteUser(ownerId, firstId)
      expect(keys.every((storageKey) => mem.files.has(storageKey))).toBe(true)
      await deleteUser(ownerId, secondId)
      expect(keys.every((storageKey) => !mem.files.has(storageKey))).toBe(true)
    })

    it('refuses missing users', async () => {
      const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
      seedInstanceDb(ownerId)
      await expect(deleteUser(ownerId, 'missing')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' })
    })

    it('cleans new-model revisions, version covers and per-user progress without legacy rows', async () => {
      const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
      seedInstanceDb(ownerId)
      const memberId = await insertUser(db, { username: 'mem' })
      const now = Date.now()
      const libraryId = createId('lib')
      db.insert(schema.libraries).values({
        id: libraryId, userId: memberId, type: 'private', name: 'mem',
        description: '', visibility: null, createdAt: now, updatedAt: now,
      }).run()
      const blobKey = 'blobs/nm/exclusive.epub'
      const coverKey = 'blobs/nm/exclusive.cover.jpg'
      const versionId = createId('book')
      db.insert(schema.bookVersions).values({ id: versionId, format: 'txt', size: 8, createdAt: now, updatedAt: now }).run()
      db.insert(schema.contentRevisions).values({
        id: createId('rev'), bookVersionId: versionId, revisionNo: 1, blobKey,
        size: 8, chapterCount: 1, meta: {}, createdAt: now,
      }).run()
      db.insert(schema.blobs).values([
        { key: blobKey, size: 8, kind: 'book', createdAt: now },
        { key: coverKey, size: 4, kind: 'cover', createdAt: now },
      ]).run()
      const workId = createId('lb')
      db.insert(schema.libraryBooks).values({
        id: workId, libraryId, userId: memberId, title: 'T', coverKey,
        createdAt: now, updatedAt: now,
      }).run()
      db.insert(schema.libraryBookVersions).values({
        id: createId('lbv'), libraryId, libraryBookId: workId, bookVersionId: versionId,
        kind: 'personal', coverKey, createdAt: now, updatedAt: now,
      }).run()
      mem.files.set(blobKey, Buffer.from('data'))
      mem.files.set(coverKey, Buffer.from('cover'))
      mem.files.set(`progress/${memberId}/${versionId}.json`, Buffer.from('{}'))

      expect((await deleteUser(ownerId, memberId)).id).toBe(memberId)
      expect(db.select().from(schema.contentRevisions)
        .where(eq(schema.contentRevisions.bookVersionId, versionId)).all()).toHaveLength(0)
      expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, versionId)).get()).toBeUndefined()
      expect(db.select().from(schema.blobs).where(eq(schema.blobs.key, blobKey)).get()).toBeUndefined()
      expect(db.select().from(schema.blobs).where(eq(schema.blobs.key, coverKey)).get()).toBeUndefined()
      expect(mem.files.has(blobKey)).toBe(false)
      expect(mem.files.has(coverKey)).toBe(false)
      expect(mem.files.has(`progress/${memberId}/${versionId}.json`)).toBe(false)
    })

    it('reassigns shared creator rows to the library owner instead of failing', async () => {
      const ownerId = await insertUser(db, { username: 'own', role: 'owner' })
      seedInstanceDb(ownerId)
      const adminId = await insertUser(db, { username: 'adm' })
      seedPrivateLibrary(adminId)
      const now = Date.now()
      const sharedId = createId('lib')
      db.insert(schema.libraries).values({
        id: sharedId, userId: ownerId, type: 'shared', name: 'City',
        description: '', visibility: 'public', createdAt: now, updatedAt: now,
      }).run()
      // Rows the admin created as a manager: the content belongs to the city.
      const workId = createId('lb')
      db.insert(schema.libraryBooks).values({
        id: workId, libraryId: sharedId, userId: adminId, title: 'City Work',
        createdAt: now, updatedAt: now,
      }).run()
      const categoryId = createId('cat')
      db.insert(schema.libraryCategories).values({
        id: categoryId, libraryId: sharedId, userId: adminId, name: 'Sci-Fi',
        createdAt: now, updatedAt: now,
      }).run()
      const tagId = createId('ltag')
      db.insert(schema.libraryTags).values({
        id: tagId, libraryId: sharedId, userId: adminId, name: 'Classic',
        createdAt: now, updatedAt: now,
      }).run()

      expect((await deleteUser(ownerId, adminId)).id).toBe(adminId)
      expect(db.select().from(schema.users).where(eq(schema.users.id, adminId)).get()).toBeUndefined()
      // The city's rows survive, attributed to the library owner.
      expect(db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, workId)).get())
        .toMatchObject({ userId: ownerId })
      expect(db.select().from(schema.libraryCategories).where(eq(schema.libraryCategories.id, categoryId)).get())
        .toMatchObject({ userId: ownerId })
      expect(db.select().from(schema.libraryTags).where(eq(schema.libraryTags.id, tagId)).get())
        .toMatchObject({ userId: ownerId })
    })
  })
})
