import { createHash } from 'node:crypto'

import { and, desc, eq, lte, sql } from 'drizzle-orm'

import type { ReadingCoverageInterval, ReadingLedgerRes, ReadingRecordConflictDetails, ReadingRecordCreateReq, ReadingSessionUpdateReq, ReadingTimerClaim, ReadingTransfer, ReadingTransferPreview } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { bookStates, bookVersions, contentRevisions, readingArchives, readingRecords, readingRounds, readingSessions, readingTimerClaims, readingWriteReceipts } from '../../db/schema'
import { createId } from '../../lib/id'
import { mergeInterval, unionLength } from '../../lib/intervals'
import { AppError } from '../../middleware/error'
import { readProgressFile } from '../../lib/progress-file'
import { projectReadingCoverage, readingCompatibleRevisions, type ReadingCoverageBasis } from '../../lib/reading-coverage'
import { getBook } from '../books/books.service'
import { mergeTimeFragments, splitReadingTime } from './time-fragments'
import { excludedReadingBookVersionIds } from './reading-visibility'

type Db = ReturnType<typeof getDb>
type Session = typeof readingSessions.$inferSelect

function archiveWhere(userId: string, bookId: string) {
  return and(eq(readingArchives.userId, userId), eq(readingArchives.bookVersionId, bookId))
}
function sessionWhere(userId: string, bookId: string) {
  return and(eq(readingSessions.userId, userId), eq(readingSessions.bookId, bookId))
}
function roundWhere(userId: string, bookId: string) {
  return and(eq(readingRounds.userId, userId), eq(readingRounds.bookVersionId, bookId))
}
function normalizeCoverage(ranges: ReadingCoverageInterval[]): ReadingCoverageInterval[] {
  return ranges.reduce<ReadingCoverageInterval[]>((all, [a, b]) => mergeInterval(all, [Math.min(a, b), Math.max(a, b)]), [])
}
function ownArchive(tx: Db, userId: string, bookId: string) {
  const archive = tx.select().from(readingArchives).where(archiveWhere(userId, bookId)).get()
  if (!archive) throw new AppError('BOOK_NOT_FOUND')
  return archive
}

export async function ensureReadingArchive(userId: string, bookId: string, showHidden = false, includePendingDeletion = false) {
  const db = getDb()
  if (!includePendingDeletion && excludedReadingBookVersionIds(db, userId, showHidden).includes(bookId)) throw new AppError('BOOK_NOT_FOUND')
  const existing = db.select().from(readingArchives).where(archiveWhere(userId, bookId)).get()
  if (existing) return existing
  const book = await getBook(userId, bookId, { showHidden })
  await readProgressFile(userId, bookId)
  const state = db.select().from(bookStates).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()
  const now = Date.now()
  db.insert(readingArchives).values({
    userId, bookVersionId: bookId, title: book.title, author: book.author, format: book.format, coverKey: book.coverKey,
    legacyIntervals: state?.progressData?.intervals ?? [],
    legacyWordCount: typeof book.meta?.wordCount === 'number' ? book.meta.wordCount : null,
    legacyRevisionId: db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).get()?.id ?? null,
    legacyDaily: [], createdAt: now, updatedAt: now,
  }).onConflictDoNothing().run()
  return ownArchive(db, userId, bookId)
}

function activeRound(tx: Db, userId: string, bookId: string, at = Date.now()) {
  const rounds = tx.select().from(readingRounds).where(roundWhere(userId, bookId)).orderBy(desc(readingRounds.ordinal)).all()
  // Completed books stay in their existing round until explicit reread.
  if (rounds[0]) return rounds[0]
  const state = tx.select({ readStatus: bookStates.readStatus }).from(bookStates).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()
  const status: 'reading' | 'finished' | 'abandoned' = state?.readStatus === 'finished' || state?.readStatus === 'abandoned' ? state.readStatus : 'reading'
  const round = { id: createId('rrd'), userId, bookVersionId: bookId, ordinal: 1, status, startedAt: at, endedAt: status === 'reading' ? null : at }
  tx.insert(readingRounds).values(round).run()
  return round
}

function readingCoverageBasis(tx: Db, bookId: string, sessions: Session[], archive: typeof readingArchives.$inferSelect, sourceAvailable = true): ReadingCoverageBasis {
  const latest = sourceAvailable ? tx.select().from(contentRevisions).where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).get() : undefined
  if (latest) return {
    revisionId: latest.id, wordCount: latest.wordCount,
    compatibleRevisionIds: readingCompatibleRevisions(latest.meta, latest.id),
    equivalentRevisionIds: tx.select({ id: contentRevisions.id }).from(contentRevisions).where(and(eq(contentRevisions.bookVersionId, bookId), eq(contentRevisions.blobKey, latest.blobKey), eq(contentRevisions.wordCount, latest.wordCount ?? -1))).all().map((row) => row.id),
  }
  const recorded = [...sessions].sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt ?? 0) - (a.startedAt ?? 0)).find((entry) => entry.wordCount !== null)
  return { revisionId: recorded?.revisionId ?? archive.legacyRevisionId, wordCount: recorded?.wordCount ?? archive.legacyWordCount, compatibleRevisionIds: [] }
}

