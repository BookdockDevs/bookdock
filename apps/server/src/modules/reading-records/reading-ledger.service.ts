import { createHash } from 'node:crypto'

import { and, desc, eq, inArray, lte, or, sql } from 'drizzle-orm'

import type { ReadingCoverageInterval, ReadingLedgerOverview, ReadingLedgerRes, ReadingLedgerSession, ReadingLedgerSessionPage, ReadingLedgerStatsRes, ReadingRecordConflictDetails, ReadingRecordCreateReq, ReadingSessionUpdateReq, ReadingTimerClaim, ReadingTransfer, ReadingTransferPreview, ReadingWordState } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { bookStates, bookVersions, contentRevisionMaps, contentRevisions, readingArchives, readingBookStats, readingContributions, readingHourlyStats, readingProjectionStates, readingRecords, readingRoundStats, readingRounds, readingSessions, readingTimerClaims, readingWriteReceipts } from '../../db/schema'
import { createId } from '../../lib/id'
import { mergeInterval, unionLength } from '../../lib/intervals'
import { AppError } from '../../middleware/error'
import { readProgressFile } from '../../lib/progress-file'
import { projectReadingCoverage, readingCompatibleRevisions, type ReadingCoverageBasis } from '../../lib/reading-coverage'
import { getBook } from '../books/books.service'
import { pendingBookDataDeletionVersionIds } from '../libraries/library-query'
import { mergeTimeFragments, splitReadingTime } from './time-fragments'
import { excludedReadingBookVersionIds } from './reading-visibility'

type Db = ReturnType<typeof getDb>
type Session = typeof readingSessions.$inferSelect
const READING_PROJECTION_ALGORITHM_VERSION = 1
export const READING_WORD_UNITS_SCALE = 1_000_000

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

type ContributionDraft = {
  id: string
  userId: string
  bookVersionId: string
  sessionId: string | null
  roundId: string | null
  contributionKey: string
  date: string
  hour: number | null
  durationSeconds: number
  wordUnits: number | null
  coverage: ReadingCoverageInterval[]
}

function wordState(values: Array<number | null>): ReadingWordState {
  const known = values.filter((value) => value !== null).length
  if (known === values.length) return 'known'
  if (known > 0) return 'partial'
  return 'unknown'
}

function addWordUnits(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null)
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null
}

function combineWordStates(states: ReadingWordState[]): ReadingWordState {
  if (states.length === 0 || states.every((state) => state === 'known')) return 'known'
  if (states.every((state) => state === 'unknown')) return 'unknown'
  return 'partial'
}

function sessionContributionDates(session: Pick<Session, 'date' | 'fragments' | 'timezone'>): string[] {
  const dates = session.fragments.length && session.timezone
    ? splitReadingTime(session.fragments, session.timezone).map((slice) => slice.date)
    : [session.date]
  return [...new Set(dates)].sort()
}

function sessionSortDate(session: Pick<Session, 'date' | 'fragments' | 'timezone'>): string {
  return sessionContributionDates(session).at(-1) ?? session.date
}

function buildProjectionContributions(
  userId: string,
  bookId: string,
  archive: typeof readingArchives.$inferSelect,
  rounds: Array<typeof readingRounds.$inferSelect>,
  sessions: Session[],
  basis: ReadingCoverageBasis,
): ContributionDraft[] {
  const contributions: ContributionDraft[] = []
  const firstRoundId = rounds.sort((a, b) => a.ordinal - b.ordinal)[0]?.id ?? null
  for (const legacy of archive.legacyDaily) {
    contributions.push({
      id: createId('rc'), userId, bookVersionId: bookId, sessionId: null, roundId: firstRoundId,
      contributionKey: `${bookId}:legacy:${legacy.date}`, date: legacy.date, hour: null,
      durationSeconds: Math.round(legacy.durationSeconds), wordUnits: null, coverage: [],
    })
  }
  for (const session of sessions) {
    const slices = session.fragments.length && session.timezone
      ? splitReadingTime(session.fragments, session.timezone)
      : [{ date: session.date, hour: null, durationSeconds: session.durationSeconds }]
    const totalSliceSeconds = slices.reduce((sum, slice) => sum + slice.durationSeconds, 0)
    const projected = projectReadingCoverage(session.coverage, session, basis)
    const totalWordUnits = session.wordCount === null
      ? null
      : Math.round(unionLength(session.coverage) * session.wordCount * READING_WORD_UNITS_SCALE)
    let allocatedSeconds = 0
    let allocatedWords = 0
    slices.forEach((slice, index) => {
      const durationSeconds = index === slices.length - 1
        ? Math.max(0, session.durationSeconds - allocatedSeconds)
        : Math.max(0, Math.round(slice.durationSeconds))
      allocatedSeconds += durationSeconds
      const wordUnits = totalWordUnits === null ? null : index === slices.length - 1
        ? totalWordUnits - allocatedWords
        : Math.round(totalWordUnits * (totalSliceSeconds > 0 ? slice.durationSeconds / totalSliceSeconds : 0))
      if (wordUnits !== null) allocatedWords += wordUnits
      contributions.push({
        id: createId('rc'), userId, bookVersionId: bookId, sessionId: session.id, roundId: session.roundId,
        contributionKey: `${bookId}:session:${session.id}:${slice.date}:${slice.hour ?? 'unknown'}`,
        date: slice.date, hour: slice.hour, durationSeconds, wordUnits, coverage: projected.intervals,
      })
    })
  }
  return contributions
}

function dailyProgressDelta(sessions: Session[], basis: ReadingCoverageBasis) {
  return sessions.reduce((sum, session) => {
    const mapped = projectReadingCoverage([[0, 1]], session, basis)
    const scale = mapped.unaligned ? 1 : mapped.intervals[0]?.[1] ?? 1
    return sum + session.coverage.reduce((length, [start, end]) => length + Math.abs(end - start), 0) * scale
  }, 0)
}

