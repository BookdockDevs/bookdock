import { and, desc, eq, gte, inArray, isNull, lt, lte, notInArray, sql } from 'drizzle-orm'

import type {
  ReadingRange,
  ReadingRecordBookDetailRes,
  ReadingRecordBookItem,
  ReadingRecordCategoryItem,
  ReadingRecordCreateReq,
  ReadingRecordDailyItem,
  ReadingRecordHourlyItem,
  ReadingRecordMonthlyComparison,
  ReadingRecordSummaryRes,
  ReadingRecordTagItem,
  ReadingSessionItem,
  ReadingSessionUpdateReq,
} from '@bookdock/shared'

import { getDb } from '../../db/client'
import { bookStates, contentRevisions, libraries, libraryBooks, libraryBookTags, libraryBookVersions, libraryCategories, libraryTags, readingArchives, readingBookStats, readingContributions, readingHourlyStats, readingRecords, readingRounds, readingSessions } from '../../db/schema'
import { readProgressFile } from '../../lib/progress-file'
import { getBook } from '../books/books.service'
import { excludedReadingBookVersionIds } from './reading-visibility'
import { readingHoldings } from './reading-holdings'
import { pendingBookDataDeletionVersionIds } from '../libraries/library-query'
import { isProgressMigrationCompleted } from '../progress/progress-migration'
import { AppError } from '../../middleware/error'
import { addLedgerReading, deleteLedgerSession, ensureReadingArchive, ensureReadingProjections, READING_WORD_UNITS_SCALE, updateLedgerSession } from './reading-ledger.service'
import { readingTimestampBounds } from '../../lib/reading-range'

export async function addReadingTime(userId: string, body: ReadingRecordCreateReq, showHidden = false) {
  const session = await addLedgerReading(userId, body, showHidden)
  return getDb().select().from(readingRecords).where(and(
    eq(readingRecords.userId, userId), eq(readingRecords.bookId, body.bookId), eq(readingRecords.date, body.date),
  )).get() ?? session
}
const DAY_MS = 24 * 3600 * 1000

function dayMs(date: string): number {
  // Parse as UTC so streak diffs are immune to DST transitions
  return Date.parse(`${date}T00:00:00Z`)
}

/** datesAsc: distinct recorded days sorted ascending; today: client-local 'YYYY-MM-DD' */
export function computeStreak(datesAsc: string[], today: string): { current: number; longest: number } {
  if (datesAsc.length === 0) return { current: 0, longest: 0 }
  let longest = 1
  let run = 1
  for (let i = 1; i < datesAsc.length; i++) {
    run = (dayMs(datesAsc[i]) - dayMs(datesAsc[i - 1])) / DAY_MS === 1 ? run + 1 : 1
    longest = Math.max(longest, run)
  }
  const gapDays = (dayMs(today) - dayMs(datesAsc[datesAsc.length - 1])) / DAY_MS
  return { current: gapDays <= 1 ? run : 0, longest }
}

function shiftDays(date: string, days: number): string {
  return new Date(dayMs(date) + days * DAY_MS).toISOString().slice(0, 10)
}

/** Monday of the week containing the client-local day */
function weekStart(date: string): string {
  const dow = new Date(dayMs(date)).getUTCDay() // 0 = Sunday
  return shiftDays(date, -((dow + 6) % 7))
}