export function rebuildReadingProjection(tx: Db, userId: string, bookId: string) {
  const archive = ownArchive(tx, userId, bookId)
  const sessions = tx.select().from(readingSessions).where(sessionWhere(userId, bookId)).all()
  const days = new Map<string, number>()
  for (const item of archive.legacyDaily) days.set(item.date, (days.get(item.date) ?? 0) + item.durationSeconds)
  for (const session of sessions) {
    if (session.fragments.length && session.timezone) {
      for (const slice of splitReadingTime(session.fragments, session.timezone)) {
        days.set(slice.date, (days.get(slice.date) ?? 0) + slice.durationSeconds)
      }
    } else days.set(session.date, (days.get(session.date) ?? 0) + session.durationSeconds)
  }
  tx.delete(readingRecords).where(and(eq(readingRecords.userId, userId), eq(readingRecords.bookId, bookId))).run()
  for (const [date, durationSeconds] of days) {
    if (durationSeconds <= 0) continue
    tx.insert(readingRecords).values({ id: createId('rr'), userId, bookId, bookVersionId: bookId, date, durationSeconds }).run()
  }
  for (const round of tx.select().from(readingRounds).where(roundWhere(userId, bookId)).all()) {
    const starts = sessions.filter((row) => row.roundId === round.id).map((row) => row.source === 'retroactive' || row.source === 'legacy'
      ? Date.parse(`${row.date}T12:00:00Z`) : row.startedAt ?? Date.parse(`${row.date}T12:00:00Z`))
    if (round.ordinal === 1) starts.push(...archive.legacyDaily.map((row) => Date.parse(`${row.date}T12:00:00Z`)))
    if (starts.length) tx.update(readingRounds).set({ startedAt: starts.reduce((minimum, value) => Math.min(minimum, value), round.endedAt ?? Infinity) }).where(eq(readingRounds.id, round.id)).run()
  }
  const current = tx.select().from(readingRounds).where(roundWhere(userId, bookId)).orderBy(desc(readingRounds.ordinal)).get()
  const basis = readingCoverageBasis(tx, bookId, sessions, archive)
  const ranges = current ? sessions.filter((row) => row.roundId === current.id).flatMap((row) => projectReadingCoverage(row.coverage, row, basis).intervals) : []
  if (!current || current.ordinal === 1) ranges.push(...projectReadingCoverage(archive.legacyIntervals, { revisionId: archive.legacyRevisionId, wordCount: archive.legacyWordCount }, basis).intervals)
  const intervals = normalizeCoverage(ranges)
  const state = tx.select().from(bookStates).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()
  if (state) {
    tx.update(bookStates).set({
      readFraction: unionLength(intervals),
      ...(state.progressData ? { progressData: { ...state.progressData, intervals } } : {}),
    }).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).run()
  } else if (intervals.length && tx.select({ id: bookVersions.id }).from(bookVersions).where(eq(bookVersions.id, bookId)).get()) {
    tx.insert(bookStates).values({
      userId, bookVersionId: bookId, readStatus: 'reading', percent: 0,
      readFraction: unionLength(intervals), updatedAt: Date.now(),
      progressData: { percent: 0, fraction: null, intervals, updatedAt: Date.now() },
    }).run()
  }
  tx.update(readingArchives).set({ updatedAt: Date.now() }).where(archiveWhere(userId, bookId)).run()
}

function subtractRecordedTime(tx: Db, userId: string, fragments: Session['fragments']) {
  const prior = tx.select({ fragments: readingSessions.fragments }).from(readingSessions).where(eq(readingSessions.userId, userId)).all()
  const occupied = mergeTimeFragments(prior.flatMap((row) => row.fragments))
  let remaining = mergeTimeFragments(fragments)
  for (const block of occupied) {
    remaining = remaining.flatMap((part) => {
      if (block.endedAt <= part.startedAt || block.startedAt >= part.endedAt) return [part]
      return [
        ...(part.startedAt < block.startedAt ? [{ startedAt: part.startedAt, endedAt: block.startedAt }] : []),
        ...(part.endedAt > block.endedAt ? [{ startedAt: block.endedAt, endedAt: part.endedAt }] : []),
      ]
    })
  }
  return remaining
}

function replayReadingWrite(tx: Db, userId: string, body: ReadingRecordCreateReq, hash: string) {
  if (!body.requestId) return undefined
  const receipt = tx.select().from(readingWriteReceipts).where(and(
    eq(readingWriteReceipts.userId, userId), eq(readingWriteReceipts.requestId, body.requestId),
  )).get()
  if (!receipt) return undefined
  if (receipt.bodyHash !== hash || receipt.bookVersionId !== body.bookId) {
    throw new AppError('VALIDATION_ERROR', 'Reading request identity already has different content')
  }
  if (receipt.status === 'skipped') return { id: body.requestId, bookId: body.bookId, date: body.date, durationSeconds: 0, skipped: true as const }
  const session = receipt.sessionId && tx.select().from(readingSessions).where(and(
    eq(readingSessions.id, receipt.sessionId), eq(readingSessions.userId, userId), eq(readingSessions.bookId, body.bookId),
  )).get()
  if (receipt.status === 'deleted' || !session) return { id: body.requestId, bookId: body.bookId, date: body.date, durationSeconds: 0, skipped: true as const, deleted: true as const }
  return session
}

