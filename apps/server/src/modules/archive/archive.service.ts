import { and, desc, eq, gte, inArray, isNull, lt, lte, notInArray, or, sql } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

import {
  parseArchiveRecordTypes,
  parseArchiveReadStatuses,
  reviewHalvesToRating,
  type AnnotationRes,
  type ArchiveBookDetail,
  type ArchiveBookItem,
  type ArchiveBooksQuery,
  type ArchiveCounts,
  type ArchiveDataExport,
  type ArchiveDeleteRes,
  type ArchiveOverview,
  type NotesExport,
  type NotesExportBook,
  type NotesExportHighlight,
  type NotesExportIdea,
  type ReadStatus,
  type ReadingImportScope,
  type ReadingRange,
} from '@bookdock/shared'

import { blobKeyReferenced, deleteBlobRowIfUnreferenced } from '../../db/blob-refs'
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
  libraryBookTags,
  libraryBookVersions,
  libraryTags,
  readingArchives,
  readingImportBindings,
  readingRecords,
  readingSessions,
} from '../../db/schema'
import { cleanContentBlobKeys } from '../../lib/content-file-lifecycle'
import { deleteOwnedIdeasInTx, deleteOwnedReviewsInTx } from '../../lib/personal-book-archive'
import { AppError } from '../../middleware/error'
import { readingTimestampBounds } from '../../lib/reading-range'
import { aggregateDurationFacts, countReadingDays, getDurationFacts } from '../reading-records/duration-facts'
import { clearReadingLedgerInTx, hasReadingTimeInTx, rebuildReadingProjection } from '../reading-records/reading-ledger.service'
import { coverThumbnailKey } from '../../lib/cover'
import { getStorage } from '../../storage'
import { toRes } from '../annotations/annotations.service'
import { ideaRevision } from '../annotations/idea-access'
import { assertReadableBook, bufferFromStream, getBook, getBookCoverContent } from '../books/books.service'
import { pendingBookDataDeletionVersionIds } from '../libraries/library-query'
import { assertSourceWorkReadable, projectReview, sourceWorkOf } from '../reviews/review-access'

type ReviewRow = typeof bookReviews.$inferSelect

export async function getArchiveCover(userId: string, bookVersionId: string) {
  const db = getDb()
  if (pendingBookDataDeletionVersionIds(db, userId).includes(bookVersionId)) throw new AppError('BOOK_NOT_FOUND')
  const archive = db.select().from(readingArchives).where(and(eq(readingArchives.userId, userId), eq(readingArchives.bookVersionId, bookVersionId))).get()
  if (!archive) throw new AppError('BOOK_NOT_FOUND')
  let readable = false
  try {
    await getBook(userId, bookVersionId)
    readable = true
  } catch (error) {
    if (!(error instanceof AppError) || !['BOOK_NOT_FOUND', 'BOOK_FILE_MISSING', 'FORBIDDEN'].includes(error.code)) throw error
  }
  if (readable) {
    const current = await getBookCoverContent(userId, bookVersionId)
    if (!current) throw new AppError('BOOK_NOT_FOUND')
    return current
  }
  if (!archive.coverKey) throw new AppError('BOOK_NOT_FOUND')
  const storage = getStorage()
  const thumbnail = coverThumbnailKey(archive.coverKey)
  const key = await storage.exists(thumbnail) ? thumbnail : archive.coverKey
  if (!await storage.exists(key)) throw new AppError('BOOK_NOT_FOUND')
  const ext = key.split('.').at(-1)?.toLowerCase()
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg'
  return { data: await bufferFromStream(await storage.get(key)), contentType }
}

async function countOwned(userId: string, range: ReadingRange): Promise<ArchiveCounts> {
  const db = getDb()
  const excluded = pendingBookDataDeletionVersionIds(db, userId)
  const visibleVersion = excluded.length ? sql`(book_version_id IS NULL OR book_version_id NOT IN (${sql.join(excluded.map((id) => sql`${id}`), sql`, `)}))` : sql`1 = 1`
  const bounds = readingTimestampBounds(range)
  const inRange = (column: typeof highlights.createdAt | typeof bookmarks.createdAt | typeof ideas.createdAt | typeof bookReviews.createdAt) => [
    bounds.from !== undefined ? gte(column, bounds.from) : undefined,
    bounds.until !== undefined ? lt(column, bounds.until) : undefined,
  ]
  const own = (table: typeof highlights | typeof bookmarks | typeof ideas) =>
    db.select({ n: sql<number>`count(*)` }).from(table)
      .where(and(eq(table.userId, userId), isNull(table.deletedAt), visibleVersion, ...inRange(table.createdAt))).get()!.n
  const h = own(highlights)
  const b = own(bookmarks)
  const i = own(ideas)
  let r = db.select({ n: sql<number>`count(*)` }).from(bookReviews)
    .where(and(eq(bookReviews.userId, userId), ...inRange(bookReviews.createdAt))).get()!.n
  if (excluded.length > 0) {
    const reviewRows = db.select().from(bookReviews)
      .where(and(eq(bookReviews.userId, userId), ...inRange(bookReviews.createdAt))).all()
    const versions = reviewVersions(userId, reviewRows)
    const hiddenReviews = new Set<string>()
    const visibleReviews = new Set<string>()
    for (const [versionId, rows] of versions) {
      for (const row of rows) (excluded.includes(versionId) ? hiddenReviews : visibleReviews).add(row.id)
    }
    r = reviewRows.filter((row) => !hiddenReviews.has(row.id) || visibleReviews.has(row.id)).length
  }
  return {
    highlights: h,
    bookmarks: b,
    ideas: i,
    reviews: r,
    total: h + b + i + r,
  }
}

interface VersionTally {
  highlights: number
  bookmarks: number
  ideas: number
  reviews: number
  durationSeconds: number
  referenceDurationSeconds: number
  readingDays: number
  lastRecordAt: number | null
  firstRecordAt: number | null
}

