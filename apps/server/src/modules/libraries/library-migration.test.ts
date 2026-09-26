import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Readable } from 'node:stream'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import {
  backfillRevisionMeta,
  backfillUserFields,
  backfillVersionReferences,
  migrateAnnotations,
  migrateLibraryOrganization,
  migratePrivateLibraries,
  migrateReadingStates,
  seedInstance,
  verifyPhase2Migration,
} from './library-migration'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

function memoryStorage(files: Map<string, number>, texts: Map<string, string> = new Map()): StorageDriver {
  return {
    async put() {},
    async get(key) {
      const text = texts.get(key)
      if (text === undefined) throw new Error(`missing blob: ${key}`)
      return Readable.from(Buffer.from(text, 'utf-8'))
    },
    async delete() {},
    async exists(key) { return files.has(key) || texts.has(key) },
    async size(key) { return files.get(key) ?? 0 },
  }
}

describe('private library migration', () => {
  let db: ReturnType<typeof createTestDb>
  let files: Map<string, number>

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    files = new Map([['blobs/ab/book1.epub', 100], ['blobs/ab/book1.cover.jpg', 10], ['blobs/ab/book2.epub', 200]])
    vi.spyOn(storage, 'getStorage').mockReturnValue(memoryStorage(files))

    db.insert(schema.users).values([
      { id: 'u-owner', username: 'Fool', role: 'owner', createdAt: 1 },
      { id: 'u-guest', username: 'admin', role: 'guest', createdAt: 1 },
    ]).run()
    db.insert(schema.books).values([
      {
        id: 'b-epub', userId: 'u-owner', title: 'Epub', author: 'A', format: 'epub',
        filePath: 'blobs/ab/book1.epub', coverKey: 'blobs/ab/book1.cover.jpg', size: 100,
        meta: { bookmeta: { description: 'desc' }, chapters: [{}, {}], wordCount: 50 },
        createdAt: 2, updatedAt: 3,
      },
      {
        id: 'b-txt', userId: 'u-owner', title: 'Txt', author: '', format: 'txt',
        filePath: 'blobs/ab/book2.epub', coverKey: null, size: 200,
        meta: {}, createdAt: 4, updatedAt: 5,
      },
      {
        id: 'b-deleted', userId: 'u-owner', title: 'Gone', author: '', format: 'txt',
        filePath: 'blobs/ab/book1.epub', coverKey: null, size: 100,
        meta: {}, createdAt: 6, updatedAt: 7, deletedAt: 8,
      },
      {
        id: 'b-missing', userId: 'u-owner', title: 'Lost', author: '', format: 'epub',
        filePath: 'blobs/zz/gone.epub', coverKey: null, size: 10,
        meta: {}, createdAt: 9, updatedAt: 10,
      },
    ]).run()
  })

  it('creates one private library per real user and migrates every readable book', async () => {
    const report = await migratePrivateLibraries()

    expect(report).toMatchObject({ users: 1, librariesCreated: 1, books: 4, booksMigrated: 3 })
    expect(report.anomalies).toEqual([{ bookId: 'b-missing', reason: 'missing file: blobs/zz/gone.epub' }])

    const libs = db.select().from(schema.libraries).all()
    expect(libs).toHaveLength(1)
    expect(libs[0]).toMatchObject({ userId: 'u-owner', type: 'private', visibility: null })

    // Legacy book id is reused as the stable version id (0.3).
    const versions = db.select().from(schema.bookVersions).all()
    expect(versions.map((v) => v.id).sort()).toEqual(['b-deleted', 'b-epub', 'b-txt'])

    const lbv = db.select().from(schema.libraryBookVersions).all()
    expect(lbv).toHaveLength(3)
    expect(lbv.every((v) => v.kind === 'personal' && v.bookVersionId && v.pinnedRevisionId === null)).toBe(true)

    const epubBook = db.select().from(schema.libraryBooks).where(eq(libs[0].id, schema.libraryBooks.libraryId)).all()
      .find((b) => b.title === 'Epub')
    expect(epubBook).toMatchObject({ author: 'A', description: 'desc', coverKey: 'blobs/ab/book1.cover.jpg', deletedAt: null })
    const deletedBook = db.select().from(schema.libraryBooks).all().find((b) => b.title === 'Gone')
    expect(deletedBook?.deletedAt).toBe(8)

    const revisions = db.select().from(schema.contentRevisions).all()
    expect(revisions).toHaveLength(3)
    expect(revisions.every((r) => r.revisionNo === 1)).toBe(true)
    expect(revisions.find((r) => r.bookVersionId === 'b-epub')).toMatchObject({ blobKey: 'blobs/ab/book1.epub', wordCount: 50, chapterCount: 2 })
  })

  it('shares one blob row for identical files and reruns cleanly', async () => {
    const first = await migratePrivateLibraries()
    // b-epub and b-deleted share blobs/ab/book1.epub; +1 cover +1 txt file.
    expect(first.blobs).toBe(3)

    const second = await migratePrivateLibraries()
    expect(second).toMatchObject({ librariesCreated: 0, librariesSkipped: 1, booksMigrated: 0, booksSkipped: 3 })
    expect(db.select().from(schema.bookVersions).all()).toHaveLength(3)

    const log = db.select().from(schema.libraryMigrationLog).all()
    expect(log).toHaveLength(2)
    expect(log.every((row) => row.status === 'completed' && row.batch === 'phase2-private-libraries')).toBe(true)
  })
})

