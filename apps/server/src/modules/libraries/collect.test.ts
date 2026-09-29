import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { createId } from '../../lib/id'
import { readProgressFile, writeProgressFile } from '../../lib/progress-file'
import { registerParser } from '../../formats/registry'
import { TxtParser } from '../../formats/txt'
import { assertReadableBookSync, getActiveBook, getBook, getBookShelf, reTocBook, appendTxtBookContent, resetBookMetadata, updateBook, uploadBook, deleteBook, updateBookCover, removeBookCover } from '../books/books.service'
import { uploadCatalogBook } from '../books/books.service'
import { addMember, createLibrary, deleteLibrary } from './libraries.service'
import { updateCatalogVersion } from './catalog.service'
import { addToPrivateLibrary, describeCollectSource } from './collect.service'
import { sourceStillReadable } from './library-access'
import { createAnnotation, listAnnotations } from '../annotations/annotations.service'
import { addReadingTime } from '../reading-records/reading-records.service'
import { updateReaderBookSettings } from '../books/reader-settings.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

function createMemoryStorage() {
  const files = new Map<string, Buffer>()
  const driver: StorageDriver = {
    async put(key, data) {
      if (Buffer.isBuffer(data)) {
        files.set(key, data)
      } else {
        const chunks: Buffer[] = []
        for await (const chunk of data) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        files.set(key, Buffer.concat(chunks))
      }
    },
    async get(key, range) {
      const buf = files.get(key)
      if (!buf) throw new Error(`missing blob: ${key}`)
      return Readable.from(range ? buf.subarray(range.start, range.end + 1) : buf)
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

describe('add-to-private (7.x)', () => {
  let db: ReturnType<typeof createTestDb>
  let files: Map<string, Buffer>
  let ownerId: string
  let memberId: string
  let outsiderId: string
  let libraryId: string

  function seedUser(username: string) {
    const id = createId('user')
    db.insert(schema.users).values({ id, username, passwordHash: null, role: 'member', createdAt: 1 }).run()
    // Every real user owns exactly one private library.
    db.insert(schema.libraries).values({
      id: createId('lib'), userId: id, type: 'private', name: username,
      description: '', visibility: null, createdAt: 1, updatedAt: 1,
    }).run()
    return id
  }

  const txtFile = (body: string) => new File([body], 'novel.txt', { type: 'text/plain' })

  const memberPrivateId = () => db.select({ id: schema.libraries.id }).from(schema.libraries)
    .where(and(eq(schema.libraries.userId, memberId), eq(schema.libraries.type, 'private'))).get()!.id

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    const memory = createMemoryStorage()
    files = memory.files
    vi.spyOn(storage, 'getStorage').mockReturnValue(memory.driver)
    registerParser(new TxtParser())
    ownerId = seedUser('owner')
    memberId = seedUser('member')
    outsiderId = seedUser('outsider')
    libraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: libraryId, userId: ownerId, type: 'shared', name: 'City',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
  })

  async function seedCityBook(title = '三体') {
    const created = await uploadCatalogBook(libraryId, ownerId, txtFile('第一章\n正文内容'), { title, author: '刘慈欣' })
    return created
  }

  it('collects a version into the private library with pinned source and metadata', async () => {
    const city = await seedCityBook()
    const result = await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    expect(result).toMatchObject({
      bookVersionId: city.bookVersionId, alreadyExists: false,
      sourceLibraryId: libraryId, sourceLibraryBookVersionId: city.versionLinkId,
    })

    // The private card exists with a copy of the effective metadata and no
    // version override, so later private edits stay local.
    const card = db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, result.libraryBookId)).get()!
    expect(card).toMatchObject({ title: '三体', author: '刘慈欣' })
    const link = db.select().from(schema.libraryBookVersions)
      .where(and(eq(schema.libraryBookVersions.libraryId, card.libraryId), eq(schema.libraryBookVersions.id, db.select({ id: schema.libraryBookVersions.id }).from(schema.libraryBookVersions).where(eq(schema.libraryBookVersions.libraryBookId, card.id)).get()!.id))).get()!
    expect(link).toMatchObject({ kind: 'shared', title: null, sourceLibraryId: libraryId })
    expect(link.pinnedRevisionId).toBeTruthy()
    // Collected, not started.
    expect(db.select().from(schema.bookStates)
      .where(eq(schema.bookStates.bookVersionId, city.bookVersionId)).get()).toMatchObject({ readStatus: 'wishlist' })
    // No blob was copied: the city's single content file is all there is.
    const blobs = db.select().from(schema.blobs).all()
    expect(blobs.filter((b) => b.kind === 'book')).toHaveLength(1)
    expect(files.get(blobs[0]!.key)?.length ?? 0).toBeGreaterThan(0)

    // The existing private reader resolves the B with no new route.
    const book = await getActiveBook(memberId, city.bookVersionId)
    expect(book).toMatchObject({ title: '三体', source: { libraryId, libraryName: 'City' } })
    expect(book.source?.libraryBookVersionId).toBe(city.versionLinkId)
  })

  it('lets a non-member with read access collect, and refuses those without', async () => {
    const city = await seedCityBook()
    // Public library: an authenticated non-member can read, so it can collect.
    expect((await addToPrivateLibrary(outsiderId, libraryId, city.versionLinkId!)).alreadyExists).toBe(false)

    // A private library is not collectable by outsiders.
    const locked = await createLibrary({ userId: ownerId, isGuest: false }, { name: 'Locked' })
    const secret = await uploadCatalogBook(locked.id, ownerId, txtFile('第一章\n机密'))
    await expect(addToPrivateLibrary(outsiderId, locked.id, secret.versionLinkId!))
      .rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
  })

  it('keeps one B per BookVersion and never re-points its source', async () => {
    const city = await seedCityBook()
    const first = await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)

    // Collecting the same version again is idempotent.
    const again = await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    expect(again).toMatchObject({ alreadyExists: true, libraryBookId: first.libraryBookId })

    // A second city listing the same BookVersion (same content, one shared
    // content identity) must not create a second card or move the source.
    const otherId = createId('lib')
    db.insert(schema.libraries).values({
      id: otherId, userId: outsiderId, type: 'shared', name: 'Other',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    const otherWorkId = createId('lb')
    db.insert(schema.libraryBooks).values({
      id: otherWorkId, libraryId: otherId, userId: outsiderId, categoryId: null,
      title: '三体（另一馆）', author: '刘慈欣', description: '', coverKey: null, createdAt: 1, updatedAt: 1,
    }).run()
    const otherLinkId = createId('lbv')
    db.insert(schema.libraryBookVersions).values({
      id: otherLinkId, libraryId: otherId, libraryBookId: otherWorkId, bookVersionId: city.bookVersionId,
      kind: 'personal', status: 'published', createdAt: 1, updatedAt: 1,
    }).run()
    const second = await addToPrivateLibrary(memberId, otherId, otherLinkId)
    expect(second).toMatchObject({ alreadyExists: true, libraryBookId: first.libraryBookId })
    // Source stays the first city.
    expect(second.sourceLibraryId).toBe(libraryId)
    expect((await getBook(memberId, city.bookVersionId)).source?.libraryId).toBe(libraryId)
  })

  it('refuses to collect a hidden version, but not for the library managers', async () => {
    const city = await seedCityBook()
    await addMember(ownerId, libraryId, { userId: memberId, role: 'member' })
    await updateCatalogVersion(ownerId, libraryId, city.libraryBookId, city.versionLinkId!, { status: 'unlisted' })
    await expect(addToPrivateLibrary(memberId, libraryId, city.versionLinkId!))
      .rejects.toMatchObject({ code: 'LIBRARY_VERSION_NOT_FOUND' })
    // The hide exists to keep members out, so it must not stop the curator
    // from pulling their own version into their private library.
    const collected = await addToPrivateLibrary(ownerId, libraryId, city.versionLinkId!)
    expect(collected.alreadyExists).toBe(false)
  })

  it('re-checks the source on every read and keeps the card when it fails', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    expect(await sourceStillReadable(memberId, city.bookVersionId)).toBe(true)
    expect(() => assertReadableBookSync(memberId, city.bookVersionId)).not.toThrow()
    expect((await getActiveBook(memberId, city.bookVersionId)).id).toBe(city.bookVersionId)

    // Losing membership closes the content while the card stays put.
    await addMember(ownerId, libraryId, { userId: memberId, role: 'member' })
    await updateCatalogVersion(ownerId, libraryId, city.libraryBookId, city.versionLinkId!, { status: 'unlisted' })
    expect(await sourceStillReadable(memberId, city.bookVersionId)).toBe(false)
    expect(() => assertReadableBookSync(memberId, city.bookVersionId))
      .toThrowError(expect.objectContaining({ code: 'BOOK_NOT_FOUND' }))
    await expect(getActiveBook(memberId, city.bookVersionId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    // The private row keeps naming its source.
    expect(await describeCollectSource(memberId, city.bookVersionId)).toMatchObject({
      libraryId, libraryBookVersionId: city.versionLinkId,
    })
    const card = db.select().from(schema.libraryBooks)
      .where(eq(schema.libraryBooks.libraryId, memberPrivateId())).get()
    expect(card?.title).toBe('三体')
  })

  it('keeps the B readable as provenance after the source library is deleted', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    await deleteLibrary(ownerId, libraryId)

    expect(await sourceStillReadable(memberId, city.bookVersionId)).toBe(false)
    await expect(getActiveBook(memberId, city.bookVersionId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    const source = await describeCollectSource(memberId, city.bookVersionId)
    expect(source).toMatchObject({ libraryId, libraryBookVersionId: city.versionLinkId, libraryName: null })
  })

  it('reads the pinned revision, not a later one the city publishes', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    const pinned = (await getActiveBook(memberId, city.bookVersionId)).filePath

    // Phase 8 will publish revisions here; simulate one landing on the version.
    const now = Date.now()
    const nextBlob = 'blobs/aa/second.epub'
    await storage.getStorage().put(nextBlob, Buffer.from('new content'))
    db.insert(schema.contentRevisions).values({
      id: createId('rev'), bookVersionId: city.bookVersionId, revisionNo: 2, blobKey: nextBlob,
      size: 11, wordCount: 2, chapterCount: 1, meta: {}, createdAt: now,
    }).run()

    // The B keeps reading the revision it pinned.
    expect((await getActiveBook(memberId, city.bookVersionId)).filePath).toBe(pinned)
    // A private upload still follows the latest revision of its own version.
    const own = await uploadBook(memberId, txtFile('第一章\n本地书'))
    const ownBefore = (await getActiveBook(memberId, own.book.id)).filePath
    db.insert(schema.contentRevisions).values({
      id: createId('rev'), bookVersionId: own.book.id, revisionNo: 2, blobKey: 'blobs/bb/own.epub',
      size: 7, wordCount: 1, chapterCount: 1, meta: {}, createdAt: now,
    }).run()
    expect((await getActiveBook(memberId, own.book.id)).filePath).not.toBe(ownBefore)
  })

  it('pins the latest revision when collecting after several publishes', async () => {
    const city = await seedCityBook()
    const now = Date.now()
    const rev2Id = createId('rev')
    const rev3Id = createId('rev')
    await storage.getStorage().put('blobs/aa/rev2.epub', Buffer.from('second'))
    await storage.getStorage().put('blobs/aa/rev3.epub', Buffer.from('third'))
    db.insert(schema.contentRevisions).values({
      id: rev2Id, bookVersionId: city.bookVersionId, revisionNo: 2, blobKey: 'blobs/aa/rev2.epub',
      size: 6, wordCount: 1, chapterCount: 1, meta: {}, createdAt: now,
    }).run()
    db.insert(schema.contentRevisions).values({
      id: rev3Id, bookVersionId: city.bookVersionId, revisionNo: 3, blobKey: 'blobs/aa/rev3.epub',
      size: 5, wordCount: 1, chapterCount: 1, meta: {}, createdAt: now,
    }).run()

    const result = await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    const link = db.select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.libraryBookId, result.libraryBookId)).get()!
    expect(link.pinnedRevisionId).toBe(rev3Id)
    expect((await getActiveBook(memberId, city.bookVersionId)).filePath).toBe('blobs/aa/rev3.epub')
  })

  it('lets the owner remove a B whose source became unreadable', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    await addMember(ownerId, libraryId, { userId: memberId, role: 'member' })
    await updateCatalogVersion(ownerId, libraryId, city.libraryBookId, city.versionLinkId!, { status: 'unlisted' })
    expect(await sourceStillReadable(memberId, city.bookVersionId)).toBe(false)

    // The card is removable even though its content is not: losing the source
    // must never trap the B in the private library.
    await deleteBook(memberId, city.bookVersionId)
    const memberPrivateId = db.select({ id: schema.libraries.id }).from(schema.libraries)
      .where(and(eq(schema.libraries.userId, memberId), eq(schema.libraries.type, 'private'))).get()!.id
    expect(db.select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.libraryId, memberPrivateId)).all()).toHaveLength(0)
    // The source still lists the version, so the version itself survives.
    expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, city.bookVersionId)).get()).toBeTruthy()
  })

  it('keeps the shared version when another library still lists it', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    const blobKey = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, city.bookVersionId)).get()!.blobKey

    // A second library listing the same BookVersion: the private delete must
    // only drop the local card, not the version (restrict used to 500 here
    // with the card already gone).
    const otherId = createId('lib')
    db.insert(schema.libraries).values({
      id: otherId, userId: outsiderId, type: 'shared', name: 'Other',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    const otherWorkId = createId('lb')
    db.insert(schema.libraryBooks).values({
      id: otherWorkId, libraryId: otherId, userId: outsiderId, categoryId: null,
      title: '三体（另一馆）', author: '刘慈欣', description: '', coverKey: null, createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId: otherId, libraryBookId: otherWorkId, bookVersionId: city.bookVersionId,
      kind: 'personal', status: 'published', createdAt: 1, updatedAt: 1,
    }).run()

    await deleteBook(memberId, city.bookVersionId)
    const memberPrivateId = db.select({ id: schema.libraries.id }).from(schema.libraries)
      .where(and(eq(schema.libraries.userId, memberId), eq(schema.libraries.type, 'private'))).get()!.id
    expect(db.select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.libraryId, memberPrivateId)).all()).toHaveLength(0)
    // The version, its revision and its blob all survive for the other library.
    expect(db.select().from(schema.bookVersions).where(eq(schema.bookVersions.id, city.bookVersionId)).get()).toBeTruthy()
    expect(db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, city.bookVersionId)).all()).toHaveLength(1)
    expect(files.has(blobKey)).toBe(true)
  })

  it('keeps the caller position when the deleted card version survives', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    const otherId = createId('lib')
    db.insert(schema.libraries).values({
      id: otherId, userId: outsiderId, type: 'shared', name: 'Other',
      description: '', visibility: 'public', createdAt: 1, updatedAt: 1,
    }).run()
    const otherWorkId = createId('lb')
    db.insert(schema.libraryBooks).values({
      id: otherWorkId, libraryId: otherId, userId: outsiderId, categoryId: null,
      title: '三体（另一馆）', author: '刘慈欣', description: '', coverKey: null, createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId: otherId, libraryBookId: otherWorkId, bookVersionId: city.bookVersionId,
      kind: 'personal', status: 'published', createdAt: 1, updatedAt: 1,
    }).run()
    // The caller keeps reading through the other library, so their position
    // must survive the card removal the way the reading rows do.
    await writeProgressFile(memberId, city.bookVersionId, { percent: 42, intervals: [], updatedAt: 1 })
    await deleteBook(memberId, city.bookVersionId)
    expect(await readProgressFile(memberId, city.bookVersionId)).toMatchObject({ percent: 42 })
  })

  it('applies the guest triple gate on anonymous direct reads', async () => {
    const city = await seedCityBook()
    db.insert(schema.instance).values({
      id: 'instance', ownerUserId: ownerId, allowRegistration: false,
      allowGuestAccess: true, uploadMaxBytes: null, createdAt: 1, updatedAt: 1,
    }).run()
    // Switch on but version flag off: the public version stays invisible to
    // anonymous reads (surfaced as NOT_FOUND, never existence). Authenticated
    // non-members are unaffected by the flag.
    await expect(getActiveBook(null, city.bookVersionId))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    await expect(getActiveBook(outsiderId, city.bookVersionId))
      .resolves.toMatchObject({ id: city.bookVersionId })
    // Flag on (per-listing): anonymous reads work, with no personal state attached.
    db.update(schema.libraryBookVersions).set({ guestReadable: true }).where(eq(schema.libraryBookVersions.id, city.versionLinkId!)).run()
    const book = await getActiveBook(null, city.bookVersionId)
    expect(book).toMatchObject({ id: city.bookVersionId, title: '三体' })
    expect(book.userId).toBeNull()
    // Unlisted closes even the guest gate, before the flag is consulted.
    await updateCatalogVersion(ownerId, libraryId, city.libraryBookId, city.versionLinkId!, { status: 'unlisted' })
    await expect(getActiveBook(null, city.bookVersionId))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    // Republished but switch off: invisible again.
    await updateCatalogVersion(ownerId, libraryId, city.libraryBookId, city.versionLinkId!, { status: 'published' })
    db.update(schema.instance).set({ allowGuestAccess: false }).run()
    await expect(getActiveBook(null, city.bookVersionId))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('collects concurrently without duplicating the B', async () => {
    const city = await seedCityBook()
    const [first, second] = await Promise.all([
      addToPrivateLibrary(memberId, libraryId, city.versionLinkId!),
      addToPrivateLibrary(memberId, libraryId, city.versionLinkId!),
    ])
    const created = [first, second].filter((r) => !r.alreadyExists)
    const existing = [first, second].filter((r) => r.alreadyExists)
    expect(created).toHaveLength(1)
    expect(existing).toHaveLength(1)
    expect(existing[0].libraryBookId).toBe(created[0].libraryBookId)
    const memberPrivateId = db.select({ id: schema.libraries.id }).from(schema.libraries)
      .where(and(eq(schema.libraries.userId, memberId), eq(schema.libraries.type, 'private'))).get()!.id
    expect(db.select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.libraryId, memberPrivateId)).all()).toHaveLength(1)
  })

  it('refuses a second private library and a second B at the database level', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    // A second private library for the same user trips the partial index.
    expect(() => db.insert(schema.libraries).values({
      id: createId('lib'), userId: memberId, type: 'private', name: 'dup',
      description: '', visibility: null, createdAt: 1, updatedAt: 1,
    }).run()).toThrowError(/UNIQUE constraint failed/)
    const memberPrivateId = db.select({ id: schema.libraries.id }).from(schema.libraries)
      .where(and(eq(schema.libraries.userId, memberId), eq(schema.libraries.type, 'private'))).get()!.id
    const link = db.select().from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.libraryId, memberPrivateId)).get()!
    // A second shared row for the same version trips the shared partial index...
    expect(() => db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId: memberPrivateId, libraryBookId: link.libraryBookId,
      bookVersionId: city.bookVersionId, kind: 'shared', status: 'published', createdAt: 1, updatedAt: 1,
    }).run()).toThrowError(/UNIQUE constraint failed/)
    // ...while a personal (A/C) row for the same version stays legal.
    expect(() => db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId: memberPrivateId, libraryBookId: link.libraryBookId,
      bookVersionId: city.bookVersionId, kind: 'personal', status: 'published', createdAt: 1, updatedAt: 1,
    }).run()).not.toThrow()
  })

  it('keeps reader settings user-scoped while refusing shared content edits on a B', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    const revisionBefore = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, city.bookVersionId)).get()!

    // Reader settings belong to the member, while palette/content edits remain
    // on the shared revision and are still forbidden for a B.
    expect(updateReaderBookSettings(memberId, city.bookVersionId, { viewSettings: { fontSize: 20 } }))
      .toEqual({ viewSettings: { fontSize: 20 } })
    await expect(updateBook(memberId, city.bookVersionId, { coverPaletteId: 'warm' as never }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, city.bookVersionId)).get()).toEqual(revisionBefore)
    const renamed = await updateBook(memberId, city.bookVersionId, { title: '我的三体' })
    expect(renamed.title).toBe('我的三体')
  })

  it('keeps B cover changes on the private card without touching shared meta', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    db.update(schema.contentRevisions).set({ meta: { coverSuppressed: true } })
      .where(eq(schema.contentRevisions.bookVersionId, city.bookVersionId)).run()

    // Setting a private cover must not clear the shared suppression flag.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    await updateBookCover(memberId, city.bookVersionId, new File([png], 'cover.png', { type: 'image/png' }))
    const metaAfterSet = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, city.bookVersionId)).get()!.meta as Record<string, unknown>
    expect(metaAfterSet.coverSuppressed).toBe(true)

    // Removing the private cover reveals the inherited one; it must not
    // suppress the cover for every library sharing the revision.
    await removeBookCover(memberId, city.bookVersionId)
    const metaAfterRemove = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, city.bookVersionId)).get()!.meta as Record<string, unknown>
    expect(metaAfterRemove.coverSuppressed).toBe(true)
    expect((await getBook(memberId, city.bookVersionId)).coverKey).toBeNull()
  })

  it('lets a reader with shared read rights save annotations and reading time without collecting', async () => {
    const city = await seedCityBook()
    // Frozen legacy row, the way the migration leaves one behind for every
    // migrated book: reading-records still dual-writes the legacy book_id
    // column (retargeted to versions at boot; raw migrate() in tests keeps
    // the old FK).
    db.insert(schema.books).values({
      id: city.bookVersionId, userId: ownerId, title: '三体', format: 'txt',
      filePath: 'books/legacy/city.epub', size: 8, meta: {}, createdAt: 1, updatedAt: 1,
    }).run()
    // outsiderId never collected: no private card, but the public version is
    // readable, so User x BookVersion data is theirs to write.
    const hl = await createAnnotation(outsiderId, city.bookVersionId, { type: 'highlight', cfiRange: 'cfi-a', text: 'excerpt' })
    expect(hl).toMatchObject({ bookId: city.bookVersionId, type: 'highlight' })
    const rec = await addReadingTime(outsiderId, { bookId: city.bookVersionId, date: '2026-07-30', durationSeconds: 60 })
    expect(rec?.durationSeconds).toBe(60)
    // And the data is theirs alone: no cross-reader leakage.
    expect(await listAnnotations(outsiderId, city.bookVersionId)).toHaveLength(1)
    expect(await listAnnotations(memberId, city.bookVersionId)).toHaveLength(0)
  })

  it('reads a library version without collecting it, but never writes to it', async () => {
    const city = await seedCityBook('三体')
    // Reading in library context: the same id, no private card involved.
    const book = await getActiveBook(memberId, city.bookVersionId)
    expect(book).toMatchObject({
      id: city.bookVersionId, title: '三体', author: '刘慈欣',
      collected: false, shelfId: null,
      source: { libraryId, libraryName: 'City' },
    })
    // Reading is dimensioned by BookVersion, so progress survives collecting.
    const state = db.select().from(schema.bookStates)
      .where(and(eq(schema.bookStates.userId, memberId), eq(schema.bookStates.bookVersionId, city.bookVersionId))).get()
    expect(state).toBeUndefined()
    db.insert(schema.bookStates).values({
      userId: memberId, bookVersionId: city.bookVersionId, readStatus: 'reading', percent: 42,
      cfi: null, chapter: null, lastReadAt: null, updatedAt: 1,
    }).run()
    const collected = await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    expect(collected.alreadyExists).toBe(false)
    // Collecting an already-read version keeps the reading data.
    expect((await getBook(memberId, city.bookVersionId)).progress).toBe(42)

    // Writes are still private-only: a version nobody collected has no row to
    // write through, so every mutation is a NOT_FOUND, not a library edit.
    const locked = await createLibrary({ userId: ownerId, isGuest: false }, { name: 'Locked' })
    const secret = await uploadCatalogBook(locked.id, ownerId, txtFile('第一章\n机密'))
    await expect(updateBook(outsiderId, secret.bookVersionId, { title: 'x' }))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    await expect(appendTxtBookContent(outsiderId, secret.bookVersionId, '追加'))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    await expect(getActiveBook(outsiderId, secret.bookVersionId))
      .rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
  })

  it('refuses content-mutating private actions on a B', async () => {    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    const revisionBefore = db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, city.bookVersionId)).all()

    // All of these write a new revision of a BookVersion the whole city shares.
    await expect(appendTxtBookContent(memberId, city.bookVersionId, '追加内容'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(reTocBook(memberId, city.bookVersionId, null))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(resetBookMetadata(memberId, city.bookVersionId))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(db.select().from(schema.contentRevisions)
      .where(eq(schema.contentRevisions.bookVersionId, city.bookVersionId)).all()).toEqual(revisionBefore)

    // Private metadata edits stay allowed (7.6): they only touch private rows.
    const renamed = await updateBook(memberId, city.bookVersionId, { title: '我的三体' })
    expect(renamed.title).toBe('我的三体')
    const cityWork = db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, city.libraryBookId)).get()!
    expect(cityWork.title).toBe('三体')
  })

  it('keeps card-local edits working on a B whose source was unpublished', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    await updateCatalogVersion(ownerId, libraryId, city.libraryBookId, city.versionLinkId!, { status: 'unlisted' })
    expect(await sourceStillReadable(memberId, city.bookVersionId)).toBe(false)

    // Content reads stay blocked, content writes stay forbidden.
    await expect(getBook(memberId, city.bookVersionId)).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    await expect(appendTxtBookContent(memberId, city.bookVersionId, '追加内容'))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })

    // Card-local fields apply and report success instead of throwing after
    // writing: the card is retained by design, only its content is blocked.
    const renamed = await updateBook(memberId, city.bookVersionId, { title: '我的三体' })
    expect(renamed.title).toBe('我的三体')
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    await updateBookCover(memberId, city.bookVersionId, new File([png], 'cover.png', { type: 'image/png' }))
    expect((await getBookShelf(memberId, city.bookVersionId))).toBeNull()
    await removeBookCover(memberId, city.bookVersionId)
  })

  it('uncollecting a book retains user reading state and notes by default, but deletes them when deleteUserData is true', async () => {
    const city = await seedCityBook()
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)

    // Seed user reading state and highlight
    db.update(schema.bookStates).set({ percent: 50, readStatus: 'reading' })
      .where(and(eq(schema.bookStates.userId, memberId), eq(schema.bookStates.bookVersionId, city.bookVersionId))).run()
    db.insert(schema.highlights).values({
      id: 'hl-test-1',
      userId: memberId,
      bookVersionId: city.bookVersionId,
      cfiRange: 'epubcfi(/6/2!/4/2)',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run()

    // 1. Uncollect without deleteUserData
    await deleteBook(memberId, city.bookVersionId)

    // Private row is gone
    const privateLib = db.select({ id: schema.libraries.id }).from(schema.libraries)
      .where(and(eq(schema.libraries.userId, memberId), eq(schema.libraries.type, 'private'))).get()!
    const link = db.select().from(schema.libraryBookVersions)
      .where(and(eq(schema.libraryBookVersions.libraryId, privateLib.id), eq(schema.libraryBookVersions.bookVersionId, city.bookVersionId))).get()
    expect(link).toBeUndefined()

    // But reading state & highlights are still preserved
    const state = db.select().from(schema.bookStates)
      .where(and(eq(schema.bookStates.userId, memberId), eq(schema.bookStates.bookVersionId, city.bookVersionId))).get()
    expect(state).toBeDefined()
    expect(state!.percent).toBe(50)
    const hl = db.select().from(schema.highlights)
      .where(and(eq(schema.highlights.userId, memberId), eq(schema.highlights.bookVersionId, city.bookVersionId))).get()
    expect(hl).toBeDefined()

    // 2. Re-collect and verify reading state is preserved
    await addToPrivateLibrary(memberId, libraryId, city.versionLinkId!)
    const recollectedState = db.select().from(schema.bookStates)
      .where(and(eq(schema.bookStates.userId, memberId), eq(schema.bookStates.bookVersionId, city.bookVersionId))).get()
    expect(recollectedState!.percent).toBe(50)

    // 3. Uncollect with deleteUserData: true
    await deleteBook(memberId, city.bookVersionId, { deleteUserData: true })

    const deletedState = db.select().from(schema.bookStates)
      .where(and(eq(schema.bookStates.userId, memberId), eq(schema.bookStates.bookVersionId, city.bookVersionId))).get()
    expect(deletedState).toBeUndefined()
    const deletedHl = db.select().from(schema.highlights)
      .where(and(eq(schema.highlights.userId, memberId), eq(schema.highlights.bookVersionId, city.bookVersionId))).get()
    expect(deletedHl).toBeUndefined()

    // City book in shared library is untouched
    const cityWork = db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, city.libraryBookId)).get()
    expect(cityWork).toBeDefined()
  })
})
