import { and, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm'

import {
  parseArchiveRecordTypes,
  parseArchiveReadStatuses,
  type AnnotationRes,
  type ArchiveBookDetail,
  type ArchiveBookItem,
  type ArchiveBooksQuery,
  type ArchiveCounts,
  type ArchiveOverview,
  type ReadStatus,
  type ReadingRange,
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
  libraryBookTags,
  libraryBookVersions,
  libraryTags,
  readingArchives,
  readingRecords,
} from '../../db/schema'
import { AppError } from '../../middleware/error'
import { readingTimestampBounds } from '../../lib/reading-range'
import { toRes } from '../annotations/annotations.service'
import { ideaRevision } from '../annotations/idea-access'
import { assertReadableBook, getBook } from '../books/books.service'
import { projectReview, sourceWorkOf } from '../reviews/review-access'

type ReviewRow = typeof bookReviews.$inferSelect

async function countOwned(userId: string, range: ReadingRange): Promise<ArchiveCounts> {
  const db = getDb()
  const bounds = readingTimestampBounds(range)
  const inRange = (column: typeof highlights.createdAt | typeof bookmarks.createdAt | typeof ideas.createdAt | typeof bookReviews.createdAt) => [
    bounds.from !== undefined ? gte(column, bounds.from) : undefined,
    bounds.until !== undefined ? lt(column, bounds.until) : undefined,
  ]
  const own = (table: typeof highlights | typeof bookmarks | typeof ideas) =>
    db.select({ n: sql<number>`count(*)` }).from(table)
      .where(and(eq(table.userId, userId), isNull(table.deletedAt), ...inRange(table.createdAt))).get()!.n
  const h = own(highlights)
  const b = own(bookmarks)
  const i = own(ideas)
  const r = db.select({ n: sql<number>`count(*)` }).from(bookReviews)
    .where(and(eq(bookReviews.userId, userId), ...inRange(bookReviews.createdAt))).get()!.n
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
  readingDays: number
  lastRecordAt: number | null
  firstRecordAt: number | null
}

function emptyTally(): VersionTally {
  return { highlights: 0, bookmarks: 0, ideas: 0, reviews: 0, durationSeconds: 0, readingDays: 0, lastRecordAt: null, firstRecordAt: null }
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
  const bounds = readingTimestampBounds(range)
  const timestampFilter = sql`${bounds.from !== undefined ? sql`AND created_at >= ${bounds.from}` : sql``} ${bounds.until !== undefined ? sql`AND created_at < ${bounds.until}` : sql``}`
  {
    const activity = db.select({
      bookVersionId: readingRecords.bookId,
      durationSeconds: sql<number>`coalesce(sum(${readingRecords.durationSeconds}), 0)`,
      days: sql<number>`count(distinct CASE WHEN ${readingRecords.durationSeconds} >= 60 THEN ${readingRecords.date} END)`,
    }).from(readingRecords).where(and(
      eq(readingRecords.userId, userId),
      range.from ? gte(readingRecords.date, range.from) : undefined,
      range.to ? lte(readingRecords.date, range.to) : undefined,
      sql`${readingRecords.durationSeconds} > 0`,
    ))
      .groupBy(readingRecords.bookId)
      .all()
    for (const row of activity) {
      const entry = tally(row.bookVersionId)
      entry.durationSeconds = row.durationSeconds
      entry.readingDays = row.days
    }
  }
  if (!range.from && !range.to) {
    for (const archive of db.select().from(readingArchives).where(eq(readingArchives.userId, userId)).all()) tally(archive.bookVersionId)
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
      const format = formats.get(versionId) ?? 'txt'
      const privateCard = privateCards.get(versionId)
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
          title = snapshots.get(versionId)?.title ?? 'Unavailable book'
          author = snapshots.get(versionId)?.author ?? ''
        }
      }

      const state = states.get(versionId)
      const readStatus: ReadStatus = state?.readStatus ?? 'reading'
      const progress = state?.progress ?? 0
      const total = tally.highlights + tally.bookmarks + tally.ideas + tally.reviews
      return {
        bookVersionId: versionId, title, author, coverKey, format, readStatus,
        highlights: tally.highlights, bookmarks: tally.bookmarks,
        ideas: tally.ideas, reviews: tally.reviews, total,
        durationSeconds: tally.durationSeconds,
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
  return { counts: await countOwned(userId, range), totalBooks: rawTallies(userId, undefined, range).size }
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
    if (query.sort === 'reading-time') return (b[1].durationSeconds - a[1].durationSeconds) || totalB - totalA || byTitle(idA, idB)
    if (query.sort === 'reading-time-asc') return (a[1].durationSeconds - b[1].durationSeconds) || totalA - totalB || byTitle(idA, idB)
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

export async function getBookDetail(userId: string, bookVersionId: string, range: ReadingRange = {}): Promise<ArchiveBookDetail> {
  const db = getDb()
  const bounds = readingTimestampBounds(range)
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

  // Targeted review matching for this specific bookVersionId instead of scanning all user reviews
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
  const reviewRows = db.select().from(bookReviews).where(and(
    eq(bookReviews.userId, userId), targetFilter,
    bounds.from !== undefined ? gte(bookReviews.createdAt, bounds.from) : undefined,
    bounds.until !== undefined ? lt(bookReviews.createdAt, bounds.until) : undefined,
  )).all()
  const attributed = reviewVersions(userId, reviewRows).get(bookVersionId) ?? []
  const reviews = await Promise.all(
    [...attributed]
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
      .map((row) => projectReview(userId, row, false)),
  )
  return { annotations, reviews }
}
