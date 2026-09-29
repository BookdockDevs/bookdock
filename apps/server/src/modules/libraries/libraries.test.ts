import { describe, expect, it, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { createId } from '../../lib/id'
import { resetInstanceCache } from '../auth/auth.service'
import { listLibraryCategories } from '../shelves/shelves.service'
import { resolveSharedVersionRead } from './library-access'
import {
  addMember,
  createLibrary,
  createLibraryInvite,
  deleteLibrary,
  getLibrary,
  getLibraryInviteStatus,
  getRelation,
  joinLibrary,
  joinLibraryByInvite,
  listLibraries,
  listMembers,
  previewLibraryInvite,
  removeMember,
  revokeLibraryInvite,
  setMemberRole,
  setVersionGuestReadable,
  transferLibraryOwnership,
  updateLibrary,
} from './libraries.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

describe('libraries service', () => {
  let db: ReturnType<typeof createTestDb>
  let aliceId: string
  let bobId: string
  let carolId: string
  let sharedId: string

  function seedUser(username: string, overrides: Partial<typeof schema.users.$inferInsert> = {}) {
    const id = createId('user')
    db.insert(schema.users).values({
      id, username, passwordHash: null, role: 'member', disabled: 0, createdAt: 1, ...overrides,
    }).run()
    return id
  }

  function seedLibrary(ownerId: string, overrides: Partial<typeof schema.libraries.$inferInsert> = {}) {
    const id = createId('lib')
    db.insert(schema.libraries).values({
      id, userId: ownerId, type: 'shared', name: 'City', description: '',
      visibility: 'private', createdAt: 1, updatedAt: 1, ...overrides,
    }).run()
    return id
  }

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    aliceId = seedUser('alice')
    bobId = seedUser('bob')
    carolId = seedUser('carol')
    // Alice owns a private library and one private shared library.
    db.insert(schema.libraries).values({
      id: createId('lib'), userId: aliceId, type: 'private', name: 'alice',
      description: '', visibility: null, createdAt: 1, updatedAt: 1,
    }).run()
    sharedId = seedLibrary(aliceId)
  })

  it('mints the invitation on creation and on switching to private, without a generate call', async () => {
    const created = await createLibrary({ userId: bobId, isGuest: false }, { name: 'Circle' })
    expect(created.visibility).toBe('private')
    expect(getLibraryInviteStatus(bobId, created.id)).toMatchObject({ active: true })
    expect(getLibraryInviteStatus(bobId, created.id).token)
      .toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/)

    const open = await createLibrary({ userId: bobId, isGuest: false }, { name: 'Open', visibility: 'public' })
    expect(() => getLibraryInviteStatus(bobId, open.id)).toThrowError(expect.objectContaining({ code: 'LIBRARY_NOT_FOUND' }))

    await updateLibrary(bobId, open.id, { visibility: 'private' })
    expect(getLibraryInviteStatus(bobId, open.id)).toMatchObject({ active: true })
    // One row per library: the automatic path never stacks a second code.
    expect(db.select().from(schema.libraryInvites).all()).toHaveLength(2)
  })

  it('keeps a private invitation visible to managers until they revoke or replace it', async () => {
    expect(getLibraryInviteStatus(aliceId, sharedId)).toMatchObject({ active: false, token: null })
    const first = createLibraryInvite(aliceId, sharedId)
    // The code is short enough to read aloud and retyped from a screenshot.
    expect(first.token).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/)
    expect(getLibraryInviteStatus(aliceId, sharedId).token).toBe(first.token)
    expect(() => getLibraryInviteStatus(bobId, sharedId)).toThrowError(expect.objectContaining({ code: 'LIBRARY_NOT_FOUND' }))
    expect(previewLibraryInvite(bobId, first.token)).toMatchObject({ name: 'City', relation: 'non-member' })
    // The invitee is told the same head counts a member sees on the row.
    expect(previewLibraryInvite(bobId, first.token)).toMatchObject({ memberCount: 1, workCount: 0 })
    const second = createLibraryInvite(aliceId, sharedId)
    expect(second.token).not.toBe(first.token)
    expect(() => previewLibraryInvite(bobId, first.token)).toThrowError(expect.objectContaining({ code: 'LIBRARY_NOT_FOUND' }))
    expect(joinLibraryByInvite(bobId, second.token)).toEqual({ libraryId: sharedId, relation: 'member' })
    expect(joinLibraryByInvite(bobId, second.token)).toEqual({ libraryId: sharedId, relation: 'member' })
    expect(db.select().from(schema.libraryMemberships).where(eq(schema.libraryMemberships.libraryId, sharedId)).all()).toHaveLength(1)
    await removeMember(aliceId, sharedId, bobId)
    expect(joinLibraryByInvite(bobId, second.token)).toEqual({ libraryId: sharedId, relation: 'member' })
    revokeLibraryInvite(aliceId, sharedId)
    expect(() => joinLibraryByInvite(carolId, second.token)).toThrowError(expect.objectContaining({ code: 'LIBRARY_NOT_FOUND' }))
  })

  it('invalidates the invitation when a library leaves private visibility', async () => {
    const invite = createLibraryInvite(aliceId, sharedId)
    await updateLibrary(aliceId, sharedId, { visibility: 'public' })
    expect(() => previewLibraryInvite(bobId, invite.token)).toThrowError(expect.objectContaining({ code: 'LIBRARY_NOT_FOUND' }))
    expect(db.select().from(schema.libraryInvites).all()).toHaveLength(0)
  })

  it('keeps the link under the new owner after a library transfer', async () => {
    const invite = createLibraryInvite(aliceId, sharedId)
    await addMember(aliceId, sharedId, { userId: bobId, role: 'member' })
    await transferLibraryOwnership(aliceId, sharedId, bobId)
    expect(getLibraryInviteStatus(bobId, sharedId).token).toBe(invite.token)
    expect(previewLibraryInvite(carolId, invite.token).libraryId).toBe(sharedId)
  })

  it('creates shared libraries and refuses guests', async () => {
    const created = await createLibrary({ userId: bobId, isGuest: false }, { name: 'Club' })
    expect(created).toMatchObject({ type: 'shared', ownerUserId: bobId, visibility: 'private' })
    await expect(createLibrary({ userId: null, isGuest: true }, { name: 'Club' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(createLibrary({ userId: bobId, isGuest: false }, { name: 'Locked', visibility: 'password' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    const locked = await createLibrary(
      { userId: bobId, isGuest: false },
      { name: 'Locked', visibility: 'password', accessPassword: 's3cret' },
    )
    expect(locked.visibility).toBe('password')
    // The hash is stored but never exposed.
    expect(locked).not.toHaveProperty('accessPasswordHash')
    const stored = db.select().from(schema.libraries).where(eq(schema.libraries.id, locked.id)).get()!
    expect(stored.accessPasswordHash).toBeTruthy()
    expect(stored.accessPasswordHash).not.toContain('s3cret')
  })

  it('refuses library creation for members when the instance switch is off', async () => {
    db.insert(schema.instance).values({
      id: 'instance', ownerUserId: aliceId, allowRegistration: false, allowGuestAccess: false,
      uploadMaxBytes: null, allowUserCreateLibrary: false, allowUserUpload: true,
      createdAt: 1, updatedAt: 1,
    }).run()
    resetInstanceCache()
    try {
      await expect(createLibrary({ userId: bobId, isGuest: false }, { name: 'Nope' }))
        .rejects.toMatchObject({ code: 'FORBIDDEN' })
      // The instance owner always bypasses the switch.
      const created = await createLibrary({ userId: aliceId, isGuest: false }, { name: 'Owner City' })
      expect(created).toMatchObject({ type: 'shared', ownerUserId: aliceId })
    } finally {
      resetInstanceCache()
    }
  })

  it('lists only discoverable libraries per identity', async () => {
    const pubId = seedLibrary(bobId, { visibility: 'public', name: 'Open' })
    db.insert(schema.libraryMemberships).values({
      id: createId('lbm'), libraryId: sharedId, userId: bobId, role: 'member', createdAt: 1, updatedAt: 1,
    }).run()
    const alice = await listLibraries({ userId: aliceId, isGuest: false })
    expect(alice.map((l) => l.id)).toEqual(expect.arrayContaining([sharedId, pubId]))
    expect(alice.filter((l) => l.type === 'private')).toHaveLength(1)
    const bob = await listLibraries({ userId: bobId, isGuest: false })
    expect(bob.map((l) => l.id)).toEqual(expect.arrayContaining([sharedId, pubId]))
    expect(bob.filter((l) => l.type === 'private')).toHaveLength(0)
    const carol = await listLibraries({ userId: carolId, isGuest: false })
    expect(carol.map((l) => l.id)).toEqual([pubId])
    const guest = await listLibraries({ userId: null, isGuest: true })
    expect(guest.map((l) => l.id)).toEqual([pubId])
  })

  it('reports a wrong access password as its own error code, not a generic failure', async () => {
    const locked = await createLibrary(
      { userId: bobId, isGuest: false },
      { name: 'Locked', visibility: 'password', accessPassword: 's3cret' },
    )
    await expect(joinLibrary(aliceId, locked.id, 'nope')).rejects.toMatchObject({ code: 'INVALID_LIBRARY_PASSWORD' })
    // The right password still works, so the check is the password and not a lockout.
    await expect(joinLibrary(aliceId, locked.id, 's3cret')).resolves.toMatchObject({ relation: 'member' })
  })

  it('orders shared libraries by when this reader joined, oldest first', async () => {
    const joined = (libraryId: string, at: number) => {
      db.insert(schema.libraryMemberships).values({
        id: createId('lbm'), libraryId, userId: aliceId, role: 'member', createdAt: at, updatedAt: at,
      }).run()
    }
    // Created out of order, and joined out of order too: the point is that the
    // reader's own membership time wins over the library's creation time.
    const early = seedLibrary(bobId, { name: 'Joined early', createdAt: 100, updatedAt: 1 })
    const later = seedLibrary(bobId, { name: 'Joined later', createdAt: 200, updatedAt: 1 })
    seedLibrary(aliceId, { name: 'Mine', createdAt: 300, updatedAt: 1 })
    joined(early, 500)
    joined(later, 900)
    // Editing settings bumps updatedAt; that must not move a row.
    await updateLibrary(bobId, early, { description: 'touched' })

    const rows = (await listLibraries({ userId: aliceId, isGuest: false })).filter((l) => l.type === 'shared')
    // 'City' is the shared fixture from beforeEach (created at 1, so it leads).
    // 'Mine' has no membership row, so its date is its own creation (300),
    // landing between the two joins (500, 900).
    expect(rows.map((l) => l.name)).toEqual(['City', 'Mine', 'Joined early', 'Joined later'])
  })

  it('counts members and works per row, without leaking hidden works to a member', async () => {
    const work = (id: string, libraryId: string, overrides: Partial<typeof schema.libraryBooks.$inferInsert> = {}) => {
      db.insert(schema.libraryBooks).values({
        id, libraryId, userId: aliceId, title: id, author: 'a', description: '',
        createdAt: 1, updatedAt: 1, ...overrides,
      }).run()
    }
    const version = (id: string, libraryId: string, libraryBookId: string, status: 'published' | 'unlisted' = 'published') => {
      db.insert(schema.bookVersions).values({ id, format: 'txt', size: 1, createdAt: 1, updatedAt: 1 }).run()
      db.insert(schema.libraryBookVersions).values({
        id: `lbv_${id}`, libraryId, libraryBookId, bookVersionId: id, kind: 'shared',
        status, createdAt: 1, updatedAt: 1,
      }).run()
    }

    work('w1', sharedId)
    version('v1', sharedId, 'w1')
    work('w2', sharedId)
    version('v2', sharedId, 'w2', 'unlisted')
    work('w3', sharedId, { hidden: true })
    version('v3', sharedId, 'w3')
    work('w4', sharedId, { deletedAt: 2 })
    version('v4', sharedId, 'w4')
    work('w5', sharedId)
    version('v5', sharedId, 'w5')

    const owned = await listLibraries({ userId: aliceId, isGuest: false })
    const ownRow = owned.find((l) => l.id === sharedId)!
    // The owner manages the library, so hidden and unlisted works are theirs to see.
    expect(ownRow.workCount).toBe(4)
    expect(ownRow.memberCount).toBe(1)
    expect(ownRow.ownerUsername).toBe('alice')

    db.insert(schema.libraryMemberships).values({
      id: createId('lbm'), libraryId: sharedId, userId: bobId, role: 'member', createdAt: 1, updatedAt: 1,
    }).run()
    const member = await listLibraries({ userId: bobId, isGuest: false })
    const memberRow = member.find((l) => l.id === sharedId)!
    // A plain member sees only what the catalog would list for them, and the
    // owner is not a membership row, so 1 membership + the owner = 2.
    expect(memberRow.workCount).toBe(2)
    expect(memberRow.memberCount).toBe(2)
  })

  it('counts the personal library as one member and all of its own works', async () => {
    const privateId = db.select({ id: schema.libraries.id }).from(schema.libraries)
      .where(and(eq(schema.libraries.userId, aliceId), eq(schema.libraries.type, 'private'))).get()!.id
    const work = (id: string, overrides: Partial<typeof schema.libraryBooks.$inferInsert> = {}) => {
      db.insert(schema.libraryBooks).values({
        id, libraryId: privateId, userId: aliceId, title: id, author: 'a', description: '',
        createdAt: 1, updatedAt: 1, ...overrides,
      }).run()
    }
    work('p1')
    work('p2', { hidden: true })
    work('p3', { deletedAt: 2 })

    const row = (await listLibraries({ userId: aliceId, isGuest: false })).find((l) => l.id === privateId)!
    // A one-person library is always its reader's, so hidden works count and
    // only the trash does not. It holds no membership rows, so one member.
    expect(row.workCount).toBe(2)
    expect(row.memberCount).toBe(1)
  })

  /**
   * The sidebar has to know, per row, whether to offer "join" or "manage". The
   * relation travels with the list so that costs no request per library - and
   * it must be the same verdict getRelation would give, or the menu would offer
   * an action the server then refuses.
   */
  it('reports each listed library with the reader relation the single-library path gives', async () => {
    const pubId = seedLibrary(bobId, { visibility: 'public', name: 'Open' })
    db.insert(schema.libraryMemberships).values({
      id: createId('lbm'), libraryId: sharedId, userId: bobId, role: 'member', createdAt: 1, updatedAt: 1,
    }).run()
    const bobAdmin = seedLibrary(aliceId, { visibility: 'public', name: 'Administered' })
    db.insert(schema.libraryMemberships).values({
      id: createId('lbm'), libraryId: bobAdmin, userId: bobId, role: 'admin', createdAt: 1, updatedAt: 1,
    }).run()

    const relationOf = async (userId: string, libraryId: string) => {
      const listed = await listLibraries({ userId, isGuest: false })
      const row = listed.find((l) => l.id === libraryId)
      expect(row).toBeDefined()
      const single = await getRelation({ userId, isGuest: false }, libraryId)
      expect(row!.relation).toBe(single.relation)
      return row!.relation
    }

    // Bob is a member of one library, an admin of another, and owns the third.
    expect(await relationOf(bobId, sharedId)).toBe('member')
    expect(await relationOf(bobId, bobAdmin)).toBe('admin')
    expect(await relationOf(bobId, pubId)).toBe('owner')
    // Carol joined nothing, so every shared library is an outsider's.
    expect(await relationOf(carolId, pubId)).toBe('non-member')
    const passLibId = seedLibrary(aliceId, { visibility: 'password', accessPasswordHash: 'hash' })
    const carolList = await listLibraries({ userId: carolId, isGuest: false })
    expect(carolList.find((l) => l.id === passLibId)?.relation).toBe('non-member')
    expect(carolList.find((l) => l.id === passLibId)?.visibility).toBe('password')
    // Alice owns both shared libraries she can see, and her private one.
    expect(await relationOf(aliceId, sharedId)).toBe('owner')
    const aliceList = await listLibraries({ userId: aliceId, isGuest: false })
    expect(aliceList.find((l) => l.type === 'private')?.relation).toBe('owner')
    // A guest can only ever be an outsider.
    const guest = await listLibraries({ userId: null, isGuest: true })
    expect(guest.every((l) => l.relation === 'guest')).toBe(true)
  })

  it('hides private and gated libraries without leaking', async () => {    await expect(getLibrary({ userId: bobId, isGuest: false }, sharedId))
      .rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
    const pubId = seedLibrary(bobId, { visibility: 'public' })
    expect((await getLibrary({ userId: carolId, isGuest: false }, pubId)).id).toBe(pubId)
    const alicePrivate = db.select().from(schema.libraries)
      .where(and(eq(schema.libraries.userId, aliceId), eq(schema.libraries.type, 'private'))).get()!
    await expect(getLibrary({ userId: bobId, isGuest: false }, alicePrivate.id))
      .rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
  })

  it('lets only the owner change settings', async () => {
    db.insert(schema.libraryMemberships).values({
      id: createId('lbm'), libraryId: sharedId, userId: bobId, role: 'admin', createdAt: 1, updatedAt: 1,
    }).run()
    await expect(updateLibrary(bobId, sharedId, { name: 'X' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const renamed = await updateLibrary(aliceId, sharedId, { name: 'Renamed' })
    expect(renamed.name).toBe('Renamed')
    const locked = await updateLibrary(aliceId, sharedId, { visibility: 'password', accessPassword: 'pw12' })
    expect(locked.visibility).toBe('password')
    const opened = await updateLibrary(aliceId, sharedId, { visibility: 'public' })
    expect(opened.visibility).toBe('public')
    expect(db.select().from(schema.libraries).where(eq(schema.libraries.id, sharedId)).get()!.accessPasswordHash).toBeNull()
  })

  it('deletes shared libraries without touching private cards or user data', async () => {
    // A shared idea falls back to private; a B reference in another library
    // and the reader state survive the deletion.
    const ideaId = createId('idea')
    db.insert(schema.ideas).values({
      id: ideaId, userId: bobId, bookVersionId: null, cfiRange: null, text: 't',
      note: null, visibility: 'shared', sharedLibraryId: sharedId,
      chapter: null, chapterHref: null, createdAt: 1, updatedAt: 1, deletedAt: null,
    }).run()
    db.insert(schema.bookVersions).values({ id: 'v1', format: 'txt', size: 1, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.bookStates).values({
      userId: bobId, bookVersionId: 'v1', readStatus: 'reading', percent: 10,
      cfi: null, chapter: null, lastReadAt: null, updatedAt: 1,
    }).run()
    await expect(deleteLibrary(bobId, sharedId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await deleteLibrary(aliceId, sharedId)).id).toBe(sharedId)
    expect(db.select().from(schema.libraries).where(eq(schema.libraries.id, sharedId)).get()).toBeUndefined()
    expect(db.select().from(schema.ideas).where(eq(schema.ideas.id, ideaId)).get())
      .toMatchObject({ visibility: 'private', sharedLibraryId: null })
    expect(db.select().from(schema.bookStates).all()).toHaveLength(1)
    const alicePrivate = db.select().from(schema.libraries)
      .where(and(eq(schema.libraries.userId, aliceId), eq(schema.libraries.type, 'private'))).get()!
    await expect(deleteLibrary(aliceId, alicePrivate.id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('releases versions nobody else lists when the library goes', async () => {
    const files = new Map<string, Buffer>()
    const driver: StorageDriver = {
      async put(key, data) {
        files.set(key, Buffer.isBuffer(data) ? data : Buffer.concat([Buffer.from(data as Uint8Array)]))
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
    vi.spyOn(storage, 'getStorage').mockReturnValue(driver)
    const now = Date.now()
    // An exclusive version with its own work cover.
    const exclusiveWorkId = createId('lb')
    const exclusiveCover = 'blobs/ex/cover.cover.jpg'
    db.insert(schema.libraryBooks).values({
      id: exclusiveWorkId, libraryId: sharedId, userId: aliceId, title: 'Exclusive',
      coverKey: exclusiveCover, createdAt: now, updatedAt: now,
    }).run()
    db.insert(schema.bookVersions).values({ id: 'vex', format: 'txt', size: 8, createdAt: now, updatedAt: now }).run()
    db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId: sharedId, libraryBookId: exclusiveWorkId, bookVersionId: 'vex',
      kind: 'personal', status: 'published', createdAt: now, updatedAt: now,
    }).run()
    const exclusiveBlob = 'blobs/ex/exclusive.epub'
    db.insert(schema.contentRevisions).values({
      id: createId('rev'), bookVersionId: 'vex', revisionNo: 1, blobKey: exclusiveBlob,
      size: 8, chapterCount: 1, meta: {}, createdAt: now,
    }).run()
    db.insert(schema.blobs).values([
      { key: exclusiveBlob, size: 8, kind: 'book', createdAt: now },
      { key: exclusiveCover, size: 4, kind: 'cover', createdAt: now },
    ]).run()
    files.set(exclusiveBlob, Buffer.from('exclusive'))
    files.set(exclusiveCover, Buffer.from('cover'))
    // A version a second library still lists.
    const otherId = createId('lib')
    db.insert(schema.libraries).values({
      id: otherId, userId: bobId, type: 'shared', name: 'Other',
      description: '', visibility: 'public', createdAt: now, updatedAt: now,
    }).run()
    const otherWorkId = createId('lb')
    db.insert(schema.libraryBooks).values({
      id: otherWorkId, libraryId: otherId, userId: bobId, title: 'Shared',
      createdAt: now, updatedAt: now,
    }).run()
    db.insert(schema.bookVersions).values({ id: 'vsh', format: 'txt', size: 8, createdAt: now, updatedAt: now }).run()
    const sharedBlob = 'blobs/ex/shared.epub'
    db.insert(schema.contentRevisions).values({
      id: createId('rev'), bookVersionId: 'vsh', revisionNo: 1, blobKey: sharedBlob,
      size: 8, chapterCount: 1, meta: {}, createdAt: now,
    }).run()
    db.insert(schema.blobs).values({ key: sharedBlob, size: 8, kind: 'book', createdAt: now }).run()
    files.set(sharedBlob, Buffer.from('shared'))
    db.insert(schema.libraryBookVersions).values([
      {
        id: createId('lbv'), libraryId: sharedId, libraryBookId: exclusiveWorkId, bookVersionId: 'vsh',
        kind: 'personal', status: 'published', createdAt: now, updatedAt: now,
      },
      {
        id: createId('lbv'), libraryId: otherId, libraryBookId: otherWorkId, bookVersionId: 'vsh',
        kind: 'personal', status: 'published', createdAt: now, updatedAt: now,
      },
    ]).run()

    expect((await deleteLibrary(aliceId, sharedId)).id).toBe(sharedId)
    // Exclusive content is gone: revisions, version, files, registry rows.
    expect(db.select().from(schema.contentRevisions).where(eq(schema.contentRevisions.bookVersionId, 'vex')).all()).toHaveLength(0)
    expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, 'vex')).get()).toBeUndefined()
    expect(files.has(exclusiveBlob)).toBe(false)
    expect(files.has(exclusiveCover)).toBe(false)
    expect(db.select().from(schema.blobs).where(eq(schema.blobs.key, exclusiveBlob)).get()).toBeUndefined()
    // Still-listed content survives with its blob.
    expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, 'vsh')).get()).toBeDefined()
    expect(db.select().from(schema.contentRevisions).where(eq(schema.contentRevisions.bookVersionId, 'vsh')).all()).toHaveLength(1)
    expect(files.has(sharedBlob)).toBe(true)
  })

  it('resolves a member target by username and reports names in the member list', async () => {
    const byName = await addMember(aliceId, sharedId, { username: 'BOB', role: 'member' })
    expect(byName.userId).toBe(bobId)
    await expect(addMember(aliceId, sharedId, { username: 'nobody', role: 'member' }))
      .rejects.toMatchObject({ code: 'USER_NOT_FOUND' })
    await expect(addMember(aliceId, sharedId, { role: 'member' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    const listed = await listMembers(aliceId, sharedId)
    expect(listed.owner).toEqual({ id: aliceId, username: 'alice', avatarKey: null, createdAt: expect.any(Number) })
    // Names travel with the rows; a member list without them is unusable.
    expect(listed.members).toEqual([expect.objectContaining({ userId: bobId, username: 'bob', role: 'member', avatarKey: null })])
  })

  it('enforces owner/admin/member management boundaries', async () => {
    const admin = await addMember(aliceId, sharedId, { userId: bobId, role: 'admin' })
    expect(admin.role).toBe('admin')
    await expect(addMember(aliceId, sharedId, { userId: bobId, role: 'member' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(addMember(aliceId, sharedId, { userId: aliceId, role: 'member' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    // Admins manage members only.
    const member = await addMember(bobId, sharedId, { userId: carolId, role: 'member' })
    expect(member.role).toBe('member')
    await expect(addMember(bobId, sharedId, { userId: seedUser('dave'), role: 'admin' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(addMember(carolId, sharedId, { userId: seedUser('erin'), role: 'member' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Guest-role and disabled accounts can never hold membership.
    const guestId = seedUser('ghost', { role: 'guest' })
    await expect(addMember(aliceId, sharedId, { userId: guestId, role: 'member' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    const offId = seedUser('off', { disabled: 1 })
    await expect(addMember(aliceId, sharedId, { userId: offId, role: 'member' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Role changes are owner-only.
    await expect(setMemberRole(bobId, sharedId, carolId, 'admin')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await setMemberRole(aliceId, sharedId, carolId, 'admin')).role).toBe('admin')
    // Removal matrix.
    await expect(removeMember(bobId, sharedId, carolId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await removeMember(aliceId, sharedId, carolId)).id).toBeTruthy()
    await expect(removeMember(aliceId, sharedId, carolId)).rejects.toMatchObject({ code: 'MEMBERSHIP_NOT_FOUND' })
    await expect(removeMember(aliceId, sharedId, aliceId)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('lets members leave and restricts member listing', async () => {
    db.insert(schema.libraryMemberships).values({
      id: createId('lbm'), libraryId: sharedId, userId: bobId, role: 'member', createdAt: 1, updatedAt: 1,
    }).run()
    expect((await removeMember(bobId, sharedId, bobId)).id).toBeTruthy()
    db.insert(schema.libraryMemberships).values({
      id: createId('lbm'), libraryId: sharedId, userId: carolId, role: 'member', createdAt: 1, updatedAt: 1,
    }).run()
    await expect(listMembers(carolId, sharedId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const listed = await listMembers(aliceId, sharedId)
    expect(listed.owner).toMatchObject({ id: aliceId, username: 'alice' })
    expect(listed.members.map((m) => m.userId)).toEqual([carolId])
  })

  it('joins password libraries with the right secret and reports relations', async () => {
    const lockedId = (await createLibrary(
      { userId: aliceId, isGuest: false },
      { name: 'Locked', visibility: 'password', accessPassword: 's3cret' },
    )).id
    await expect(joinLibrary(bobId, lockedId, 'wrong'))
      .rejects.toMatchObject({ code: 'INVALID_LIBRARY_PASSWORD' })
    await expect(joinLibrary(bobId, lockedId)).rejects.toMatchObject({ code: 'INVALID_LIBRARY_PASSWORD' })
    const joined = await joinLibrary(bobId, lockedId, 's3cret')
    expect(joined).toMatchObject({ relation: 'member' })
    expect(joined.membership).toMatchObject({ userId: bobId, role: 'member' })
    // Rejoining never re-asks the password.
    expect(await joinLibrary(bobId, lockedId)).toMatchObject({ relation: 'member' })
    expect((await getRelation({ userId: aliceId, isGuest: false }, lockedId)).relation).toBe('owner')
    expect((await getRelation({ userId: bobId, isGuest: false }, lockedId)).relation).toBe('member')
    expect((await getRelation({ userId: carolId, isGuest: false }, lockedId)).relation).toBe('non-member')
    expect((await getRelation({ userId: null, isGuest: true }, lockedId)).relation).toBe('guest')
    await expect(joinLibrary(bobId, sharedId, 's3cret'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('admits members freely to public libraries', async () => {
    const pubId = (await createLibrary(
      { userId: aliceId, isGuest: false },
      { name: 'Open', visibility: 'public' },
    )).id
    expect(await joinLibrary(bobId, pubId)).toMatchObject({ relation: 'member' })
  })

  it('gates version readability flags on owners/admins and rechecks every call', async () => {
    db.insert(schema.bookVersions).values({ id: 'v1', format: 'txt', size: 1, createdAt: 1, updatedAt: 1 }).run()
    const lbId = createId('lb')
    db.insert(schema.libraryBooks).values({
      id: lbId, libraryId: sharedId, userId: aliceId, title: 'T', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId: sharedId, libraryBookId: lbId, bookVersionId: 'v1',
      kind: 'personal', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.libraryMemberships).values({
      id: createId('lbm'), libraryId: sharedId, userId: bobId, role: 'admin', createdAt: 1, updatedAt: 1,
    }).run()
    expect(await setVersionGuestReadable(bobId, sharedId, 'v1', true))
      .toMatchObject({ bookVersionId: 'v1', guestReadable: true })
    // Per-listing: the same version listed in another library stays closed.
    const otherId = seedLibrary(aliceId)
    const otherLbId = createId('lb')
    db.insert(schema.libraryBooks).values({
      id: otherLbId, libraryId: otherId, userId: aliceId, title: 'T', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId: otherId, libraryBookId: otherLbId, bookVersionId: 'v1',
      kind: 'personal', createdAt: 1, updatedAt: 1,
    }).run()
    expect(db.select({ guestReadable: schema.libraryBookVersions.guestReadable }).from(schema.libraryBookVersions)
      .where(and(eq(schema.libraryBookVersions.libraryId, otherId), eq(schema.libraryBookVersions.bookVersionId, 'v1'))).get())
      .toMatchObject({ guestReadable: false })
    db.insert(schema.libraryMemberships).values({
      id: createId('lbm'), libraryId: sharedId, userId: carolId, role: 'member', createdAt: 1, updatedAt: 1,
    }).run()
    await expect(setVersionGuestReadable(carolId, sharedId, 'v1', false))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    // Revoked admins lose the power on the very next call.
    await removeMember(aliceId, sharedId, bobId)
    await expect(setVersionGuestReadable(bobId, sharedId, 'v1', false))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(setVersionGuestReadable(aliceId, sharedId, 'missing', true))
      .rejects.toMatchObject({ code: 'LIBRARY_VERSION_NOT_FOUND' })
  })

  it('transfers shared libraries to members and seats the former owner as admin', async () => {
    db.insert(schema.libraryMemberships).values([
      { id: createId('lbm'), libraryId: sharedId, userId: bobId, role: 'admin', createdAt: 1, updatedAt: 1 },
      { id: createId('lbm'), libraryId: sharedId, userId: carolId, role: 'member', createdAt: 1, updatedAt: 1 },
    ]).run()
    await expect(transferLibraryOwnership(bobId, sharedId, carolId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(transferLibraryOwnership(aliceId, sharedId, createId('user')))
      .rejects.toMatchObject({ code: 'USER_NOT_FOUND' })
    const outsiderId = seedUser('outsider')
    await expect(transferLibraryOwnership(aliceId, sharedId, outsiderId))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    const transferred = await transferLibraryOwnership(aliceId, sharedId, carolId)
    expect(transferred.ownerUserId).toBe(carolId)
    // The new owner has no membership row; the former owner is now an admin.
    expect(db.select().from(schema.libraryMemberships)
      .where(and(eq(schema.libraryMemberships.libraryId, sharedId), eq(schema.libraryMemberships.userId, carolId))).get())
      .toBeUndefined()
    expect(db.select().from(schema.libraryMemberships)
      .where(and(eq(schema.libraryMemberships.libraryId, sharedId), eq(schema.libraryMemberships.userId, aliceId))).get())
      .toMatchObject({ role: 'admin' })
    // Ownership powers moved with the seat.
    await expect(transferLibraryOwnership(aliceId, sharedId, bobId)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await transferLibraryOwnership(carolId, sharedId, bobId)).ownerUserId).toBe(bobId)
  })

  it('keeps instance and library ownership independent', async () => {
    // The instance owner holds no library seat, so library powers stay closed.
    const instanceOwnerId = seedUser('frank', { role: 'owner' })
    await expect(addMember(instanceOwnerId, sharedId, { userId: carolId, role: 'member' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(updateLibrary(instanceOwnerId, sharedId, { name: 'Hijacked' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    // A library owner who is an ordinary member manages their own library.
    const carolLibraryId = seedLibrary(carolId)
    expect((await updateLibrary(carolId, carolLibraryId, { name: 'Carol City' })).name).toBe('Carol City')
    expect((await addMember(carolId, carolLibraryId, { userId: bobId, role: 'admin' })).role).toBe('admin')
    // Neither seat implies the other: the library owner cannot touch the instance.
    expect((await listMembers(carolId, carolLibraryId)).owner.id).toBe(carolId)
  })

  it('lets an owner rename only their own private library', async () => {
    const privateId = db.select({ id: schema.libraries.id }).from(schema.libraries)
      .where(and(eq(schema.libraries.userId, aliceId), eq(schema.libraries.type, 'private'))).get()!.id
    await expect(updateLibrary(bobId, privateId, { name: 'Hijacked' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(updateLibrary(aliceId, privateId, { visibility: 'public' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(updateLibrary(aliceId, privateId, { name: 'Mine', description: 'Shared' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    const renamed = await updateLibrary(aliceId, privateId, { name: 'Mine' })
    expect(renamed).toMatchObject({ name: 'Mine', type: 'private', visibility: null })
    expect((await listLibraries({ userId: aliceId, isGuest: false }))[0].name).toBe('Mine')
  })

  it('grants shared membership no reach into private libraries', async () => {
    const alicePrivateId = db.select({ id: schema.libraries.id }).from(schema.libraries)
      .where(and(eq(schema.libraries.userId, aliceId), eq(schema.libraries.type, 'private'))).get()!.id
    // Bob joins Alice's public library: the shared seat must not unlock her
    // private library, its taxonomy or its versions.
    await joinLibrary(bobId, seedLibrary(aliceId, { visibility: 'public' }))
    await expect(getLibrary({ userId: bobId, isGuest: false }, alicePrivateId))
      .rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
    await expect(listLibraryCategories(bobId, alicePrivateId))
      .rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
    await expect(resolveSharedVersionRead(alicePrivateId, 'v1', bobId))
      .rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
  })
})
