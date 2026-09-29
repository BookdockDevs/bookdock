import { eq, and } from 'drizzle-orm'
import { getDb } from '../../db/client'
import { bookStates, bookVersions } from '../../db/schema'
import { assertReadableBook } from '../books/books.service'
import { mergeInterval, unionLength, type FractionInterval } from '../../lib/intervals'
import { readProgressFile, writeProgressFile, type ProgressFileData } from '../../lib/progress-file'
import type { RateSample } from '@bookdock/shared'

const RATE_SAMPLE_MAX = 20

export async function getProgress(userId: string, bookId: string, showHidden = false) {
  // Readability is the shared gate, not a private-library lookup: a version read
  // in a library has no private row, and refusing it here made the reader treat
  // "no saved position" as a failure to load.
  await assertReadableBook(userId, bookId, showHidden)
  const data = await readProgressFile(userId, bookId)
  if (!data) return null
  // intervals stay server-side; clients get the precomputed union length
  const { intervals, ...rest } = data
  const readFraction = unionLength(intervals)
  return { id: `prog-${bookId}`, userId, bookId, ...rest, readFraction }
}

export async function upsertProgress(userId: string, bookId: string, data: { cfi?: string; chapter?: string; chapterIndex?: number; percent: number; fraction?: number; segmentStartFraction?: number; sample?: RateSample }, showHidden = false) {
  const db = getDb()
  // Reading needs no collection, and a position is the reader's own: design
  // invariant 14 files BookState by User x BookVersion, so a library read keeps
  // its place exactly like a collected one. The file is filed per user, which is
  // what makes that true for two people reading one version.
  await assertReadableBook(userId, bookId, showHidden)

  const now = Date.now()
  const existing = await readProgressFile(userId, bookId) as ProgressFileData | null

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
  const payload: ProgressFileData = {
    cfi: data.cfi ?? existing?.cfi ?? null,
    chapter: data.chapter ?? existing?.chapter ?? null,
    chapterIndex: data.chapterIndex ?? existing?.chapterIndex ?? null,
    percent: data.percent,
    fraction: data.fraction ?? existing?.fraction ?? null,
    intervals,
    rateSamples: rateSamples.length > 0 ? rateSamples : undefined,
    updatedAt: now,
  }
  await writeProgressFile(userId, bookId, payload)

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