function emptyTally(): VersionTally {
  return { highlights: 0, bookmarks: 0, ideas: 0, reviews: 0, durationSeconds: 0, referenceDurationSeconds: 0, readingDays: 0, lastRecordAt: null, firstRecordAt: null }
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

  const privateBookIds = [...new Set(rows.map((r) => r.privateLibraryBookId).filter((id): id is string => Boolean(id)))]
  const versionsByBookId = new Map<string, string[]>()
  if (privateBookIds.length > 0) {
    const lbvRows = db.select({
      libraryBookId: libraryBookVersions.libraryBookId,
      bookVersionId: libraryBookVersions.bookVersionId,
    }).from(libraryBookVersions)
      .where(inArray(libraryBookVersions.libraryBookId, privateBookIds)).all()
    for (const r of lbvRows) {
      const list = versionsByBookId.get(r.libraryBookId) ?? []
      list.push(r.bookVersionId)
      versionsByBookId.set(r.libraryBookId, list)
    }
  }

  let userHoldings: { link: typeof libraryBookVersions.$inferSelect }[] | null = null

  for (const row of rows) {
    if (row.readBookVersionId) add(row.readBookVersionId, row)
    if (row.privateLibraryBookId) {
      const versions = versionsByBookId.get(row.privateLibraryBookId) ?? []
      for (const versionId of versions) {
        add(versionId, row)
      }
    }
    if (row.sourceLibraryId && row.sourceLibraryBookId && ![...byVersion.values()].some((list) => list.includes(row))) {
      // Stale read provenance (version deleted or re-created): fall back to
      // the reader's live holdings of the same source work.
      if (userHoldings === null) {
        userHoldings = db.select({ link: libraryBookVersions }).from(libraryBookVersions)
          .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
          .where(and(
            eq(libraries.userId, userId),
            eq(libraries.type, 'private'),
            eq(libraryBookVersions.kind, 'shared'),
          )).all()
      }
      for (const { link } of userHoldings) {
        if (link.sourceLibraryId === row.sourceLibraryId) {
          const work = sourceWorkOf(link)
          if (work && work.libraryId === row.sourceLibraryId && work.libraryBookId === row.sourceLibraryBookId) {
            add(link.bookVersionId, row)
          }
        }
      }
    }
  }
  return byVersion
}

function rawTallies(userId: string, type?: ArchiveBooksQuery['type'], range: ReadingRange = {}): Map<string, VersionTally> {
  const db = getDb()
  const tallies = new Map<string, VersionTally>()
  const tally = (versionId: string) => {
    const entry = tallies.get(versionId) ?? emptyTally()
    tallies.set(versionId, entry)
    return entry
  }
  if (!range.from && !range.to) {
    for (const archive of db.select({ id: readingArchives.bookVersionId }).from(readingArchives).where(
      eq(readingArchives.userId, userId),
    ).all()) tally(archive.id)
  }
  const bounds = readingTimestampBounds(range)
  const timestampFilter = sql`${bounds.from !== undefined ? sql`AND created_at >= ${bounds.from}` : sql``} ${bounds.until !== undefined ? sql`AND created_at < ${bounds.until}` : sql``}`
  // Native and imported durations merge per book and date before the 60s
  // threshold: a day that only reaches it across sources counts once, never
  // twice, and never differently between pages (same rule as the
  // reading-records overview).
  const dailyByBook = new Map<string, Map<string, number>>()
  {
    const activity = db.select({
      bookVersionId: readingRecords.bookId,
      date: readingRecords.date,
      durationSeconds: sql<number>`coalesce(sum(${readingRecords.durationSeconds}), 0)`,
    }).from(readingRecords).where(and(
      eq(readingRecords.userId, userId),
      range.from ? gte(readingRecords.date, range.from) : undefined,
      range.to ? lte(readingRecords.date, range.to) : undefined,
      sql`${readingRecords.durationSeconds} > 0`,
    ))
      .groupBy(readingRecords.bookId, readingRecords.date)
      .all()
    for (const row of activity) {
      const entry = tally(row.bookVersionId)
      entry.durationSeconds += row.durationSeconds
      const dates = dailyByBook.get(row.bookVersionId) ?? new Map<string, number>()
      dates.set(row.date, (dates.get(row.date) ?? 0) + row.durationSeconds)
      dailyByBook.set(row.bookVersionId, dates)
    }
  }
  const durationFacts = aggregateDurationFacts(getDurationFacts(userId), range)
  for (const [archiveId, seconds] of durationFacts.archiveAdditive) tally(archiveId).durationSeconds += seconds
  for (const [archiveId, seconds] of durationFacts.archiveReference) tally(archiveId).referenceDurationSeconds += seconds
  const dayBooks = new Set([...dailyByBook.keys(), ...durationFacts.archiveDaily.keys()])
  for (const bookId of dayBooks) {
    tally(bookId).readingDays = countReadingDays(dailyByBook.get(bookId), durationFacts.archiveDaily.get(bookId))
  }
  const selectedTypes = parseArchiveRecordTypes(type)
  const annotationKinds = selectedTypes.filter((t) => t !== 'review')
  const typeFilterSql = selectedTypes.length === 0
    ? sql`1 = 1`
    : annotationKinds.length === 0
      ? sql`1 = 0`
      : sql`kind IN (${sql.join(annotationKinds.map((k) => sql`${k}`), sql`, `)})`

  const groupedRows = db.all<{
    bookVersionId: string
    highlights: number
    bookmarks: number
    ideas: number
    lastRecordAt: number | null
    firstRecordAt: number | null
  }>(sql`
    SELECT
      book_version_id AS bookVersionId,
      count(CASE WHEN kind = 'highlight' THEN 1 END) AS highlights,
      count(CASE WHEN kind = 'bookmark' THEN 1 END) AS bookmarks,
      count(CASE WHEN kind = 'idea' THEN 1 END) AS ideas,
      max(CASE WHEN ${typeFilterSql} THEN created_at END) AS lastRecordAt,
      min(CASE WHEN ${typeFilterSql} THEN created_at END) AS firstRecordAt
    FROM (
      SELECT book_version_id, 'highlight' AS kind, created_at FROM ${highlights}
        WHERE user_id = ${userId} AND deleted_at IS NULL AND book_version_id IS NOT NULL ${timestampFilter}
      UNION ALL
      SELECT book_version_id, 'bookmark' AS kind, created_at FROM ${bookmarks}
        WHERE user_id = ${userId} AND deleted_at IS NULL AND book_version_id IS NOT NULL ${timestampFilter}
      UNION ALL
      SELECT book_version_id, 'idea' AS kind, created_at FROM ${ideas}
        WHERE user_id = ${userId} AND deleted_at IS NULL AND book_version_id IS NOT NULL ${timestampFilter}
    )
    GROUP BY book_version_id
  `)
  for (const row of groupedRows) {
    const entry = tally(row.bookVersionId)
    entry.highlights = row.highlights
    entry.bookmarks = row.bookmarks
    entry.ideas = row.ideas
    if (row.lastRecordAt !== null) touch(entry, row.lastRecordAt)
    if (row.firstRecordAt !== null) touchFirst(entry, row.firstRecordAt)
  }
  const reviewRows = db.select().from(bookReviews).where(and(
    eq(bookReviews.userId, userId),
    bounds.from !== undefined ? gte(bookReviews.createdAt, bounds.from) : undefined,
    bounds.until !== undefined ? lt(bookReviews.createdAt, bounds.until) : undefined,
  )).all()
  const attributed = reviewVersions(userId, reviewRows)
  for (const [versionId, list] of attributed) {
    const entry = tally(versionId)
    entry.reviews += list.length
    for (const row of list) {
      if (selectedTypes.length === 0 || selectedTypes.includes('review')) {
        touch(entry, row.createdAt)
        touchFirst(entry, row.createdAt)
      }
    }
  }
  for (const id of pendingBookDataDeletionVersionIds(db, userId)) tallies.delete(id)
  return tallies
}