describe('library follow-up migrations', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(memoryStorage(
      new Map([['blobs/ab/book1.epub', 100], ['blobs/ab/book1.cover.jpg', 10], ['blobs/ab/book3.epub', 50]]),
      new Map([
        ['progress/b-epub.json', JSON.stringify({ percent: 60, cfi: 'cfi-1', chapter: 'Ch1', updatedAt: 100, intervals: [] })],
        ['progress/b-txt.json', 'not-json{{{'],
      ]),
    ))

    db.insert(schema.users).values({ id: 'u-owner', username: 'Fool', role: 'owner', createdAt: 1 }).run()
    db.insert(schema.shelves).values([
      { id: 's1', userId: 'u-owner', name: 'Fiction', sortOrder: 0, createdAt: 1 },
      { id: 's2', userId: 'u-owner', name: 'Tech', sortOrder: 1, createdAt: 1 },
    ]).run()
    db.insert(schema.tags).values([
      { id: 't1', userId: 'u-owner', name: 'Fav', sortOrder: 0, createdAt: 1 },
      { id: 't2', userId: 'u-owner', name: 'Later', sortOrder: 1, createdAt: 1 },
    ]).run()
    db.insert(schema.books).values([
      {
        id: 'b-epub', userId: 'u-owner', title: 'Epub', author: 'A', format: 'epub',
        filePath: 'blobs/ab/book1.epub', coverKey: 'blobs/ab/book1.cover.jpg', size: 100,
        meta: {}, createdAt: 2, updatedAt: 3, readStatus: 'reading', progress: 10, lastReadAt: 50, shelfId: 's1',
      },
      {
        id: 'b-missing', userId: 'u-owner', title: 'Lost', author: '', format: 'epub',
        filePath: 'blobs/zz/gone.epub', coverKey: null, size: 10,
        meta: {}, createdAt: 4, updatedAt: 5, readStatus: 'wishlist', progress: 0, shelfId: null,
      },
      {
        id: 'b-txt', userId: 'u-owner', title: 'Txt', author: '', format: 'txt',
        filePath: 'blobs/ab/book3.epub', coverKey: null, size: 50,
        meta: {}, createdAt: 6, updatedAt: 7, readStatus: 'idle', progress: 30, lastReadAt: 70, shelfId: null,
      },
    ]).run()
    db.insert(schema.bookTags).values([
      { bookId: 'b-epub', tagId: 't1' },
      { bookId: 'b-epub', tagId: 't2' },
    ]).run()
    db.insert(schema.annotations).values([
      {
        id: 'a-hl', userId: 'u-owner', bookId: 'b-epub', cfiRange: 'cfi-h', cfiAnchor: 'a1',
        type: 'highlight', color: 'yellow', style: 'highlight', text: 'marked', chapter: 'Ch1',
        createdAt: 10, updatedAt: 11,
      },
      {
        id: 'a-bm', userId: 'u-owner', bookId: 'b-epub', cfiRange: 'cfi-b',
        type: 'bookmark', color: 'yellow', style: 'highlight', text: '', chapter: 'Ch2',
        createdAt: 12, updatedAt: 13,
      },
      {
        id: 'a-note', userId: 'u-owner', bookId: 'b-epub', cfiRange: 'cfi-n',
        type: 'note', color: 'yellow', style: 'highlight', text: 'quoted', note: 'thought', chapter: 'Ch1',
        createdAt: 14, updatedAt: 15,
      },
      {
        id: 'a-orphan', userId: 'u-owner', bookId: 'b-missing', cfiRange: 'cfi-o',
        type: 'highlight', color: 'yellow', style: 'highlight', text: 'lost', chapter: null,
        createdAt: 16, updatedAt: 17,
      },
    ]).run()
    db.insert(schema.readingRecords).values([
      { id: 'r1', userId: 'u-owner', bookId: 'b-epub', date: '2026-09-26', durationSeconds: 60 },
      { id: 'r2', userId: 'u-owner', bookId: 'b-missing', date: '2026-09-26', durationSeconds: 30 },
    ]).run()
    db.insert(schema.readingSessions).values([
      { id: 's1', userId: 'u-owner', bookId: 'b-epub', date: '2026-09-26', durationSeconds: 60 },
    ]).run()
    db.insert(schema.aiThreads).values([
      { id: 'th1', userId: 'u-owner', bookId: 'b-epub', title: 'T', createdAt: 20, updatedAt: 21 },
    ]).run()
    db.insert(schema.textReplacements).values([
      { id: 'tr-global', userId: 'u-owner', bookId: null, matchType: 'pattern', pattern: 'a', createdAt: 22, updatedAt: 23 },
      { id: 'tr-book', userId: 'u-owner', bookId: 'b-epub', matchType: 'pattern', pattern: 'b', createdAt: 24, updatedAt: 25 },
    ]).run()
    db.insert(schema.textReplacementOverrides).values([
      { id: 'o1', userId: 'u-owner', bookId: 'b-epub', replacementId: 'tr-book', enabled: 0, createdAt: 26, updatedAt: 27 },
    ]).run()
  })

  it('migrates shelves/tags/relations reusing ids and reruns cleanly', async () => {
    await migratePrivateLibraries()
    const first = await migrateLibraryOrganization()
    expect(first).toMatchObject({
      shelves: 2, categoriesMigrated: 2, tags: 2, tagsMigrated: 2,
      booksClassified: 1, bookTagRelations: 2,
    })
    expect(first.anomalies).toEqual([{ bookId: 'b-missing', reason: 'book has no migrated library entry' }])

    const categories = db.select().from(schema.libraryCategories).all()
    expect(categories.map((c) => c.id).sort()).toEqual(['s1', 's2'])
    const book = db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.title, 'Epub')).get()
    expect(book?.categoryId).toBe('s1')
    expect(db.select().from(schema.libraryBookTags).all()).toHaveLength(2)

    const second = await migrateLibraryOrganization()
    expect(second).toMatchObject({ categoriesMigrated: 0, tagsMigrated: 0, booksClassified: 1, bookTagRelations: 2 })
  })

  it('migrates reading states preferring progress files with row fallback', async () => {
    await migratePrivateLibraries()
    const report = await migrateReadingStates()
    expect(report).toMatchObject({ books: 3, statesMigrated: 2, statesSkipped: 0 })
    expect(report.anomalies).toEqual([
      { bookId: 'b-missing', reason: 'book has no migrated version' },
      { bookId: 'b-txt', reason: 'unreadable progress file, fell back to books row' },
    ])

    const epub = db.select().from(schema.bookStates).where(eq(schema.bookStates.bookVersionId, 'b-epub')).get()
    expect(epub).toMatchObject({ readStatus: 'reading', percent: 60, cfi: 'cfi-1', chapter: 'Ch1', lastReadAt: 50, updatedAt: 100 })
    const txt = db.select().from(schema.bookStates).where(eq(schema.bookStates.bookVersionId, 'b-txt')).get()
    expect(txt).toMatchObject({ readStatus: 'idle', percent: 30, cfi: null, chapter: null, lastReadAt: 70, updatedAt: 7 })

    const rerun = await migrateReadingStates()
    expect(rerun).toMatchObject({ statesMigrated: 0, statesSkipped: 2 })
  })

  it('splits annotations by type keeping ids and soft-delete state', async () => {
    await migratePrivateLibraries()
    const report = await migrateAnnotations()
    expect(report).toMatchObject({ annotations: 4, highlights: 1, bookmarks: 1, ideas: 1, skipped: 0 })
    expect(report.anomalies).toEqual([{ bookId: 'b-missing', reason: 'annotation a-orphan has no migrated version' }])

    expect(db.select().from(schema.highlights).where(eq(schema.highlights.id, 'a-hl')).get())
      .toMatchObject({ bookVersionId: 'b-epub', text: 'marked', revisionId: null, relocation: 'ok' })
    expect(db.select().from(schema.bookmarks).where(eq(schema.bookmarks.id, 'a-bm')).get())
      .toMatchObject({ bookVersionId: 'b-epub', cfi: 'cfi-b', chapter: 'Ch2' })
    expect(db.select().from(schema.ideas).where(eq(schema.ideas.id, 'a-note')).get())
      .toMatchObject({ bookVersionId: 'b-epub', text: 'quoted', note: 'thought', visibility: 'private', sharedLibraryId: null })

    const rerun = await migrateAnnotations()
    expect(rerun).toMatchObject({ highlights: 0, bookmarks: 0, ideas: 0, skipped: 3 })
  })

  it('backfills version references and reports rows without a version', async () => {
    await migratePrivateLibraries()
    const report = await backfillVersionReferences()
    expect(report.tables).toMatchObject({
      reading_records: 1,
      reading_sessions: 1,
      ai_threads: 1,
      text_replacements: 1,
      text_replacement_overrides: 1,
    })
    expect(report.anomalies).toEqual([
      { bookId: 'b-missing', reason: 'reading_records row r2 has no migrated version' },
    ])
    expect(db.select({ bookVersionId: schema.readingRecords.bookVersionId }).from(schema.readingRecords).where(eq(schema.readingRecords.id, 'r1')).get())
      .toEqual({ bookVersionId: 'b-epub' })

    const rerun = await backfillVersionReferences()
    expect(Object.values(rerun.tables).every((count) => count === 0)).toBe(true)
  })
})

