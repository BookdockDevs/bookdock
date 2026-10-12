import { and, desc, eq, isNull, sql } from 'drizzle-orm'

import type {
  AnnotationRes,
  ArchiveBookDetail,
  ArchiveBookItem,
  ArchiveBooksQuery,
  ArchiveCounts,
  ArchiveOverview,
  BookFormat,
  ReadStatus,
} from '@bookdock/shared'

import { getDb } from '../../db/client'
import {
  bookmarks,
  bookReviews,
  bookStates,
  bookVersions,
  highlights,
  ideas,
  libraries,
  libraryBooks,
  libraryBookVersions,
} from '../../db/schema'
import { AppError } from '../../middleware/error'
import { toRes } from '../annotations/annotations.service'
import { ideaRevision } from '../annotations/idea-access'
import { assertReadableBook, getBook } from '../books/books.service'
import { projectReview, sourceWorkOf } from '../reviews/review-access'

type ReviewRow = typeof bookReviews.$inferSelect

async function countOwned(userId: string): Promise<ArchiveCounts> {
  const db = getDb()
  const own = (table: typeof highlights | typeof bookmarks | typeof ideas) =>
    db.select({ n: sql<number>`count(*)` }).from(table)
      .where(and(eq(table.userId, userId), isNull(table.deletedAt))).get()!.n
  return {
    highlights: own(highlights),
    bookmarks: own(bookmarks),
    ideas: own(ideas),
    reviews: db.select({ n: sql<number>`count(*)` }).from(bookReviews)
      .where(eq(bookReviews.userId, userId)).get()!.n,
  }
}

interface VersionTally {
  highlights: number
  bookmarks: number
  ideas: number
  reviews: number
  lastRecordAt: number | null
  firstRecordAt: number | null
}

function emptyTally(): VersionTally {
  return { highlights: 0, bookmarks: 0, ideas: 0, reviews: 0, lastRecordAt: null, firstRecordAt: null }
}

function touch(tally: VersionTally, at: number) {
  tally.lastRecordAt = tally.lastRecordAt == null ? at : Math.max(tally.lastRecordAt, at)
}

function touchFirst(tally: VersionTally, at: number) {
  tally.firstRecordAt = tally.firstRecordAt == null ? at : Math.min(tally.firstRecordAt, at)
}

/** Version ids the user's review rows belong to, including versions that are
 * gone: a review outlives its version by design, and the dead entry keeps the
 * review reachable (titled 'Unavailable book') instead of vanishing. */
function reviewVersions(userId: string, rows: ReviewRow[]): Map<string, ReviewRow[]> {
  const db = getDb()
  const byVersion = new Map<string, ReviewRow[]>()
  const add = (versionId: string, row: ReviewRow) => {
    const list = byVersion.get(versionId) ?? []
    if (!list.includes(row)) list.push(row)
    byVersion.set(versionId, list)
  }
  for (const row of rows) {
    if (row.readBookVersionId) add(row.readBookVersionId, row)
    if (row.privateLibraryBookId) {
      for (const version of db.select({ bookVersionId: libraryBookVersions.bookVersionId })
        .from(libraryBookVersions)
        .where(eq(libraryBookVersions.libraryBookId, row.privateLibraryBookId)).all()) {
        add(version.bookVersionId, row)
      }
    }
    if (row.sourceLibraryId && row.sourceLibraryBookId && ![...byVersion.values()].some((list) => list.includes(row))) {
      // Stale read provenance (version deleted or re-created): fall back to
      // the reader's live holdings of the same source work.
      const holdings = db.select({ link: libraryBookVersions }).from(libraryBookVersions)
        .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
        .where(and(
          eq(libraries.userId, userId),
          eq(libraries.type, 'private'),
          eq(libraryBookVersions.kind, 'shared'),
          eq(libraryBookVersions.sourceLibraryId, row.sourceLibraryId),
        )).all()
      for (const { link } of holdings) {
        const work = sourceWorkOf(link)
        if (work && work.libraryId === row.sourceLibraryId && work.libraryBookId === row.sourceLibraryBookId) {
          add(link.bookVersionId, row)
        }
      }
    }
  }
  return byVersion
}

