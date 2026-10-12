import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { and, eq } from 'drizzle-orm'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { getBookDetail, getOverview, listBooks } from './archive.service'

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

  it('counts live rows per record type with real data', async () => {
    seedHighlight(db, ownerId, bookOne, 100)
    seedHighlight(db, ownerId, bookOne, 200, true)
    seedBookmark(db, ownerId, bookOne, 150)
    seedIdea(db, ownerId, bookTwo, 120)
    seedHighlight(db, otherId, bookOne, 300)

    const overview = await getOverview(ownerId)
    expect(overview.counts).toEqual({ highlights: 1, bookmarks: 1, ideas: 1, reviews: 0 })
    expect(overview.recent.map((b) => b.bookVersionId)).toEqual([bookOne, bookTwo])
    expect(overview.recent[0]).toMatchObject({
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
    const one = overview.recent.find((b) => b.bookVersionId === bookOne)!
    const two = overview.recent.find((b) => b.bookVersionId === bookTwo)!
    expect(one.reviews).toBe(1)
    expect(two.reviews).toBe(1)
    expect(overview.recent[0].bookVersionId).toBe(bookTwo)

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

    const byRecords = await listBooks(ownerId, { sort: 'records', page: 1, pageSize: 20 })
    expect(byRecords.entries[0].bookVersionId).toBe(bookTwo)

    const secondPage = await listBooks(ownerId, { sort: 'records', page: 2, pageSize: 1 })
    expect(secondPage.entries.map((b) => b.bookVersionId)).toEqual([bookOne])
    expect(secondPage.hasMore).toBe(false)
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
    expect(overview.recent[0]).toMatchObject({ bookVersionId: 'v-gone', title: 'Unavailable book' })
    const detail = await getBookDetail(ownerId, 'v-gone')
    expect(detail.annotations).toEqual([])
    expect(detail.reviews).toHaveLength(1)
  })
})
