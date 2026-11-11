import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { and, eq } from 'drizzle-orm'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import archiveRoutes from './archive.routes'
import { deleteBookArchive, exportNotes, getBookDetail, getOverview, listBooks } from './archive.service'

type TestDb = ReturnType<typeof drizzle<typeof schema>>

function seedVersion(db: TestDb, userId: string, bookId: string, title = 'B', author = '') {
  let library = db.select({ id: schema.libraries.id }).from(schema.libraries)
    .where(and(eq(schema.libraries.userId, userId), eq(schema.libraries.type, 'private'))).get()
  if (!library) {
    const libraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: libraryId, userId, type: 'private', name: userId, createdAt: 1, updatedAt: 1,
    }).run()
    library = { id: libraryId }
  }
  db.insert(schema.bookVersions).values({ id: bookId, format: 'txt', size: 100, createdAt: 1, updatedAt: 1 }).run()
  db.insert(schema.contentRevisions).values({
    id: createId('rev'), bookVersionId: bookId, revisionNo: 1, blobKey: `blobs/x/${bookId}.epub`,
    size: 100, wordCount: 100, chapterCount: 0, meta: {}, createdAt: 1,
  }).run()
  const libraryBookId = createId('lb')
  db.insert(schema.libraryBooks).values({
    id: libraryBookId, libraryId: library.id, userId, title, author, createdAt: 1, updatedAt: 1,
  }).run()
  db.insert(schema.libraryBookVersions).values({
    id: createId('lbv'), libraryId: library.id, libraryBookId, bookVersionId: bookId,
    kind: 'personal', createdAt: 1, updatedAt: 1,
  }).run()
  return { libraryId: library.id, libraryBookId }
}

function seedHighlight(db: TestDb, userId: string, bookId: string, at: number, deleted = false) {
  db.insert(schema.highlights).values({
    id: createId('hl'), userId, bookVersionId: bookId, cfiRange: `cfi-${at}`,
    text: `quote ${at}`, chapter: 'chapter one', createdAt: at, updatedAt: at,
    deletedAt: deleted ? at : null,
  }).run()
}

function seedBookmark(db: TestDb, userId: string, bookId: string, at: number) {
  db.insert(schema.bookmarks).values({
    id: createId('bm'), userId, bookVersionId: bookId, cfi: `cfi-${at}`,
    title: `mark ${at}`, createdAt: at, updatedAt: at, deletedAt: null,
  }).run()
}

function seedIdea(db: TestDb, userId: string, bookId: string, at: number) {
  db.insert(schema.ideas).values({
    id: createId('idea'), userId, bookVersionId: bookId, cfiRange: `cfi-${at}`,
    text: `quote ${at}`, note: `thought ${at}`, createdAt: at, updatedAt: at, deletedAt: null,
  }).run()
}

function seedPrivateReview(db: TestDb, userId: string, workId: string, at: number) {
  db.insert(schema.bookReviews).values({
    id: createId('review'), userId, privateLibraryBookId: workId,
    ratingHalves: 8, body: 'a private review', visibility: 'private',
    createdAt: at, updatedAt: at,
  }).run()
}

function seedSourceReview(db: TestDb, userId: string, versionId: string, at: number) {
  db.insert(schema.bookReviews).values({
    id: createId('review'), userId,
    sourceLibraryId: 'lib-gone', sourceLibraryBookId: 'work-gone',
    ratingHalves: 9, body: 'a shared review', visibility: 'shared',
    readBookVersionId: versionId, createdAt: at, updatedAt: at,
  }).run()
}