export async function addLedgerReading(userId: string, body: ReadingRecordCreateReq, showHidden = false) {
  const db = getDb()
  const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex')
  const prior = replayReadingWrite(db, userId, body, hash)
  if (prior) return prior
  await ensureReadingArchive(userId, body.bookId, showHidden)
  let book = db.select().from(contentRevisions).where(eq(contentRevisions.bookVersionId, body.bookId)).orderBy(desc(contentRevisions.revisionNo)).get()
  if (body.revisionId && book && body.revisionId !== book.id) {
    const knownRevision = db.select().from(contentRevisions).where(and(eq(contentRevisions.id, body.revisionId), eq(contentRevisions.bookVersionId, body.bookId))).get()
    if (!knownRevision && (!readingCompatibleRevisions(book.meta, book.id).includes(body.revisionId) || body.wordCount === undefined)) {
      throw new AppError('VALIDATION_ERROR', 'Unknown reading content revision')
    }
    book = knownRevision
  }
  return db.transaction((rawTx) => {
    const tx = rawTx as unknown as Db
    const replay = replayReadingWrite(tx, userId, body, hash)
    if (replay) return replay
    const source = body.source ?? 'legacy'
    const suppliedFragments = body.continuous && body.startedAt != null
      ? [{ startedAt: body.startedAt, endedAt: body.startedAt + body.durationSeconds * 1000 }]
      : body.fragments ?? []
    if (mergeTimeFragments(suppliedFragments).reduce((total, part) => total + part.endedAt - part.startedAt, 0) > 24 * 3600_000) {
      throw new AppError('VALIDATION_ERROR', 'A reading record cannot exceed 24 hours of effective time')
    }
    if (body.replaceSessionIds?.length) {
      if (source !== 'retroactive' || !suppliedFragments.length) throw new AppError('VALIDATION_ERROR', 'Only timed retroactive entries can replace overlapping records')
      const current = tx.select().from(readingRounds).where(roundWhere(userId, body.bookId)).orderBy(desc(readingRounds.ordinal)).get()
      for (const sessionId of new Set(body.replaceSessionIds)) {
        const replaced = tx.select().from(readingSessions).where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, sessionId), eq(readingSessions.bookId, body.bookId))).get()
        if (!replaced || replaced.roundId !== current?.id || !replaced.fragments.some((a) => suppliedFragments.some((b) => a.startedAt < b.endedAt && a.endedAt > b.startedAt))) {
          throw new AppError('VALIDATION_ERROR', 'Only overlapping records in the current round can be replaced')
        }
        tx.update(readingWriteReceipts).set({ status: 'deleted' }).where(and(eq(readingWriteReceipts.userId, userId), eq(readingWriteReceipts.sessionId, sessionId))).run()
        tx.delete(readingSessions).where(eq(readingSessions.id, sessionId)).run()
      }
    }
    const fragments = subtractRecordedTime(tx, userId, suppliedFragments)
    if (source === 'retroactive' && suppliedFragments.length && JSON.stringify(fragments) !== JSON.stringify(mergeTimeFragments(suppliedFragments))) {
      const conflicts = tx.select().from(readingSessions).where(eq(readingSessions.userId, userId)).all()
        .filter((row) => row.fragments.some((a) => suppliedFragments.some((b) => a.startedAt < b.endedAt && a.endedAt > b.startedAt)))
      const current = tx.select().from(readingRounds).where(roundWhere(userId, body.bookId)).orderBy(desc(readingRounds.ordinal)).get()
      const hasUnreplaceableConflicts = conflicts.some((row) => row.bookId !== body.bookId || row.roundId !== current?.id)
      throw new AppError('VALIDATION_ERROR', 'Reading interval overlaps existing records; adjust it or explicitly replace the conflicting records', {
        conflictingSessionIds: hasUnreplaceableConflicts ? [] : conflicts.map((row) => row.id),
        hasUnreplaceableConflicts,
      } satisfies ReadingRecordConflictDetails)
    }
    const knownSeconds = fragments.reduce((total, fragment) => total + (fragment.endedAt - fragment.startedAt) / 1000, 0)
    const durationSeconds = suppliedFragments.length ? knownSeconds : body.durationSeconds
    if (durationSeconds === 0 || (source === 'auto' && durationSeconds < 60)) {
      if (body.requestId) tx.insert(readingWriteReceipts).values({
        userId, requestId: body.requestId, bookVersionId: body.bookId, bodyHash: hash, sessionId: null, status: 'skipped',
      }).run()
      return { id: body.requestId ?? '', bookId: body.bookId, date: body.date, durationSeconds: 0, skipped: true as const }
    }
    const round = activeRound(tx, userId, body.bookId, body.startedAt ?? Date.now())
    if (round.status === 'reading') tx.update(bookStates).set({ readStatus: 'reading' }).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, body.bookId))).run()
    const coverage = durationSeconds > 0
      ? normalizeCoverage(body.coverage ?? (body.startFraction != null && body.endFraction != null ? [[body.startFraction, body.endFraction]] : []))
      : []
    const id = createId('rs')
    const retainedBasis = book ? null : readingCoverageBasis(tx, body.bookId,
      tx.select().from(readingSessions).where(sessionWhere(userId, body.bookId)).all(),
      ownArchive(tx, userId, body.bookId), false)
    tx.insert(readingSessions).values({
      id, userId, bookId: body.bookId, bookVersionId: body.bookId, roundId: round.id,
      source, requestId: body.requestId, bodyHash: hash, timezone: body.timezone ?? null,
      date: body.date, durationSeconds,
      startedAt: body.startedAt === undefined ? (source === 'retroactive' ? null : Date.now()) : body.startedAt,
      endedAt: body.endedAt ?? (source === 'retroactive' ? (body.continuous && body.startedAt != null ? body.startedAt + body.durationSeconds * 1000 : null) : source === 'auto' || source === 'legacy' ? null : Date.now()),
      startCfi: body.startCfi, endCfi: body.endCfi,
      startFraction: body.startFraction, endFraction: body.endFraction,
      startChapterIndex: body.startChapterIndex, endChapterIndex: body.endChapterIndex,
      fragments, coverage, revisionId: body.revisionId ?? book?.id ?? retainedBasis?.revisionId ?? null,
      wordCount: book?.wordCount ?? body.wordCount ?? (body.revisionId === undefined || body.revisionId === retainedBasis?.revisionId ? retainedBasis?.wordCount : null) ?? null,
    }).run()
    if (body.requestId) tx.insert(readingWriteReceipts).values({
      userId, requestId: body.requestId, bookVersionId: body.bookId, bodyHash: hash, sessionId: id, status: 'accepted',
    }).run()
    if (body.finished) {
      tx.update(readingRounds).set({ status: 'finished', endedAt: body.endedAt ?? Date.now() }).where(eq(readingRounds.id, round.id)).run()
      tx.update(bookStates).set({ readStatus: 'finished' }).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, body.bookId))).run()
    }
    rebuildReadingProjection(tx, userId, body.bookId)
    return tx.select().from(readingSessions).where(eq(readingSessions.id, id)).get()!
  })
}