async function enrichBooks(userId: string, tallies: Map<string, VersionTally>): Promise<ArchiveBookItem[]> {
  const versionIds = [...tallies.keys()]
  if (versionIds.length === 0) return []
  const db = getDb()
  const snapshots = new Map(db.select().from(readingArchives).where(eq(readingArchives.userId, userId)).all()
    .map((archive) => [archive.bookVersionId, archive]))

  const formats = new Map(
    db.select({ id: bookVersions.id, format: bookVersions.format })
      .from(bookVersions)
      .where(inArray(bookVersions.id, versionIds))
      .all()
      .map((row) => [row.id, row.format] as const),
  )

  const privateCards = new Map(
    db.select({
      bookVersionId: libraryBookVersions.bookVersionId,
      title: sql<string>`coalesce(${libraryBookVersions.title}, ${libraryBooks.title})`,
      author: sql<string>`coalesce(${libraryBookVersions.author}, ${libraryBooks.author})`,
      coverKey: sql<string | null>`coalesce(${libraryBookVersions.coverKey}, ${libraryBooks.coverKey})`,
    }).from(libraryBookVersions)
      .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
      .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
      .where(and(
        inArray(libraryBookVersions.bookVersionId, versionIds),
        eq(libraries.userId, userId),
        eq(libraries.type, 'private'),
      )).all()
      .map((row) => [row.bookVersionId, row] as const),
  )

  const states = new Map(
    db.select({
      bookVersionId: bookStates.bookVersionId,
      readStatus: bookStates.readStatus,
      progress: bookStates.percent,
    }).from(bookStates)
      .where(and(eq(bookStates.userId, userId), inArray(bookStates.bookVersionId, versionIds)))
      .all()
      .map((row) => [row.bookVersionId, row] as const),
  )

  return Promise.all(
    versionIds.map(async (versionId) => {
      const tally = tallies.get(versionId)!
      const snapshot = snapshots.get(versionId)
      // Imported archives (导入阅读历史) have no bookdock work behind the id:
      // the archive row itself carries title/author and the remote cover.
      if (snapshot?.importSource) {
        // Imported archives carry their own source facts: `format` is the
        // source's ebook format (normalised on import) and `finished` lives in
        // `meta`, since these rows have no book_states row to hold a status.
        const finished = snapshot.meta?.finished
        return {
          bookVersionId: versionId, title: snapshot.title, author: snapshot.author || null,
          coverKey: null, coverUrl: snapshot.coverUrl, format: snapshot.format,
          readStatus: finished === true ? 'finished' : null,
          imported: true, importSource: snapshot.importSource,
          highlights: tally.highlights, bookmarks: tally.bookmarks, ideas: tally.ideas, reviews: tally.reviews,
          total: tally.highlights + tally.bookmarks + tally.ideas + tally.reviews,
          durationSeconds: tally.durationSeconds,
          referenceDurationSeconds: tally.referenceDurationSeconds,
          readingDays: tally.readingDays > 0 ? tally.readingDays : null,
          progress: null,
          lastRecordAt: tally.lastRecordAt, firstRecordAt: tally.firstRecordAt,
        }
      }
      const format = formats.get(versionId) ?? snapshot?.format ?? null
      const privateCard = privateCards.get(versionId)
      let title: string | null = privateCard?.title ?? null
      let author: string | null = privateCard?.author ?? null
      let coverKey: string | null = privateCard?.coverKey ?? snapshot?.coverKey ?? null

      if (!privateCard) {
        try {
          const book = await getBook(userId, versionId)
          title = book.title
          author = book.author
          coverKey = book.coverKey
        } catch (error) {
          if (!(error instanceof AppError) || !['BOOK_NOT_FOUND', 'BOOK_FILE_MISSING', 'FORBIDDEN'].includes(error.code)) throw error
          title = snapshot?.title ?? 'Unavailable book'
          author = snapshot?.author ?? ''
        }
      }

      const state = states.get(versionId)
      const readStatus: ReadStatus | null = state?.readStatus ?? null
      const progress = state?.progress ?? null
      const total = tally.highlights + tally.bookmarks + tally.ideas + tally.reviews
      return {
        bookVersionId: versionId, title, author, coverKey, format, readStatus,
        highlights: tally.highlights, bookmarks: tally.bookmarks,
        ideas: tally.ideas, reviews: tally.reviews, total,
        durationSeconds: tally.durationSeconds,
        referenceDurationSeconds: tally.referenceDurationSeconds,
        readingDays: tally.readingDays,
        progress,
        lastRecordAt: tally.lastRecordAt, firstRecordAt: tally.firstRecordAt,
      }
    }),
  )
}

