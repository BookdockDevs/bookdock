import { and, desc, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm'

import type {
  ReadingDetailItem,
  ReadingRecordBookDetailRes,
  ReadingRecordBookItem,
  ReadingRecordCreateReq,
  ReadingRecordDailyItem,
  ReadingRecordHourlyItem,
  ReadingRecordSummaryRes,
  ReadingRecordTagItem,
  ReadingSessionItem,
  ReadingSessionUpdateReq,
} from '@bookdock/shared'

import { getDb } from '../../db/client'
import { bookTags, books, readingRecords, readingSessions, tags } from '../../db/schema'
import { createId } from '../../lib/id'
import { unionLength } from '../../lib/intervals'
import { mergeProgressInterval, readProgressFile } from '../../lib/progress-file'
import { AppError } from '../../middleware/error'

function assertBookOwnership(userId: string, bookId: string) {
  const db = getDb()
  const book = db.select({ id: books.id }).from(books)
    .where(and(eq(books.id, bookId), eq(books.userId, userId), isNull(books.deletedAt)))
    .get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
}

export async function addReadingTime(userId: string, body: ReadingRecordCreateReq) {
  assertBookOwnership(userId, body.bookId)
  const db = getDb()
  db.insert(readingRecords).values({
    id: createId('rr'),
    userId,
    bookId: body.bookId,
    date: body.date,
    durationSeconds: body.durationSeconds,
  }).onConflictDoUpdate({
    target: [readingRecords.userId, readingRecords.bookId, readingRecords.date],
    set: { durationSeconds: sql`${readingRecords.durationSeconds} + ${body.durationSeconds}` },
  }).run()
  db.insert(readingSessions).values({
    id: createId('rs'),
    userId,
    bookId: body.bookId,
    date: body.date,
    // Explicit null = retroactive entry without a known start time
    startedAt: body.startedAt === undefined ? Date.now() : body.startedAt,
    durationSeconds: body.durationSeconds,
    endedAt: body.endedAt,
    startCfi: body.startCfi,
    endCfi: body.endCfi,
    startFraction: body.startFraction,
    endFraction: body.endFraction,
    startChapterIndex: body.startChapterIndex,
    endChapterIndex: body.endChapterIndex,
  }).run()
  // Retroactive entries may carry an explicit read range: merge it into the
  // book's interval union. This is a pure interval merge — the current
  // reading position (cfi/percent/lastReadAt) stays untouched.
  if (body.startFraction !== undefined && body.endFraction !== undefined) {
    await mergeProgressInterval(body.bookId, [body.startFraction, body.endFraction])
  }
  return db.select().from(readingRecords).where(and(
    eq(readingRecords.userId, userId),
    eq(readingRecords.bookId, body.bookId),
    eq(readingRecords.date, body.date),
  )).get()
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

async function computeTotalWordsRead(userId: string): Promise<number> {
  const db = getDb()
  const rows = db.select({ id: books.id, meta: books.meta }).from(books)
    .where(and(eq(books.userId, userId), isNull(books.deletedAt))).all()
  let total = 0
  for (const row of rows) {
    const wordCount = row.meta?.wordCount
    if (typeof wordCount !== 'number' || wordCount <= 0) continue
    const progress = await readProgressFile(row.id)
    if (!progress?.intervals) continue
    total += unionLength(progress.intervals) * wordCount
  }
  return Math.round(total)
}

export async function getSummary(userId: string, today: string): Promise<ReadingRecordSummaryRes> {
  const db = getDb()
  const totals = db.select({
    totalSeconds: sql<number>`coalesce(sum(${readingRecords.durationSeconds}), 0)`,
    totalBooks: sql<number>`count(distinct ${readingRecords.bookId})`,
    totalDays: sql<number>`count(distinct ${readingRecords.date})`,
  }).from(readingRecords).where(eq(readingRecords.userId, userId)).get()!
  const todayRow = db.select({
    todaySeconds: sql<number>`coalesce(sum(${readingRecords.durationSeconds}), 0)`,
  }).from(readingRecords).where(and(eq(readingRecords.userId, userId), eq(readingRecords.date, today))).get()!
  const dates = db.selectDistinct({ date: readingRecords.date }).from(readingRecords)
    .where(eq(readingRecords.userId, userId)).orderBy(readingRecords.date).all()
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
    .where(and(eq(readingRecords.userId, userId), gte(readingRecords.date, prevMonthStart)))
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

  const totalWordsRead = await computeTotalWordsRead(userId)
  return {
    ...totals,
    todaySeconds: todayRow.todaySeconds,
    currentStreak: streak.current,
    longestStreak: streak.longest,
    weekSeconds,
    prevWeekSeconds,
    monthSeconds,
    prevMonthSeconds,
    totalWordsRead,
  }
}

function rangeConditions(userId: string, range: { from?: string; to?: string }) {
  return and(
    eq(readingRecords.userId, userId),
    range.from ? gte(readingRecords.date, range.from) : undefined,
    range.to ? lte(readingRecords.date, range.to) : undefined,
  )
}

export async function getDaily(userId: string, range: { from?: string; to?: string }): Promise<ReadingRecordDailyItem[]> {
  const db = getDb()
  return db.select({
    date: readingRecords.date,
    durationSeconds: sql<number>`sum(${readingRecords.durationSeconds})`,
  }).from(readingRecords)
    .where(rangeConditions(userId, range))
    .groupBy(readingRecords.date)
    .orderBy(readingRecords.date)
    .all()
}

/** Hour-of-day distribution from session detail rows; tzOffset is minutes behind UTC (Date#getTimezoneOffset). */
export async function getHourly(userId: string, range: { from?: string; to?: string; bookId?: string }, tzOffset: number): Promise<ReadingRecordHourlyItem[]> {
  const db = getDb()
  const hour = sql<number>`cast(strftime('%H', ${readingSessions.startedAt} / 1000 - ${tzOffset} * 60, 'unixepoch') as integer)`
  return db.select({
    hour,
    durationSeconds: sql<number>`sum(${readingSessions.durationSeconds})`,
  }).from(readingSessions)
    .where(and(
      eq(readingSessions.userId, userId),
      // Retroactive entries without a start time have no hour to attribute to
      isNotNull(readingSessions.startedAt),
      range.from ? gte(readingSessions.date, range.from) : undefined,
      range.to ? lte(readingSessions.date, range.to) : undefined,
      range.bookId ? eq(readingSessions.bookId, range.bookId) : undefined,
    ))
    .groupBy(hour)
    .orderBy(hour)
    .all()
}

export async function getByBook(userId: string, range: { from?: string; to?: string }): Promise<ReadingRecordBookItem[]> {
  const db = getDb()
  return db.select({
    bookId: readingRecords.bookId,
    title: books.title,
    author: books.author,
    coverKey: books.coverKey,
    progress: books.progress,
    readStatus: books.readStatus,
    durationSeconds: sql<number>`sum(${readingRecords.durationSeconds})`,
    days: sql<number>`count(distinct ${readingRecords.date})`,
  }).from(readingRecords)
    .innerJoin(books, eq(readingRecords.bookId, books.id))
    .where(rangeConditions(userId, range))
    .groupBy(readingRecords.bookId)
    .orderBy(desc(sql`sum(${readingRecords.durationSeconds})`))
    .all()
}

export async function getBookRecords(userId: string, bookId: string): Promise<ReadingRecordBookDetailRes> {
  assertBookOwnership(userId, bookId)
  const db = getDb()
  const total = db.select({
    totalSeconds: sql<number>`coalesce(sum(${readingRecords.durationSeconds}), 0)`,
  }).from(readingRecords).where(and(eq(readingRecords.userId, userId), eq(readingRecords.bookId, bookId))).get()!
  const records = db.select({
    date: readingRecords.date,
    durationSeconds: readingRecords.durationSeconds,
  }).from(readingRecords)
    .where(and(eq(readingRecords.userId, userId), eq(readingRecords.bookId, bookId)))
    .orderBy(desc(readingRecords.date))
    .all()
  return { totalSeconds: total.totalSeconds, records }
}

// Manual-session maintenance (manual-reading-timer.md §7): edits and deletes
// only touch the session row and the daily aggregate — the progress interval
// union is intentionally left stale (see the design doc's decision record).
type DbLike = Pick<
  ReturnType<typeof getDb>,
  'insert' | 'select' | 'update' | 'delete'
>

function adjustAggregate(
  tx: DbLike,
  userId: string,
  bookId: string,
  date: string,
  deltaSeconds: number,
) {
  if (deltaSeconds > 0) {
    tx.insert(readingRecords).values({
      id: createId('rr'), userId, bookId, date, durationSeconds: deltaSeconds,
    }).onConflictDoUpdate({
      target: [readingRecords.userId, readingRecords.bookId, readingRecords.date],
      set: { durationSeconds: sql`${readingRecords.durationSeconds} + ${deltaSeconds}` },
    }).run()
    return
  }
  if (deltaSeconds < 0) {
    const row = tx.select().from(readingRecords).where(and(
      eq(readingRecords.userId, userId), eq(readingRecords.bookId, bookId), eq(readingRecords.date, date),
    )).get()
    if (!row) return
    const next = row.durationSeconds + deltaSeconds
    if (next <= 0) {
      tx.delete(readingRecords).where(eq(readingRecords.id, row.id)).run()
    } else {
      tx.update(readingRecords).set({ durationSeconds: next }).where(eq(readingRecords.id, row.id)).run()
    }
  }
}

type SessionRow = typeof readingSessions.$inferSelect

function toSessionItem(row: SessionRow): ReadingSessionItem {
  return {
    id: row.id,
    bookId: row.bookId,
    date: row.date,
    // Null only for retroactive no-time entries, which the legacy session
    // endpoints never list; the mixed detail feed types startedAt as nullable
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

export function getSessionOrThrow(userId: string, sessionId: string): SessionRow {
  const db = getDb()
  const row = db.select().from(readingSessions).where(and(
    eq(readingSessions.id, sessionId),
    eq(readingSessions.userId, userId),
  )).get()
  if (!row) throw new AppError('SESSION_NOT_FOUND')
  return row
}

export async function listSessions(userId: string, bookId: string, limit: number, offset: number): Promise<ReadingSessionItem[]> {
  assertBookOwnership(userId, bookId)
  const db = getDb()
  // Manual sessions only: auto-mode blocks are heuristic fragments without
  // exact bounds and are immutable — they never appear in the session list.
  // Retroactive entries without a start time are excluded too: the legacy
  // session UI assumes a non-null startedAt; they surface in the mixed
  // detail feed (getBookDetail) instead.
  return db.select().from(readingSessions)
    .where(and(
      eq(readingSessions.userId, userId),
      eq(readingSessions.bookId, bookId),
      isNotNull(readingSessions.endedAt),
      isNotNull(readingSessions.startedAt),
    ))
    .orderBy(desc(readingSessions.startedAt))
    .limit(limit)
    .offset(offset)
    .all()
    .map(toSessionItem)
}

export async function updateSession(userId: string, sessionId: string, body: ReadingSessionUpdateReq): Promise<ReadingSessionItem> {
  const db = getDb()
  const existing = getSessionOrThrow(userId, sessionId)
  if (existing.endedAt === null) throw new AppError('VALIDATION_ERROR', 'auto-mode sessions are immutable')
  const startedAt = body.startedAt ?? existing.startedAt
  const endedAt = body.endedAt ?? existing.endedAt ?? startedAt
  const durationSeconds = body.durationSeconds ?? existing.durationSeconds
  const date = body.date ?? existing.date

  db.transaction((tx) => {
    tx.update(readingSessions).set({
      startedAt,
      endedAt,
      date,
      durationSeconds,
      ...(body.startCfi !== undefined ? { startCfi: body.startCfi } : {}),
      ...(body.endCfi !== undefined ? { endCfi: body.endCfi } : {}),
      ...(body.startFraction !== undefined ? { startFraction: body.startFraction } : {}),
      ...(body.endFraction !== undefined ? { endFraction: body.endFraction } : {}),
      ...(body.startChapterIndex !== undefined ? { startChapterIndex: body.startChapterIndex } : {}),
      ...(body.endChapterIndex !== undefined ? { endChapterIndex: body.endChapterIndex } : {}),
    }).where(eq(readingSessions.id, sessionId)).run()
    if (date === existing.date) {
      adjustAggregate(tx, userId, existing.bookId, date, durationSeconds - existing.durationSeconds)
    } else {
      adjustAggregate(tx, userId, existing.bookId, existing.date, -existing.durationSeconds)
      adjustAggregate(tx, userId, existing.bookId, date, durationSeconds)
    }
  })
  return toSessionItem(getSessionOrThrow(userId, sessionId))
}

export async function deleteSession(userId: string, sessionId: string): Promise<void> {
  const db = getDb()
  const existing = getSessionOrThrow(userId, sessionId)
  if (existing.endedAt === null) throw new AppError('VALIDATION_ERROR', 'auto-mode sessions are immutable')
  db.transaction((tx) => {
    tx.delete(readingSessions).where(eq(readingSessions.id, sessionId)).run()
    adjustAggregate(tx, userId, existing.bookId, existing.date, -existing.durationSeconds)
  })
}

/**
 * Mixed per-book detail feed: manual sessions (editable) + auto-mode day rows
 * (read-only), merged newest-first and paginated after the merge. An auto day
 * row's duration is the day's aggregate minus that day's manual sessions, so
 * retroactive entries never double-count; days fully covered by manual
 * sessions produce no auto row.
 */
export async function getBookDetail(userId: string, bookId: string, limit: number, offset: number): Promise<ReadingDetailItem[]> {
  assertBookOwnership(userId, bookId)
  const db = getDb()
  const manualRows = db.select().from(readingSessions)
    .where(and(
      eq(readingSessions.userId, userId),
      eq(readingSessions.bookId, bookId),
      isNotNull(readingSessions.endedAt),
    ))
    .all()
  const manualSecondsByDate = new Map<string, number>()
  const manualItems: ReadingDetailItem[] = manualRows.map((row) => {
    manualSecondsByDate.set(row.date, (manualSecondsByDate.get(row.date) ?? 0) + row.durationSeconds)
    return { kind: 'manual', ...toSessionItem(row), startedAt: row.startedAt }
  })
  const dayRows = db.select({
    date: readingRecords.date,
    durationSeconds: readingRecords.durationSeconds,
  }).from(readingRecords)
    .where(and(eq(readingRecords.userId, userId), eq(readingRecords.bookId, bookId)))
    .all()
  const autoItems: ReadingDetailItem[] = []
  for (const day of dayRows) {
    const autoSeconds = day.durationSeconds - (manualSecondsByDate.get(day.date) ?? 0)
    if (autoSeconds > 0) autoItems.push({ kind: 'autoDay', date: day.date, durationSeconds: autoSeconds })
  }
  const sortKey = (item: ReadingDetailItem): number =>
    item.kind === 'manual' ? item.startedAt ?? dayMs(item.date) : dayMs(item.date)
  const merged = [...manualItems, ...autoItems]
    .sort((a, b) => sortKey(b) - sortKey(a) || (a.kind === 'manual' ? -1 : 1))
  return merged.slice(offset, offset + limit)
}

/** Reading time grouped by tag; untagged books are excluded (no 'uncategorized' bucket) */
export async function getByTag(userId: string, range: { from?: string; to?: string }): Promise<ReadingRecordTagItem[]> {
  const db = getDb()
  return db.select({
    tagId: bookTags.tagId,
    name: tags.name,
    durationSeconds: sql<number>`sum(${readingRecords.durationSeconds})`,
  }).from(readingRecords)
    .innerJoin(bookTags, eq(readingRecords.bookId, bookTags.bookId))
    .innerJoin(tags, eq(bookTags.tagId, tags.id))
    .where(rangeConditions(userId, range))
    .groupBy(bookTags.tagId, tags.name)
    .orderBy(desc(sql`sum(${readingRecords.durationSeconds})`))
    .all()
}
