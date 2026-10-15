import { and, eq } from 'drizzle-orm'

import type { RateSample } from '@bookdock/shared'

import { getDb } from '../db/client'
import { bookStates } from '../db/schema'
import { isProgressMigrationCompleted } from '../modules/progress/progress-migration'
import { getStorage } from '../storage'
import { mergeInterval, unionLength, type FractionInterval } from './intervals'

export interface ProgressFileData {
  cfi?: string | null
  chapter?: string | null
  chapterIndex?: number | null
  percent: number
  fraction?: number | null
  intervals: FractionInterval[]
  /** Reading-speed samples; stored server-side, computed client-side. */
  rateSamples?: RateSample[]
  updatedAt: number
  [key: string]: unknown
}

export interface WriteProgressOptions {
  touchLastReadAt?: boolean
  readStatus?: 'wishlist' | 'reading' | 'idle' | 'finished' | 'abandoned'
}

/**
 * Legacy file path for backward-compatibility / migration / rollback artifacts.
 */
function progressKey(userId: string, bookId: string): string {
  return `progress/${userId}/${bookId}.json`
}

async function readLegacyKey(key: string): Promise<ProgressFileData | null> {
  try {
    const storage = getStorage()
    if (!(await storage.exists(key))) return null
    const stream = await storage.get(key)
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as ProgressFileData
  } catch {
    return null
  }
}

/**
 * SQLite is the authoritative storage for progress.
 * If progress_data is null in SQLite:
 * - If progress migration is completed, null means the book has no progress (zero file I/O).
 * - Otherwise, fall back to legacy storage once and backfill.
 */
export async function readProgressFile(userId: string, bookId: string): Promise<ProgressFileData | null> {
  const db = getDb()
  const row = db.select({
    progressData: bookStates.progressData,
  }).from(bookStates).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()

  if (row?.progressData) {
    return row.progressData
  }

  // If progress migration is complete, a missing/null progressData means NO progress.
  // Never touch or probe external storage.
  if (isProgressMigrationCompleted(db)) {
    return null
  }

  // Fallback to legacy file only when migration is not yet completed
  const legacy = await readLegacyKey(progressKey(userId, bookId))
  if (legacy) {
    const readFraction = unionLength(legacy.intervals ?? [])
    const now = legacy.updatedAt ?? Date.now()
    if (row) {
      db.update(bookStates).set({
        progressData: legacy,
        readFraction,
        updatedAt: now,
      }).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).run()
    } else {
      db.insert(bookStates).values({
        userId,
        bookVersionId: bookId,
        readStatus: 'reading',
        percent: legacy.percent ?? 0,
        cfi: legacy.cfi ?? null,
        chapter: legacy.chapter ?? null,
        progressData: legacy,
        readFraction,
        updatedAt: now,
      }).run()
    }
    return legacy
  }

  return null
}

export async function writeProgressFile(
  userId: string,
  bookId: string,
  data: ProgressFileData,
  options?: WriteProgressOptions,
): Promise<void> {
  const db = getDb()
  const readFraction = unionLength(data.intervals ?? [])
  const now = data.updatedAt ?? Date.now()
  const touch = options?.touchLastReadAt ?? false

  const existing = db.select({
    userId: bookStates.userId,
    percent: bookStates.percent,
    cfi: bookStates.cfi,
    chapter: bookStates.chapter,
  }).from(bookStates).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()

  if (existing) {
    db.update(bookStates).set({
      progressData: data,
      readFraction,
      percent: data.percent ?? existing.percent,
      cfi: data.cfi !== undefined ? data.cfi : existing.cfi,
      chapter: data.chapter !== undefined ? data.chapter : existing.chapter,
      ...(touch ? { lastReadAt: now } : {}),
      updatedAt: now,
    }).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).run()
  } else {
    db.insert(bookStates).values({
      userId,
      bookVersionId: bookId,
      readStatus: options?.readStatus ?? 'reading',
      percent: data.percent ?? 0,
      cfi: data.cfi ?? null,
      chapter: data.chapter ?? null,
      lastReadAt: touch ? now : null,
      progressData: data,
      readFraction,
      updatedAt: now,
    }).run()
  }
}

export async function deleteProgressFile(userId: string, bookId: string): Promise<void> {
  const db = getDb()
  db.delete(bookStates).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).run()

  try {
    const storage = getStorage()
    const key = progressKey(userId, bookId)
    if (await storage.exists(key)) await storage.delete(key)
  } catch {
    // Non-blocking
  }
}

/**
 * Synchronous transactional interval merge. Must be called inside a SQLite transaction lock
 * so concurrent writes serialize and never overwrite disjoint intervals.
 */
export function mergeProgressIntervalInTx(
  tx: ReturnType<typeof getDb>,
  userId: string,
  bookId: string,
  interval: FractionInterval,
): ProgressFileData {
  const [start, end] = interval[0] <= interval[1] ? interval : [interval[1], interval[0]]
  if (end <= start) {
    const row = tx.select({ progressData: bookStates.progressData }).from(bookStates)
      .where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()
    return row?.progressData ?? { percent: 0, intervals: [], updatedAt: Date.now() }
  }

  const row = tx.select({
    progressData: bookStates.progressData,
    percent: bookStates.percent,
    cfi: bookStates.cfi,
    chapter: bookStates.chapter,
    readStatus: bookStates.readStatus,
  }).from(bookStates).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()

  const existingData = row?.progressData
  const base = existingData?.intervals ?? []
  const intervals = mergeInterval(base, [start, end])
  const now = Date.now()
  const readFraction = unionLength(intervals)

  const payload: ProgressFileData = existingData
    ? { ...existingData, intervals, updatedAt: now }
    : {
        cfi: row?.cfi ?? null,
        chapter: row?.chapter ?? null,
        percent: row?.percent ?? 0,
        fraction: null,
        intervals,
        updatedAt: now,
      }

  if (row) {
    tx.update(bookStates).set({
      progressData: payload,
      readFraction,
      updatedAt: now,
    }).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).run()
  } else {
    tx.insert(bookStates).values({
      userId,
      bookVersionId: bookId,
      readStatus: 'reading',
      percent: 0,
      cfi: null,
      chapter: null,
      lastReadAt: null,
      progressData: payload,
      readFraction,
      updatedAt: now,
    }).run()
  }

  return payload
}

/**
 * Merge [start,end] into the read-interval union without touching the current
 * position. Used by retroactive manual entries - deliberately NOT the
 * PUT /progress path, which also moves cfi/percent/lastReadAt.
 * Atomic and serialized inside a synchronous SQLite transaction.
 */
export async function mergeProgressInterval(userId: string, bookId: string, interval: FractionInterval): Promise<void> {
  const db = getDb()
  if (!isProgressMigrationCompleted(db)) {
    await readProgressFile(userId, bookId)
  }

  db.transaction((tx) => {
    mergeProgressIntervalInTx(tx as unknown as ReturnType<typeof getDb>, userId, bookId, interval)
  })
}