async function loadCandidateTitles(userId: string, versionIds: string[]): Promise<Map<string, string | null>> {
  if (versionIds.length === 0) return new Map()
  const db = getDb()
  const titles = new Map<string, string | null>()
  for (const archive of db.select().from(readingArchives).where(and(eq(readingArchives.userId, userId), inArray(readingArchives.bookVersionId, versionIds))).all()) {
    titles.set(archive.bookVersionId, archive.title)
  }

  const privateCards = db.select({
    bookVersionId: libraryBookVersions.bookVersionId,
    title: sql<string>`coalesce(${libraryBookVersions.title}, ${libraryBooks.title})`,
  }).from(libraryBookVersions)
    .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
    .where(and(
      inArray(libraryBookVersions.bookVersionId, versionIds),
      eq(libraries.userId, userId),
      eq(libraries.type, 'private'),
    )).all()

  for (const card of privateCards) {
    titles.set(card.bookVersionId, card.title)
  }

  const missing = versionIds.filter((id) => !titles.has(id))
  if (missing.length > 0) {
    await Promise.all(
      missing.map(async (id) => {
        try {
          const book = await getBook(userId, id)
          titles.set(id, book.title)
        } catch {
          titles.set(id, 'Unavailable book')
        }
      }),
    )
  }

  return titles
}

export async function getOverview(userId: string, range: ReadingRange = {}): Promise<ArchiveOverview> {
  const db = getDb()
  const pending = new Set(pendingBookDataDeletionVersionIds(db, userId))
  const bookIds = new Set([...rawTallies(userId, undefined, range).keys()].filter((id) => !pending.has(id)))
  for (const archive of db.select({ id: readingArchives.bookVersionId }).from(readingArchives).where(
    eq(readingArchives.userId, userId),
  ).all()) if (!pending.has(archive.id)) bookIds.add(archive.id)
  return { counts: await countOwned(userId, range), totalBooks: bookIds.size }
}

export async function listBooks(userId: string, query: ArchiveBooksQuery) {
  const db = getDb()
  const tallies = rawTallies(userId, query.type, query)

  const selectedTypes = parseArchiveRecordTypes(query.type)
  const selectedStatuses = parseArchiveReadStatuses(query.readStatus)

  let tagAllowedVersionIds: Set<string> | null = null
  if (query.tag) {
    const tagged = db
      .select({ bookVersionId: libraryBookVersions.bookVersionId })
      .from(libraryBookVersions)
      .innerJoin(libraryBookTags, eq(libraryBookTags.libraryBookId, libraryBookVersions.libraryBookId))
      .innerJoin(libraryTags, eq(libraryBookTags.tagId, libraryTags.id))
      .where(or(eq(libraryTags.name, query.tag), eq(libraryTags.id, query.tag)))
      .all()
    tagAllowedVersionIds = new Set(tagged.map((r) => r.bookVersionId))
  }

  let statusAllowedVersionIds: Set<string> | null = null
  if (selectedStatuses.length > 0) {
    const matched = db
      .select({ bookVersionId: bookStates.bookVersionId })
      .from(bookStates)
      .where(and(eq(bookStates.userId, userId), inArray(bookStates.readStatus, selectedStatuses)))
      .all()
    statusAllowedVersionIds = new Set(matched.map((r) => r.bookVersionId))
  }

  const candidateEntries = [...tallies.entries()].filter(([versionId, tally]) => {
    if (selectedTypes.length > 0) {
      const hasAny = selectedTypes.some((t) => {
        const field = t === 'review' ? 'reviews' : t === 'idea' ? 'ideas' : t === 'bookmark' ? 'bookmarks' : 'highlights'
        return tally[field] > 0
      })
      if (!hasAny) return false
    }
    if (tagAllowedVersionIds && !tagAllowedVersionIds.has(versionId)) return false
    if (statusAllowedVersionIds && !statusAllowedVersionIds.has(versionId)) return false
    return true
  })

  const search = query.search?.trim().toLowerCase()
  const isTitleSort = query.sort === 'title-asc' || query.sort === 'title-desc'
  const byId = (a: { bookVersionId: string }, b: { bookVersionId: string }) => a.bookVersionId.localeCompare(b.bookVersionId)

  const candidateVersionIds = candidateEntries.map((e) => e[0])
  const candidateTitles = await loadCandidateTitles(userId, candidateVersionIds)
  const byTitle = (a: { bookVersionId: string }, b: { bookVersionId: string }) => {
    const titleA = candidateTitles.get(a.bookVersionId)
    const titleB = candidateTitles.get(b.bookVersionId)
    if (titleA == null && titleB != null) return 1
    if (titleA != null && titleB == null) return -1
    return (titleA ?? '').localeCompare(titleB ?? '', 'zh') || byId(a, b)
  }

  const filtered = candidateEntries.filter(([versionId]) => {
    if (search) {
      const title = candidateTitles?.get(versionId) ?? ''
      if (!title.toLowerCase().includes(search)) return false
    }
    return true
  })

  const countOf = (t: VersionTally) => {
    if (selectedTypes.length === 0) return t.highlights + t.bookmarks + t.ideas + t.reviews
    return selectedTypes.reduce((sum, tType) => {
      const field = tType === 'review' ? 'reviews' : tType === 'idea' ? 'ideas' : tType === 'bookmark' ? 'bookmarks' : 'highlights'
      return sum + t[field]
    }, 0)
  }

  const sorted = [...filtered].sort((a, b) => {
    const totalA = countOf(a[1])
    const totalB = countOf(b[1])
    const idA = { bookVersionId: a[0] }
    const idB = { bookVersionId: b[0] }
    if (query.sort === 'most') return totalB - totalA || byTitle(idA, idB)
    if (query.sort === 'fewest') return totalA - totalB || byTitle(idA, idB)
    if (query.sort === 'reading-time') return ((b[1].durationSeconds + b[1].referenceDurationSeconds) - (a[1].durationSeconds + a[1].referenceDurationSeconds)) || totalB - totalA || byTitle(idA, idB)
    if (query.sort === 'reading-time-asc') return ((a[1].durationSeconds + a[1].referenceDurationSeconds) - (b[1].durationSeconds + b[1].referenceDurationSeconds)) || totalA - totalB || byTitle(idA, idB)
    if (query.sort === 'earliest') return (a[1].firstRecordAt ?? Number.POSITIVE_INFINITY) - (b[1].firstRecordAt ?? Number.POSITIVE_INFINITY) || byTitle(idA, idB)
    if (isTitleSort) {
      const titleA = candidateTitles?.get(a[0]) ?? null
      const titleB = candidateTitles?.get(b[0]) ?? null
      if (titleA == null && titleB == null) return byTitle(idA, idB)
      if (titleA == null) return 1
      if (titleB == null) return -1
      const compared = query.sort === 'title-asc'
        ? titleA.localeCompare(titleB, 'zh')
        : titleB.localeCompare(titleA, 'zh')
      return compared || byTitle(idA, idB)
    }
    return (b[1].lastRecordAt ?? Number.NEGATIVE_INFINITY) - (a[1].lastRecordAt ?? Number.NEGATIVE_INFINITY) || byTitle(idA, idB)
  })

  const pageSlice = sorted.slice((query.page - 1) * query.pageSize, query.page * query.pageSize)
  const pageTallies = new Map(pageSlice)
  const entries = await enrichBooks(userId, pageTallies)
  return { entries, page: query.page, hasMore: sorted.length > query.page * query.pageSize }
}