function rebuildReadingStatsProjection(
  tx: Db,
  userId: string,
  bookId: string,
  archive: typeof readingArchives.$inferSelect,
  rounds: Array<typeof readingRounds.$inferSelect>,
  sessions: Session[],
  basis: ReadingCoverageBasis,
  factVersion: number,
) {
  const contributions = buildProjectionContributions(userId, bookId, archive, rounds, sessions, basis)
  tx.delete(readingContributions).where(and(eq(readingContributions.userId, userId), eq(readingContributions.bookVersionId, bookId))).run()
  tx.delete(readingRecords).where(and(eq(readingRecords.userId, userId), eq(readingRecords.bookId, bookId))).run()
  tx.delete(readingHourlyStats).where(and(eq(readingHourlyStats.userId, userId), eq(readingHourlyStats.bookVersionId, bookId))).run()
  tx.delete(readingRoundStats).where(and(eq(readingRoundStats.userId, userId), eq(readingRoundStats.bookVersionId, bookId))).run()
  tx.delete(readingBookStats).where(and(eq(readingBookStats.userId, userId), eq(readingBookStats.bookVersionId, bookId))).run()
  for (const session of sessions) tx.update(readingSessions).set({ sortDate: sessionSortDate(session), sortStartedAt: session.startedAt ?? 0 }).where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, session.id))).run()
  for (const contribution of contributions) tx.insert(readingContributions).values(contribution).run()

  const daily = new Map<string, ContributionDraft[]>()
  const hourly = new Map<string, ContributionDraft[]>()
  for (const contribution of contributions) {
    daily.set(contribution.date, [...(daily.get(contribution.date) ?? []), contribution])
    if (contribution.hour !== null) {
      const key = `${contribution.date}:${contribution.hour}`
      hourly.set(key, [...(hourly.get(key) ?? []), contribution])
    }
  }
  for (const [date, rows] of daily) {
    const coverage = normalizeCoverage(rows.flatMap((row) => row.coverage))
    const words = rows.map((row) => row.wordUnits)
    tx.insert(readingRecords).values({
      id: createId('rr'), userId, bookId, bookVersionId: bookId, date, factVersion,
      durationSeconds: rows.reduce((sum, row) => sum + row.durationSeconds, 0),
      wordUnits: addWordUnits(words), wordState: wordState(words), coverage,
      progressDelta: dailyProgressDelta(sessions.filter((session) => session.date === date), basis),
    }).run()
  }
  for (const [key, rows] of hourly) {
    const [date, hour] = key.split(':')
    tx.insert(readingHourlyStats).values({
      userId, bookVersionId: bookId, date, hour: Number(hour), factVersion,
      durationSeconds: rows.reduce((sum, row) => sum + row.durationSeconds, 0),
      sessionCount: new Set(rows.map((row) => row.sessionId).filter((id): id is string => id !== null)).size,
    }).run()
  }

  for (const round of rounds) {
    const rows = contributions.filter((row) => row.roundId === round.id)
    const coverage = normalizeCoverage([
      ...rows.flatMap((row) => row.coverage),
      ...(round.ordinal === 1 ? projectReadingCoverage(archive.legacyIntervals, {
        revisionId: archive.legacyRevisionId, wordCount: archive.legacyWordCount,
      }, basis).intervals : []),
    ])
    const sessionRows = sessions.filter((row) => row.roundId === round.id)
    const words = sessionRows.map((row) => row.wordCount === null ? null : Math.round(unionLength(row.coverage) * row.wordCount * READING_WORD_UNITS_SCALE))
    if (round.ordinal === 1 && archive.legacyIntervals.length > 0) words.push(archive.legacyWordCount === null ? null : Math.round(unionLength(archive.legacyIntervals) * archive.legacyWordCount * READING_WORD_UNITS_SCALE))
    tx.insert(readingRoundStats).values({
      userId, roundId: round.id, bookVersionId: bookId, factVersion,
      totalSeconds: rows.reduce((sum, row) => sum + row.durationSeconds, 0), sessionCount: sessionRows.length,
      coverage, wordCount: basis.wordCount, wordState: wordState(words.length ? words : [null]),
    }).run()
  }

  const baselineWords = archive.legacyIntervals.length === 0 ? [] : [archive.legacyWordCount === null
    ? null : Math.round(unionLength(archive.legacyIntervals) * archive.legacyWordCount * READING_WORD_UNITS_SCALE)]
  const sessionWords = sessions.map((row) => row.wordCount === null ? null : Math.round(unionLength(row.coverage) * row.wordCount * READING_WORD_UNITS_SCALE))
  const allWords = [...baselineWords, ...sessionWords]
  const hasReadingFacts = archive.legacyDaily.length > 0 || archive.legacyIntervals.length > 0 || sessions.length > 0
  const totalWordUnits = hasReadingFacts ? addWordUnits(allWords) : 0
  const knownContributionCount = contributions.filter((row) => row.wordUnits !== null).length
  const unknownContributionCount = contributions.filter((row) => row.wordUnits === null).length
  const knownWordUnits = contributions.reduce((sum, row) => sum + (row.wordUnits ?? 0), 0)
  const knownDurationSeconds = contributions.reduce((sum, row) => sum + (row.wordUnits === null ? 0 : row.durationSeconds), 0)
  const coverage = normalizeCoverage([
    ...projectReadingCoverage(archive.legacyIntervals, { revisionId: archive.legacyRevisionId, wordCount: archive.legacyWordCount }, basis).intervals,
    ...sessions.flatMap((row) => projectReadingCoverage(row.coverage, row, basis).intervals),
  ])
  tx.insert(readingBookStats).values({
    userId, bookVersionId: bookId, factVersion, algorithmVersion: READING_PROJECTION_ALGORITHM_VERSION,
    contentRevisionId: basis.revisionId ?? null, contentWordCount: basis.wordCount ?? null,
    totalSeconds: contributions.reduce((sum, row) => sum + row.durationSeconds, 0), sessionCount: sessions.length,
    readingDays: [...daily.entries()].filter(([, rows]) => rows.some((row) => row.durationSeconds >= 60)).length,
    totalWordUnits, knownWordUnits, knownDurationSeconds, knownContributionCount, unknownContributionCount,
    wordState: hasReadingFacts ? wordState(allWords.length ? allWords : [null]) : 'known', coverage,
    earliestDate: [...daily.keys()].sort()[0] ?? null, updatedAt: Date.now(),
  }).run()
  tx.insert(readingProjectionStates).values({
    userId, bookVersionId: bookId, factVersion, algorithmVersion: READING_PROJECTION_ALGORITHM_VERSION,
    contentRevisionId: basis.revisionId ?? null, contentWordCount: basis.wordCount ?? null,
    status: 'ready', error: null, updatedAt: Date.now(),
  }).onConflictDoUpdate({ target: [readingProjectionStates.userId, readingProjectionStates.bookVersionId], set: {
    factVersion, algorithmVersion: READING_PROJECTION_ALGORITHM_VERSION,
    contentRevisionId: basis.revisionId ?? null, contentWordCount: basis.wordCount ?? null,
    status: 'ready', error: null, updatedAt: Date.now(),
  } }).run()
}

function projectionBasisForWrite(tx: Db, bookId: string, archive: typeof readingArchives.$inferSelect, changedSessions: Session[]): ReadingCoverageBasis {
  const latest = tx.select().from(contentRevisions).where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).get()
  if (latest) return {
    revisionId: latest.id, wordCount: latest.wordCount,
    compatibleRevisionIds: readingCompatibleRevisions(latest.meta, latest.id),
    equivalentRevisionIds: tx.select({ id: contentRevisions.id }).from(contentRevisions)
      .where(and(eq(contentRevisions.bookVersionId, bookId), eq(contentRevisions.blobKey, latest.blobKey), eq(contentRevisions.wordCount, latest.wordCount ?? -1))).all().map((row) => row.id),
  }
  const state = tx.select().from(readingProjectionStates).where(and(
    eq(readingProjectionStates.userId, archive.userId), eq(readingProjectionStates.bookVersionId, bookId),
  )).get()
  if (state) return { revisionId: state.contentRevisionId ?? archive.legacyRevisionId, wordCount: state.contentWordCount ?? archive.legacyWordCount, compatibleRevisionIds: [] }
  const recorded = [...changedSessions].sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt ?? 0) - (a.startedAt ?? 0)).find((entry) => entry.wordCount !== null)
  return { revisionId: recorded?.revisionId ?? archive.legacyRevisionId, wordCount: recorded?.wordCount ?? archive.legacyWordCount, compatibleRevisionIds: [] }
}