async function enrichBook(userId: string, versionId: string, tally: VersionTally, format: BookFormat): Promise<ArchiveBookItem> {
  const db = getDb()
  const privateCard = db.select({
    title: sql<string>`coalesce(${libraryBookVersions.title}, ${libraryBooks.title})`,
    author: sql<string>`coalesce(${libraryBookVersions.author}, ${libraryBooks.author})`,
    coverKey: sql<string | null>`coalesce(${libraryBookVersions.coverKey}, ${libraryBooks.coverKey})`,
  }).from(libraryBookVersions)
    .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
    .where(and(
      eq(libraryBookVersions.bookVersionId, versionId),
      eq(libraries.userId, userId),
      eq(libraries.type, 'private'),
    )).get()
  let title: string | null = privateCard?.title ?? null
  let author: string | null = privateCard?.author ?? null
  let coverKey: string | null = privateCard?.coverKey ?? null
  if (!privateCard) {
    try {
      const book = await getBook(userId, versionId)
      title = book.title
      author = book.author
      coverKey = book.coverKey
    } catch (error) {
      if (!(error instanceof AppError) || !['BOOK_NOT_FOUND', 'BOOK_FILE_MISSING', 'FORBIDDEN'].includes(error.code)) throw error
      title = 'Unavailable book'
    }
  }
  const state = db.select().from(bookStates)
    .where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, versionId))).get()
  const readStatus: ReadStatus = state?.readStatus ?? 'reading'
  const total = tally.highlights + tally.bookmarks + tally.ideas + tally.reviews
  return {
    bookVersionId: versionId, title, author, coverKey, format, readStatus,
    highlights: tally.highlights, bookmarks: tally.bookmarks,
    ideas: tally.ideas, reviews: tally.reviews, total,
    lastRecordAt: tally.lastRecordAt, firstRecordAt: tally.firstRecordAt,
  }
}

async function talliedBooks(userId: string): Promise<ArchiveBookItem[]> {
  const db = getDb()
  const tallies = new Map<string, VersionTally>()
  const tally = (versionId: string) => {
    const entry = tallies.get(versionId) ?? emptyTally()
    tallies.set(versionId, entry)
    return entry
  }
  const rows = db.all<{ bookVersionId: string; kind: 'highlight' | 'bookmark' | 'idea'; updatedAt: number; createdAt: number }>(sql`
    SELECT book_version_id AS bookVersionId, 'highlight' AS kind, updated_at AS updatedAt, created_at AS createdAt FROM ${highlights}
      WHERE user_id = ${userId} AND deleted_at IS NULL AND book_version_id IS NOT NULL
    UNION ALL
    SELECT book_version_id AS bookVersionId, 'bookmark' AS kind, updated_at AS updatedAt, created_at AS createdAt FROM ${bookmarks}
      WHERE user_id = ${userId} AND deleted_at IS NULL AND book_version_id IS NOT NULL
    UNION ALL
    SELECT book_version_id AS bookVersionId, 'idea' AS kind, updated_at AS updatedAt, created_at AS createdAt FROM ${ideas}
      WHERE user_id = ${userId} AND deleted_at IS NULL AND book_version_id IS NOT NULL
  `)
  for (const row of rows) {
    const entry = tally(row.bookVersionId)
    if (row.kind === 'highlight') entry.highlights += 1
    else if (row.kind === 'bookmark') entry.bookmarks += 1
    else entry.ideas += 1
    touch(entry, row.updatedAt)
    touchFirst(entry, row.createdAt)
  }
  const reviewRows = db.select().from(bookReviews).where(eq(bookReviews.userId, userId)).all()
  const attributed = reviewVersions(userId, reviewRows)
  for (const [versionId, list] of attributed) {
    const entry = tally(versionId)
    entry.reviews += list.length
    for (const row of list) {
      touch(entry, row.updatedAt)
      touchFirst(entry, row.createdAt)
    }
  }
  const formats = new Map(
    db.select({ id: bookVersions.id, format: bookVersions.format }).from(bookVersions).all()
      .map((row) => [row.id, row.format] as const),
  )
  // Versions gone from book_versions keep a fallback so covers degrade to the
  // same placeholder the library shows instead of breaking the row.
  return Promise.all([...tallies].map(([versionId, entry]) =>
    enrichBook(userId, versionId, entry, formats.get(versionId) ?? 'txt')))
}