// Targeted review matching for one specific bookVersionId instead of scanning
// all user reviews: reviews reached through the read provenance, the private
// works holding the version, or the source work of a shared holding.
function reviewRowsForVersion(userId: string, bookVersionId: string, bounds: { from?: number; until?: number } = {}) {
  const db = getDb()
  const userPrivateBookIds = db.select({ id: libraryBooks.id })
    .from(libraryBookVersions)
    .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'), eq(libraryBookVersions.bookVersionId, bookVersionId)))
    .all().map((r) => r.id)

  const userSharedHolding = db.select({ link: libraryBookVersions })
    .from(libraryBookVersions)
    .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'), eq(libraryBookVersions.bookVersionId, bookVersionId), eq(libraryBookVersions.kind, 'shared')))
    .get()
  const sourceWork = userSharedHolding?.link ? sourceWorkOf(userSharedHolding.link) : null

  const conditions = [eq(bookReviews.readBookVersionId, bookVersionId)]
  if (userPrivateBookIds.length > 0) {
    conditions.push(inArray(bookReviews.privateLibraryBookId, userPrivateBookIds))
  }
  if (sourceWork) {
    conditions.push(and(eq(bookReviews.sourceLibraryId, sourceWork.libraryId), eq(bookReviews.sourceLibraryBookId, sourceWork.libraryBookId))!)
  }

  const targetFilter = conditions.length === 1 ? conditions[0] : or(...conditions)!
  return db.select().from(bookReviews).where(and(
    eq(bookReviews.userId, userId), targetFilter,
    bounds.from !== undefined ? gte(bookReviews.createdAt, bounds.from) : undefined,
    bounds.until !== undefined ? lt(bookReviews.createdAt, bounds.until) : undefined,
  )).all()
}

export async function getBookDetail(userId: string, bookVersionId: string, range: ReadingRange = {}): Promise<ArchiveBookDetail> {
  const db = getDb()
  if (pendingBookDataDeletionVersionIds(db, userId).includes(bookVersionId)) throw new AppError('BOOK_NOT_FOUND')
  const bounds = readingTimestampBounds(range)
  let readable = true
  try {
    await assertReadableBook(userId, bookVersionId)
  } catch (error) {
    if (!(error instanceof AppError)) throw error
    readable = false
  }
  const [hl, bm, ideaRows] = await Promise.all([
    db.select().from(highlights)
      .where(and(eq(highlights.userId, userId), eq(highlights.bookVersionId, bookVersionId), isNull(highlights.deletedAt),
        bounds.from !== undefined ? gte(highlights.createdAt, bounds.from) : undefined,
        bounds.until !== undefined ? lt(highlights.createdAt, bounds.until) : undefined))
      .orderBy(desc(highlights.createdAt), desc(highlights.id)).all(),
    db.select().from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.bookVersionId, bookVersionId), isNull(bookmarks.deletedAt),
        bounds.from !== undefined ? gte(bookmarks.createdAt, bounds.from) : undefined,
        bounds.until !== undefined ? lt(bookmarks.createdAt, bounds.until) : undefined))
      .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id)).all(),
    db.select().from(ideas)
      .where(and(eq(ideas.userId, userId), eq(ideas.bookVersionId, bookVersionId), isNull(ideas.deletedAt),
        bounds.from !== undefined ? gte(ideas.createdAt, bounds.from) : undefined,
        bounds.until !== undefined ? lt(ideas.createdAt, bounds.until) : undefined))
      .orderBy(desc(ideas.createdAt), desc(ideas.id)).all(),
  ])
  const currentRevisionId = ideaRevision(userId, bookVersionId)?.id ?? null
  const annotations: AnnotationRes[] = [
    ...hl.map((row) => ({
      ...toRes('highlight', row),
      locationAvailable: readable && row.relocation !== 'unresolved' && (!row.revisionId || row.revisionId === currentRevisionId),
    })),
    ...bm.map((row) => ({
      ...toRes('bookmark', row),
      locationAvailable: readable && (!row.revisionId || row.revisionId === currentRevisionId),
    })),
    ...ideaRows.map((row) => ({
      ...toRes('idea', row),
      locationAvailable: readable && (!row.revisionId || !currentRevisionId || row.revisionId === currentRevisionId),
    })),
  ]

  // Targeted review matching for this specific bookVersionId instead of scanning all user reviews
  const reviewRows = reviewRowsForVersion(userId, bookVersionId, bounds)
  const attributed = reviewVersions(userId, reviewRows).get(bookVersionId) ?? []
  const reviews = await Promise.all(
    [...attributed]
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .map((row) => projectReview(userId, row, false)),
  )
  return { annotations, reviews }
}