function refreshDailyProjection(tx: Db, userId: string, bookId: string, date: string, factVersion: number, basis: ReadingCoverageBasis) {
  const rows = tx.select().from(readingContributions).where(and(
    eq(readingContributions.userId, userId), eq(readingContributions.bookVersionId, bookId), eq(readingContributions.date, date),
  )).all()
  if (rows.length === 0) {
    tx.delete(readingRecords).where(and(eq(readingRecords.userId, userId), eq(readingRecords.bookId, bookId), eq(readingRecords.date, date))).run()
    return
  }
  const existing = tx.select({ id: readingRecords.id }).from(readingRecords).where(and(
    eq(readingRecords.userId, userId), eq(readingRecords.bookId, bookId), eq(readingRecords.date, date),
  )).get()
  const sessions = tx.select().from(readingSessions).where(and(sessionWhere(userId, bookId), eq(readingSessions.date, date))).all()
  const progressDelta = dailyProgressDelta(sessions, basis)
  tx.insert(readingRecords).values({
    id: existing?.id ?? createId('rr'), userId, bookId, bookVersionId: bookId, date, factVersion,
    progressDelta,
    durationSeconds: rows.reduce((sum, row) => sum + row.durationSeconds, 0),
    wordUnits: addWordUnits(rows.map((row) => row.wordUnits)), wordState: wordState(rows.map((row) => row.wordUnits)),
    coverage: normalizeCoverage(rows.flatMap((row) => row.coverage)),
  }).onConflictDoUpdate({ target: [readingRecords.userId, readingRecords.bookId, readingRecords.date], set: {
    progressDelta,
    factVersion, durationSeconds: rows.reduce((sum, row) => sum + row.durationSeconds, 0),
    wordUnits: addWordUnits(rows.map((row) => row.wordUnits)), wordState: wordState(rows.map((row) => row.wordUnits)),
    coverage: normalizeCoverage(rows.flatMap((row) => row.coverage)), bookVersionId: bookId,
  } }).run()
}

function refreshHourlyProjection(tx: Db, userId: string, bookId: string, date: string, factVersion: number) {
  tx.delete(readingHourlyStats).where(and(
    eq(readingHourlyStats.userId, userId), eq(readingHourlyStats.bookVersionId, bookId), eq(readingHourlyStats.date, date),
  )).run()
  const rows = tx.select().from(readingContributions).where(and(
    eq(readingContributions.userId, userId), eq(readingContributions.bookVersionId, bookId), eq(readingContributions.date, date),
  )).all().filter((row) => row.hour !== null)
  const hourly = new Map<number, typeof rows>()
  for (const row of rows) hourly.set(row.hour!, [...(hourly.get(row.hour!) ?? []), row])
  for (const [hour, items] of hourly) tx.insert(readingHourlyStats).values({
    userId, bookVersionId: bookId, date, hour, factVersion,
    durationSeconds: items.reduce((sum, row) => sum + row.durationSeconds, 0),
    sessionCount: new Set(items.map((row) => row.sessionId).filter((id): id is string => id !== null)).size,
  }).run()
}

function refreshRoundProjection(tx: Db, userId: string, bookId: string, roundId: string, archive: typeof readingArchives.$inferSelect, basis: ReadingCoverageBasis, factVersion: number) {
  const round = tx.select().from(readingRounds).where(and(eq(readingRounds.userId, userId), eq(readingRounds.id, roundId), eq(readingRounds.bookVersionId, bookId))).get()
  tx.delete(readingRoundStats).where(and(eq(readingRoundStats.userId, userId), eq(readingRoundStats.roundId, roundId))).run()
  if (!round) return
  const rows = tx.select().from(readingContributions).where(and(
    eq(readingContributions.userId, userId), eq(readingContributions.bookVersionId, bookId), eq(readingContributions.roundId, roundId),
  )).all()
  const legacy = round.ordinal === 1 ? projectReadingCoverage(archive.legacyIntervals, { revisionId: archive.legacyRevisionId, wordCount: archive.legacyWordCount }, basis).intervals : []
  const words = rows.map((row) => row.wordUnits)
  if (round.ordinal === 1 && archive.legacyIntervals.length > 0) words.push(archive.legacyWordCount === null ? null : Math.round(unionLength(archive.legacyIntervals) * archive.legacyWordCount * READING_WORD_UNITS_SCALE))
  tx.insert(readingRoundStats).values({
    userId, roundId, bookVersionId: bookId, factVersion,
    totalSeconds: rows.reduce((sum, row) => sum + row.durationSeconds, 0),
    sessionCount: new Set(rows.map((row) => row.sessionId).filter((id): id is string => id !== null)).size,
    coverage: normalizeCoverage([...legacy, ...rows.flatMap((row) => row.coverage)]), wordCount: basis.wordCount,
    wordState: wordState(words.length ? words : [null]),
  }).run()
}