describe('library identity migration', () => {
  let db: ReturnType<typeof createTestDb>

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(storage, 'getStorage').mockReturnValue(memoryStorage(new Map()))

    db.insert(schema.users).values([
      { id: 'u-owner', username: 'Fool', role: 'owner', createdAt: 1 },
      { id: 'u-guest', username: 'admin', role: 'guest', createdAt: 1 },
    ]).run()
    db.insert(schema.instanceSettings).values([
      { key: 'allowRegistration', value: 'true' },
      { key: 'allowGuestAccess', value: 'false' },
    ]).run()
  })

  it('backfills normalized names, skips the guest row, and blocks on conflict', async () => {
    const first = await backfillUserFields()
    expect(first).toMatchObject({ users: 1, backfilled: 1, skipped: 0, anomalies: [] })
    expect(db.select({ usernameNormalized: schema.users.usernameNormalized }).from(schema.users).where(eq(schema.users.id, 'u-owner')).get())
      .toEqual({ usernameNormalized: 'fool' })
    expect(db.select({ usernameNormalized: schema.users.usernameNormalized }).from(schema.users).where(eq(schema.users.id, 'u-guest')).get())
      .toEqual({ usernameNormalized: null })

    const second = await backfillUserFields()
    expect(second).toMatchObject({ backfilled: 0, skipped: 1 })

    db.insert(schema.users).values({ id: 'u-clash', username: 'FOOL', role: 'member', createdAt: 2 }).run()
    await expect(backfillUserFields()).rejects.toThrow('usernameNormalized conflicts block migration')
  })

  it('seeds the instance from the adjudicated owner and settings', async () => {
    await backfillUserFields()
    const report = await seedInstance()
    expect(report).toMatchObject({
      created: true, ownerId: 'u-owner', allowRegistration: true, allowGuestAccess: false, uploadMaxBytes: null,
    })
    expect(db.select().from(schema.instance).all()).toHaveLength(1)

    const rerun = await seedInstance()
    expect(rerun.created).toBe(false)
  })

  it('blocks instance seeding without exactly one enabled owner', async () => {
    db.insert(schema.users).values({ id: 'u-second', username: 'Second', role: 'owner', createdAt: 2 }).run()
    await expect(seedInstance()).rejects.toThrow('expected exactly one enabled owner, found 2')
    expect(db.select().from(schema.instance).all()).toHaveLength(0)
  })

  it('verifies a fully migrated database end to end', async () => {
    db.insert(schema.books).values({
      id: 'b1', userId: 'u-owner', title: 'B', author: '', format: 'txt',
      filePath: 'blobs/ab/b1.epub', coverKey: null, size: 10,
      meta: {}, createdAt: 1, updatedAt: 1,
    }).run()
    vi.spyOn(storage, 'getStorage').mockReturnValue(memoryStorage(new Map([['blobs/ab/b1.epub', 10]])))

    await backfillUserFields()
    await migratePrivateLibraries()
    await seedInstance()
    await migrateLibraryOrganization()
    await migrateReadingStates()
    await migrateAnnotations()
    await backfillVersionReferences()
    const report = await verifyPhase2Migration()
    expect(report.pass).toBe(true)
    expect(report.checks.map((c) => c.name)).toEqual(expect.arrayContaining([
      'private-library-per-user', 'guest-has-no-library', 'username-normalized',
      'book-versions', 'initial-revisions', 'revision-files', 'categories', 'tags',
      'reading-states', 'annotations', 'version-references', 'instance',
    ]))
  })

  it('backfills revision meta and pins from legacy rows without touching newer state', async () => {
    db.insert(schema.books).values({
      id: 'b1', userId: 'u-owner', title: 'B', author: '', format: 'txt',
      filePath: 'blobs/ab/b1.epub', coverKey: null, size: 10,
      meta: { chapters: [{ id: 'ch-0', title: 'Ch', wordCount: 5 }], wordCount: 5 },
      createdAt: 1, updatedAt: 1, pinnedAt: 99,
    }).run()
    db.insert(schema.bookVersions).values({ id: 'b1', format: 'txt', size: 10, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.contentRevisions).values({
      id: 'r1', bookVersionId: 'b1', revisionNo: 1, blobKey: 'blobs/ab/b1.epub',
      size: 10, wordCount: 5, chapterCount: 1, meta: {}, createdAt: 1,
    }).run()
    db.insert(schema.libraries).values({ id: 'l1', userId: 'u-owner', type: 'private', name: 'Fool', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBooks).values({ id: 'lb1', libraryId: 'l1', userId: 'u-owner', title: 'B', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBookVersions).values({
      id: 'lbv1', libraryId: 'l1', libraryBookId: 'lb1', bookVersionId: 'b1',
      kind: 'personal', createdAt: 1, updatedAt: 1,
    }).run()

    const first = await backfillRevisionMeta()
    expect(first).toMatchObject({ versions: 1, metasBackfilled: 1, pinsBackfilled: 1, anomalies: [] })
    expect(db.select({ meta: schema.contentRevisions.meta }).from(schema.contentRevisions).where(eq(schema.contentRevisions.id, 'r1')).get())
      .toEqual({ meta: { chapters: [{ id: 'ch-0', title: 'Ch', wordCount: 5 }], wordCount: 5 } })
    expect(db.select({ pinnedAt: schema.libraryBookVersions.pinnedAt }).from(schema.libraryBookVersions).where(eq(schema.libraryBookVersions.id, 'lbv1')).get())
      .toEqual({ pinnedAt: 99 })

    const second = await backfillRevisionMeta()
    expect(second).toMatchObject({ metasBackfilled: 0, pinsBackfilled: 0 })
  })
})