async function computeTotalWordsRead(userId: string, showHidden = false): Promise<number> {
  const db = getDb()
  const archives = db.select().from(readingArchives).where(eq(readingArchives.userId, userId)).all()
  if (archives.length) {
    await ensureReadingProjections(userId, showHidden)
    const hidden = new Set(excludedReadingBookVersionIds(db, userId, showHidden))
    const rows = db.select({ totalWordUnits: readingBookStats.totalWordUnits }).from(readingBookStats)
      .where(and(eq(readingBookStats.userId, userId), hidden.size ? notInArray(readingBookStats.bookVersionId, [...hidden]) : undefined)).all()
    return Math.round(rows.reduce((sum, row) => sum + (row.totalWordUnits ?? 0), 0) / READING_WORD_UNITS_SCALE)
  }
  const library = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (!library) return 0

  const skips = excludedReadingBookVersionIds(db, userId, showHidden)
  const skipsSet = new Set(skips)

  const versionRows = db.selectDistinct({ versionId: libraryBookVersions.bookVersionId }).from(libraryBookVersions)
    .innerJoin(libraryBooks, eq(libraryBookVersions.libraryBookId, libraryBooks.id))
    .where(and(eq(libraryBookVersions.libraryId, library.id), isNull(libraryBooks.deletedAt)))
    .all()

  const eligibleVersions = versionRows
    .map((r) => r.versionId)
    .filter((id) => !skipsSet.has(id))

  if (eligibleVersions.length === 0) return 0

  // Fallback to legacy files only if migration has not yet run
  if (!isProgressMigrationCompleted(db)) {
    for (const vId of eligibleVersions) {
      const state = db.select({ readFraction: bookStates.readFraction, progressData: bookStates.progressData })
        .from(bookStates).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, vId))).get()
      if (!state || state.progressData === null) {
        await readProgressFile(userId, vId)
      }
    }
  }

  const stateRows = db.select({
    bookVersionId: bookStates.bookVersionId,
    readFraction: bookStates.readFraction,
  }).from(bookStates)
    .where(and(
      eq(bookStates.userId, userId),
      inArray(bookStates.bookVersionId, eligibleVersions),
      sql`${bookStates.readFraction} > 0`,
    )).all()

  if (stateRows.length === 0) return 0

  const readVersionIds = stateRows.map((r) => r.bookVersionId)
  const fractionMap = new Map(stateRows.map((r) => [r.bookVersionId, r.readFraction]))

  const cr = contentRevisions
  const revisionRows = db.all<{ bookVersionId: string; wordCount: number }>(sql`
    SELECT cr.book_version_id AS bookVersionId, cr.word_count AS wordCount
    FROM ${cr} cr
    WHERE cr.book_version_id IN ${readVersionIds}
      AND cr.revision_no = (
        SELECT max(cr2.revision_no)
        FROM ${cr} cr2
        WHERE cr2.book_version_id = cr.book_version_id
      )
      AND cr.word_count > 0
  `)

  let total = 0
  for (const rev of revisionRows) {
    const fraction = fractionMap.get(rev.bookVersionId)
    if (fraction && rev.wordCount) {
      total += fraction * rev.wordCount
    }
  }

  return Math.round(total)
}