export async function getOverview(userId: string): Promise<ArchiveOverview> {
  const [counts, books] = await Promise.all([countOwned(userId), talliedBooks(userId)])
  const recent = books
    .sort((a, b) => (b.lastRecordAt ?? -1) - (a.lastRecordAt ?? -1) || a.bookVersionId.localeCompare(b.bookVersionId))
    .slice(0, 5)
  return { counts, recent }
}

export async function listBooks(userId: string, query: ArchiveBooksQuery) {
  const books = await talliedBooks(userId)
  const search = query.search?.trim().toLowerCase()
  const filtered = books.filter((book) => {
    if (query.type) {
      const field = query.type === 'review' ? 'reviews' : query.type === 'idea' ? 'ideas' : query.type === 'bookmark' ? 'bookmarks' : 'highlights'
      if (book[field] === 0) return false
    }
    if (search && !(book.title ?? '').toLowerCase().includes(search)) return false
    return true
  })
  const byId = (a: { bookVersionId: string }, b: { bookVersionId: string }) => a.bookVersionId.localeCompare(b.bookVersionId)
  const sorted = [...filtered].sort((a, b) => {
    if (query.sort === 'most') return b.total - a.total || byId(a, b)
    if (query.sort === 'fewest') return a.total - b.total || byId(a, b)
    if (query.sort === 'earliest') return (a.firstRecordAt ?? Number.POSITIVE_INFINITY) - (b.firstRecordAt ?? Number.POSITIVE_INFINITY) || byId(a, b)
    if (query.sort === 'title-asc' || query.sort === 'title-desc') {
      if (a.title == null && b.title == null) return byId(a, b)
      if (a.title == null) return 1
      if (b.title == null) return -1
      const compared = query.sort === 'title-asc'
        ? a.title.localeCompare(b.title, 'zh')
        : b.title.localeCompare(a.title, 'zh')
      return compared || byId(a, b)
    }
    return (b.lastRecordAt ?? -1) - (a.lastRecordAt ?? -1) || byId(a, b)
  })
  const entries = sorted.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
  return { entries, page: query.page, hasMore: sorted.length > query.page * query.pageSize }
}

export async function getBookDetail(userId: string, bookVersionId: string): Promise<ArchiveBookDetail> {
  const db = getDb()
  let readable = true
  try {
    await assertReadableBook(userId, bookVersionId)
  } catch (error) {
    if (!(error instanceof AppError)) throw error
    readable = false
  }
  let annotations: AnnotationRes[] = []
  if (readable) {
    const [hl, bm, ideaRows] = await Promise.all([
      db.select().from(highlights)
        .where(and(eq(highlights.userId, userId), eq(highlights.bookVersionId, bookVersionId), isNull(highlights.deletedAt)))
        .orderBy(desc(highlights.createdAt), desc(highlights.id)).all(),
      db.select().from(bookmarks)
        .where(and(eq(bookmarks.userId, userId), eq(bookmarks.bookVersionId, bookVersionId), isNull(bookmarks.deletedAt)))
        .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id)).all(),
      db.select().from(ideas)
        .where(and(eq(ideas.userId, userId), eq(ideas.bookVersionId, bookVersionId), isNull(ideas.deletedAt)))
        .orderBy(desc(ideas.createdAt), desc(ideas.id)).all(),
    ])
    const currentRevisionId = ideaRevision(userId, bookVersionId)?.id ?? null
    annotations = [
      ...hl.map((row) => ({
        ...toRes('highlight', row),
        locationAvailable: row.relocation !== 'unresolved' && (!row.revisionId || row.revisionId === currentRevisionId),
      })),
      ...bm.map((row) => ({
        ...toRes('bookmark', row),
        locationAvailable: !row.revisionId || row.revisionId === currentRevisionId,
      })),
      ...ideaRows.map((row) => ({
        ...toRes('idea', row),
        locationAvailable: !row.revisionId || !currentRevisionId || row.revisionId === currentRevisionId,
      })),
    ]
  }
  const reviewRows = db.select().from(bookReviews).where(eq(bookReviews.userId, userId)).all()
  const attributed = reviewVersions(userId, reviewRows).get(bookVersionId) ?? []
  const reviews = await Promise.all(
    [...attributed]
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .map((row) => projectReview(userId, row, false)),
  )
  return { annotations, reviews }
}