/** Structured notes export (结构化笔记导出): the archive notes surface — the
 * caller's live highlights, bookmarks, ideas and own reviews grouped per book
 * — as a standalone user-owned file. Visibility mirrors the archive notes
 * view: pending-data-deletion versions are excluded, lost sources fall back
 * to the archive snapshot title/author. Never includes images/attachments,
 * discussion threads, likes or another user's content. */
export async function exportNotes(userId: string, bookId?: string): Promise<NotesExport> {
  const db = getDb()
  const excludedVersions = pendingBookDataDeletionVersionIds(db, userId)
  if (bookId && excludedVersions.includes(bookId)) {
    return { version: 1, exportedAt: Date.now(), books: [], reviews: [] }
  }
  // NULL version ids (unanchored ideas) must survive the pending filter like
  // they do in the archive notes query.
  const notPending = (column: AnySQLiteColumn) =>
    excludedVersions.length ? or(isNull(column), notInArray(column, excludedVersions)) : undefined

  const [hl, bm, ideaRows] = await Promise.all([
    db.select().from(highlights).where(and(
      eq(highlights.userId, userId), isNull(highlights.deletedAt),
      bookId ? eq(highlights.bookVersionId, bookId) : undefined,
      notPending(highlights.bookVersionId)))
      .orderBy(highlights.createdAt, highlights.id).all(),
    db.select().from(bookmarks).where(and(
      eq(bookmarks.userId, userId), isNull(bookmarks.deletedAt),
      bookId ? eq(bookmarks.bookVersionId, bookId) : undefined,
      notPending(bookmarks.bookVersionId)))
      .orderBy(bookmarks.createdAt, bookmarks.id).all(),
    db.select().from(ideas).where(and(
      eq(ideas.userId, userId), isNull(ideas.deletedAt),
      bookId ? eq(ideas.bookVersionId, bookId) : undefined,
      notPending(ideas.bookVersionId)))
      .orderBy(ideas.createdAt, ideas.id).all(),
  ])

  const versionIds = [...new Set([hl, bm, ideaRows].flat().map((row) => row.bookVersionId).filter((id): id is string => id !== null))]
  // Title/author precedence mirrors note-archive: a readable holding wins,
  // otherwise the reading-archive snapshot taken before the source was lost.
  const heldByVersion = new Map(versionIds.length ? db.select({ bookVersionId: libraryBookVersions.bookVersionId, work: libraryBooks })
    .from(libraryBookVersions)
    .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'), inArray(libraryBookVersions.bookVersionId, versionIds)))
    .all().map((row) => [row.bookVersionId, row.work]) : [])
  const archiveByVersion = new Map(db.select().from(readingArchives)
    .where(eq(readingArchives.userId, userId))
    .all().map((row) => [row.bookVersionId, row]))
  const readableByVersion = new Map<string, boolean>()
  for (const versionId of versionIds) {
    try {
      await assertReadableBook(userId, versionId)
      readableByVersion.set(versionId, true)
    } catch (error) {
      if (!(error instanceof AppError)) throw error
      readableByVersion.set(versionId, false)
    }
  }

  const groups = new Map<string | null, NotesExportBook>()
  const groupFor = (versionId: string | null) => {
    let group = groups.get(versionId)
    if (!group) {
      const held = versionId && readableByVersion.get(versionId) ? heldByVersion.get(versionId) : undefined
      const archive = versionId ? archiveByVersion.get(versionId) : undefined
      group = {
        bookId: versionId,
        title: held?.title ?? archive?.title ?? null,
        author: held?.author ?? archive?.author ?? null,
        highlights: [], bookmarks: [], ideas: [],
      }
      groups.set(versionId, group)
    }
    return group
  }
  for (const row of hl) {
    groupFor(row.bookVersionId).highlights.push({
      id: row.id, cfiRange: row.cfiRange, cfiAnchor: row.cfiAnchor,
      color: row.color, style: row.style as NotesExportHighlight['style'],
      text: row.text, chapter: row.chapter, chapterHref: row.chapterHref,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    })
  }
  for (const row of bm) {
    groupFor(row.bookVersionId).bookmarks.push({
      id: row.id, cfi: row.cfi, title: row.title, contextText: row.contextText,
      chapter: row.chapter, chapterHref: row.chapterHref,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    })
  }
  for (const row of ideaRows) {
    groupFor(row.bookVersionId).ideas.push({
      id: row.id, cfiRange: row.cfiRange, cfiAnchor: row.cfiAnchor,
      color: row.color, style: row.style as NotesExportIdea['style'],
      text: row.text, note: row.note, visibility: row.visibility,
      chapter: row.chapter, chapterHref: row.chapterHref,
      createdAt: row.createdAt, updatedAt: row.updatedAt, editedAt: row.editedAt,
    })
  }
  const books = [...groups.values()].sort((a, b) => {
    if (a.title === null) return b.title === null ? 0 : 1
    if (b.title === null) return -1
    return a.title.localeCompare(b.title) || (a.bookId ?? '').localeCompare(b.bookId ?? '')
  })

  const reviewRows = bookId
    // Single book mirrors the archive detail view: the version's attributed reviews.
    ? (reviewVersions(userId, reviewRowsForVersion(userId, bookId)).get(bookId) ?? [])
    : (() => {
        const rows = db.select().from(bookReviews).where(eq(bookReviews.userId, userId)).all()
        if (!excludedVersions.length) return rows
        // Full export mirrors the archive overview attribution rule: a row is
        // hidden only when every version it is attributed to is pending data
        // deletion. Rows with no version attribution (e.g. their work and
        // versions are gone) are not attributable to a pending cleanup and
        // always stay.
        const pending = new Set(excludedVersions)
        const liveAttribution = new Set<ReviewRow>()
        const pendingAttribution = new Set<ReviewRow>()
        for (const [versionId, list] of reviewVersions(userId, rows)) {
          const target = pending.has(versionId) ? pendingAttribution : liveAttribution
          for (const row of list) target.add(row)
        }
        return rows.filter((row) => liveAttribution.has(row) || !pendingAttribution.has(row))
      })()
  const privateWorkIds = [...new Set(reviewRows.flatMap((row) => row.privateLibraryBookId ? [row.privateLibraryBookId] : []))]
  const privateWorksById = new Map(privateWorkIds.length ? db.select().from(libraryBooks)
    .where(inArray(libraryBooks.id, privateWorkIds)).all().map((row) => [row.id, row]) : [])
  // A lost source must not leak its live title/author: only a source the
  // caller can still read contributes metadata, otherwise the caller's own
  // reading-archive snapshot (if any) is the retained attribution fallback.
  const readableSourceByKey = new Map<string, typeof libraryBooks.$inferSelect | null>()
  const readableSourceWork = async (row: ReviewRow) => {
    if (!row.sourceLibraryId || !row.sourceLibraryBookId) return null
    const key = `${row.sourceLibraryId}:${row.sourceLibraryBookId}`
    if (!readableSourceByKey.has(key)) {
      try {
        const read = await assertSourceWorkReadable(userId, row.sourceLibraryId, row.sourceLibraryBookId)
        readableSourceByKey.set(key, read.work)
      } catch (error) {
        if (!(error instanceof AppError)) throw error
        readableSourceByKey.set(key, null)
      }
    }
    return readableSourceByKey.get(key) ?? null
  }

  const reviews = []
  for (const row of [...reviewRows].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))) {
    let workTitle: string | null = null
    let workAuthor: string | null = null
    if (row.privateLibraryBookId) {
      const work = privateWorksById.get(row.privateLibraryBookId)
      if (work) {
        workTitle = work.title
        workAuthor = work.author
      }
    } else if (row.sourceLibraryId && row.sourceLibraryBookId) {
      const work = await readableSourceWork(row)
      if (work) {
        workTitle = work.title
        workAuthor = work.author
      }
    }
    if (workTitle === null && row.readBookVersionId) {
      const snapshot = archiveByVersion.get(row.readBookVersionId)
      if (snapshot) {
        workTitle = snapshot.title
        workAuthor = snapshot.author
      }
    }
    reviews.push({
      id: row.id,
      rating: row.ratingHalves === null ? null : reviewHalvesToRating(row.ratingHalves),
      title: row.title,
      body: row.body,
      bodyFormat: row.bodyFormat,
      visibility: row.visibility,
      privateLibraryBookId: row.privateLibraryBookId,
      sourceLibraryId: row.sourceLibraryId,
      sourceLibraryBookId: row.sourceLibraryBookId,
      bookVersionId: row.readBookVersionId,
      workTitle,
      workAuthor,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      editedAt: row.editedAt,
    })
  }

  return { version: 1, exportedAt: Date.now(), books, reviews }
}