export async function getSummary(userId: string, today: string, showHidden = false, range: ReadingRange = {}): Promise<ReadingRecordSummaryRes> {
  const db = getDb()
  const hiddenIds = excludedReadingBookVersionIds(db, userId, showHidden)
  const visibleRecords = hiddenIds.length > 0 ? notInArray(readingRecords.bookId, hiddenIds) : undefined
  const totals = db.select({
    totalSeconds: sql<number>`coalesce(sum(${readingRecords.durationSeconds}), 0)`,
    totalBooks: sql<number>`count(distinct ${readingRecords.bookId})`,
    totalDays: sql<number>`count(distinct ${readingRecords.date})`,
  }).from(readingRecords).where(and(eq(readingRecords.userId, userId), visibleRecords)).get()!
  const todayRow = db.select({
    todaySeconds: sql<number>`coalesce(sum(${readingRecords.durationSeconds}), 0)`,
  }).from(readingRecords).where(and(eq(readingRecords.userId, userId), eq(readingRecords.date, today), visibleRecords)).get()!
  const dates = db.select({ date: readingRecords.date }).from(readingRecords)
    .where(and(eq(readingRecords.userId, userId), visibleRecords)).groupBy(readingRecords.date)
    .having(sql`sum(${readingRecords.durationSeconds}) >= 60`).orderBy(readingRecords.date).all()
    .map((r) => r.date)
  const streak = computeStreak(dates, today)

  // Week-over-week / month-over-month comparison, bucketed from one grouped
  // query; 'YYYY-MM-DD' strings compare lexicographically
  const thisWeekStart = weekStart(today)
  const prevWeekStart = shiftDays(thisWeekStart, -7)
  const thisMonthStart = `${today.slice(0, 7)}-01`
  const prevMonthStart = `${shiftDays(thisMonthStart, -1).slice(0, 7)}-01`
  const dayRows = db.select({
    date: readingRecords.date,
    durationSeconds: sql<number>`sum(${readingRecords.durationSeconds})`,
  }).from(readingRecords)
    .where(and(eq(readingRecords.userId, userId), gte(readingRecords.date, prevMonthStart), visibleRecords))
    .groupBy(readingRecords.date)
    .all()
  let weekSeconds = 0
  let prevWeekSeconds = 0
  let monthSeconds = 0
  let prevMonthSeconds = 0
  for (const row of dayRows) {
    if (row.date >= thisMonthStart) monthSeconds += row.durationSeconds
    else prevMonthSeconds += row.durationSeconds
    if (row.date >= thisWeekStart) weekSeconds += row.durationSeconds
    else if (row.date >= prevWeekStart) prevWeekSeconds += row.durationSeconds
  }

  // Same-period month-to-date comparison
  const [curYear, curMonth, curDay] = today.split('-').map(Number)
  const prevYear = curMonth === 1 ? curYear - 1 : curYear
  const prevMonth = curMonth === 1 ? 12 : curMonth - 1
  const thisMonthFrom = `${curYear}-${String(curMonth).padStart(2, '0')}-01`
  const thisMonthTo = today
  const prevMonthFrom = `${prevYear}-${String(prevMonth).padStart(2, '0')}-01`
  const prevMonthEndDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate()
  const prevMonthTo = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(Math.min(curDay, prevMonthEndDay)).padStart(2, '0')}`

  const comparisonRows = db.select({
    date: readingRecords.date,
    bookId: readingRecords.bookId,
    durationSeconds: readingRecords.durationSeconds,
  }).from(readingRecords)
    .where(and(
      eq(readingRecords.userId, userId),
      gte(readingRecords.date, prevMonthFrom),
      lte(readingRecords.date, thisMonthTo),
      visibleRecords,
    ))
    .all()

  let currentPeriodSeconds = 0
  let previousPeriodSeconds = 0
  const currentBooks = new Set<string>()
  const previousBooks = new Set<string>()
  const currentDays = new Set<string>()
  const previousDays = new Set<string>()
  const comparisonDays = new Map<string, number>()

  for (const r of comparisonRows) {
    comparisonDays.set(r.date, (comparisonDays.get(r.date) ?? 0) + r.durationSeconds)
    if (r.date >= thisMonthFrom && r.date <= thisMonthTo) {
      currentPeriodSeconds += r.durationSeconds
      currentBooks.add(r.bookId)
      currentDays.add(r.date)
    }
    if (r.date >= prevMonthFrom && r.date <= prevMonthTo) {
      previousPeriodSeconds += r.durationSeconds
      previousBooks.add(r.bookId)
      previousDays.add(r.date)
    }
  }
  for (const date of currentDays) if ((comparisonDays.get(date) ?? 0) < 60) currentDays.delete(date)
  for (const date of previousDays) if ((comparisonDays.get(date) ?? 0) < 60) previousDays.delete(date)

  const monthlyComparison: ReadingRecordMonthlyComparison = {
    currentPeriodSeconds,
    previousPeriodSeconds,
    currentPeriodBooks: currentBooks.size,
    previousPeriodBooks: previousBooks.size,
    currentPeriodDays: currentDays.size,
    previousPeriodDays: previousDays.size,
  }

  const totalWordsRead = await computeTotalWordsRead(userId, showHidden)
  const scopedDays = await getDaily(userId, range, showHidden)
  const scopedBooks = db.select({ count: sql<number>`count(distinct ${readingRecords.bookId})` }).from(readingRecords)
    .where(rangeConditions(userId, range, hiddenIds)).get()!.count
  const finishBounds = readingTimestampBounds(range)
  const finished = db.select().from(readingRounds).where(and(
    eq(readingRounds.userId, userId), eq(readingRounds.status, 'finished'),
    finishBounds.from !== undefined ? gte(readingRounds.endedAt, finishBounds.from) : undefined,
    finishBounds.until !== undefined ? lt(readingRounds.endedAt, finishBounds.until) : undefined,
    hiddenIds.length ? notInArray(readingRounds.bookVersionId, hiddenIds) : undefined,
  )).all()
  const scopedContributions = range.from || range.to ? db.select({ wordUnits: readingContributions.wordUnits })
    .from(readingContributions).where(and(
      eq(readingContributions.userId, userId),
      range.from ? gte(readingContributions.date, range.from) : undefined,
      range.to ? lte(readingContributions.date, range.to) : undefined,
      hiddenIds.length ? notInArray(readingContributions.bookVersionId, hiddenIds) : undefined,
    )).all() : []
  const scopedWordUnits = scopedContributions.reduce((sum, row) => sum + (row.wordUnits ?? 0), 0)
  return {
    ...totals,
    firstRecordedDate: dates[0],
    totalDays: dates.length,
    scope: {
      longestStreak: computeStreak(scopedDays.filter((day) => day.durationSeconds >= 60).map((day) => day.date), today).longest,
      totalSeconds: scopedDays.reduce((sum, day) => sum + day.durationSeconds, 0),
      totalBooks: scopedBooks,
      totalDays: scopedDays.filter((day) => day.durationSeconds >= 60).length,
      finishedBooks: new Set(finished.map((round) => round.bookVersionId)).size,
      finishedRounds: finished.length,
      totalWordsRead: !range.from && !range.to ? totalWordsRead : Math.round(scopedWordUnits / READING_WORD_UNITS_SCALE),
      wordsPartial: Boolean(range.from || range.to) && scopedContributions.some((row) => row.wordUnits === null),
    },
    todaySeconds: todayRow.todaySeconds,
    currentStreak: streak.current,
    longestStreak: streak.longest,
    weekSeconds,
    prevWeekSeconds,
    monthSeconds,
    prevMonthSeconds,
    totalWordsRead,
    monthlyComparison,
  }
}

function rangeConditions(userId: string, range: { from?: string; to?: string }, hiddenIds: string[] = []) {
  return and(
    eq(readingRecords.userId, userId),
    range.from ? gte(readingRecords.date, range.from) : undefined,
    range.to ? lte(readingRecords.date, range.to) : undefined,
    hiddenIds.length > 0 ? notInArray(readingRecords.bookId, hiddenIds) : undefined,
  )
}

export async function getDaily(userId: string, range: { from?: string; to?: string }, showHidden = false): Promise<ReadingRecordDailyItem[]> {
  const db = getDb()
  return db.select({
    date: readingRecords.date,
    durationSeconds: sql<number>`sum(${readingRecords.durationSeconds})`,
  }).from(readingRecords)
    .where(rangeConditions(userId, range, excludedReadingBookVersionIds(db, userId, showHidden)))
    .groupBy(readingRecords.date)
    .orderBy(readingRecords.date)
    .all()
}

/** Hour-of-day distribution from persisted contributions in each record's timezone. */
export async function getHourly(userId: string, range: { from?: string; to?: string; bookId?: string }, _tzOffset: number, showHidden = false): Promise<ReadingRecordHourlyItem[]> {
  const db = getDb()
  await ensureReadingProjections(userId, showHidden)
  const hiddenIds = excludedReadingBookVersionIds(db, userId, showHidden)
  const rows = db.select({ hour: readingHourlyStats.hour, date: readingHourlyStats.date, durationSeconds: readingHourlyStats.durationSeconds })
    .from(readingHourlyStats).where(and(
      eq(readingHourlyStats.userId, userId),
      range.from ? gte(readingHourlyStats.date, range.from) : undefined,
      range.to ? lte(readingHourlyStats.date, range.to) : undefined,
      range.bookId ? eq(readingHourlyStats.bookVersionId, range.bookId) : undefined,
      hiddenIds.length ? notInArray(readingHourlyStats.bookVersionId, hiddenIds) : undefined,
    )).all()
  const hours = new Map<number, { durationSeconds: number; days: Set<string> }>()
  for (const row of rows) {
    const cur = hours.get(row.hour) ?? { durationSeconds: 0, days: new Set<string>() }
    cur.durationSeconds += row.durationSeconds
    cur.days.add(row.date)
    hours.set(row.hour, cur)
  }
  return [...hours].sort(([a], [b]) => a - b).map(([hour, { durationSeconds, days }]) => ({ hour, durationSeconds, days: days.size }))
}
export async function getByBook(userId: string, range: { from?: string; to?: string }, showHidden = false): Promise<ReadingRecordBookItem[]> {
  const db = getDb()
  const totals = db.select({
    bookId: readingRecords.bookId,
    progress: sql<number>`coalesce(${bookStates.percent}, 0)`,
    readStatus: sql<ReadingRecordBookItem['readStatus']>`coalesce(${bookStates.readStatus}, 'reading')`,
    durationSeconds: sql<number>`sum(${readingRecords.durationSeconds})`,
    days: sql<number>`count(distinct CASE WHEN ${readingRecords.durationSeconds} >= 60 THEN ${readingRecords.date} END)`,
  }).from(readingRecords)
    .leftJoin(bookStates, and(eq(bookStates.bookVersionId, readingRecords.bookId), eq(bookStates.userId, userId)))
    .where(rangeConditions(userId, range, excludedReadingBookVersionIds(db, userId, showHidden)))
    .groupBy(readingRecords.bookId)
    .orderBy(desc(sql`sum(${readingRecords.durationSeconds})`))
    .all()

  if (totals.length === 0) return []

  const bookIds = totals.map((row) => row.bookId)
  const privateCards = db.select({
    bookVersionId: libraryBookVersions.bookVersionId,
    title: sql<string>`coalesce(${libraryBookVersions.title}, ${libraryBooks.title})`,
    author: sql<string>`coalesce(${libraryBookVersions.author}, ${libraryBooks.author})`,
    coverKey: sql<string | null>`coalesce(${libraryBookVersions.coverKey}, ${libraryBooks.coverKey})`,
  }).from(libraryBookVersions)
    .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
    .where(and(
      inArray(libraryBookVersions.bookVersionId, bookIds),
      eq(libraries.userId, userId),
      eq(libraries.type, 'private'),
    )).all()

  const cardMap = new Map<string, { title: string; author: string; coverKey: string | null }>()
  for (const card of privateCards) {
    if (!cardMap.has(card.bookVersionId)) {
      cardMap.set(card.bookVersionId, { title: card.title, author: card.author, coverKey: card.coverKey })
    }
  }

  return Promise.all(totals.map(async (row) => {
    const cached = cardMap.get(row.bookId)
    if (cached) return { ...row, ...cached }
    try {
      const book = await getBook(userId, row.bookId, { showHidden })
      return { ...row, title: book.title, author: book.author, coverKey: book.coverKey }
    } catch (error) {
      if (!(error instanceof AppError) || !['BOOK_NOT_FOUND', 'BOOK_FILE_MISSING', 'FORBIDDEN'].includes(error.code)) throw error
      const archive = db.select().from(readingArchives).where(and(eq(readingArchives.userId, userId), eq(readingArchives.bookVersionId, row.bookId))).get()
      return { ...row, title: archive?.title ?? 'Unavailable book', author: archive?.author ?? '', coverKey: null }
    }
  }))
}

export async function getBookRecords(userId: string, bookId: string, showHidden = false, range: ReadingRange = {}): Promise<ReadingRecordBookDetailRes> {
  await ensureReadingArchive(userId, bookId, showHidden)
  const db = getDb()
  const total = db.select({
    totalSeconds: sql<number>`coalesce(sum(${readingRecords.durationSeconds}), 0)`,
  }).from(readingRecords).where(and(eq(readingRecords.bookId, bookId), rangeConditions(userId, range))).get()!
  const records = db.select({
    date: readingRecords.date,
    durationSeconds: readingRecords.durationSeconds,
  }).from(readingRecords)
    .where(and(eq(readingRecords.bookId, bookId), rangeConditions(userId, range)))
    .orderBy(desc(readingRecords.date))
    .all()
  return { totalSeconds: total.totalSeconds, records }
}

type SessionRow = typeof readingSessions.$inferSelect

function toSessionItem(row: SessionRow): ReadingSessionItem {
  return {
    id: row.id,
    bookId: row.bookId,
    date: row.date,
    startedAt: row.startedAt as number,
    durationSeconds: row.durationSeconds,
    endedAt: row.endedAt,
    startCfi: row.startCfi,
    endCfi: row.endCfi,
    startFraction: row.startFraction,
    endFraction: row.endFraction,
    startChapterIndex: row.startChapterIndex,
    endChapterIndex: row.endChapterIndex,
  }
}

export async function updateSession(userId: string, sessionId: string, body: ReadingSessionUpdateReq): Promise<ReadingSessionItem> {
  return toSessionItem(updateLedgerSession(userId, sessionId, body))
}

export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  deleteLedgerSession(userId, sessionId)
}
function readingTaxonomyFacts(userId: string, range: ReadingRange, showHidden: boolean) {
  const db = getDb()
  const holdings = readingHoldings(db, userId, showHidden)
  const excluded = [...new Set([
    ...pendingBookDataDeletionVersionIds(db, userId),
    ...holdings.filter((row) => row.excluded).map((row) => row.bookVersionId),
  ])]
  const facts = db.select({
    bookVersionId: readingRecords.bookId,
    durationSeconds: sql<number>`sum(${readingRecords.durationSeconds})`,
  }).from(readingRecords).where(rangeConditions(userId, range, excluded))
    .groupBy(readingRecords.bookId).all()
  return { db, facts, holdings: new Map(holdings.filter((row) => !row.excluded).map((row) => [row.bookVersionId, row])) }
}

/** Every distinct version/tag receives the full duration, without multiplying facts. */
export async function getByTag(userId: string, range: ReadingRange, showHidden = false): Promise<ReadingRecordTagItem[]> {
  const { db, facts, holdings } = readingTaxonomyFacts(userId, range, showHidden)
  const workIds = [...new Set(facts.flatMap((fact) => {
    const holding = holdings.get(fact.bookVersionId)
    return holding ? [holding.libraryBookId] : []
  }))]
  if (!workIds.length) return []
  const links = db.selectDistinct({
    libraryBookId: libraryBookTags.libraryBookId,
    tagId: libraryBookTags.tagId,
    name: libraryTags.name,
  }).from(libraryBookTags)
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookTags.libraryBookId))
    .innerJoin(libraryTags, and(eq(libraryTags.id, libraryBookTags.tagId), eq(libraryTags.libraryId, libraryBooks.libraryId)))
    .where(inArray(libraryBookTags.libraryBookId, workIds)).all()
  const tagsByWork = new Map<string, typeof links>()
  for (const link of links) {
    const tags = tagsByWork.get(link.libraryBookId) ?? []
    tags.push(link)
    tagsByWork.set(link.libraryBookId, tags)
  }
  const groups = new Map<string, ReadingRecordTagItem>()
  for (const fact of facts) {
    const holding = holdings.get(fact.bookVersionId)
    if (!holding) continue
    const seen = new Set<string>()
    for (const tag of tagsByWork.get(holding.libraryBookId) ?? []) {
      if (seen.has(tag.tagId)) continue
      seen.add(tag.tagId)
      const group = groups.get(tag.tagId) ?? { tagId: tag.tagId, name: tag.name, durationSeconds: 0, bookCount: 0 }
      group.durationSeconds += fact.durationSeconds
      group.bookCount = (group.bookCount ?? 0) + 1
      groups.set(tag.tagId, group)
    }
  }
  return [...groups.values()].sort((a, b) => (b.bookCount ?? 0) - (a.bookCount ?? 0) || b.durationSeconds - a.durationSeconds || a.tagId.localeCompare(b.tagId))
}

export async function getByCategory(userId: string, range: ReadingRange, showHidden = false): Promise<ReadingRecordCategoryItem[]> {
  const { db, facts, holdings } = readingTaxonomyFacts(userId, range, showHidden)
  const libraryIds = [...new Set([...holdings.values()].map((h) => h.libraryId))]
  const categories = libraryIds.length > 0
    ? db.select().from(libraryCategories).where(inArray(libraryCategories.libraryId, libraryIds)).all()
    : []
  const categoryMap = new Map(categories.map((category) => [category.id, category]))
  const groups = new Map<string | null, ReadingRecordCategoryItem>()
  for (const fact of facts) {
    const holding = holdings.get(fact.bookVersionId)
    const assigned = holding?.categoryId ? categoryMap.get(holding.categoryId) : undefined
    const category = assigned?.libraryId === holding?.libraryId ? assigned : undefined
    const parent = category?.parentId ? categoryMap.get(category.parentId) : undefined
    const categoryId = category?.id ?? null
    const group = groups.get(categoryId) ?? {
      categoryId, name: category?.name ?? null, parentId: parent?.libraryId === category?.libraryId ? parent?.id ?? null : null,
      parentName: parent?.libraryId === category?.libraryId ? parent?.name ?? null : null,
      durationSeconds: 0, bookCount: 0,
    }
    group.durationSeconds += fact.durationSeconds
    group.bookCount += 1
    groups.set(categoryId, group)
  }
  return [...groups.values()].sort((a, b) => b.durationSeconds - a.durationSeconds || (a.categoryId ?? '').localeCompare(b.categoryId ?? ''))
}
