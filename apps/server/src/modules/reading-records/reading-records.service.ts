import { and, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'

import type {
  ReadingRecordBookDetailRes,
  ReadingRecordBookItem,
  ReadingRecordCreateReq,
  ReadingRecordDailyItem,
  ReadingRecordHourlyItem,
  ReadingRecordSummaryRes,
} from '@bookdock/shared'

import { getDb } from '../../db/client'
import { books, readingRecords, readingSessions } from '../../db/schema'
import { createId } from '../../lib/id'
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
    startedAt: body.startedAt ?? Date.now(),
    durationSeconds: body.durationSeconds,
  }).run()
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
  return { ...totals, todaySeconds: todayRow.todaySeconds, currentStreak: streak.current, longestStreak: streak.longest }
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