/** Read-only data export (用户数据导出). Sessions are queried directly instead
 * of through the ledger's detail entry point: that one creates a missing
 * archive as a side effect and computes rounds, coverage projections and
 * progress scales the export drops anyway. A full export flattens every book's
 * sessions, so each row carries its own book attribution. */
export async function exportArchiveData(userId: string, scope: ReadingImportScope, bookId?: string): Promise<ArchiveDataExport> {
  const db = getDb()
  const result: ArchiveDataExport = { version: 1, kind: 'bookdock-data-export', scope, exportedAt: Date.now() }
  if (scope !== 'time') {
    const notes = await exportNotes(userId, bookId)
    result.books = notes.books
    result.reviews = notes.reviews
  }
  if (scope !== 'notes') {
    const archives = db.select().from(readingArchives).where(bookId
      ? and(eq(readingArchives.userId, userId), eq(readingArchives.bookVersionId, bookId))
      : eq(readingArchives.userId, userId)).all()
    const archiveById = new Map(archives.map((archive) => [archive.bookVersionId, archive]))
    const sessionBookIds = bookId
      ? [bookId]
      : db.selectDistinct({ bookId: readingSessions.bookId }).from(readingSessions).where(eq(readingSessions.userId, userId)).all()
        .flatMap((row) => row.bookId ? [row.bookId] : [])
    const bookIds = new Set([...archives.map((archive) => archive.bookVersionId), ...sessionBookIds])
    if (bookId) bookIds.add(bookId)

    const titles = new Map<string, { title: string | null; author: string | null }>()
    for (const archive of archives) titles.set(archive.bookVersionId, { title: archive.title, author: archive.author })
    const ids = [...bookIds]
    if (ids.length > 0) {
      // Books whose duration predates any archive snapshot still need a usable
      // title in the file: fall back to the private library card.
      const cards = db.select({
        bookVersionId: libraryBookVersions.bookVersionId,
        title: sql<string>`coalesce(${libraryBookVersions.title}, ${libraryBooks.title})`,
        author: sql<string>`coalesce(${libraryBookVersions.author}, ${libraryBooks.author})`,
      }).from(libraryBookVersions)
        .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
        .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
        .where(and(
          inArray(libraryBookVersions.bookVersionId, ids),
          eq(libraries.userId, userId),
          eq(libraries.type, 'private'),
        )).all()
      for (const card of cards) {
        if (!titles.has(card.bookVersionId)) titles.set(card.bookVersionId, { title: card.title, author: card.author })
      }
    }

    result.sessions = (ids.length === 0 ? [] : db.select().from(readingSessions).where(and(
      eq(readingSessions.userId, userId),
      inArray(readingSessions.bookId, ids),
    )).all()).map((row) => ({
      bookId: row.bookId,
      title: titles.get(row.bookId)?.title ?? null,
      author: titles.get(row.bookId)?.author ?? null,
      id: row.id,
      roundId: row.roundId,
      source: row.source,
      date: row.date,
      startedAt: row.startedAt,
      endedAt: row.endedAt,
      durationSeconds: row.durationSeconds,
      startFraction: row.startFraction,
      endFraction: row.endFraction,
      startCfi: row.startCfi,
      endCfi: row.endCfi,
      startChapterIndex: row.startChapterIndex,
      endChapterIndex: row.endChapterIndex,
      coverage: row.coverage,
      fragments: row.fragments,
      timezone: row.timezone ?? '',
      revisionId: row.revisionId,
      wordCount: row.wordCount,
    }))

    result.durationFacts = getDurationFacts(userId, bookId).map((fact) => {
      const archive = fact.bookVersionId ? archiveById.get(fact.bookVersionId) : undefined
      return { archiveId: fact.bookVersionId, title: archive?.title ?? null, author: archive?.author ?? null, granularity: fact.granularity,
        date: fact.date, durationSeconds: fact.durationSeconds, aggregationRole: fact.aggregationRole,
        overlapGroup: fact.overlapGroup, source: fact.source }
    })
    if (!bookId) {
      for (const archive of archives) {
        for (const day of archive.legacyDaily) result.durationFacts.push({ archiveId: archive.bookVersionId, title: archive.title, author: archive.author,
          granularity: 'book_day', date: day.date, durationSeconds: day.durationSeconds, aggregationRole: 'additive', overlapGroup: null, source: 'native' })
      }
    } else {
      const archive = archiveById.get(bookId)
      for (const day of archive?.legacyDaily ?? []) result.durationFacts.push({ archiveId: bookId, title: archive?.title ?? null, author: archive?.author ?? null,
        granularity: 'book_day', date: day.date, durationSeconds: day.durationSeconds, aggregationRole: 'additive', overlapGroup: null, source: 'native' })
    }
  }
  return result
}

