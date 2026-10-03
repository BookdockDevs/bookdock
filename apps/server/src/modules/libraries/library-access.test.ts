import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateBeforeBookRetirement as migrate } from '../../db/migration-stage'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { getLibrary, getLibraryBookVersion, requireLibraryRelation, resolveLibraryRelation, resolveSharedVersionRead, resolveSourceRead } from './library-access'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

describe('library access base', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let adminId: string
  let memberId: string
  let outsiderId: string
  let libraryId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)

    ownerId = createId('user')
    adminId = createId('user')
    memberId = createId('user')
    outsiderId = createId('user')
    for (const [id, username] of [[ownerId, 'owner'], [adminId, 'admin'], [memberId, 'member'], [outsiderId, 'outsider']] as const) {
      db.insert(schema.users).values({ id, username, createdAt: 1 }).run()
    }
    libraryId = createId('lib')
    db.insert(schema.libraries).values({ id: libraryId, userId: ownerId, type: 'shared', name: 'City', visibility: 'public', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryMemberships).values({ id: createId('m'), libraryId, userId: adminId, role: 'admin', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryMemberships).values({ id: createId('m'), libraryId, userId: memberId, role: 'member', createdAt: 1, updatedAt: 1 }).run()
  })

  it('resolves owner/admin/member/non-member/guest distinctly', async () => {
    await expect(resolveLibraryRelation(libraryId, { userId: ownerId })).resolves.toBe('owner')
    await expect(resolveLibraryRelation(libraryId, { userId: adminId })).resolves.toBe('admin')
    await expect(resolveLibraryRelation(libraryId, { userId: memberId })).resolves.toBe('member')
    await expect(resolveLibraryRelation(libraryId, { userId: outsiderId })).resolves.toBe('non-member')
    await expect(resolveLibraryRelation(libraryId, { userId: null })).resolves.toBe('guest')
  })

  it('rejects unknown libraries without leaking membership state', async () => {
    await expect(resolveLibraryRelation('nope', { userId: outsiderId })).rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
    await expect(getLibrary('nope')).rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
  })

  it('gates relations with a single checkpoint', () => {
    expect(() => requireLibraryRelation('admin', ['owner', 'admin'])).not.toThrow()
    expect(() => requireLibraryRelation('member', ['owner', 'admin'])).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }))
    expect(() => requireLibraryRelation('guest', ['non-member'])).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }))
  })

  it('scopes version reads to their library', async () => {
    const otherId = createId('lib')
    db.insert(schema.libraries).values({ id: otherId, userId: ownerId, type: 'shared', name: 'Other', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.bookVersions).values({ id: 'v1', format: 'epub', size: 10, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBooks).values({ id: 'b1', libraryId: otherId, userId: ownerId, title: 'W', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBookVersions).values({ id: 'lbv1', libraryId: otherId, libraryBookId: 'b1', bookVersionId: 'v1', kind: 'personal', createdAt: 1, updatedAt: 1 }).run()

    await expect(getLibraryBookVersion(otherId, 'lbv1')).resolves.toMatchObject({ id: 'lbv1' })
    await expect(getLibraryBookVersion(libraryId, 'lbv1')).rejects.toMatchObject({ code: 'LIBRARY_VERSION_NOT_FOUND' })
  })

  it('judges B source readability without deleting provenance', async () => {
    db.insert(schema.bookVersions).values({ id: 'v9', format: 'txt', size: 5, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.contentRevisions).values({ id: 'r9', bookVersionId: 'v9', revisionNo: 1, blobKey: 'k9', size: 5, createdAt: 1 }).run()
    db.insert(schema.libraryBooks).values({ id: 'sb', libraryId, userId: ownerId, title: 'S', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBookVersions).values({
      id: 'src', libraryId, libraryBookId: 'sb', bookVersionId: 'v9',
      kind: 'personal', status: 'published', createdAt: 1, updatedAt: 1,
    }).run()
    const b = { sourceLibraryId: libraryId, sourceLibraryBookVersionId: 'src' }

    await expect(resolveSourceRead(b, { userId: memberId })).resolves.toMatchObject({ readable: true })
    // Source reads follow the same visibility rules as any other read (4.3): an
    // authenticated non-member of a public library may read it, a guest may not
    // (the version is not guest-readable), and a non-member of a gated library
    // never can.
    await expect(resolveSourceRead(b, { userId: outsiderId })).resolves.toMatchObject({ readable: true })
    await expect(resolveSourceRead(b, { userId: null })).resolves.toMatchObject({ readable: false })
    db.update(schema.libraries).set({ visibility: 'password' }).run()
    await expect(resolveSourceRead(b, { userId: outsiderId })).resolves.toMatchObject({ readable: false })
    db.update(schema.libraries).set({ visibility: 'public' }).run()

    db.update(schema.libraryBookVersions).set({ status: 'unlisted' }).run()
    await expect(resolveSourceRead(b, { userId: memberId })).resolves.toMatchObject({ readable: false })

    // Source deleted: unreadable, but the verdict still carries the provenance.
    db.delete(schema.libraryBookVersions).run()
    await expect(resolveSourceRead(b, { userId: memberId })).resolves.toMatchObject({
      readable: false, sourceLibraryId: libraryId, sourceLibraryBookVersionId: 'src',
    })
  })
})

describe('shared version reads', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let memberId: string
  let adminId: string
  let outsiderId: string
  let libraryId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    ownerId = createId('user')
    memberId = createId('user')
    adminId = createId('user')
    outsiderId = createId('user')
    for (const [id, username] of [[ownerId, 'owner'], [memberId, 'member'], [adminId, 'admin'], [outsiderId, 'outsider']] as const) {
      db.insert(schema.users).values({ id, username, createdAt: 1 }).run()
    }
    db.insert(schema.instance).values({
      id: 'instance', ownerUserId: ownerId, allowRegistration: false,
      allowGuestAccess: true, uploadMaxBytes: null, createdAt: 1, updatedAt: 1,
    }).run()
    libraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: libraryId, userId: ownerId, type: 'shared', name: 'City',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.libraryMemberships).values({
      id: createId('m'), libraryId, userId: memberId, role: 'member', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.libraryMemberships).values({
      id: createId('m'), libraryId, userId: adminId, role: 'admin', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.bookVersions).values({ id: 'v1', format: 'txt', size: 5, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBooks).values({ id: 'wb', libraryId, userId: ownerId, title: 'W', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBookVersions).values({
      id: 'lv1', libraryId, libraryBookId: 'wb', bookVersionId: 'v1',
      kind: 'personal', status: 'published', createdAt: 1, updatedAt: 1,
    }).run()
  })

  it('serves members and owners while hiding unlisted versions', async () => {
    await expect(resolveSharedVersionRead(libraryId, 'v1', ownerId)).resolves.toMatchObject({ relation: 'owner' })
    await expect(resolveSharedVersionRead(libraryId, 'v1', memberId)).resolves.toMatchObject({ relation: 'member' })
    db.update(schema.libraryBookVersions).set({ status: 'unlisted' }).where(eq(schema.libraryBookVersions.id, 'lv1')).run()
    await expect(resolveSharedVersionRead(libraryId, 'v1', memberId))
      .rejects.toMatchObject({ code: 'LIBRARY_VERSION_NOT_FOUND' })
    // Hiding is a member-facing switch, not a read ban: the curator keeps
    // reading what they hid.
    await expect(resolveSharedVersionRead(libraryId, 'v1', ownerId))
      .resolves.toMatchObject({ relation: 'owner' })
    await expect(resolveSharedVersionRead(libraryId, 'v1', adminId))
      .resolves.toMatchObject({ relation: 'admin' })
  })

  it('keeps reading an effectively hidden work available to its managers', async () => {
    db.insert(schema.libraryCategories).values({
      id: 'cat1', libraryId, userId: ownerId, name: 'Hidden shelf',
      sortOrder: 0, pinned: false, hidden: true, createdAt: 1, updatedAt: 1,
    }).run()
    db.update(schema.libraryBooks).set({ categoryId: 'cat1' }).where(eq(schema.libraryBooks.id, 'wb')).run()
    await expect(resolveSharedVersionRead(libraryId, 'v1', memberId))
      .rejects.toMatchObject({ code: 'LIBRARY_VERSION_NOT_FOUND' })
    await expect(resolveSharedVersionRead(libraryId, 'v1', ownerId))
      .resolves.toMatchObject({ relation: 'owner' })
    await expect(resolveSharedVersionRead(libraryId, 'v1', adminId))
      .resolves.toMatchObject({ relation: 'admin' })
  })

  it('lets authenticated non-members read public scope without the guest switch', async () => {
    db.update(schema.instance).set({ allowGuestAccess: false }).run()
    await expect(resolveSharedVersionRead(libraryId, 'v1', outsiderId))
      .resolves.toMatchObject({ relation: 'non-member' })
  })

  it('gates guests on the instance switch and the listing flag', async () => {
    // Neither switch nor flag: invisible.
    await expect(resolveSharedVersionRead(libraryId, 'v1', null))
      .rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
    db.update(schema.libraryBookVersions).set({ guestReadable: true }).where(eq(schema.libraryBookVersions.id, 'lv1')).run()
    await expect(resolveSharedVersionRead(libraryId, 'v1', null))
      .resolves.toMatchObject({ relation: 'guest' })
    db.update(schema.instance).set({ allowGuestAccess: false }).run()
    await expect(resolveSharedVersionRead(libraryId, 'v1', null))
      .rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
  })

  it('keeps one listing’s guest flag from opening a sibling library’s copy', async () => {
    const otherId = createId('lib')
    db.insert(schema.libraries).values({
      id: otherId, userId: ownerId, type: 'shared', name: 'Other',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.libraryBooks).values({ id: 'wb2', libraryId: otherId, userId: ownerId, title: 'W', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBookVersions).values({
      id: 'lv2', libraryId: otherId, libraryBookId: 'wb2', bookVersionId: 'v1',
      kind: 'personal', status: 'published', createdAt: 1, updatedAt: 1,
    }).run()
    // Same BookVersion, flag open in the first library only.
    db.update(schema.libraryBookVersions).set({ guestReadable: true }).where(eq(schema.libraryBookVersions.id, 'lv1')).run()
    await expect(resolveSharedVersionRead(libraryId, 'v1', null))
      .resolves.toMatchObject({ relation: 'guest' })
    await expect(resolveSharedVersionRead(otherId, 'v1', null))
      .rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
  })

  it('refuses cross-library, gated-library and private reads without leaking', async () => {
    const otherId = createId('lib')
    db.insert(schema.libraries).values({
      id: otherId, userId: ownerId, type: 'shared', name: 'Other',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    // v1 is not linked in the other library.
    await expect(resolveSharedVersionRead(otherId, 'v1', memberId))
      .rejects.toMatchObject({ code: 'LIBRARY_VERSION_NOT_FOUND' })
    // Password and private libraries are invisible to outsiders and guests.
    db.update(schema.libraries).set({ visibility: 'password' }).where(eq(schema.libraries.id, libraryId)).run()
    await expect(resolveSharedVersionRead(libraryId, 'v1', outsiderId))
      .rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
    await expect(resolveSharedVersionRead(libraryId, 'v1', null))
      .rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
    // Members keep reading through the gate.
    await expect(resolveSharedVersionRead(libraryId, 'v1', memberId))
      .resolves.toMatchObject({ relation: 'member' })
    db.update(schema.libraries).set({ type: 'private', visibility: null }).where(eq(schema.libraries.id, libraryId)).run()
    await expect(resolveSharedVersionRead(libraryId, 'v1', memberId))
      .rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
  })
})