describe('archive service', () => {
  let db: TestDb
  let ownerId: string
  let otherId: string
  let bookOne: string
  let bookTwo: string

  beforeEach(async () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
    await client.runDatabaseMigrations(db)
    vi.spyOn(client, 'getDb').mockReturnValue(db)

    ownerId = createId('user')
    db.insert(schema.users).values({ id: ownerId, username: 'owner', createdAt: Date.now() }).run()
    otherId = createId('user')
    db.insert(schema.users).values({ id: otherId, username: 'other', createdAt: Date.now() }).run()

    bookOne = createId('book')
    bookTwo = createId('book')
    seedVersion(db, ownerId, bookOne, 'Book One', 'Author A')
    seedVersion(db, ownerId, bookTwo, 'Book Two', 'Author B')
    db.insert(schema.bookStates).values({ userId: ownerId, bookVersionId: bookOne, readStatus: 'finished', updatedAt: 10 }).run()
  })

  it('returns only complete archive counts without a second book-list projection', async () => {
    seedHighlight(db, ownerId, bookOne, 100)
    seedBookmark(db, ownerId, bookOne, 200)
    for (let i = 0; i < 6; i++) {
      const versionId = `reading-only-${i}`
      db.insert(schema.readingArchives).values({ userId: ownerId, bookVersionId: versionId, title: `Reading ${i}`, createdAt: 1, updatedAt: 1 }).run()
    }
    db.insert(schema.readingArchives).values({ userId: ownerId, bookVersionId: bookOne, title: 'Book One', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.readingArchives).values({ userId: otherId, bookVersionId: bookTwo, title: 'Other account', createdAt: 1, updatedAt: 1 }).run()
    seedHighlight(db, ownerId, bookTwo, 300, true)
    const overview = await getOverview(ownerId)
    expect(overview.totalBooks).toBe(7)
    expect(overview).toEqual({ totalBooks: 7, counts: { highlights: 1, bookmarks: 1, ideas: 0, reviews: 0, total: 2 } })
    await listBooks(ownerId, { search: 'One', type: 'highlight', sort: 'recent', page: 1, pageSize: 1 })
    expect((await getOverview(ownerId)).totalBooks).toBe(7)
  })

  it('counts live rows per record type with real data', async () => {
    seedHighlight(db, ownerId, bookOne, 100)
    seedHighlight(db, ownerId, bookOne, 200, true)
    seedBookmark(db, ownerId, bookOne, 150)
    seedIdea(db, ownerId, bookTwo, 120)
    seedHighlight(db, otherId, bookOne, 300)

    const overview = await getOverview(ownerId)
    expect(overview.counts).toEqual({ highlights: 1, bookmarks: 1, ideas: 1, reviews: 0, total: 3 })
    const books = await listBooks(ownerId, { sort: 'recent', page: 1, pageSize: 20 })
    expect(books.entries.map((b) => b.bookVersionId)).toEqual([bookOne, bookTwo])
    expect(books.entries[0]).toMatchObject({
      title: 'Book One', author: 'Author A', format: 'txt', readStatus: 'finished',
      highlights: 1, bookmarks: 1, ideas: 0, total: 2, lastRecordAt: 150,
    })
  })

  it('attributes private and source reviews to their versions', async () => {
    const work = db.select({ id: schema.libraryBooks.id }).from(schema.libraryBooks)
      .innerJoin(schema.libraryBookVersions, eq(schema.libraryBookVersions.libraryBookId, schema.libraryBooks.id))
      .where(eq(schema.libraryBookVersions.bookVersionId, bookOne)).get()!
    seedPrivateReview(db, ownerId, work.id, 400)
    seedSourceReview(db, ownerId, bookTwo, 500)

    const overview = await getOverview(ownerId)
    expect(overview.counts.reviews).toBe(2)
    const books = await listBooks(ownerId, { sort: 'recent', page: 1, pageSize: 20 })
    const one = books.entries.find((b) => b.bookVersionId === bookOne)!
    const two = books.entries.find((b) => b.bookVersionId === bookTwo)!
    expect(one.reviews).toBe(1)
    expect(two.reviews).toBe(1)
    expect(books.entries[0].bookVersionId).toBe(bookTwo)

    const onlyReviews = await listBooks(ownerId, { type: 'review', sort: 'recent', page: 1, pageSize: 20 })
    expect(onlyReviews.entries.map((b) => b.bookVersionId).sort()).toEqual([bookOne, bookTwo].sort())
  })

  it('searches by title, sorts, and paginates with effect', async () => {
    seedHighlight(db, ownerId, bookOne, 100)
    seedHighlight(db, ownerId, bookTwo, 100)
    seedBookmark(db, ownerId, bookTwo, 110)
    seedIdea(db, ownerId, bookTwo, 120)

    const searched = await listBooks(ownerId, { search: 'two', sort: 'recent', page: 1, pageSize: 20 })
    expect(searched.entries.map((b) => b.title)).toEqual(['Book Two'])

    const byRecords = await listBooks(ownerId, { sort: 'most', page: 1, pageSize: 20 })
    expect(byRecords.entries[0].bookVersionId).toBe(bookTwo)

    const secondPage = await listBooks(ownerId, { sort: 'most', page: 2, pageSize: 1 })
    expect(secondPage.entries.map((b) => b.bookVersionId)).toEqual([bookOne])
    expect(secondPage.hasMore).toBe(false)
  })

  it('sorts by earliest creation, totals, and titles in both directions', async () => {
    // Editing an older note must not advance its creation time.
    seedHighlight(db, ownerId, bookOne, 100)
    db.insert(schema.highlights).values({
      id: createId('hl'), userId: ownerId, bookVersionId: bookOne, cfiRange: 'cfi-late',
      text: 'late quote', chapter: 'chapter two', createdAt: 120, updatedAt: 900, deletedAt: null,
    }).run()
    // bookTwo: everything in between, plus one more record overall.
    seedHighlight(db, ownerId, bookTwo, 50)
    seedBookmark(db, ownerId, bookTwo, 60)
    seedIdea(db, ownerId, bookTwo, 70)

    const earliest = await listBooks(ownerId, { sort: 'earliest', page: 1, pageSize: 20 })
    expect(earliest.entries.map((b) => b.bookVersionId)).toEqual([bookTwo, bookOne])
    expect(earliest.entries[0]).toMatchObject({ firstRecordAt: 50, lastRecordAt: 70 })
    expect(earliest.entries[1]).toMatchObject({ firstRecordAt: 100, lastRecordAt: 120 })

    const recent = await listBooks(ownerId, { sort: 'recent', page: 1, pageSize: 20 })
    expect(recent.entries.map((b) => b.bookVersionId)).toEqual([bookOne, bookTwo])

    const most = await listBooks(ownerId, { sort: 'most', page: 1, pageSize: 20 })
    expect(most.entries.map((b) => b.bookVersionId)).toEqual([bookTwo, bookOne])

    const fewest = await listBooks(ownerId, { sort: 'fewest', page: 1, pageSize: 20 })
    expect(fewest.entries.map((b) => b.bookVersionId)).toEqual([bookOne, bookTwo])

    const titleAsc = await listBooks(ownerId, { sort: 'title-asc', page: 1, pageSize: 20 })
    expect(titleAsc.entries.map((b) => b.title)).toEqual(['Book One', 'Book Two'])
    const titleDesc = await listBooks(ownerId, { sort: 'title-desc', page: 1, pageSize: 20 })
    expect(titleDesc.entries.map((b) => b.title)).toEqual(['Book Two', 'Book One'])

    const secondPage = await listBooks(ownerId, { sort: 'earliest', page: 2, pageSize: 1 })
    expect(secondPage.entries.map((b) => b.bookVersionId)).toEqual([bookOne])
    expect(secondPage.hasMore).toBe(false)
  })

  it('keeps reading-only archives last in time orders and available in count and title orders', async () => {
    db.insert(schema.readingArchives).values({ userId: ownerId, bookVersionId: bookTwo, title: 'Book Two', createdAt: 1, updatedAt: 99999 }).run()
    seedBookmark(db, ownerId, bookOne, 100)
    for (const sort of ['recent', 'earliest', 'most', 'title-asc'] as const) {
      const result = await listBooks(ownerId, { sort, page: 1, pageSize: 20 })
      expect(result.entries.map((book) => book.bookVersionId)).toEqual([bookOne, bookTwo])
      expect(result.entries[1]).toMatchObject({ total: 0, firstRecordAt: null, lastRecordAt: null })
    }
    for (const sort of ['fewest', 'title-desc'] as const) {
      expect((await listBooks(ownerId, { sort, page: 1, pageSize: 20 })).entries[0].bookVersionId).toBe(bookTwo)
    }
    expect((await listBooks(ownerId, { type: 'bookmark', sort: 'recent', page: 1, pageSize: 20 })).entries.map((book) => book.bookVersionId)).toEqual([bookOne])
  })

  it('scopes both time and count sorting to the selected annotation type', async () => {
    seedBookmark(db, ownerId, bookOne, 100)
    seedHighlight(db, ownerId, bookOne, 900)
    seedHighlight(db, ownerId, bookOne, 1000)
    seedIdea(db, ownerId, bookOne, 800)
    seedBookmark(db, ownerId, bookTwo, 200)
    seedBookmark(db, ownerId, bookTwo, 300)
    seedHighlight(db, ownerId, bookTwo, 50)
    for (const sort of ['recent', 'most'] as const) {
      expect((await listBooks(ownerId, { sort, page: 1, pageSize: 20 })).entries[0].bookVersionId).toBe(bookOne)
      const scoped = await listBooks(ownerId, { type: 'bookmark', sort, page: 1, pageSize: 20 })
      expect(scoped.entries.map((book) => book.bookVersionId)).toEqual([bookTwo, bookOne])
      expect(scoped.entries[0]).toMatchObject({ firstRecordAt: 200, lastRecordAt: 300 })
    }
    for (const sort of ['earliest', 'fewest'] as const) {
      expect((await listBooks(ownerId, { type: 'bookmark', sort, page: 1, pageSize: 20 })).entries[0].bookVersionId).toBe(bookOne)
    }
  })

  it('ignores edits, deleted notes and other users when finding recent notes', async () => {
    seedHighlight(db, ownerId, bookOne, 100)
    seedBookmark(db, ownerId, bookTwo, 200)
    seedHighlight(db, ownerId, bookOne, 5000, true)
    seedHighlight(db, otherId, bookOne, 6000)
    db.update(schema.highlights).set({ updatedAt: 10000 }).where(eq(schema.highlights.bookVersionId, bookOne)).run()
    const work = db.select({ id: schema.libraryBookVersions.libraryBookId }).from(schema.libraryBookVersions)
      .where(eq(schema.libraryBookVersions.bookVersionId, bookOne)).get()!
    seedPrivateReview(db, ownerId, work.id, 50)
    db.update(schema.bookReviews).set({ updatedAt: 20000 }).run()
    const recent = await listBooks(ownerId, { sort: 'recent', page: 1, pageSize: 20 })
    expect(recent.entries.map((book) => book.bookVersionId)).toEqual([bookTwo, bookOne])
    expect(recent.entries[1]).toMatchObject({ firstRecordAt: 50, lastRecordAt: 100 })
    expect((await listBooks(ownerId, { type: 'review', sort: 'recent', page: 1, pageSize: 20 })).entries[0].lastRecordAt).toBe(50)
    db.update(schema.bookmarks).set({ deletedAt: 300 }).run()
    expect((await listBooks(ownerId, { sort: 'recent', page: 1, pageSize: 20 })).entries.map((book) => book.bookVersionId)).toEqual([bookOne])
  })

  it('breaks equal annotation keys by title before paginating', async () => {
    seedHighlight(db, ownerId, bookOne, 100)
    seedHighlight(db, ownerId, bookTwo, 100)
    for (const sort of ['recent', 'earliest', 'most', 'fewest'] as const) {
      expect((await listBooks(ownerId, { sort, page: 1, pageSize: 1 })).entries[0].bookVersionId).toBe(bookOne)
      expect((await listBooks(ownerId, { sort, page: 2, pageSize: 1 })).entries[0].bookVersionId).toBe(bookTwo)
    }
  })

  it('returns annotations and own reviews for one book', async () => {
    seedHighlight(db, ownerId, bookOne, 100)
    seedIdea(db, ownerId, bookOne, 110)
    seedIdea(db, ownerId, bookTwo, 120)
    const work = db.select({ id: schema.libraryBooks.id }).from(schema.libraryBooks)
      .innerJoin(schema.libraryBookVersions, eq(schema.libraryBookVersions.libraryBookId, schema.libraryBooks.id))
      .where(eq(schema.libraryBookVersions.bookVersionId, bookOne)).get()!
    seedPrivateReview(db, ownerId, work.id, 400)

    const detail = await getBookDetail(ownerId, bookOne)
    expect(detail.annotations).toHaveLength(2)
    expect(detail.annotations.map((a) => a.type).sort()).toEqual(['highlight', 'note'])
    expect(detail.reviews).toHaveLength(1)
    expect(detail.reviews[0].body).toBe('a private review')
  })

  it('keeps the review readable after its version is gone', async () => {
    // Stale read provenance: the version id no longer resolves to any book.
    seedSourceReview(db, ownerId, 'v-gone', 500)

    const overview = await getOverview(ownerId)
    expect(overview.counts.reviews).toBe(1)
    expect(overview.totalBooks).toBe(1)
    const books = await listBooks(ownerId, { sort: 'recent', page: 1, pageSize: 20 })
    expect(books.entries[0]).toMatchObject({ bookVersionId: 'v-gone', title: 'Unavailable book' })
    const detail = await getBookDetail(ownerId, 'v-gone')
    expect(detail.annotations).toEqual([])
    expect(detail.reviews).toHaveLength(1)
  })

  it('does not leak private titles across users during archive search', async () => {
    const secretVersion = createId('book')
    seedVersion(db, otherId, secretVersion, 'Top Secret Diary')
    seedHighlight(db, ownerId, secretVersion, 100)

    const searchRes = await listBooks(ownerId, { search: 'Secret', page: 1, pageSize: 20 })
    expect(searchRes.entries).toHaveLength(0)
    expect(searchRes.hasMore).toBe(false)
  })
  it('scopes counts, participating books and note sorting without using edits or foreign/deleted facts', async () => {
    const from = Date.parse('2026-10-17T16:00:00Z')
    const until = Date.parse('2026-10-18T16:00:00Z')
    const range = { from: '2026-10-18', to: '2026-10-18', timezone: 'Asia/Shanghai' }
    const readingOnly = createId('book')
    seedVersion(db, ownerId, readingOnly, 'Reading Only')
    for (const [userId, bookId, date] of [
      [ownerId, readingOnly, '2026-10-18'], [ownerId, bookTwo, '2026-10-17'], [otherId, bookTwo, '2026-10-18'],
    ]) db.insert(schema.readingRecords).values({ id: createId('rr'), userId, bookId, bookVersionId: bookId, date, durationSeconds: 120 }).run()
    seedHighlight(db, ownerId, bookOne, from)
    seedBookmark(db, ownerId, bookOne, from + 1000)
    seedHighlight(db, ownerId, bookTwo, from - 1)
    seedHighlight(db, ownerId, bookTwo, until)
    seedIdea(db, otherId, bookTwo, from + 5000)
    seedHighlight(db, ownerId, bookTwo, from + 5000, true)
    db.update(schema.highlights).set({ updatedAt: until + 10000 }).where(eq(schema.highlights.bookVersionId, bookTwo)).run()
    const work = db.select({ id: schema.libraryBookVersions.libraryBookId }).from(schema.libraryBookVersions).where(eq(schema.libraryBookVersions.bookVersionId, bookOne)).get()!
    seedPrivateReview(db, ownerId, work.id, from + 2000)
    seedSourceReview(db, ownerId, bookTwo, from - 1)
    db.update(schema.bookReviews).set({ updatedAt: until + 20000 }).run()
    expect(await getOverview(ownerId, range)).toEqual({ counts: { highlights: 1, bookmarks: 1, ideas: 0, reviews: 1, total: 3 }, totalBooks: 2 })
    const scoped = await listBooks(ownerId, { ...range, sort: 'recent', page: 1, pageSize: 20 })
    expect(scoped.entries.map((book) => book.bookVersionId)).toEqual([bookOne, readingOnly])
    expect(scoped.entries[0]).toMatchObject({ total: 3, firstRecordAt: from, lastRecordAt: from + 2000 })
    expect((await listBooks(ownerId, { ...range, type: 'bookmark', sort: 'recent', page: 1, pageSize: 20 })).entries.map((book) => book.bookVersionId)).toEqual([bookOne])
    expect((await listBooks(ownerId, { ...range, type: 'idea', sort: 'recent', page: 1, pageSize: 20 })).entries).toEqual([])
    const detail = await getBookDetail(ownerId, bookOne, range)
    expect(detail.annotations).toHaveLength(2)
    expect(detail.reviews).toHaveLength(1)
    expect(detail.reviews[0].createdAt).toBe(from + 2000)
    expect((await getBookDetail(ownerId, bookTwo, range)).annotations).toEqual([])
    expect((await getOverview(ownerId)).totalBooks).toBe(3)
  })

  it('enriches book list with reading metrics and sorts by reading-time', async () => {
    db.insert(schema.readingRecords).values([
      { id: createId('rr'), userId: ownerId, bookId: bookOne, date: '2026-10-18', durationSeconds: 300 },
      { id: createId('rr'), userId: ownerId, bookId: bookTwo, date: '2026-10-18', durationSeconds: 600 },
    ]).run()
    db.update(schema.bookStates).set({ percent: 45 }).where(eq(schema.bookStates.bookVersionId, bookOne)).run()

    const byTime = await listBooks(ownerId, { sort: 'reading-time', page: 1, pageSize: 20 })
    expect(byTime.entries.map((b) => b.bookVersionId)).toEqual([bookTwo, bookOne])
    expect(byTime.entries[0]).toMatchObject({ durationSeconds: 600, readingDays: 1, progress: null })
    expect(byTime.entries[1]).toMatchObject({ durationSeconds: 300, readingDays: 1, progress: 45 })
  })

  it('filters book list by readStatus', async () => {
    seedHighlight(db, ownerId, bookOne, 100)
    seedHighlight(db, ownerId, bookTwo, 200)
    db.update(schema.bookStates).set({ readStatus: 'finished' }).where(eq(schema.bookStates.bookVersionId, bookOne)).run()
    db.insert(schema.bookStates).values({ userId: ownerId, bookVersionId: bookTwo, readStatus: 'reading', updatedAt: 10 }).run()

    const finishedOnly = await listBooks(ownerId, { readStatus: 'finished', sort: 'recent', page: 1, pageSize: 20 })
    expect(finishedOnly.entries.map((b) => b.bookVersionId)).toEqual([bookOne])

    const readingList = await listBooks(ownerId, { readStatus: 'reading', sort: 'recent', page: 1, pageSize: 20 })
    expect(readingList.entries.some((b) => b.bookVersionId === bookOne)).toBe(false)
    expect(readingList.entries.map((b) => b.bookVersionId)).toContain(bookTwo)

    // Multi-status filtering
    const multiStatus = await listBooks(ownerId, { readStatus: 'finished,reading', sort: 'recent', page: 1, pageSize: 20 })
    expect(multiStatus.entries.map((b) => b.bookVersionId)).toContain(bookOne)
    expect(multiStatus.entries.map((b) => b.bookVersionId)).toContain(bookTwo)
  })

  it('sorts by reading-time-asc and filters by multiple types', async () => {
    db.insert(schema.readingRecords).values([
      { id: createId('rr'), userId: ownerId, bookId: bookOne, date: '2026-10-18', durationSeconds: 300 },
      { id: createId('rr'), userId: ownerId, bookId: bookTwo, date: '2026-10-18', durationSeconds: 600 },
    ]).run()

    // reading-time-asc sorts lowest duration first
    const ascTime = await listBooks(ownerId, { sort: 'reading-time-asc', page: 1, pageSize: 20 })
    expect(ascTime.entries.map((b) => b.bookVersionId)).toEqual([bookOne, bookTwo])

    // multi-type filtering
    seedHighlight(db, ownerId, bookOne, 100)
    seedBookmark(db, ownerId, bookTwo, 200)
    const multiType = await listBooks(ownerId, { type: 'highlight,bookmark', sort: 'recent', page: 1, pageSize: 20 })
    expect(multiType.entries.map((b) => b.bookVersionId)).toEqual([bookTwo, bookOne])
  })

  it('exports live notes and own reviews per book with user isolation', async () => {
    seedHighlight(db, ownerId, bookOne, 100)
    seedHighlight(db, ownerId, bookOne, 105, true)
    seedBookmark(db, ownerId, bookOne, 110)
    seedIdea(db, ownerId, bookTwo, 120)
    seedHighlight(db, otherId, bookOne, 130)
    const workOne = db.select({ id: schema.libraryBooks.id }).from(schema.libraryBooks)
      .innerJoin(schema.libraryBookVersions, eq(schema.libraryBookVersions.libraryBookId, schema.libraryBooks.id))
      .where(eq(schema.libraryBookVersions.bookVersionId, bookOne)).get()!
    seedPrivateReview(db, ownerId, workOne.id, 400)

    const result = await exportNotes(ownerId)
    expect(result.version).toBe(1)
    expect(result.books).toHaveLength(2)
    const one = result.books.find((book) => book.bookId === bookOne)!
    expect(one).toMatchObject({ title: 'Book One', author: 'Author A' })
    expect(one.highlights.map((row) => row.cfiRange)).toEqual(['cfi-100'])
    expect(one.highlights[0]).toMatchObject({ text: 'quote 100', chapter: 'chapter one' })
    expect(one.bookmarks).toHaveLength(1)
    expect(one.ideas).toHaveLength(0)
    const two = result.books.find((book) => book.bookId === bookTwo)!
    expect(two.ideas).toHaveLength(1)
    expect(two.ideas[0]).toMatchObject({ note: 'thought 120', visibility: 'private' })
    expect(result.reviews).toHaveLength(1)
    expect(result.reviews[0]).toMatchObject({ rating: 4, workTitle: 'Book One', visibility: 'private' })

    const other = await exportNotes(otherId)
    expect(other.books.find((book) => book.bookId === bookOne)!.highlights).toHaveLength(1)
    expect(other.reviews).toHaveLength(0)
  })

  it('scopes single-book export to that version and its work review', async () => {
    seedHighlight(db, ownerId, bookOne, 100)
    seedIdea(db, ownerId, bookTwo, 120)
    const workOne = db.select({ id: schema.libraryBooks.id }).from(schema.libraryBooks)
      .innerJoin(schema.libraryBookVersions, eq(schema.libraryBookVersions.libraryBookId, schema.libraryBooks.id))
      .where(eq(schema.libraryBookVersions.bookVersionId, bookOne)).get()!
    const workTwo = db.select({ id: schema.libraryBooks.id }).from(schema.libraryBooks)
      .innerJoin(schema.libraryBookVersions, eq(schema.libraryBookVersions.libraryBookId, schema.libraryBooks.id))
      .where(eq(schema.libraryBookVersions.bookVersionId, bookTwo)).get()!
    seedPrivateReview(db, ownerId, workOne.id, 400)
    seedPrivateReview(db, ownerId, workTwo.id, 410)

    const result = await exportNotes(ownerId, bookOne)
    expect(result.books).toHaveLength(1)
    expect(result.books[0]).toMatchObject({ bookId: bookOne, title: 'Book One' })
    expect(result.books[0].highlights).toHaveLength(1)
    expect(result.books[0].ideas).toHaveLength(0)
    expect(result.reviews.map((row) => row.workTitle)).toEqual(['Book One'])
  })

  it('falls back to the archive snapshot for lost sources and keeps read-provenance reviews', async () => {
    const gone = createId('book')
    seedHighlight(db, ownerId, gone, 100)
    db.insert(schema.readingArchives).values({
      userId: ownerId, bookVersionId: gone, title: 'Archived book', author: 'Gone author',
      createdAt: 1, updatedAt: 1,
    }).run()
    seedSourceReview(db, ownerId, gone, 500)

    const result = await exportNotes(ownerId, gone)
    expect(result.books).toHaveLength(1)
    expect(result.books[0]).toMatchObject({ bookId: gone, title: 'Archived book', author: 'Gone author' })
    expect(result.books[0].highlights).toHaveLength(1)
    expect(result.reviews).toHaveLength(1)
    // The source is unreadable, so attribution falls back to the retained snapshot.
    expect(result.reviews[0]).toMatchObject({
      workTitle: 'Archived book', workAuthor: 'Gone author',
      bookVersionId: gone, sourceLibraryId: 'lib-gone', visibility: 'shared',
    })
  })

  it('hides unreadable source work metadata without a retained snapshot', async () => {
    seedSourceReview(db, ownerId, createId('book'), 500)
    const result = await exportNotes(ownerId)
    expect(result.reviews).toHaveLength(1)
    expect(result.reviews[0]).toMatchObject({ workTitle: null, workAuthor: null })
  })

  it('hides source metadata when the source work exists but the caller lost access', async () => {
    const sharedLibraryId = createId('lib')
    db.insert(schema.libraries).values({
      id: sharedLibraryId, userId: otherId, type: 'shared', name: 'closed library',
      visibility: 'private', createdAt: 1, updatedAt: 1,
    }).run()
    const workId = createId('lb')
    db.insert(schema.libraryBooks).values({
      id: workId, libraryId: sharedLibraryId, userId: otherId,
      title: 'Shared work', author: 'Shared author', createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.bookReviews).values({
      id: createId('review'), userId: ownerId,
      sourceLibraryId: sharedLibraryId, sourceLibraryBookId: workId,
      ratingHalves: 8, body: 'a collected review', visibility: 'private',
      readBookVersionId: createId('book'), createdAt: 600, updatedAt: 600,
    }).run()

    const result = await exportNotes(ownerId)
    expect(result.reviews).toHaveLength(1)
    expect(result.reviews[0]).toMatchObject({ workTitle: null, workAuthor: null, sourceLibraryBookId: workId })
  })

  it('keeps reviews whose work and versions no longer exist', async () => {
    const workOne = db.select({ id: schema.libraryBooks.id }).from(schema.libraryBooks)
      .innerJoin(schema.libraryBookVersions, eq(schema.libraryBookVersions.libraryBookId, schema.libraryBooks.id))
      .where(eq(schema.libraryBookVersions.bookVersionId, bookOne)).get()!
    seedPrivateReview(db, ownerId, workOne.id, 400)
    db.delete(schema.libraryBookVersions).where(eq(schema.libraryBookVersions.libraryBookId, workOne.id)).run()

    const result = await exportNotes(ownerId)
    expect(result.reviews).toHaveLength(1)
    expect(result.reviews[0]).toMatchObject({ workTitle: 'Book One', workAuthor: 'Author A' })
  })

  it('keeps unattributed reviews while excluding pending-attributed ones', async () => {
    const workOne = db.select({ id: schema.libraryBooks.id }).from(schema.libraryBooks)
      .innerJoin(schema.libraryBookVersions, eq(schema.libraryBookVersions.libraryBookId, schema.libraryBooks.id))
      .where(eq(schema.libraryBookVersions.bookVersionId, bookOne)).get()!
    seedPrivateReview(db, ownerId, workOne.id, 400)
    db.delete(schema.libraryBookVersions).where(eq(schema.libraryBookVersions.libraryBookId, workOne.id)).run()

    const workTwo = db.select({ id: schema.libraryBooks.id }).from(schema.libraryBooks)
      .innerJoin(schema.libraryBookVersions, eq(schema.libraryBookVersions.libraryBookId, schema.libraryBooks.id))
      .where(eq(schema.libraryBookVersions.bookVersionId, bookTwo)).get()!
    seedPrivateReview(db, ownerId, workTwo.id, 410)
    db.update(schema.libraryBooks)
      .set({ deletedAt: 1, meta: { pendingUserDataDeletion: 1 } })
      .where(eq(schema.libraryBooks.id, workTwo.id))
      .run()

    const result = await exportNotes(ownerId)
    expect(result.reviews).toHaveLength(1)
    expect(result.reviews[0].createdAt).toBe(400)
  })

  it('keeps unanchored ideas when pending deletions exist', async () => {
    seedIdea(db, ownerId, bookOne, 120)
    db.insert(schema.ideas).values({
      id: createId('idea'), userId: ownerId, bookVersionId: null, cfiRange: null,
      text: 'loose idea', note: null, createdAt: 130, updatedAt: 130, deletedAt: null,
    }).run()
    db.update(schema.libraryBooks)
      .set({ deletedAt: 1, meta: { pendingUserDataDeletion: 1 } })
      .where(eq(schema.libraryBooks.id,
        db.select({ id: schema.libraryBooks.id }).from(schema.libraryBooks)
          .innerJoin(schema.libraryBookVersions, eq(schema.libraryBookVersions.libraryBookId, schema.libraryBooks.id))
          .where(eq(schema.libraryBookVersions.bookVersionId, bookOne)).get()!.id))
      .run()

    const result = await exportNotes(ownerId)
    const unanchored = result.books.find((book) => book.bookId === null)
    expect(unanchored?.ideas.map((row) => row.text)).toEqual(['loose idea'])
  })

  it('excludes reviews attributed to pending-deletion versions from the full export', async () => {
    const workOne = db.select({ id: schema.libraryBooks.id }).from(schema.libraryBooks)
      .innerJoin(schema.libraryBookVersions, eq(schema.libraryBookVersions.libraryBookId, schema.libraryBooks.id))
      .where(eq(schema.libraryBookVersions.bookVersionId, bookOne)).get()!
    seedPrivateReview(db, ownerId, workOne.id, 400)
    db.update(schema.libraryBooks)
      .set({ deletedAt: 1, meta: { pendingUserDataDeletion: 1 } })
      .where(eq(schema.libraryBooks.id, workOne.id))
      .run()

    const result = await exportNotes(ownerId)
    expect(result.reviews).toHaveLength(0)
  })

  it('excludes notes on versions pending data deletion', async () => {
    seedHighlight(db, ownerId, bookOne, 100)
    db.update(schema.libraryBooks)
      .set({ deletedAt: 1, meta: { pendingUserDataDeletion: 1 } })
      .where(eq(schema.libraryBooks.id,
        db.select({ id: schema.libraryBooks.id }).from(schema.libraryBooks)
          .innerJoin(schema.libraryBookVersions, eq(schema.libraryBookVersions.libraryBookId, schema.libraryBooks.id))
          .where(eq(schema.libraryBookVersions.bookVersionId, bookOne)).get()!.id))
      .run()

    const all = await exportNotes(ownerId)
    expect(all.books).toHaveLength(0)
    const single = await exportNotes(ownerId, bookOne)
    expect(single.books).toHaveLength(0)
  })
})

describe('archive scoped deletion', () => {
  let db: TestDb
  const ownerId = 'user-del-owner'
  const sharedLibraryId = 'lib-shared-del'
  const sharedWorkId = 'work-shared-del'
  const sharedListingId = 'listing-shared-del'
  const bookId = 'book-del-1'

  beforeEach(async () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
    await client.runDatabaseMigrations(db)
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    db.insert(schema.users).values({ id: ownerId, username: 'owner', createdAt: 1 }).run()
    seedVersion(db, ownerId, bookId, 'Book One', 'Author A')
    db.insert(schema.libraries).values({ id: sharedLibraryId, userId: ownerId, type: 'shared', name: 'Shared', visibility: 'shared', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBooks).values({ id: sharedWorkId, libraryId: sharedLibraryId, userId: ownerId, title: 'Shared Book', author: 'Author A', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBookVersions).values({ id: sharedListingId, libraryId: sharedLibraryId, libraryBookId: sharedWorkId, bookVersionId: bookId, kind: 'shared', createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.bookStates).values({
      userId: ownerId, bookVersionId: bookId, cfi: 'epubcfi(/6/4!/4/2:0)', percent: 45,
      readFraction: 0.45, readStatus: 'reading', progressData: { intervals: [[0, 0.45]] }, updatedAt: 100,
    }).run()
    db.insert(schema.readingArchives).values({
      userId: ownerId, bookVersionId: bookId, title: 'Book One', author: 'Author A', format: 'epub',
      legacyIntervals: [[0, 0.2]], legacyDaily: [{ date: '2026-10-01', durationSeconds: 120 }],
      createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.readingImportBindings).values({
      id: 'bind-1', userId: ownerId, source: 'weread', accountKey: 'vid:1', bookKey: 'src-1',
      mode: 'mounted', targetBookVersionId: bookId, createdAt: 1, updatedAt: 1,
    }).run()
    db.insert(schema.readingRounds).values({
      id: 'round-1', userId: ownerId, bookVersionId: bookId, ordinal: 1, status: 'reading', startedAt: 10, updatedAt: 10,
    }).run()
    db.insert(schema.readingSessions).values({
      id: 'sess-1', userId: ownerId, bookId, roundId: 'round-1', source: 'auto', date: '2026-10-02',
      durationSeconds: 300, createdAt: 10,
    }).run()
    db.insert(schema.readingRecords).values({
      id: 'rec-1', userId: ownerId, bookId, date: '2026-10-02', durationSeconds: 300, createdAt: 10, updatedAt: 10,
    }).run()
    db.insert(schema.readingDurationFacts).values({
      id: 'fact-1', userId: ownerId, bookVersionId: bookId, granularity: 'book_day', date: '2026-10-03',
      durationSeconds: 180, aggregationRole: 'additive', source: 'weread', sourceNamespace: 'vid:1',
      sourceRecordKey: 'k1', observedAt: 1,
    }).run()
    seedHighlight(db, ownerId, bookId, 100)
    seedBookmark(db, ownerId, bookId, 110)
    db.insert(schema.ideas).values({
      id: 'idea-shared', userId: ownerId, bookVersionId: bookId, cfiRange: 'cfi-idea', text: 'q', note: 'shared note',
      visibility: 'shared', sharedLibraryId, sourceLibraryBookVersionId: sharedListingId,
      createdAt: 120, updatedAt: 120, deletedAt: null,
    }).run()
    db.insert(schema.bookReviews).values({
      id: 'rev-shared', userId: ownerId, sourceLibraryId: sharedLibraryId, sourceLibraryBookId: sharedWorkId,
      readBookVersionId: bookId, ratingHalves: 9, title: 'Great', body: 'Shared review',
      visibility: 'shared', createdAt: 130, updatedAt: 130,
    }).run()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('clears only reading time when scope is time and keeps notes, reviews, and reading position', async () => {
    const res = await deleteBookArchive(ownerId, bookId, 'time')
    expect(res).toEqual({ ok: true, remaining: true })
    expect(db.select().from(schema.readingSessions).all()).toHaveLength(0)
    expect(db.select().from(schema.readingRecords).all()).toHaveLength(0)
    expect(db.select().from(schema.readingRounds).all()).toHaveLength(0)
    expect(db.select().from(schema.readingDurationFacts).all()).toHaveLength(0)
    expect(db.select().from(schema.readingArchives).all()).toHaveLength(1)
    expect(db.select().from(schema.readingImportBindings).all()).toHaveLength(1)
    expect(db.select().from(schema.highlights).all()).toHaveLength(1)
    expect(db.select().from(schema.bookmarks).all()).toHaveLength(1)
    expect(db.select().from(schema.ideas).all()).toHaveLength(1)
    expect(db.select().from(schema.bookReviews).all()).toHaveLength(1)
    expect(db.select().from(schema.bookStates).get()).toMatchObject({
      cfi: 'epubcfi(/6/4!/4/2:0)',
      readStatus: 'reading',
      readFraction: 0,
      progressData: { intervals: [] },
    })
  })

  it('clears notes and shared/private reviews when scope is notes while keeping reading time', async () => {
    const res = await deleteBookArchive(ownerId, bookId, 'notes')
    expect(res).toEqual({ ok: true, remaining: true })
    expect(db.select().from(schema.highlights).all()).toHaveLength(0)
    expect(db.select().from(schema.bookmarks).all()).toHaveLength(0)
    expect(db.select().from(schema.ideas).all()).toHaveLength(0)
    expect(db.select().from(schema.bookReviews).all()).toHaveLength(0)
    expect(db.select().from(schema.activityEvents).all().map((row) => row.eventType)).toEqual(['idea.deleted', 'review.deleted'])
    expect(db.select().from(schema.readingSessions).all()).toHaveLength(1)
    expect(db.select().from(schema.readingArchives).all()).toHaveLength(1)
    expect(db.select().from(schema.readingImportBindings).all()).toHaveLength(1)
    expect(db.select().from(schema.bookStates).get()).toMatchObject({
      cfi: 'epubcfi(/6/4!/4/2:0)',
      readStatus: 'reading',
      readFraction: 0.45,
    })

    const thenTime = await deleteBookArchive(ownerId, bookId, 'time')
    expect(thenTime).toEqual({ ok: true, remaining: false })
    expect(db.select().from(schema.readingArchives).all()).toHaveLength(0)
    expect(db.select().from(schema.readingImportBindings).all()).toHaveLength(0)
  })

  it('removes archive snapshot and bindings when notes are deleted on a notes-only book', async () => {
    db.delete(schema.readingSessions).run()
    db.delete(schema.readingRecords).run()
    db.delete(schema.readingRounds).run()
    db.delete(schema.readingDurationFacts).run()
    db.update(schema.readingArchives).set({ legacyIntervals: [], legacyDaily: [] }).run()

    const res = await deleteBookArchive(ownerId, bookId, 'notes')
    expect(res).toEqual({ ok: true, remaining: false })
    expect(db.select().from(schema.readingArchives).all()).toHaveLength(0)
    expect(db.select().from(schema.readingImportBindings).all()).toHaveLength(0)
  })

  it('deletes both time and notes when scope is all while preserving reader position and readStatus', async () => {
    const res = await deleteBookArchive(ownerId, bookId, 'all')
    expect(res).toEqual({ ok: true, remaining: false })
    expect(db.select().from(schema.readingSessions).all()).toHaveLength(0)
    expect(db.select().from(schema.readingRecords).all()).toHaveLength(0)
    expect(db.select().from(schema.readingRounds).all()).toHaveLength(0)
    expect(db.select().from(schema.readingDurationFacts).all()).toHaveLength(0)
    expect(db.select().from(schema.highlights).all()).toHaveLength(0)
    expect(db.select().from(schema.bookmarks).all()).toHaveLength(0)
    expect(db.select().from(schema.ideas).all()).toHaveLength(0)
    expect(db.select().from(schema.bookReviews).all()).toHaveLength(0)
    expect(db.select().from(schema.readingArchives).all()).toHaveLength(0)
    expect(db.select().from(schema.readingImportBindings).all()).toHaveLength(0)
    expect(db.select().from(schema.bookStates).get()).toMatchObject({
      cfi: 'epubcfi(/6/4!/4/2:0)',
      readStatus: 'reading',
      readFraction: 0,
      progressData: { intervals: [] },
    })
  })

  it('validates scope query parameter on DELETE /books/:bookVersionId route', async () => {
    const { Hono } = await import('hono')
    const { errorHandler } = await import('../../middleware/error')
    const app = new Hono()
    app.onError(errorHandler)
    app.use('*', async (c, next) => {
      c.set('user', { id: ownerId } as never)
      return next()
    })
    app.route('/', archiveRoutes)

    const invalid = await app.request(`/books/${bookId}?scope=bad`, { method: 'DELETE' })
    expect(invalid.status).toBe(400)

    const valid = await app.request(`/books/${bookId}?scope=time`, { method: 'DELETE' })
    expect(valid.status).toBe(200)
    expect(await valid.json()).toEqual({ data: { ok: true, remaining: true } })
  })

  it('isolates archive deletion per user and returns BOOK_NOT_FOUND when archive is missing', async () => {
    const otherId = 'user-del-other'
    db.insert(schema.users).values({ id: otherId, username: 'other', createdAt: 1 }).run()
    db.insert(schema.readingArchives).values({
      userId: otherId, bookVersionId: bookId, title: 'Other Book', author: '', createdAt: 1, updatedAt: 1,
    }).run()
    seedHighlight(db, otherId, bookId, 200)

    await expect(deleteBookArchive(ownerId, 'non-existent-book', 'all')).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })

    const res = await deleteBookArchive(ownerId, bookId, 'all')
    expect(res).toEqual({ ok: true, remaining: false })
    expect(db.select().from(schema.readingArchives).all()).toHaveLength(1)
    expect(db.select().from(schema.readingArchives).all()[0]?.userId).toBe(otherId)
    expect(db.select().from(schema.highlights).all()).toHaveLength(1)
    expect(db.select().from(schema.highlights).all()[0]?.userId).toBe(otherId)
  })

  it('removes time-only archive snapshots, bindings, and unreferenced covers on scope=time, and targets only deleted content blobs on scope=notes', async () => {
    const files = new Map<string, Buffer>([
      ['covers/archive.cover.jpg', Buffer.from('cover')],
      ['covers/archive.thumb.webp', Buffer.from('thumb')],
      ['content/deleted-idea.png', Buffer.from('img')],
      ['content/other-user.png', Buffer.from('other')],
    ])
    vi.spyOn(storage, 'getStorage').mockReturnValue({
      exists: async (key: string) => files.has(key),
      delete: async (key: string) => { files.delete(key) },
    } as unknown as StorageDriver)

    db.insert(schema.blobs).values([
      { key: 'covers/archive.cover.jpg', kind: 'cover', size: 5, createdAt: 1 },
      { key: 'content/deleted-idea.png', kind: 'content', size: 3, createdAt: 1 },
      { key: 'content/other-user.png', kind: 'content', size: 5, createdAt: 1 },
    ]).run()
    db.insert(schema.contentFiles).values({
      id: 'cf-1', userId: ownerId, domain: 'idea', kind: 'image', draftId: 'd-1',
      bookVersionId: bookId, ideaId: 'idea-shared', blobKey: 'content/deleted-idea.png',
      name: 'a.png', mimeType: 'image/png', size: 3, sortOrder: 0, ready: true, createdAt: 1,
    }).run()
    db.update(schema.readingArchives).set({ coverKey: 'covers/archive.cover.jpg' })
      .where(and(eq(schema.readingArchives.userId, ownerId), eq(schema.readingArchives.bookVersionId, bookId))).run()

    // Deleting notes cascades contentFiles and removes only the deleted idea's content blob.
    const notesRes = await deleteBookArchive(ownerId, bookId, 'notes')
    expect(notesRes).toEqual({ ok: true, remaining: true })
    expect(db.select().from(schema.contentFiles).all()).toHaveLength(0)
    expect(files.has('content/deleted-idea.png')).toBe(false)
    expect(files.has('content/other-user.png')).toBe(true)

    // Deleting time on the now notes-free archive removes the archive, binding, and unreferenced cover + thumbnail.
    const timeRes = await deleteBookArchive(ownerId, bookId, 'time')
    expect(timeRes).toEqual({ ok: true, remaining: false })
    expect(db.select().from(schema.readingArchives).all()).toHaveLength(0)
    expect(db.select().from(schema.readingImportBindings).all()).toHaveLength(0)
    expect(files.has('covers/archive.cover.jpg')).toBe(false)
    expect(files.has('covers/archive.thumb.webp')).toBe(false)
  })
})