function refreshBookProjection(tx: Db, userId: string, bookId: string, archive: typeof readingArchives.$inferSelect, basis: ReadingCoverageBasis, prior: typeof readingBookStats.$inferSelect | undefined, oldRows: ContributionDraft[], newRows: ContributionDraft[], factVersion: number, coverageChanged: boolean) {
  const existing = prior ?? {
    totalSeconds: 0, sessionCount: 0, totalWordUnits: archive.legacyIntervals.length === 0 ? 0 : archive.legacyWordCount === null ? null : Math.round(unionLength(archive.legacyIntervals) * archive.legacyWordCount * READING_WORD_UNITS_SCALE),
    knownWordUnits: 0, knownDurationSeconds: 0, knownContributionCount: 0, unknownContributionCount: archive.legacyDaily.length,
    readingDays: 0, earliestDate: null, coverage: [], wordState: archive.legacyIntervals.length && archive.legacyWordCount === null ? 'unknown' as const : 'known' as const,
  }
  const oldSessionIds = new Set(oldRows.map((row) => row.sessionId).filter((id): id is string => id !== null))
  const newSessionIds = new Set(newRows.map((row) => row.sessionId).filter((id): id is string => id !== null))
  const oldKnownWords = oldRows.reduce((sum, row) => sum + (row.wordUnits ?? 0), 0)
  const newKnownWords = newRows.reduce((sum, row) => sum + (row.wordUnits ?? 0), 0)
  const oldKnownSeconds = oldRows.reduce((sum, row) => sum + (row.wordUnits === null ? 0 : row.durationSeconds), 0)
  const newKnownSeconds = newRows.reduce((sum, row) => sum + (row.wordUnits === null ? 0 : row.durationSeconds), 0)
  const knownContributionCount = existing.knownContributionCount - oldRows.filter((row) => row.wordUnits !== null).length + newRows.filter((row) => row.wordUnits !== null).length
  const unknownContributionCount = existing.unknownContributionCount - oldRows.filter((row) => row.wordUnits === null).length + newRows.filter((row) => row.wordUnits === null).length
  const knownWordCount = Math.max(0, knownContributionCount)
  const unknownWordCount = Math.max(0, unknownContributionCount)
  const baselineStates: ReadingWordState[] = archive.legacyIntervals.length ? [archive.legacyWordCount === null ? 'unknown' : 'known'] : []
  const state = baselineStates.length || knownWordCount || unknownWordCount
    ? combineWordStates([...baselineStates, ...(knownWordCount ? ['known' as const] : []), ...(unknownWordCount ? ['unknown' as const] : [])])
    : 'known'
  const totalWordUnits = state === 'unknown' ? null : Math.max(0, (existing.totalWordUnits ?? 0) - oldKnownWords + newKnownWords)
  const coverageRows = coverageChanged ? tx.select().from(readingContributions).where(and(eq(readingContributions.userId, userId), eq(readingContributions.bookVersionId, bookId))).all() : []
  const coverage = coverageChanged
    ? normalizeCoverage([...projectReadingCoverage(archive.legacyIntervals, { revisionId: archive.legacyRevisionId, wordCount: archive.legacyWordCount }, basis).intervals, ...coverageRows.flatMap((row) => row.coverage)])
    : normalizeCoverage([...existing.coverage, ...newRows.flatMap((row) => row.coverage)])
  const sessionCount = existing.sessionCount - oldSessionIds.size + newSessionIds.size
  const readingDays = tx.select({ count: sql<number>`count(*)` }).from(readingRecords).where(and(
    eq(readingRecords.userId, userId), eq(readingRecords.bookId, bookId), sql`${readingRecords.durationSeconds} >= 60`,
  )).get()!.count
  const earliestDate = tx.select({ date: readingRecords.date }).from(readingRecords).where(and(eq(readingRecords.userId, userId), eq(readingRecords.bookId, bookId))).orderBy(readingRecords.date).get()?.date ?? null
  tx.update(readingRecords).set({ factVersion }).where(and(eq(readingRecords.userId, userId), eq(readingRecords.bookId, bookId))).run()
  tx.update(readingHourlyStats).set({ factVersion }).where(and(eq(readingHourlyStats.userId, userId), eq(readingHourlyStats.bookVersionId, bookId))).run()
  tx.update(readingRoundStats).set({ factVersion }).where(and(eq(readingRoundStats.userId, userId), eq(readingRoundStats.bookVersionId, bookId))).run()
  tx.insert(readingBookStats).values({
    userId, bookVersionId: bookId, factVersion, algorithmVersion: READING_PROJECTION_ALGORITHM_VERSION,
    contentRevisionId: basis.revisionId ?? null, contentWordCount: basis.wordCount ?? null,
    totalSeconds: existing.totalSeconds - oldRows.reduce((sum, row) => sum + row.durationSeconds, 0) + newRows.reduce((sum, row) => sum + row.durationSeconds, 0),
    sessionCount: Math.max(0, sessionCount), readingDays: Math.max(0, readingDays), totalWordUnits,
    knownWordUnits: Math.max(0, existing.knownWordUnits - oldKnownWords + newKnownWords),
    knownDurationSeconds: Math.max(0, existing.knownDurationSeconds - oldKnownSeconds + newKnownSeconds),
    knownContributionCount: knownWordCount, unknownContributionCount: unknownWordCount, wordState: state, coverage, earliestDate, updatedAt: Date.now(),
  }).onConflictDoUpdate({ target: [readingBookStats.userId, readingBookStats.bookVersionId], set: {
    factVersion, algorithmVersion: READING_PROJECTION_ALGORITHM_VERSION, contentRevisionId: basis.revisionId ?? null, contentWordCount: basis.wordCount ?? null,
    totalSeconds: existing.totalSeconds - oldRows.reduce((sum, row) => sum + row.durationSeconds, 0) + newRows.reduce((sum, row) => sum + row.durationSeconds, 0),
    sessionCount: Math.max(0, sessionCount), readingDays: Math.max(0, readingDays), totalWordUnits,
    knownWordUnits: Math.max(0, existing.knownWordUnits - oldKnownWords + newKnownWords),
    knownDurationSeconds: Math.max(0, existing.knownDurationSeconds - oldKnownSeconds + newKnownSeconds), knownContributionCount: knownWordCount, unknownContributionCount: unknownWordCount,
    wordState: state, coverage, earliestDate, updatedAt: Date.now(),
  } }).run()
}

function refreshBookStateCoverage(tx: Db, userId: string, bookId: string, archive: typeof readingArchives.$inferSelect, basis: ReadingCoverageBasis) {
  const current = tx.select().from(readingRounds).where(roundWhere(userId, bookId)).orderBy(desc(readingRounds.ordinal)).get()
  const ranges = current
    ? tx.select({ coverage: readingContributions.coverage }).from(readingContributions).where(and(
      eq(readingContributions.userId, userId), eq(readingContributions.bookVersionId, bookId), eq(readingContributions.roundId, current.id),
    )).all().flatMap((row) => row.coverage)
    : []
  if (!current || current.ordinal === 1) ranges.push(...projectReadingCoverage(
    archive.legacyIntervals,
    { revisionId: archive.legacyRevisionId, wordCount: archive.legacyWordCount },
    basis,
  ).intervals)
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
}

function refreshReadingProjectionIncrementally(tx: Db, userId: string, bookId: string, changedSessionIds: string[], changedRoundIds: string[] = [], deletedRows: ContributionDraft[] = [], changedDates: string[] = []) {
  const archive = ownArchive(tx, userId, bookId)
  const priorState = tx.select().from(readingProjectionStates).where(and(eq(readingProjectionStates.userId, userId), eq(readingProjectionStates.bookVersionId, bookId))).get()
  const priorStats = tx.select().from(readingBookStats).where(and(eq(readingBookStats.userId, userId), eq(readingBookStats.bookVersionId, bookId))).get()
  if (!priorState || !priorStats || priorState.status !== 'ready' || priorState.algorithmVersion !== READING_PROJECTION_ALGORITHM_VERSION || priorStats.algorithmVersion !== READING_PROJECTION_ALGORITHM_VERSION) {
    rebuildReadingProjection(tx, userId, bookId)
    return
  }
  const oldRows: ContributionDraft[] = []
  const affectedDates = new Set(changedDates)
  const affectedRounds = new Set(changedRoundIds)
  for (const sessionId of new Set(changedSessionIds)) {
    const existingRows = tx.select().from(readingContributions).where(and(eq(readingContributions.userId, userId), eq(readingContributions.bookVersionId, bookId), eq(readingContributions.sessionId, sessionId))).all()
    const priorRows = existingRows.length > 0 ? existingRows : deletedRows.filter((row) => row.sessionId === sessionId)
    oldRows.push(...priorRows)
    for (const row of priorRows) { affectedDates.add(row.date); if (row.roundId) affectedRounds.add(row.roundId) }
    tx.delete(readingContributions).where(and(eq(readingContributions.userId, userId), eq(readingContributions.bookVersionId, bookId), eq(readingContributions.sessionId, sessionId))).run()
  }
  const currentSessions = changedSessionIds.flatMap((sessionId) => {
    const row = tx.select().from(readingSessions).where(and(eq(readingSessions.userId, userId), eq(readingSessions.bookVersionId, bookId), eq(readingSessions.id, sessionId))).get()
    return row ? [row] : []
  })
  const basis = projectionBasisForWrite(tx, bookId, archive, currentSessions)
  const newRows = currentSessions.flatMap((session) => buildProjectionContributions(userId, bookId, archive, [], [session], basis).filter((row) => row.sessionId === session.id))
  for (const row of newRows) { tx.insert(readingContributions).values(row).run(); affectedDates.add(row.date); if (row.roundId) affectedRounds.add(row.roundId) }
  for (const session of currentSessions) affectedDates.add(session.date)
  for (const date of affectedDates) { refreshDailyProjection(tx, userId, bookId, date, priorState.factVersion + 1, basis); refreshHourlyProjection(tx, userId, bookId, date, priorState.factVersion + 1) }
  for (const roundId of affectedRounds) refreshRoundProjection(tx, userId, bookId, roundId, archive, basis, priorState.factVersion + 1)
  refreshBookProjection(tx, userId, bookId, archive, basis, priorStats, oldRows, newRows, priorState.factVersion + 1, oldRows.length > 0)
  refreshBookStateCoverage(tx, userId, bookId, archive, basis)
  for (const session of currentSessions) tx.update(readingSessions).set({ sortDate: sessionSortDate(session), sortStartedAt: session.startedAt ?? 0 }).where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, session.id))).run()
  tx.update(readingProjectionStates).set({ factVersion: priorState.factVersion + 1, algorithmVersion: READING_PROJECTION_ALGORITHM_VERSION, contentRevisionId: basis.revisionId ?? null, contentWordCount: basis.wordCount ?? null, status: 'ready', error: null, updatedAt: Date.now() }).where(and(eq(readingProjectionStates.userId, userId), eq(readingProjectionStates.bookVersionId, bookId))).run()
}

