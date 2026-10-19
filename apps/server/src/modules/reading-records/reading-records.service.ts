import { and, desc, eq, gte, inArray, isNull, lt, lte, notInArray, sql } from 'drizzle-orm'

import type {
  ReadingRange,
  ReadingRecordBookDetailRes,
  ReadingRecordBookItem,
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
import { bookStates, contentRevisions, libraries, libraryBooks, libraryBookTags, libraryBookVersions, libraryTags, readingArchives, readingRecords, readingRounds, readingSessions } from '../../db/schema'
import { readProgressFile } from '../../lib/progress-file'
import { getBook } from '../books/books.service'
import { unionLength } from '../../lib/intervals'
import { hiddenBookVersionIds } from './reading-visibility'
import { isProgressMigrationCompleted } from '../progress/progress-migration'
import { AppError } from '../../middleware/error'
import { addLedgerReading, deleteLedgerSession, ensureReadingArchive, updateLedgerSession } from './reading-ledger.service'
import { splitReadingTime } from './time-fragments'
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
    const hidden = new Set(showHidden ? [] : hiddenBookVersionIds(db, userId))
    const sessions = db.select().from(readingSessions).where(eq(readingSessions.userId, userId)).all()
    let words = 0
    for (const archive of archives) {
      if (hidden.has(archive.bookVersionId)) continue
      words += unionLength(archive.legacyIntervals) * (archive.legacyWordCount ?? 0)
    }
    for (const session of sessions) {
      if (hidden.has(session.bookId)) continue
      words += session.coverage.reduce((sum, [start, end]) => sum + Math.abs(end - start), 0) * (session.wordCount ?? 0)
    }
    return Math.round(words)
  }
  const library = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (!library) return 0

  const skips = showHidden ? [] : hiddenBookVersionIds(db, userId)
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
  const hiddenIds = showHidden ? [] : hiddenBookVersionIds(db, userId)
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
  const scopedSessions = db.select().from(readingSessions).where(and(
    eq(readingSessions.userId, userId),
    hiddenIds.length ? notInArray(readingSessions.bookId, hiddenIds) : undefined,
  )).all()
  let scopedWords = 0
  for (const session of scopedSessions) {
    const words = session.coverage.reduce((sum, [a, b]) => sum + Math.abs(b - a), 0) * (session.wordCount ?? 0)
    if (session.fragments.length && session.timezone) {
      const slices = splitReadingTime(session.fragments, session.timezone)
      const total = slices.reduce((sum, slice) => sum + slice.durationSeconds, 0)
      const selected = slices.filter((slice) => (!range.from || slice.date >= range.from) && (!range.to || slice.date <= range.to))
        .reduce((sum, slice) => sum + slice.durationSeconds, 0)
      if (total > 0) scopedWords += words * selected / total
    } else if ((!range.from || session.date >= range.from) && (!range.to || session.date <= range.to)) scopedWords += words
  }
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
      totalWordsRead: !range.from && !range.to ? totalWordsRead : Math.round(scopedWords),
      wordsPartial: Boolean(range.from || range.to) && scopedSessions.some((session) => session.source === 'legacy' && !session.coverage.length),
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
    .where(rangeConditions(userId, range, showHidden ? [] : hiddenBookVersionIds(db, userId)))
    .groupBy(readingRecords.date)
    .orderBy(readingRecords.date)
    .all()
}

/** Hour-of-day distribution from session detail rows; tzOffset is minutes behind UTC (Date#getTimezoneOffset). */
export async function getHourly(userId: string, range: { from?: string; to?: string; bookId?: string }, tzOffset: number, showHidden = false): Promise<ReadingRecordHourlyItem[]> {
  const db = getDb()
  const hiddenIds = showHidden ? [] : hiddenBookVersionIds(db, userId)
  const rows = db.select().from(readingSessions).where(and(
    eq(readingSessions.userId, userId),
    range.bookId ? eq(readingSessions.bookId, range.bookId) : undefined,
    hiddenIds.length ? notInArray(readingSessions.bookId, hiddenIds) : undefined,
  )).all()
  const hours = new Map<number, { durationSeconds: number; days: Set<string> }>()
  for (const row of rows) {
    if (row.fragments.length && row.timezone) {
      for (const slice of splitReadingTime(row.fragments, row.timezone)) {
        if ((range.from && slice.date < range.from) || (range.to && slice.date > range.to)) continue
        const cur = hours.get(slice.hour) ?? { durationSeconds: 0, days: new Set<string>() }
        cur.durationSeconds += slice.durationSeconds
        cur.days.add(slice.date)
        hours.set(slice.hour, cur)
      }
    } else if (row.source === 'legacy' && row.startedAt != null && (!range.from || row.date >= range.from) && (!range.to || row.date <= range.to)) {
      const hour = new Date(row.startedAt - tzOffset * 60_000).getUTCHours()
      const cur = hours.get(hour) ?? { durationSeconds: 0, days: new Set<string>() }
      cur.durationSeconds += row.durationSeconds
      cur.days.add(row.date)
      hours.set(hour, cur)
    }
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
    .where(rangeConditions(userId, range, showHidden ? [] : hiddenBookVersionIds(db, userId)))
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
/** Reading time grouped by tag; untagged books are excluded (no 'uncategorized' bucket) */
export async function getByTag(userId: string, range: { from?: string; to?: string }, showHidden = false): Promise<ReadingRecordTagItem[]> {
  const db = getDb()
  return db.select({
    tagId: libraryBookTags.tagId,
    name: libraryTags.name,
    durationSeconds: sql<number>`sum(${readingRecords.durationSeconds})`,
    bookCount: sql<number>`count(distinct ${readingRecords.bookId})`,
  }).from(readingRecords)
    .innerJoin(libraryBookVersions, eq(readingRecords.bookId, libraryBookVersions.bookVersionId))
    .innerJoin(libraryBookTags, eq(libraryBookTags.libraryBookId, libraryBookVersions.libraryBookId))
    .innerJoin(libraryTags, eq(libraryBookTags.tagId, libraryTags.id))
    .where(rangeConditions(userId, range, showHidden ? [] : hiddenBookVersionIds(db, userId)))
    .groupBy(libraryBookTags.tagId, libraryTags.name)
    .orderBy(desc(sql`count(distinct ${readingRecords.bookId})`), desc(sql`sum(${readingRecords.durationSeconds})`))
    .all()
}