export async function getReadingLedger(userId: string, bookId: string, showHidden = false, includePendingDeletion = false): Promise<ReadingLedgerRes> {
  const archive = await ensureReadingArchive(userId, bookId, showHidden, includePendingDeletion)
  const db = getDb()
  let sourceAvailable = false
  try { await getBook(userId, bookId, { showHidden }); sourceAvailable = true } catch (error) {
    if (!(error instanceof AppError) || !['BOOK_NOT_FOUND', 'FORBIDDEN', 'BOOK_FILE_MISSING'].includes(error.code)) throw error
  }
  const roundRows = db.select().from(readingRounds).where(roundWhere(userId, bookId)).orderBy(desc(readingRounds.ordinal)).all()
  const rows = db.select().from(readingSessions).where(sessionWhere(userId, bookId)).orderBy(desc(readingSessions.date), desc(readingSessions.startedAt), desc(readingSessions.id)).all()
  const basis = readingCoverageBasis(db, bookId, rows, archive, sourceAvailable)
  const projectedLegacy = projectReadingCoverage(archive.legacyIntervals, { revisionId: archive.legacyRevisionId, wordCount: archive.legacyWordCount }, basis)
  const projected = new Map(rows.map((row) => [row.id, projectReadingCoverage(row.coverage, row, basis)]))
  const rounds = roundRows.map((round) => {
    const entries = rows.filter((entry) => entry.roundId === round.id)
    const legacy = round.ordinal === 1 ? projectedLegacy.intervals : []
    const coverage = unionLength(normalizeCoverage([...legacy, ...entries.flatMap((entry) => projected.get(entry.id)!.intervals)]))
    return {
      id: round.id, ordinal: round.ordinal, status: round.status, startedAt: round.startedAt, endedAt: round.endedAt,
      coverage, totalSeconds: entries.reduce((sum, row) => sum + row.durationSeconds, 0) + (round.ordinal === 1 ? archive.legacyDaily.reduce((sum, row) => sum + row.durationSeconds, 0) : 0),
      wordCount: basis.wordCount,
      legacyCoverage: round.ordinal === 1 && archive.legacyIntervals.length > 0,
      unalignedCoverage: entries.some((entry) => projected.get(entry.id)!.unaligned) || (round.ordinal === 1 && projectedLegacy.unaligned),
      coverageEstimated: entries.some((entry) => !projected.get(entry.id)!.unaligned && JSON.stringify(projected.get(entry.id)!.intervals) !== JSON.stringify(normalizeCoverage(entry.coverage)))
        || (round.ordinal === 1 && !projectedLegacy.unaligned && JSON.stringify(projectedLegacy.intervals) !== JSON.stringify(normalizeCoverage(archive.legacyIntervals))),
    }
  })
  return {
    bookId, title: archive.title, author: archive.author, format: archive.format, coverKey: archive.coverKey, sourceAvailable,
    currentRoundId: rounds[0]?.id ?? null, legacyCoverage: archive.legacyIntervals.length > 0,
    rounds, coverage: rounds[0]?.coverage ?? unionLength(projectedLegacy.intervals),
    legacyRevisionId: archive.legacyRevisionId, projectedLegacyIntervals: projectedLegacy.intervals, unalignedCoverage: rounds.some((round) => round.unalignedCoverage) || projectedLegacy.unaligned,
    coverageEstimated: rounds.some((round) => round.coverageEstimated),
    legacyDaily: archive.legacyDaily, legacyIntervals: archive.legacyIntervals, legacyWordCount: archive.legacyWordCount,
    totalSeconds: rows.reduce((sum, row) => sum + row.durationSeconds, 0) + archive.legacyDaily.reduce((sum, row) => sum + row.durationSeconds, 0),
    sessions: rows.map((row) => {
      const positionBasis = projectReadingCoverage([[0, 1]], row, basis)
      return {
      id: row.id, roundId: row.roundId ?? '', source: row.source, date: row.date,
      startedAt: row.startedAt, endedAt: row.endedAt, durationSeconds: row.durationSeconds,
      startFraction: row.startFraction, endFraction: row.endFraction, wordCount: row.wordCount,
      progressScale: positionBasis.unaligned ? null : positionBasis.intervals[0]?.[1] ?? 1,
      startCfi: row.startCfi, endCfi: row.endCfi, startChapterIndex: row.startChapterIndex, endChapterIndex: row.endChapterIndex,
      revisionId: row.revisionId, coverage: row.coverage, projectedCoverage: projected.get(row.id)!.intervals, unalignedCoverage: projected.get(row.id)!.unaligned, fragments: row.fragments, timezone: row.timezone ?? '',
      }
    }),
  }
}

