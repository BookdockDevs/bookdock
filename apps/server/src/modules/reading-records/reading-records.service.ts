import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, or, sql, type SQL } from 'drizzle-orm'

import type {
  ReadingDetailItem,
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
import { bookStates, bookVersions, contentRevisions, libraries, libraryBooks, libraryBookTags, libraryBookVersions, libraryTags, readingRecords, readingSessions } from '../../db/schema'
import { createId } from '../../lib/id'
import { mergeProgressIntervalInTx, readProgressFile } from '../../lib/progress-file'
import { assertReadableBook, getBook } from '../books/books.service'
import { loadLibraryHiddenTaxonomy } from '../libraries/library-query'
import { isProgressMigrationCompleted } from '../progress/progress-migration'
import { AppError } from '../../middleware/error'

/**
 * Version ids hidden from the owner's default stats views (private vault).
 * Aggregates exclude these rows unless the caller reveals them; per-book
 * endpoints keep their own assertReadableBook flag instead.
 */
function hiddenBookVersionIds(db: ReturnType<typeof getDb>, userId: string): string[] {
  const library = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (!library) return []
  const taxonomy = loadLibraryHiddenTaxonomy(db, library.id)
  const hiddenWorkConditions: SQL[] = [eq(libraryBooks.hidden, true)]
  if (taxonomy.hiddenCategoryIds.length > 0) {
    hiddenWorkConditions.push(inArray(libraryBooks.categoryId, taxonomy.hiddenCategoryIds))
  }
  if (taxonomy.hiddenTagIds.length > 0) {
    hiddenWorkConditions.push(sql`EXISTS (
      SELECT 1 FROM ${libraryBookTags} AS stats_hidden_tag
      INNER JOIN ${libraryTags} AS stats_hidden_name ON stats_hidden_name.id = stats_hidden_tag.tag_id
      WHERE stats_hidden_tag.library_book_id = ${libraryBooks.id}
        AND stats_hidden_tag.tag_id IN ${taxonomy.hiddenTagIds}
    )`)
  }
  const works = db.select({ id: libraryBooks.id }).from(libraryBooks)
    .where(and(eq(libraryBooks.libraryId, library.id), or(...hiddenWorkConditions))).all()
  if (works.length === 0) return []
  return db.select({ bookVersionId: libraryBookVersions.bookVersionId }).from(libraryBookVersions)
    .where(inArray(libraryBookVersions.libraryBookId, works.map((w) => w.id)))
    .all().map((row) => row.bookVersionId)
}

function versionIdIfMigrated(bookId: string): string | null {
  const db = getDb()
  return db.select({ id: bookVersions.id }).from(bookVersions).where(eq(bookVersions.id, bookId)).get()?.id ?? null
}

export async function addReadingTime(userId: string, body: ReadingRecordCreateReq, showHidden = false) {
  await assertReadableBook(userId, body.bookId, showHidden)
  const db = getDb()
  // New rows bind the version when the book already migrated; history keeps
  // flowing through bookId either way (0.3 id reuse).
  const bookVersionId = versionIdIfMigrated(body.bookId)

  if (body.startFraction !== undefined && body.endFraction !== undefined && !isProgressMigrationCompleted(db)) {
    await readProgressFile(userId, body.bookId)
  }

  db.transaction((tx) => {
    tx.insert(readingRecords).values({
      id: createId('rr'),
      userId,
      bookId: body.bookId,
      bookVersionId,
      date: body.date,
      durationSeconds: body.durationSeconds,
    }).onConflictDoUpdate({
      target: [readingRecords.userId, readingRecords.bookId, readingRecords.date],
      set: { durationSeconds: sql`${readingRecords.durationSeconds} + ${body.durationSeconds}` },
    }).run()
    tx.insert(readingSessions).values({
      id: createId('rs'),
      userId,
      bookId: body.bookId,
      bookVersionId,
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
    // book's interval union atomically within the same transaction.
    if (body.startFraction !== undefined && body.endFraction !== undefined) {
      mergeProgressIntervalInTx(tx as unknown as ReturnType<typeof getDb>, userId, body.bookId, [body.startFraction, body.endFraction])
    }
  })

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

async function computeTotalWordsRead(userId: string, showHidden = false): Promise<number> {
  const db = getDb()
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

export async function getSummary(userId: string, today: string, showHidden = false): Promise<ReadingRecordSummaryRes> {
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
  const dates = db.selectDistinct({ date: readingRecords.date }).from(readingRecords)
    .where(and(eq(readingRecords.userId, userId), visibleRecords)).orderBy(readingRecords.date).all()
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

  for (const r of comparisonRows) {
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

  const monthlyComparison: ReadingRecordMonthlyComparison = {
    currentPeriodSeconds,
    previousPeriodSeconds,
    currentPeriodBooks: currentBooks.size,
    previousPeriodBooks: previousBooks.size,
    currentPeriodDays: currentDays.size,
    previousPeriodDays: previousDays.size,
  }

  const totalWordsRead = await computeTotalWordsRead(userId, showHidden)
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
      hiddenIds.length > 0 ? notInArray(readingSessions.bookId, hiddenIds) : undefined,
    ))
    .groupBy(hour)
    .orderBy(hour)
    .all()
}

export async function getByBook(userId: string, range: { from?: string; to?: string }, showHidden = false): Promise<ReadingRecordBookItem[]> {
  const db = getDb()
  const totals = db.select({
    bookId: readingRecords.bookId,
    progress: sql<number>`coalesce(${bookStates.percent}, 0)`,
    readStatus: sql<ReadingRecordBookItem['readStatus']>`coalesce(${bookStates.readStatus}, 'reading')`,
    durationSeconds: sql<number>`sum(${readingRecords.durationSeconds})`,
    days: sql<number>`count(distinct ${readingRecords.date})`,
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
      return { ...row, title: 'Unavailable book', author: '', coverKey: null }
    }
  }))
}

export async function getBookRecords(userId: string, bookId: string, showHidden = false): Promise<ReadingRecordBookDetailRes> {
  await assertReadableBook(userId, bookId, showHidden)
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
    // Null only for retroactive no-time entries, which the session list never
    // includes; the mixed detail feed types startedAt as nullable.
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

export async function listSessions(userId: string, bookId: string, limit: number, offset: number, showHidden = false): Promise<ReadingSessionItem[]> {
  await assertReadableBook(userId, bookId, showHidden)
  const db = getDb()
  // Manual sessions only: auto-mode blocks are heuristic fragments without
  // exact bounds and are immutable — they never appear in the session list.
  // Retroactive entries without a start time surface in the mixed detail feed
  // instead of this session list.
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
export async function getBookDetail(userId: string, bookId: string, limit: number, offset: number, showHidden = false): Promise<ReadingDetailItem[]> {
  await assertReadableBook(userId, bookId, showHidden)
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
export async function getByTag(userId: string, range: { from?: string; to?: string }, showHidden = false): Promise<ReadingRecordTagItem[]> {
  const db = getDb()
  return db.select({
    tagId: libraryBookTags.tagId,
    name: libraryTags.name,
    durationSeconds: sql<number>`sum(${readingRecords.durationSeconds})`,
  }).from(readingRecords)
    .innerJoin(libraryBookVersions, eq(readingRecords.bookId, libraryBookVersions.bookVersionId))
    .innerJoin(libraryBookTags, eq(libraryBookTags.libraryBookId, libraryBookVersions.libraryBookId))
    .innerJoin(libraryTags, eq(libraryBookTags.tagId, libraryTags.id))
    .where(rangeConditions(userId, range, showHidden ? [] : hiddenBookVersionIds(db, userId)))
    .groupBy(libraryBookTags.tagId, libraryTags.name)
    .orderBy(desc(sql`sum(${readingRecords.durationSeconds})`))
    .all()
}