export async function ensureReadingArchive(userId: string, bookId: string, showHidden = false, includePendingDeletion = false) {
  const db = getDb()
  if (!includePendingDeletion && pendingBookDataDeletionVersionIds(db, userId).includes(bookId)) throw new AppError('BOOK_NOT_FOUND')
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
  if (latest) {
    const targetMaps = tx.select().from(contentRevisionMaps).where(and(
      eq(contentRevisionMaps.bookVersionId, bookId), eq(contentRevisionMaps.targetRevisionId, latest.id),
    )).all()
    const revisionMaps = Object.fromEntries(targetMaps
      .map((map) => [map.sourceRevisionId, {
        sourceSections: map.sourceSections,
        targetSections: map.targetSections,
        segments: map.segments,
        structuralRanges: map.structuralRanges,
      }]))
    return {
    revisionId: latest.id, wordCount: latest.wordCount,
    compatibleRevisionIds: readingCompatibleRevisions(latest.meta, latest.id),
    equivalentRevisionIds: tx.select({ id: contentRevisions.id }).from(contentRevisions).where(and(eq(contentRevisions.bookVersionId, bookId), eq(contentRevisions.blobKey, latest.blobKey), eq(contentRevisions.wordCount, latest.wordCount ?? -1))).all().map((row) => row.id),
      revisionMaps,
    }
  }
  const recorded = [...sessions].sort((a, b) => b.date.localeCompare(a.date) || (b.startedAt ?? 0) - (a.startedAt ?? 0)).find((entry) => entry.wordCount !== null)
  return { revisionId: recorded?.revisionId ?? archive.legacyRevisionId, wordCount: recorded?.wordCount ?? archive.legacyWordCount, compatibleRevisionIds: [] }
}

function preserveUnreconstructableDailyFacts(tx: Db, userId: string, bookId: string, archive: typeof readingArchives.$inferSelect, sessions: Session[]) {
  if (sessions.length > 0 || archive.legacyDaily.length > 0) return archive
  const rows = tx.select({ date: readingRecords.date, durationSeconds: readingRecords.durationSeconds })
    .from(readingRecords)
    .where(and(eq(readingRecords.userId, userId), eq(readingRecords.bookId, bookId)))
    .orderBy(readingRecords.date)
    .all()
  if (rows.length === 0) return archive
  const legacyDaily = rows.map((row) => ({ date: row.date, durationSeconds: row.durationSeconds }))
  tx.update(readingArchives).set({ legacyDaily, updatedAt: Date.now() }).where(archiveWhere(userId, bookId)).run()
  return { ...archive, legacyDaily }
}

export function rebuildReadingProjection(tx: Db, userId: string, bookId: string) {
  let archive = ownArchive(tx, userId, bookId)
  const sessions = tx.select().from(readingSessions).where(sessionWhere(userId, bookId)).all()
  archive = preserveUnreconstructableDailyFacts(tx, userId, bookId, archive, sessions)
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
  const priorProjection = tx.select({ factVersion: readingProjectionStates.factVersion }).from(readingProjectionStates)
    .where(and(eq(readingProjectionStates.userId, userId), eq(readingProjectionStates.bookVersionId, bookId))).get()
  rebuildReadingStatsProjection(tx, userId, bookId, archive,
    tx.select().from(readingRounds).where(roundWhere(userId, bookId)).all(), sessions, basis,
    (priorProjection?.factVersion ?? 0) + 1)
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
  await ensureBookProjection(userId, body.bookId, showHidden)
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
    const replacedContributions: ContributionDraft[] = []
    const replacedDates: string[] = []
    if (body.replaceSessionIds?.length) {
      if (source !== 'retroactive' || !suppliedFragments.length) throw new AppError('VALIDATION_ERROR', 'Only timed retroactive entries can replace overlapping records')
      const current = tx.select().from(readingRounds).where(roundWhere(userId, body.bookId)).orderBy(desc(readingRounds.ordinal)).get()
      for (const sessionId of new Set(body.replaceSessionIds)) {
        const replaced = tx.select().from(readingSessions).where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, sessionId), eq(readingSessions.bookId, body.bookId))).get()
        if (!replaced || replaced.roundId !== current?.id || !replaced.fragments.some((a) => suppliedFragments.some((b) => a.startedAt < b.endedAt && a.endedAt > b.startedAt))) {
          throw new AppError('VALIDATION_ERROR', 'Only overlapping records in the current round can be replaced')
        }
        replacedDates.push(replaced.date)
        replacedContributions.push(...tx.select().from(readingContributions).where(and(
          eq(readingContributions.userId, userId), eq(readingContributions.bookVersionId, body.bookId), eq(readingContributions.sessionId, sessionId),
        )).all())
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
      sortDate: sessionSortDate({ date: body.date, fragments, timezone: body.timezone ?? null }),
      sortStartedAt: body.startedAt ?? 0,
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
    refreshReadingProjectionIncrementally(tx, userId, body.bookId, [id, ...body.replaceSessionIds ?? []], [], replacedContributions, replacedDates)
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