export async function changeReadingRound(userId: string, bookId: string, action: 'reread' | 'continue' | 'finish' | 'abandon', showHidden = false) {
  await ensureReadingArchive(userId, bookId, showHidden)
  const db = getDb()
  db.transaction((rawTx) => {
    const tx = rawTx as unknown as Db
    let round = activeRound(tx, userId, bookId)
    const now = Date.now()
    let status: 'reading' | 'finished' | 'abandoned' = 'reading'
    if (action === 'reread') {
      if (round.status === 'reading') tx.update(readingRounds).set({ status: 'abandoned', endedAt: now }).where(eq(readingRounds.id, round.id)).run()
      tx.insert(readingRounds).values({ id: createId('rrd'), userId, bookVersionId: bookId, ordinal: round.ordinal + 1, status: 'reading', startedAt: now }).run()
    } else {
      const undoReread = action === 'continue' && round.status === 'reading' && round.ordinal > 1 && !tx.select({ id: readingSessions.id }).from(readingSessions).where(eq(readingSessions.roundId, round.id)).get()
      if (undoReread) {
        tx.delete(readingRounds).where(eq(readingRounds.id, round.id)).run()
        round = activeRound(tx, userId, bookId)
      }
      status = undoReread ? round.status : action === 'finish' ? 'finished' : action === 'abandon' ? 'abandoned' : 'reading'
      if (!undoReread) tx.update(readingRounds).set({ status, endedAt: status === 'reading' ? null : now }).where(eq(readingRounds.id, round.id)).run()
    }
    tx.update(bookStates).set({ readStatus: status }).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).run()
    rebuildReadingProjection(tx, userId, bookId)
  })
  return getReadingLedger(userId, bookId, showHidden)
}

export function updateLedgerSession(userId: string, sessionId: string, body: ReadingSessionUpdateReq) {
  const db = getDb()
  return db.transaction((rawTx) => {
    const tx = rawTx as unknown as Db
    const existing = tx.select().from(readingSessions).where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, sessionId))).get()
    if (!existing) throw new AppError('SESSION_NOT_FOUND')
    if (existing.source === 'auto') throw new AppError('VALIDATION_ERROR', 'Delete and replace automatic reading records to correct them')
    const start = body.startedAt === undefined ? existing.startedAt : body.startedAt
    const end = body.endedAt ?? existing.endedAt
    if (start != null && end != null && end < start) throw new AppError('VALIDATION_ERROR', 'End time precedes start time')
    const startFraction = body.startFraction === undefined ? existing.startFraction : body.startFraction
    const endFraction = body.endFraction === undefined ? existing.endFraction : body.endFraction
    if (existing.source === 'retroactive' && ((startFraction === null) !== (endFraction === null)
      || (startFraction !== null && endFraction !== null && endFraction < startFraction))) {
      throw new AppError('VALIDATION_ERROR', 'Retroactive progress requires an ordered pair or no bounds')
    }
    const timingChanged = body.durationSeconds !== undefined || body.startedAt !== undefined || body.endedAt !== undefined || body.date !== undefined || body.continuous === false
    let fragments = timingChanged ? [] : existing.fragments
    if (body.continuous && start != null) {
      fragments = [{ startedAt: start, endedAt: start + (body.durationSeconds ?? existing.durationSeconds) * 1000 }]
      const others = tx.select().from(readingSessions).where(eq(readingSessions.userId, userId)).all().filter((row) => row.id !== sessionId)
      if (others.some((row) => row.fragments.some((part) => part.startedAt < fragments[0].endedAt && part.endedAt > fragments[0].startedAt))) {
        throw new AppError('VALIDATION_ERROR', 'Reading interval overlaps existing records')
      }
    }
    const { continuous: _continuous, ...changes } = body
    tx.update(readingSessions).set({
      ...changes,
      startedAt: start, endedAt: end, fragments,
      coverage: body.startFraction !== undefined || body.endFraction !== undefined
        ? normalizeCoverage(startFraction != null && endFraction != null ? [[startFraction, endFraction]] : []) : existing.coverage,
    } as Partial<typeof readingSessions.$inferInsert>).where(eq(readingSessions.id, sessionId)).run()
    rebuildReadingProjection(tx, userId, existing.bookId)
    return tx.select().from(readingSessions).where(eq(readingSessions.id, sessionId)).get()!
  })
}

export function deleteLedgerSession(userId: string, sessionId: string) {
  const db = getDb()
  db.transaction((rawTx) => {
    const tx = rawTx as unknown as Db
    const row = tx.select().from(readingSessions).where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, sessionId))).get()
    if (!row) throw new AppError('SESSION_NOT_FOUND')
    tx.update(readingWriteReceipts).set({ status: 'deleted' }).where(and(
      eq(readingWriteReceipts.userId, userId), eq(readingWriteReceipts.sessionId, sessionId),
    )).run()
    tx.delete(readingSessions).where(eq(readingSessions.id, sessionId)).run()
    rebuildReadingProjection(tx, userId, row.bookId)
  })
}

