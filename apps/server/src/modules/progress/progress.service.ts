import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../../db/client'
import { bookStates, contentRevisions } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { assertReadableBook, getActiveBook } from '../books/books.service'
import { mergeInterval, unionLength } from '../../lib/intervals'
import { readProgressFile, type ProgressFileData } from '../../lib/progress-file'
import { isProgressMigrationCompleted } from './progress-migration'
import type { RateSample } from '@bookdock/shared'

const RATE_SAMPLE_MAX = 20

export async function getProgress(userId: string, bookId: string, showHidden = false) {
  // Readability is the shared gate, not a private-library lookup: a version read
  // in a library has no private row, and refusing it here made the reader treat
  // "no saved position" as a failure to load.
  const activeBook = await getActiveBook(userId, bookId, { showHidden })
  await assertReadableBook(userId, bookId, showHidden)
  const data = await readProgressFile(userId, bookId)
  if (!data) return null
  // intervals stay server-side; clients get the precomputed union length
  const { intervals, ...rest } = data
  const coverageAvailable = !data.coverageRevisionId || data.coverageRevisionId === activeBook.revisionId
  const state = getDb().select({ readRevisionId: bookStates.readRevisionId }).from(bookStates)
    .where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()
  const readFraction = coverageAvailable ? unionLength(intervals) : 0
  return {
    id: `prog-${bookId}`, userId, bookId, ...rest, readFraction,
    locationAvailable: !data.progressRevisionId || data.progressRevisionId === activeBook.revisionId,
    coverageAvailable,
    contentUpdateUnseen: Boolean(activeBook.revisionId && state?.readRevisionId !== activeBook.revisionId),
  }
}

export async function upsertProgress(userId: string, bookId: string, data: { revisionId?: string; cfi?: string; contentCfi?: string; chapter?: string; chapterIndex?: number; percent: number; fraction?: number; segmentStartFraction?: number; sample?: RateSample }, showHidden = false) {
  const db = getDb()
  // Reading needs no collection, and a position is the reader's own: design
  // invariant 14 files BookState by User x BookVersion, so a library read keeps
  // its place exactly like a collected one.
  const activeBook = await getActiveBook(userId, bookId, { showHidden })
  if (data.revisionId && data.revisionId !== activeBook.revisionId) {
    throw new AppError('VALIDATION_ERROR', 'Progress revision changed; reopen the book')
  }

  if (!isProgressMigrationCompleted(db)) {
    await readProgressFile(userId, bookId)
  }

  const now = Date.now()
  let payload!: ProgressFileData

  db.transaction((tx) => {
    const latestRevision = tx.select({ id: contentRevisions.id }).from(contentRevisions)
      .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).get()
    const expectedRevisionId = data.revisionId ?? activeBook.revisionId
    if (expectedRevisionId && latestRevision?.id !== expectedRevisionId) {
      throw new AppError('VALIDATION_ERROR', 'Progress revision changed; reopen the book')
    }
    const row = tx.select({
      progressData: bookStates.progressData,
      progressRevisionId: bookStates.progressRevisionId,
      coverageRevisionId: bookStates.coverageRevisionId,
      percent: bookStates.percent,
      cfi: bookStates.cfi,
      chapter: bookStates.chapter,
      readStatus: bookStates.readStatus,
    }).from(bookStates).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()

    const existing = row?.progressData as ProgressFileData | null

    let intervals = existing?.intervals ?? []
    const historicalCoverage = [...(existing?.historicalCoverage ?? [])]
    const priorCoverageRevisionId = existing?.coverageRevisionId
      ?? row?.coverageRevisionId
      ?? existing?.progressRevisionId
      ?? row?.progressRevisionId
      ?? activeBook.revisionId
      ?? null
    if (priorCoverageRevisionId !== (activeBook.revisionId ?? null) && intervals.length) {
      historicalCoverage.push({ revisionId: priorCoverageRevisionId, intervals, retainedAt: now })
      intervals = []
    }
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

    payload = {
      progressRevisionId: activeBook.revisionId ?? null,
      coverageRevisionId: activeBook.revisionId ?? null,
      cfi: data.cfi ?? existing?.cfi ?? null,
      contentCfi: data.contentCfi ?? (data.cfi === undefined ? existing?.contentCfi : null) ?? null,
      chapter: data.chapter ?? existing?.chapter ?? null,
      chapterIndex: data.chapterIndex ?? existing?.chapterIndex ?? null,
      percent: data.percent,
      fraction: data.fraction ?? existing?.fraction ?? null,
      intervals,
      ...(data.cfi === undefined && data.contentCfi === undefined && existing?.positionAnchor ? { positionAnchor: existing.positionAnchor } : {}),
      ...(historicalCoverage.length ? { historicalCoverage } : {}),
      ...(existing?.historicalPositions ? { historicalPositions: existing.historicalPositions } : {}),
      rateSamples: rateSamples.length > 0 ? rateSamples : undefined,
      updatedAt: now,
    }

    const readFraction = unionLength(intervals)

    if (row) {
      tx.update(bookStates).set({
        percent: data.percent,
        ...(data.cfi !== undefined ? { cfi: data.cfi } : {}),
        ...(data.chapter !== undefined ? { chapter: data.chapter } : {}),
        lastReadAt: now,
        progressData: payload,
        progressRevisionId: payload.progressRevisionId,
        coverageRevisionId: payload.coverageRevisionId,
        readFraction,
        updatedAt: now,
      }).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).run()
    } else {
      tx.insert(bookStates).values({
        userId,
        bookVersionId: bookId,
        readStatus: 'reading',
        percent: data.percent,
        cfi: data.cfi ?? null,
        chapter: data.chapter ?? null,
        lastReadAt: now,
        progressData: payload,
        progressRevisionId: payload.progressRevisionId,
        coverageRevisionId: payload.coverageRevisionId,
        readFraction,
        updatedAt: now,
      }).run()
    }
  })

  return { id: `prog-${bookId}`, userId, bookId, ...payload }
}