async function ensureBookProjection(userId: string, bookId: string, showHidden: boolean, includePendingDeletion = false) {
  const archive = await ensureReadingArchive(userId, bookId, showHidden, includePendingDeletion)
  const db = getDb()
  let sourceAvailable = false
  try {
    await getBook(userId, bookId, { showHidden })
    sourceAvailable = true
  } catch (error) {
    if (!(error instanceof AppError) || !['BOOK_NOT_FOUND', 'FORBIDDEN', 'BOOK_FILE_MISSING'].includes(error.code)) throw error
  }
  const latest = sourceAvailable ? db.select({ id: contentRevisions.id }).from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).get() : undefined
  const state = db.select().from(readingProjectionStates).where(and(
    eq(readingProjectionStates.userId, userId), eq(readingProjectionStates.bookVersionId, bookId),
  )).get()
  const stats = db.select().from(readingBookStats).where(and(
    eq(readingBookStats.userId, userId), eq(readingBookStats.bookVersionId, bookId),
  )).get()
  if (!state || !stats || state.status !== 'ready' || state.algorithmVersion !== READING_PROJECTION_ALGORITHM_VERSION
    || stats.algorithmVersion !== READING_PROJECTION_ALGORITHM_VERSION || stats.factVersion !== state.factVersion
    || (latest && state.contentRevisionId !== latest.id)) {
    db.transaction((rawTx) => {
      const tx = rawTx as unknown as Db
      const currentState = tx.select().from(readingProjectionStates).where(and(
        eq(readingProjectionStates.userId, userId), eq(readingProjectionStates.bookVersionId, bookId),
      )).get()
      const currentStats = tx.select().from(readingBookStats).where(and(
        eq(readingBookStats.userId, userId), eq(readingBookStats.bookVersionId, bookId),
      )).get()
      const currentLatest = sourceAvailable ? tx.select().from(contentRevisions).where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).get() : undefined
      if (!currentState || !currentStats || currentState.status !== 'ready' || currentState.algorithmVersion !== READING_PROJECTION_ALGORITHM_VERSION
        || currentStats.algorithmVersion !== READING_PROJECTION_ALGORITHM_VERSION || currentStats.factVersion !== currentState.factVersion
        || (currentLatest && currentState.contentRevisionId !== currentLatest.id)) rebuildReadingProjection(tx, userId, bookId)
    })
  }
  const readyState = db.select().from(readingProjectionStates).where(and(
    eq(readingProjectionStates.userId, userId), eq(readingProjectionStates.bookVersionId, bookId),
  )).get()
  const readyStats = db.select().from(readingBookStats).where(and(
    eq(readingBookStats.userId, userId), eq(readingBookStats.bookVersionId, bookId),
  )).get()
  if (!readyState || !readyStats || readyState.status !== 'ready' || readyState.algorithmVersion !== READING_PROJECTION_ALGORITHM_VERSION
    || readyStats.algorithmVersion !== READING_PROJECTION_ALGORITHM_VERSION || readyStats.factVersion !== readyState.factVersion) {
    throw new AppError('READING_PROJECTION_UNAVAILABLE', 'Reading statistics are not currently available')
  }
  return { archive, sourceAvailable, state: readyState, stats: readyStats }
}

function sessionToLedger(row: Session, basis: ReadingCoverageBasis, contributionDates: string[] = []): ReadingLedgerSession {
  const projected = projectReadingCoverage(row.coverage, row, basis)
  const positionBasis = projectReadingCoverage([[0, 1]], row, basis)
  return {
    id: row.id, roundId: row.roundId ?? '', source: row.source, date: row.date,
    startedAt: row.startedAt, endedAt: row.endedAt, durationSeconds: row.durationSeconds,
    startFraction: row.startFraction, endFraction: row.endFraction, wordCount: row.wordCount,
    progressScale: positionBasis.unaligned ? null : positionBasis.intervals[0]?.[1] ?? 1,
    startCfi: row.startCfi, endCfi: row.endCfi, startChapterIndex: row.startChapterIndex, endChapterIndex: row.endChapterIndex,
    revisionId: row.revisionId, coverage: row.coverage, projectedCoverage: projected.intervals,
    unalignedCoverage: projected.unaligned, fragments: row.fragments, timezone: row.timezone ?? '', contributionDates,
  }
}

function encodeReadingCursor(date: string, sortStartedAt: number, id: string) {
  return Buffer.from(JSON.stringify({ date, sortStartedAt, id }), 'utf8').toString('base64url')
}

function decodeReadingCursor(cursor: string | undefined): { date: string; sortStartedAt: number; id: string } | null {
  if (!cursor) return null
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { date?: unknown; sortStartedAt?: unknown; startedAt?: unknown; id?: unknown }
    const sortStartedAt = value.sortStartedAt ?? value.startedAt
    if (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)
      || typeof sortStartedAt !== 'number' || !Number.isSafeInteger(sortStartedAt) || typeof value.id !== 'string') throw new Error('invalid')
    return { date: value.date, sortStartedAt, id: value.id }
  } catch {
    throw new AppError('VALIDATION_ERROR', 'Invalid reading session cursor')
  }
}

export async function getReadingLedgerOverview(userId: string, bookId: string, showHidden = false, includePendingDeletion = false): Promise<ReadingLedgerOverview> {
  const { archive, sourceAvailable, state, stats } = await ensureBookProjection(userId, bookId, showHidden, includePendingDeletion)
  const db = getDb()
  const basis = readingCoverageBasis(db, bookId, [], archive, sourceAvailable)
  const projectedLegacy = projectReadingCoverage(archive.legacyIntervals, { revisionId: archive.legacyRevisionId, wordCount: archive.legacyWordCount }, basis)
  const roundRows = db.select().from(readingRounds).where(roundWhere(userId, bookId)).orderBy(desc(readingRounds.ordinal)).all()
  const roundStats = db.select().from(readingRoundStats).where(and(
    eq(readingRoundStats.userId, userId), eq(readingRoundStats.bookVersionId, bookId), eq(readingRoundStats.factVersion, state.factVersion),
  )).all()
  const roundStatMap = new Map(roundStats.map((row) => [row.roundId, row]))
  const rounds = roundRows.map((round) => {
    const summary = roundStatMap.get(round.id)
    return {
      id: round.id, ordinal: round.ordinal, status: round.status, startedAt: round.startedAt, endedAt: round.endedAt,
      coverage: summary ? unionLength(summary.coverage) : 0, totalSeconds: summary?.totalSeconds ?? 0,
      wordCount: summary?.wordCount ?? state.contentWordCount, legacyCoverage: round.ordinal === 1 && archive.legacyIntervals.length > 0,
      unalignedCoverage: round.ordinal === 1 && projectedLegacy.unaligned,
      coverageEstimated: round.ordinal === 1 && !projectedLegacy.unaligned && JSON.stringify(projectedLegacy.intervals) !== JSON.stringify(normalizeCoverage(archive.legacyIntervals)),
    }
  })
  return {
    bookId, title: archive.title, author: archive.author, format: archive.format, coverKey: archive.coverKey, sourceAvailable,
    currentRoundId: rounds[0]?.id ?? null, legacyCoverage: archive.legacyIntervals.length > 0, rounds,
    coverage: unionLength(stats.coverage), coverageIntervals: stats.coverage, totalSeconds: stats.totalSeconds,
    totalWordsRead: stats.totalWordUnits === null ? null : Math.round(stats.totalWordUnits / READING_WORD_UNITS_SCALE), wordState: stats.wordState,
    readingDays: stats.readingDays, earliestDate: stats.earliestDate, legacyIntervals: archive.legacyIntervals,
    legacyWordCount: archive.legacyWordCount, legacyRevisionId: archive.legacyRevisionId, projectedLegacyIntervals: projectedLegacy.intervals,
    unalignedCoverage: projectedLegacy.unaligned, coverageEstimated: rounds.some((round) => round.coverageEstimated), dataVersion: state.factVersion,
  }
}