export function claimReadingTimer(userId: string, body: { deviceId: string; mode: 'auto' | 'manual'; activityAt: number; explicit?: boolean }): ReadingTimerClaim {
  const db = getDb()
  return db.transaction((tx) => {
    const now = Date.now()
    const prior = tx.select().from(readingTimerClaims).where(eq(readingTimerClaims.userId, userId)).get()
    const activityAt = Math.min(body.activityAt, now)
    const granted = !prior || prior.expiresAt <= now || (activityAt >= prior.activityAt && (
      (prior.deviceId === body.deviceId && !(prior.mode === 'manual' && body.mode === 'auto'))
      || (body.mode === 'manual' && body.explicit === true)
      || (prior.mode === 'auto' && body.mode === 'auto' && activityAt > prior.activityAt)
    ))
    if (!granted) return { granted: false, ownerDeviceId: prior!.deviceId, mode: prior!.mode, expiresAt: prior!.expiresAt }
    const row = { userId, deviceId: body.deviceId, mode: body.mode, activityAt, expiresAt: now + 30_000 }
    tx.insert(readingTimerClaims).values(row).onConflictDoUpdate({ target: readingTimerClaims.userId, set: row }).run()
    return { granted: true, ownerDeviceId: body.deviceId, mode: body.mode, expiresAt: row.expiresAt }
  })
}

export function releaseReadingTimer(userId: string, deviceId: string, activityAt?: number) {
  getDb().delete(readingTimerClaims).where(and(
    eq(readingTimerClaims.userId, userId), eq(readingTimerClaims.deviceId, deviceId),
    activityAt === undefined ? undefined : lte(readingTimerClaims.activityAt, activityAt),
  )).run()
}

export function deleteReadingArchive(userId: string, bookId: string) {
  const db = getDb()
  ownArchive(db, userId, bookId)
  db.transaction((tx) => {
    tx.update(readingWriteReceipts).set({ status: 'deleted' }).where(and(
      eq(readingWriteReceipts.userId, userId), eq(readingWriteReceipts.bookVersionId, bookId),
    )).run()
    tx.delete(readingSessions).where(sessionWhere(userId, bookId)).run()
    tx.delete(readingRecords).where(and(eq(readingRecords.userId, userId), eq(readingRecords.bookId, bookId))).run()
    tx.delete(readingRounds).where(roundWhere(userId, bookId)).run()
    const hasNotes = tx.get(sql`SELECT 1 FROM highlights WHERE user_id = ${userId} AND book_version_id = ${bookId} AND deleted_at IS NULL
      UNION ALL SELECT 1 FROM bookmarks WHERE user_id = ${userId} AND book_version_id = ${bookId} AND deleted_at IS NULL
      UNION ALL SELECT 1 FROM ideas WHERE user_id = ${userId} AND book_version_id = ${bookId} AND deleted_at IS NULL
      UNION ALL SELECT 1 FROM book_reviews WHERE user_id = ${userId} AND read_book_version_id = ${bookId} LIMIT 1`)
    if (hasNotes) {
      tx.update(readingArchives).set({ legacyIntervals: [], legacyDaily: [], legacyWordCount: null, legacyRevisionId: null })
        .where(archiveWhere(userId, bookId)).run()
    } else tx.delete(readingArchives).where(archiveWhere(userId, bookId)).run()
    const state = tx.select().from(bookStates).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()
    if (state) tx.update(bookStates).set({ readFraction: 0, ...(state.progressData ? { progressData: { ...state.progressData, intervals: [] } } : {}) })
      .where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).run()
  })
}

export async function exportReadingTransfer(userId: string, bookId?: string): Promise<ReadingTransfer> {
  const archives = getDb().select().from(readingArchives).where(bookId ? archiveWhere(userId, bookId) : eq(readingArchives.userId, userId)).all()
  const allArchiveIds = new Set(getDb().select({ id: readingArchives.bookVersionId }).from(readingArchives).where(eq(readingArchives.userId, userId)).all().map((row) => row.id))
  const detachedReceipts = getDb().select().from(readingWriteReceipts).where(eq(readingWriteReceipts.userId, userId)).all()
    .filter((row) => !allArchiveIds.has(row.bookVersionId) && (!bookId || row.bookVersionId === bookId))
    .map((row) => ({ bookId: row.bookVersionId, requestId: row.requestId, bodyHash: row.bodyHash, status: row.status === 'accepted' && row.sessionId === null ? 'deleted' as const : row.status, sessionId: row.sessionId }))
  return { version: 1, detachedReceipts, archives: await Promise.all(archives.map(async (archive) => {
    const ledger = await getReadingLedger(userId, archive.bookVersionId, true, true)
    return { bookId: archive.bookVersionId, title: archive.title, author: archive.author, legacyIntervals: archive.legacyIntervals, legacyDaily: archive.legacyDaily, legacyWordCount: archive.legacyWordCount, legacyRevisionId: archive.legacyRevisionId, rounds: ledger.rounds, sessions: ledger.sessions.map(({ progressScale: _progressScale, ...session }) => session),
      receipts: getDb().select({ requestId: readingWriteReceipts.requestId, bodyHash: readingWriteReceipts.bodyHash, sessionId: readingWriteReceipts.sessionId, status: readingWriteReceipts.status })
        .from(readingWriteReceipts).where(and(eq(readingWriteReceipts.userId, userId), eq(readingWriteReceipts.bookVersionId, archive.bookVersionId))).all().map((row) => ({ ...row, status: row.status === 'accepted' && row.sessionId === null ? 'deleted' as const : row.status })),
    }
  })) }
}

function importedId(userId: string, kind: string, id: string) {
  return `${kind}_${createHash('sha256').update(`${userId}:${id}`).digest('hex').slice(0, 30)}`
}

