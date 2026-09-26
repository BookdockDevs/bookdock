import { eq, and, isNull } from 'drizzle-orm'
import { getDb } from '../../db/client'
import { books, bookStates, bookVersions, libraries, libraryBooks, libraryBookVersions } from '../../db/schema'
import { getStorage } from '../../storage'
import { AppError } from '../../middleware/error'
import { mergeInterval, unionLength, type FractionInterval } from '../../lib/intervals'
import type { RateSample } from '@bookdock/shared'

function progressKey(bookId: string): string {
  return `progress/${bookId}.json`
}

interface ProgressData {
  cfi?: string | null
  chapter?: string | null
  chapterIndex?: number | null
  percent: number
  fraction?: number | null
  intervals: FractionInterval[]
  rateSamples?: RateSample[]
  updatedAt: number
}

const RATE_SAMPLE_MAX = 20

async function readProgressData(bookId: string): Promise<ProgressData | null> {
  const storage = getStorage()
  const key = progressKey(bookId)
  if (!(await storage.exists(key))) return null
  const stream = await storage.get(key)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as ProgressData
}

function assertBookReadable(userId: string, bookId: string) {
  const db = getDb()
  const book = db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (book) return
  // Version-native books have no legacy row: readability is the private library.
  const library = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  const version = library && db.select({ id: libraryBookVersions.id }).from(libraryBookVersions)
    .where(and(eq(libraryBookVersions.libraryId, library.id), eq(libraryBookVersions.bookVersionId, bookId))).get()
  if (!version) throw new AppError('BOOK_NOT_FOUND')
}

export async function getProgress(userId: string, bookId: string) {
  assertBookReadable(userId, bookId)
  const data = await readProgressData(bookId)
  if (!data) return null
  // intervals stay server-side; clients get the precomputed union length
  const { intervals, ...rest } = data
  const readFraction = unionLength(intervals)
  return { id: `prog-${bookId}`, userId, bookId, ...rest, readFraction }
}

export async function upsertProgress(userId: string, bookId: string, data: { cfi?: string; chapter?: string; chapterIndex?: number; percent: number; fraction?: number; segmentStartFraction?: number; sample?: RateSample }) {
  const db = getDb()
  const storage = getStorage()
  const legacy = db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (legacy) {
    const active = db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), isNull(books.deletedAt))).get()
    if (!active) throw new AppError('BOOK_NOT_FOUND')
  } else {
    // Version-native books have no legacy row: readability is the private
    // library, and trashed works stay out like their legacy counterparts.
    const library = db.select({ id: libraries.id }).from(libraries)
      .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
    const lbv = library && db.select({ libraryBookId: libraryBookVersions.libraryBookId }).from(libraryBookVersions)
      .where(and(eq(libraryBookVersions.libraryId, library.id), eq(libraryBookVersions.bookVersionId, bookId))).get()
    const work = lbv && db.select({ deletedAt: libraryBooks.deletedAt }).from(libraryBooks)
      .where(eq(libraryBooks.id, lbv.libraryBookId)).get()
    if (!work || work.deletedAt) throw new AppError('BOOK_NOT_FOUND')
  }

  const now = Date.now()
  const existing = await readProgressData(bookId)

  let intervals = existing?.intervals ?? [[0, data.fraction ?? data.percent / 100] as FractionInterval]
  if (data.fraction !== undefined && data.segmentStartFraction !== undefined) {
    let start = data.segmentStartFraction
    let end = data.fraction
    if (start > end) [start, end] = [end, start]
    if (end > start) intervals = mergeInterval(intervals, [start, end])
  }

  // Reading-speed samples: the client filters to continuous stretches, the
  // server only stores the sliding window (rate computation is client-side).
  const rateSamples = existing?.rateSamples ? [...existing.rateSamples] : []
  if (data.sample) {
    rateSamples.push(data.sample)
    if (rateSamples.length > RATE_SAMPLE_MAX) rateSamples.splice(0, rateSamples.length - RATE_SAMPLE_MAX)
  }

  // Write per-book progress file
  const payload: ProgressData = {
    cfi: data.cfi ?? existing?.cfi ?? null,
    chapter: data.chapter ?? existing?.chapter ?? null,
    chapterIndex: data.chapterIndex ?? existing?.chapterIndex ?? null,
    percent: data.percent,
    fraction: data.fraction ?? existing?.fraction ?? null,
    intervals,
    rateSamples: rateSamples.length > 0 ? rateSamples : undefined,
    updatedAt: now,
  }
  await storage.put(progressKey(bookId), Buffer.from(JSON.stringify(payload), 'utf-8'))

  // Mirror the position into the version state row for library sorting;
  // bumps lastReadAt, not the work updatedAt, so cover cache keys and
  // metadata-edit ordering stay stable. readStatus is deliberately untouched
  // — status changes are manual user actions only. Legacy-only rows (no
  // version yet) keep the file as their sole truth.
  const version = db.select({ id: bookVersions.id }).from(bookVersions).where(eq(bookVersions.id, bookId)).get()
  if (version) {
    const state = db.select({ userId: bookStates.userId }).from(bookStates)
      .where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()
    if (state) {
      db.update(bookStates).set({
        percent: data.percent,
        ...(data.cfi !== undefined ? { cfi: data.cfi } : {}),
        ...(data.chapter !== undefined ? { chapter: data.chapter } : {}),
        lastReadAt: now, updatedAt: now,
      }).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).run()
    } else {
      db.insert(bookStates).values({
        userId, bookVersionId: bookId, readStatus: 'reading', percent: data.percent,
        cfi: data.cfi ?? null, chapter: data.chapter ?? null, lastReadAt: now, updatedAt: now,
      }).run()
    }
  }

  return { id: `prog-${bookId}`, userId, bookId, ...payload }
}