export async function getReadingLedgerStats(userId: string, bookId: string, range: { from?: string; to?: string } = {}, showHidden = false): Promise<ReadingLedgerStatsRes> {
  const { archive, sourceAvailable, state, stats } = await ensureBookProjection(userId, bookId, showHidden)
  const db = getDb()
  const dailyRows = db.select().from(readingRecords).where(and(
    eq(readingRecords.userId, userId), eq(readingRecords.bookId, bookId), eq(readingRecords.factVersion, state.factVersion),
    range.from ? sql`${readingRecords.date} >= ${range.from}` : undefined,
    range.to ? sql`${readingRecords.date} <= ${range.to}` : undefined,
  )).orderBy(readingRecords.date).all()
  const cumulativeRows = db.select().from(readingRecords).where(and(
    eq(readingRecords.userId, userId), eq(readingRecords.bookId, bookId), eq(readingRecords.factVersion, state.factVersion),
    range.to ? sql`${readingRecords.date} <= ${range.to}` : undefined,
  )).orderBy(readingRecords.date).all()
  const hourlyRows = db.select().from(readingHourlyStats).where(and(
    eq(readingHourlyStats.userId, userId), eq(readingHourlyStats.bookVersionId, bookId), eq(readingHourlyStats.factVersion, state.factVersion),
    range.from ? sql`${readingHourlyStats.date} >= ${range.from}` : undefined,
    range.to ? sql`${readingHourlyStats.date} <= ${range.to}` : undefined,
  )).all()
  const basis = readingCoverageBasis(db, bookId, [], archive, sourceAvailable)
  let cumulative = normalizeCoverage(projectReadingCoverage(archive.legacyIntervals, { revisionId: archive.legacyRevisionId, wordCount: archive.legacyWordCount }, basis).intervals)
  const cumulativeByDate = new Map<string, number>()
  for (const row of cumulativeRows) {
    cumulative = normalizeCoverage([...cumulative, ...row.coverage])
    cumulativeByDate.set(row.date, unionLength(cumulative))
  }
  const daily = dailyRows.map((row) => {
    return {
      date: row.date, durationSeconds: row.durationSeconds,
      totalWordsRead: row.wordUnits === null ? null : Math.round(row.wordUnits / READING_WORD_UNITS_SCALE), wordState: row.wordState,
      cumulativeCoverage: cumulativeByDate.get(row.date) ?? unionLength(cumulative),
      progressDelta: row.progressDelta,
    }
  })
  const hourlyMap = new Map<number, { durationSeconds: number; dates: Set<string> }>()
  for (const row of hourlyRows) {
    const item = hourlyMap.get(row.hour) ?? { durationSeconds: 0, dates: new Set<string>() }
    item.durationSeconds += row.durationSeconds
    item.dates.add(row.date)
    hourlyMap.set(row.hour, item)
  }
  const contentWords = state.contentWordCount ?? archive.legacyWordCount
  const knownWords = stats.knownWordUnits / READING_WORD_UNITS_SCALE
  const remainingSeconds = !range.from && !range.to && contentWords !== null && contentWords !== undefined && knownWords > 0
    ? Math.max(0, (1 - unionLength(stats.coverage)) * contentWords) * stats.knownDurationSeconds / knownWords
    : null
  const bounded = Boolean(range.from || range.to)
  const rangeWordUnits = addWordUnits(dailyRows.map((row) => row.wordUnits))
  const rangeWordState = combineWordStates(dailyRows.map((row) => row.wordState))
  const totalWordUnits = bounded ? rangeWordUnits : stats.totalWordUnits
  const totalWordState = bounded ? rangeWordState : stats.wordState
  const hasFacts = bounded ? dailyRows.length > 0 : stats.totalSeconds > 0 || stats.sessionCount > 0 || archive.legacyIntervals.length > 0 || archive.legacyDaily.length > 0
  return {
    dataVersion: state.factVersion, from: range.from, to: range.to,
    totalSeconds: dailyRows.reduce((sum, row) => sum + row.durationSeconds, 0),
    totalWordsRead: hasFacts && totalWordUnits !== null ? Math.round(totalWordUnits / READING_WORD_UNITS_SCALE) : hasFacts ? null : 0,
    wordState: hasFacts ? totalWordState : 'known',
    readingDays: dailyRows.filter((row) => row.durationSeconds >= 60).length, daily,
    hourly: [...hourlyMap.entries()].sort(([a], [b]) => a - b).map(([hour, item]) => ({ hour, durationSeconds: item.durationSeconds, days: item.dates.size })),
    legacyDaily: archive.legacyDaily.filter((row) => (!range.from || row.date >= range.from) && (!range.to || row.date <= range.to)),
    remainingSeconds,
  }
}

export async function getReadingLedgerSessions(userId: string, bookId: string, options: { from?: string; to?: string; cursor?: string; limit?: number } = {}, showHidden = false): Promise<ReadingLedgerSessionPage> {
  const { archive, sourceAvailable, state } = await ensureBookProjection(userId, bookId, showHidden)
  const db = getDb()
  const cursor = decodeReadingCursor(options.cursor)
  const rows = db.select().from(readingSessions).where(and(
    sessionWhere(userId, bookId),
    options.from || options.to ? sql`${readingSessions.id} IN (SELECT c.session_id FROM reading_contributions c WHERE c.user_id = ${userId} AND c.book_version_id = ${bookId}${options.from ? sql` AND c.date >= ${options.from}` : sql``}${options.to ? sql` AND c.date <= ${options.to}` : sql``})` : undefined,
    cursor ? or(sql`${readingSessions.sortDate} < ${cursor.date}`, and(sql`${readingSessions.sortDate} = ${cursor.date}`, sql`${readingSessions.sortStartedAt} < ${cursor.sortStartedAt}`), and(sql`${readingSessions.sortDate} = ${cursor.date}`, sql`${readingSessions.sortStartedAt} = ${cursor.sortStartedAt}`, sql`${readingSessions.id} < ${cursor.id}`)) : undefined,
  )).orderBy(desc(readingSessions.sortDate), desc(readingSessions.sortStartedAt), desc(readingSessions.id)).limit((options.limit ?? 50) + 1).all()
  const hasMore = rows.length > (options.limit ?? 50)
  const pageRows = hasMore ? rows.slice(0, options.limit ?? 50) : rows
  const ids = pageRows.map((row) => row.id)
  const contributionRows = ids.length ? db.select({ sessionId: readingContributions.sessionId, date: readingContributions.date }).from(readingContributions).where(and(
    eq(readingContributions.userId, userId), inArray(readingContributions.sessionId, ids),
  )).all() : []
  const dates = new Map<string, string[]>()
  for (const row of contributionRows) if (row.sessionId) dates.set(row.sessionId, [...new Set([...(dates.get(row.sessionId) ?? []), row.date])].sort())
  const basis = readingCoverageBasis(db, bookId, [], archive, sourceAvailable)
  const items = pageRows.map((row) => sessionToLedger(row, basis, dates.get(row.id) ?? [row.date]))
  const last = pageRows.at(-1)
  const nextCursor = hasMore && last ? encodeReadingCursor(last.sortDate, last.sortStartedAt, last.id) : null
  return { dataVersion: state.factVersion, items, nextCursor, hasMore }
}