export function importReadingTransfer(userId: string, transfer: ReadingTransfer, preview: boolean): ReadingTransferPreview {
  const db = getDb()
  const result = { archives: transfer.archives.length, sessions: 0, duplicates: 0 }
  const archiveIds = new Set<string>()
  const roundIds = new Map<string, string>()
  const sessionIds = new Map<string, string>()
  const receiptIds = new Set<string>()
  const pendingTime: Session['fragments'] = []
  const existingSessions = db.select().from(readingSessions).where(eq(readingSessions.userId, userId)).all()
  const existingById = new Map(existingSessions.map((entry) => [entry.id, entry]))
  const existingRequests = new Set(existingSessions.map((entry) => entry.requestId))
  const existingRounds = db.select().from(readingRounds).where(eq(readingRounds.userId, userId)).all()
  const roundsById = new Map(existingRounds.map((entry) => [entry.id, entry]))
  const occupied = mergeTimeFragments(existingSessions.flatMap((entry) => entry.fragments))
  for (const archive of transfer.archives) {
    if (archiveIds.has(archive.bookId)) throw new AppError('VALIDATION_ERROR', 'Duplicate archive identity')
    archiveIds.add(archive.bookId)
    const incomingRounds = new Set(archive.rounds.map((round) => round.id))
    const ordinals = new Set(archive.rounds.map((round) => round.ordinal))
    const newestOrdinal = Math.max(0, ...archive.rounds.map((round) => round.ordinal))
    if (incomingRounds.size !== archive.rounds.length || ordinals.size !== archive.rounds.length
      || archive.rounds.filter((round) => round.status === 'reading').length > 1
      || archive.rounds.some((round) => round.status === 'reading' && round.ordinal !== newestOrdinal)) {
      throw new AppError('VALIDATION_ERROR', 'Invalid round identities')
    }
    const existingArchive = db.select().from(readingArchives).where(archiveWhere(userId, archive.bookId)).get()
    if (existingArchive && (JSON.stringify(existingArchive.legacyIntervals) !== JSON.stringify(archive.legacyIntervals)
      || JSON.stringify(existingArchive.legacyDaily) !== JSON.stringify(archive.legacyDaily ?? [])
      || existingArchive.legacyWordCount !== (archive.legacyWordCount ?? null)
      || existingArchive.legacyRevisionId !== (archive.legacyRevisionId ?? null))) {
      throw new AppError('VALIDATION_ERROR', 'Import conflicts with the existing historical baseline')
    }
    for (const round of archive.rounds) {
      if (roundIds.has(round.id) || (round.endedAt != null && round.endedAt < round.startedAt)
        || (round.status === 'reading' && round.endedAt !== null)) throw new AppError('VALIDATION_ERROR', 'Invalid round lifecycle')
      const candidates = [roundsById.get(round.id), roundsById.get(importedId(userId, 'rrd', round.id))].filter((entry) => entry !== undefined)
      if (candidates.length > 1 || candidates.some((entry) => entry.bookVersionId !== archive.bookId)) {
        throw new AppError('VALIDATION_ERROR', 'Imported round identity belongs to another archive')
      }
      const local = candidates[0]
      const localOrdinal = db.select().from(readingRounds).where(and(eq(readingRounds.userId, userId), eq(readingRounds.bookVersionId, archive.bookId), eq(readingRounds.ordinal, round.ordinal))).get()
      if (localOrdinal && localOrdinal.id !== local?.id) throw new AppError('VALIDATION_ERROR', 'Import conflicts with existing reading rounds')
      if (local && (local.ordinal !== round.ordinal || local.status !== round.status || local.startedAt !== round.startedAt || local.endedAt !== round.endedAt)) {
        throw new AppError('VALIDATION_ERROR', 'Imported round has changed facts')
      }
      // An imported ongoing round must not collide with an ongoing local round
      // omitted from the backup, including during the read-only preview.
      if (round.status === 'reading') {
        const active = db.select().from(readingRounds).where(and(roundWhere(userId, archive.bookId), eq(readingRounds.status, 'reading'))).get()
        if (active && active.id !== local?.id) throw new AppError('VALIDATION_ERROR', 'Import conflicts with the ongoing reading round')
      }
      roundIds.set(round.id, local?.id ?? importedId(userId, 'rrd', round.id))
    }
    for (const session of archive.sessions) {
      if (!incomingRounds.has(session.roundId) || sessionIds.has(session.id)) throw new AppError('VALIDATION_ERROR', 'Invalid session identity or round')
      const candidates = [existingById.get(session.id), existingById.get(importedId(userId, 'rs', session.id))].filter((entry) => entry !== undefined)
      if (candidates.length > 1) throw new AppError('VALIDATION_ERROR', 'Ambiguous imported record identity')
      const existing = candidates[0]
      const normalized = mergeTimeFragments(session.fragments)
      const effectiveSeconds = normalized.reduce((sum, part) => sum + (part.endedAt - part.startedAt) / 1000, 0)
      if ((session.startedAt != null && session.endedAt != null && session.endedAt < session.startedAt)
        || (session.fragments.length && (!session.timezone || Math.abs(effectiveSeconds - session.durationSeconds) > 0.001))) {
        throw new AppError('VALIDATION_ERROR', 'Imported effective time does not match its fragments')
      }
      if (existing) {
        const matches = existing.bookId === archive.bookId && existing.roundId === roundIds.get(session.roundId)
          && existing.source === session.source && existing.date === session.date
          && existing.startedAt === session.startedAt && existing.endedAt === session.endedAt && existing.durationSeconds === session.durationSeconds
          && existing.startFraction === session.startFraction && existing.endFraction === session.endFraction
          && existing.wordCount === session.wordCount && (existing.timezone ?? '') === session.timezone
          && existing.revisionId === (session.revisionId ?? null)
          && existing.startCfi === (session.startCfi ?? null) && existing.endCfi === (session.endCfi ?? null)
          && existing.startChapterIndex === (session.startChapterIndex ?? null) && existing.endChapterIndex === (session.endChapterIndex ?? null)
          && JSON.stringify(existing.coverage) === JSON.stringify(session.coverage) && JSON.stringify(existing.fragments) === JSON.stringify(session.fragments)
        if (!matches) throw new AppError('VALIDATION_ERROR', 'Imported record identity has different facts')
        result.duplicates++
      } else {
        if (existingRequests.has(importedId(userId, 'imp', session.id))) {
          throw new AppError('VALIDATION_ERROR', 'Imported record request identity conflicts with an existing record')
        }
        pendingTime.push(...normalized)
        result.sessions++
      }
      sessionIds.set(session.id, existing?.id ?? importedId(userId, 'rs', session.id))
    }
    const incomingSessionIds = new Set(archive.sessions.map((session) => session.id))
    for (const receipt of archive.receipts ?? []) {
      if (receiptIds.has(receipt.requestId) || (receipt.status === 'accepted'
        ? receipt.sessionId === null || !incomingSessionIds.has(receipt.sessionId)
        : receipt.sessionId !== null)) throw new AppError('VALIDATION_ERROR', 'Invalid reading write receipt')
      receiptIds.add(receipt.requestId)
      const local = db.select().from(readingWriteReceipts).where(and(eq(readingWriteReceipts.userId, userId), eq(readingWriteReceipts.requestId, receipt.requestId))).get()
      if (local && (local.bookVersionId !== archive.bookId || local.bodyHash !== receipt.bodyHash || (local.status === 'accepted' && local.sessionId === null ? 'deleted' : local.status) !== receipt.status
        || local.sessionId !== (receipt.sessionId === null ? null : sessionIds.get(receipt.sessionId)))) {
        throw new AppError('VALIDATION_ERROR', 'Imported write receipt has different facts')
      }
    }
  }
  const allTime = [...occupied, ...pendingTime].sort((a, b) => a.startedAt - b.startedAt)
  for (let index = 1; index < allTime.length; index++) {
    if (allTime[index].startedAt < allTime[index - 1].endedAt) throw new AppError('VALIDATION_ERROR', 'Imported reading time overlaps existing records')
  }
  for (const receipt of transfer.detachedReceipts ?? []) {
    if (receiptIds.has(receipt.requestId) || archiveIds.has(receipt.bookId) || receipt.status === 'accepted' || receipt.sessionId !== null) {
      throw new AppError('VALIDATION_ERROR', 'Invalid detached reading write receipt')
    }
    receiptIds.add(receipt.requestId)
    const local = db.select().from(readingWriteReceipts).where(and(eq(readingWriteReceipts.userId, userId), eq(readingWriteReceipts.requestId, receipt.requestId))).get()
    if (local && (local.bookVersionId !== receipt.bookId || local.bodyHash !== receipt.bodyHash || (local.status === 'accepted' && local.sessionId === null ? 'deleted' : local.status) !== receipt.status || local.sessionId !== null)) {
      throw new AppError('VALIDATION_ERROR', 'Imported write receipt has different facts')
    }
  }
  if (preview) return result
  db.transaction((rawTx) => {
    const tx = rawTx as unknown as Db
    for (const archive of transfer.archives) {
      tx.insert(readingArchives).values({ userId, bookVersionId: archive.bookId, title: archive.title, author: archive.author, legacyIntervals: archive.legacyIntervals, legacyDaily: archive.legacyDaily ?? [], legacyWordCount: archive.legacyWordCount ?? null, legacyRevisionId: archive.legacyRevisionId ?? null, createdAt: Date.now(), updatedAt: Date.now() }).onConflictDoNothing().run()
      for (const round of archive.rounds) {
        tx.insert(readingRounds).values({ id: roundIds.get(round.id)!, userId, bookVersionId: archive.bookId, ordinal: round.ordinal, status: round.status, startedAt: round.startedAt, endedAt: round.endedAt }).onConflictDoNothing().run()
      }
      for (const session of archive.sessions) {
        tx.insert(readingSessions).values({ ...session, id: sessionIds.get(session.id)!, roundId: roundIds.get(session.roundId)!, userId, bookId: archive.bookId, bookVersionId: archive.bookId, requestId: importedId(userId, 'imp', session.id) }).onConflictDoNothing().run()
      }
      for (const receipt of archive.receipts ?? []) {
        tx.insert(readingWriteReceipts).values({ ...receipt, userId, bookVersionId: archive.bookId, sessionId: receipt.sessionId === null ? null : sessionIds.get(receipt.sessionId)! }).onConflictDoNothing().run()
      }
      rebuildReadingProjection(tx, userId, archive.bookId)
    }
    for (const receipt of transfer.detachedReceipts ?? []) {
      tx.insert(readingWriteReceipts).values({ userId, requestId: receipt.requestId, bookVersionId: receipt.bookId, bodyHash: receipt.bodyHash, status: receipt.status, sessionId: null }).onConflictDoNothing().run()
    }
  })
  return result
}
