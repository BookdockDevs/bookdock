import { eq, and, isNull } from 'drizzle-orm'
import { getDb } from '../../db/client'
import { books } from '../../db/schema'
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
  percent: number
  fraction?: number | null
  intervals?: FractionInterval[]
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

export async function getProgress(userId: string, bookId: string) {
  const db = getDb()
  const book = db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  const data = await readProgressData(bookId)
  if (!data) return null
  // intervals stay server-side; clients get the precomputed union length
  const { intervals, ...rest } = data
  const readFraction = intervals ? unionLength(intervals) : undefined
  return { id: `prog-${bookId}`, userId, bookId, ...rest, readFraction }
}

export async function upsertProgress(userId: string, bookId: string, data: { cfi?: string; chapter?: string; percent: number; fraction?: number; segmentStartFraction?: number; sample?: RateSample }) {
  const db = getDb()
  const storage = getStorage()
  const book = db.select({ id: books.id }).from(books).where(and(eq(books.id, bookId), eq(books.userId, userId), isNull(books.deletedAt))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')

  const now = Date.now()
  const existing = await readProgressData(bookId)

  // Legacy files have no intervals: assume everything up to the current
  // position was read, then merge the reported segment on top.
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
    percent: data.percent,
    fraction: data.fraction ?? existing?.fraction ?? null,
    intervals,
    rateSamples: rateSamples.length > 0 ? rateSamples : undefined,
    updatedAt: now,
  }
  await storage.put(progressKey(bookId), Buffer.from(JSON.stringify(payload), 'utf-8'))

  // Update books table for library sorting; bumps lastReadAt, not updatedAt,
  // so cover cache keys and metadata-edit ordering stay stable. readStatus is
  // deliberately untouched — status changes are manual user actions only.
  db.update(books).set({ progress: data.percent, lastReadAt: now }).where(and(eq(books.id, bookId), eq(books.userId, userId))).run()

  return { id: `prog-${bookId}`, userId, bookId, ...payload }
}