export function rebuildAllReadingProjections(userId?: string) {
  const db = getDb()
  const archives = db.select().from(readingArchives).where(userId ? eq(readingArchives.userId, userId) : undefined).all()
  for (const archive of archives) db.transaction((rawTx) => rebuildReadingProjection(rawTx as unknown as Db, archive.userId, archive.bookVersionId))
}

export async function ensureReadingProjections(userId: string, showHidden = false) {
  const db = getDb()
  const excluded = new Set(excludedReadingBookVersionIds(db, userId, showHidden))
  const archives = db.select().from(readingArchives).where(eq(readingArchives.userId, userId)).all()
  for (const archive of archives) {
    if (excluded.has(archive.bookVersionId)) continue
    await ensureBookProjection(userId, archive.bookVersionId, showHidden)
  }
}

export async function changeReadingRound(userId: string, bookId: string, action: 'reread' | 'continue' | 'finish' | 'abandon', showHidden = false) {
  await ensureReadingArchive(userId, bookId, showHidden)
  const db = getDb()
  db.transaction((rawTx) => {
    const tx = rawTx as unknown as Db
    let round = activeRound(tx, userId, bookId)
    const changedRoundIds = new Set<string>([round.id])
    const now = Date.now()
    let status: 'reading' | 'finished' | 'abandoned' = 'reading'
    if (action === 'reread') {
      if (round.status === 'reading') tx.update(readingRounds).set({ status: 'abandoned', endedAt: now }).where(eq(readingRounds.id, round.id)).run()
      const reread = { id: createId('rrd'), userId, bookVersionId: bookId, ordinal: round.ordinal + 1, status: 'reading' as const, startedAt: now, endedAt: null }
      tx.insert(readingRounds).values(reread).run()
      changedRoundIds.add(reread.id)
    } else {
      const undoReread = action === 'continue' && round.status === 'reading' && round.ordinal > 1 && !tx.select({ id: readingSessions.id }).from(readingSessions).where(eq(readingSessions.roundId, round.id)).get()
      if (undoReread) {
        tx.delete(readingRounds).where(eq(readingRounds.id, round.id)).run()
        round = activeRound(tx, userId, bookId)
        changedRoundIds.add(round.id)
      }
      status = undoReread ? round.status : action === 'finish' ? 'finished' : action === 'abandon' ? 'abandoned' : 'reading'
      if (!undoReread) tx.update(readingRounds).set({ status, endedAt: status === 'reading' ? null : now }).where(eq(readingRounds.id, round.id)).run()
    }
    tx.update(bookStates).set({ readStatus: status }).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).run()
    refreshReadingProjectionIncrementally(tx, userId, bookId, [], [...changedRoundIds])
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
    const nextDate = body.date ?? existing.date
    const nextTimezone = body.timezone === undefined ? existing.timezone : body.timezone
    tx.update(readingSessions).set({
      ...changes,
      startedAt: start, endedAt: end, fragments,
      date: nextDate, timezone: nextTimezone,
      sortDate: sessionSortDate({ date: nextDate, fragments, timezone: nextTimezone }), sortStartedAt: start ?? 0,
      coverage: body.startFraction !== undefined || body.endFraction !== undefined
        ? normalizeCoverage(startFraction != null && endFraction != null ? [[startFraction, endFraction]] : []) : existing.coverage,
    } as Partial<typeof readingSessions.$inferInsert>).where(eq(readingSessions.id, sessionId)).run()
    refreshReadingProjectionIncrementally(tx, userId, existing.bookId, [sessionId], [], [], [existing.date])
    return tx.select().from(readingSessions).where(eq(readingSessions.id, sessionId)).get()!
  })
}

export function deleteLedgerSession(userId: string, sessionId: string) {
  const db = getDb()
  db.transaction((rawTx) => {
    const tx = rawTx as unknown as Db
    const row = tx.select().from(readingSessions).where(and(eq(readingSessions.userId, userId), eq(readingSessions.id, sessionId))).get()
    if (!row) throw new AppError('SESSION_NOT_FOUND')
    const deletedRows = tx.select().from(readingContributions).where(and(
      eq(readingContributions.userId, userId), eq(readingContributions.bookVersionId, row.bookId), eq(readingContributions.sessionId, sessionId),
    )).all()
    tx.update(readingWriteReceipts).set({ status: 'deleted' }).where(and(
      eq(readingWriteReceipts.userId, userId), eq(readingWriteReceipts.sessionId, sessionId),
    )).run()
    tx.delete(readingSessions).where(eq(readingSessions.id, sessionId)).run()
    refreshReadingProjectionIncrementally(tx, userId, row.bookId, [sessionId], [], deletedRows, [row.date])
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
    tx.delete(readingContributions).where(and(eq(readingContributions.userId, userId), eq(readingContributions.bookVersionId, bookId))).run()
    tx.delete(readingHourlyStats).where(and(eq(readingHourlyStats.userId, userId), eq(readingHourlyStats.bookVersionId, bookId))).run()
    tx.delete(readingRoundStats).where(and(eq(readingRoundStats.userId, userId), eq(readingRoundStats.bookVersionId, bookId))).run()
    tx.delete(readingBookStats).where(and(eq(readingBookStats.userId, userId), eq(readingBookStats.bookVersionId, bookId))).run()
    tx.delete(readingProjectionStates).where(and(eq(readingProjectionStates.userId, userId), eq(readingProjectionStates.bookVersionId, bookId))).run()
    tx.delete(readingRounds).where(roundWhere(userId, bookId)).run()
    const hasNotes = tx.get(sql`SELECT 1 FROM highlights WHERE user_id = ${userId} AND book_version_id = ${bookId} AND deleted_at IS NULL
      UNION ALL SELECT 1 FROM bookmarks WHERE user_id = ${userId} AND book_version_id = ${bookId} AND deleted_at IS NULL
      UNION ALL SELECT 1 FROM ideas WHERE user_id = ${userId} AND book_version_id = ${bookId} AND deleted_at IS NULL
      UNION ALL SELECT 1 FROM book_reviews WHERE user_id = ${userId} AND read_book_version_id = ${bookId} LIMIT 1`)
    if (hasNotes) {
      tx.update(readingArchives).set({ legacyIntervals: [], legacyDaily: [], legacyWordCount: null, legacyRevisionId: null })
        .where(archiveWhere(userId, bookId)).run()
      rebuildReadingProjection(tx as unknown as Db, userId, bookId)
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
      refreshReadingProjectionIncrementally(tx, userId, archive.bookId,
        archive.sessions.map((session) => sessionIds.get(session.id)!),
        archive.rounds.map((round) => roundIds.get(round.id)!))
    }
    for (const receipt of transfer.detachedReceipts ?? []) {
      tx.insert(readingWriteReceipts).values({ userId, requestId: receipt.requestId, bookVersionId: receipt.bookId, bodyHash: receipt.bodyHash, status: receipt.status, sessionId: null }).onConflictDoNothing().run()
    }
  })
  return result
}