function hasLiveNotesOrReviewsInTx(
  tx: ReturnType<typeof getDb>,
  userId: string,
  bookVersionId: string,
): boolean {
  if (tx.select({ id: highlights.id }).from(highlights).where(and(
    eq(highlights.userId, userId), eq(highlights.bookVersionId, bookVersionId), isNull(highlights.deletedAt),
  )).get()) return true
  if (tx.select({ id: bookmarks.id }).from(bookmarks).where(and(
    eq(bookmarks.userId, userId), eq(bookmarks.bookVersionId, bookVersionId), isNull(bookmarks.deletedAt),
  )).get()) return true
  if (tx.select({ id: ideas.id }).from(ideas).where(and(
    eq(ideas.userId, userId), eq(ideas.bookVersionId, bookVersionId), isNull(ideas.deletedAt),
  )).get()) return true
  const attributedReviews = reviewVersions(userId, reviewRowsForVersion(userId, bookVersionId)).get(bookVersionId) ?? []
  return attributedReviews.length > 0
}

export async function deleteBookArchive(
  userId: string,
  bookVersionId: string,
  scope: ReadingImportScope,
): Promise<ArchiveDeleteRes> {
  const db = getDb()
  if (pendingBookDataDeletionVersionIds(db, userId).includes(bookVersionId)) throw new AppError('BOOK_NOT_FOUND')

  const archive = db.select().from(readingArchives).where(and(
    eq(readingArchives.userId, userId),
    eq(readingArchives.bookVersionId, bookVersionId),
  )).get()
  const exists = Boolean(archive)
    || hasReadingTimeInTx(db, userId, bookVersionId)
    || hasLiveNotesOrReviewsInTx(db, userId, bookVersionId)
  if (!exists) throw new AppError('BOOK_NOT_FOUND')

  const now = Date.now()
  let deletedCoverKey: string | null = null
  const deletedContentBlobKeys: string[] = []
  let remaining = false

  db.transaction((rawTx) => {
    const tx = rawTx as unknown as ReturnType<typeof getDb>
    if (scope === 'time' || scope === 'all') {
      clearReadingLedgerInTx(tx, userId, bookVersionId)
    }

    if (scope === 'notes' || scope === 'all') {
      deletedContentBlobKeys.push(...deleteOwnedIdeasInTx(rawTx, userId, [bookVersionId], now))
      tx.delete(highlights).where(and(eq(highlights.userId, userId), eq(highlights.bookVersionId, bookVersionId))).run()
      tx.delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.bookVersionId, bookVersionId))).run()

      const attributedReviews = reviewVersions(userId, reviewRowsForVersion(userId, bookVersionId)).get(bookVersionId) ?? []
      deletedContentBlobKeys.push(...deleteOwnedReviewsInTx(rawTx, userId, attributedReviews, now))
    }

    const hasRemainingNotes = hasLiveNotesOrReviewsInTx(tx, userId, bookVersionId)
    const hasRemainingTime = hasReadingTimeInTx(tx, userId, bookVersionId)

    if (hasRemainingNotes || hasRemainingTime) {
      if (scope === 'time' && archive) {
        tx.update(readingArchives).set({
          legacyIntervals: [], legacyDaily: [], legacyWordCount: null, legacyRevisionId: null,
        }).where(and(
          eq(readingArchives.userId, userId),
          eq(readingArchives.bookVersionId, bookVersionId),
        )).run()
        rebuildReadingProjection(tx, userId, bookVersionId)
      }
      remaining = true
    } else {
      if (archive) {
        deletedCoverKey = archive.coverKey
        tx.delete(readingArchives).where(and(
          eq(readingArchives.userId, userId),
          eq(readingArchives.bookVersionId, bookVersionId),
        )).run()
      }
      tx.delete(readingImportBindings).where(and(
        eq(readingImportBindings.userId, userId),
        eq(readingImportBindings.targetBookVersionId, bookVersionId),
      )).run()
      remaining = false
    }
  })

  if (deletedContentBlobKeys.length > 0) await cleanContentBlobKeys(deletedContentBlobKeys)
  if (deletedCoverKey && !blobKeyReferenced(deletedCoverKey)) {
    const storage = getStorage()
    if (await storage.exists(deletedCoverKey)) await storage.delete(deletedCoverKey)
    const thumbKey = coverThumbnailKey(deletedCoverKey)
    if (await storage.exists(thumbKey)) await storage.delete(thumbKey)
    deleteBlobRowIfUnreferenced(deletedCoverKey)
  }

  return { ok: true, remaining }
}
