import { z } from 'zod'

import type { BookFormat } from './constants'

import { calendarDateSchema } from './reading-range'

export { readingTimezoneSchema } from './reading-range'

export type ReadingCoverageInterval = [number, number]
export interface ReadingTimeFragment { startedAt: number; endedAt: number }
export type ReadingSource = 'auto' | 'manual' | 'retroactive' | 'legacy'
export type ReadingWordState = 'known' | 'partial' | 'unknown'

export interface ReadingLedgerRound {
  id: string
  ordinal: number
  status: 'reading' | 'finished' | 'abandoned'
  startedAt: number | null
  endedAt: number | null
  coverage: number
  totalSeconds: number
  wordCount: number | null
  legacyCoverage: boolean
  unalignedCoverage?: boolean
  coverageEstimated?: boolean
}

export interface ReadingLedgerSession {
  id: string
  roundId: string | null
  clientMembers?: Array<{ id: string; version: number }>
  source: ReadingSource
  date: string
  startedAt: number | null
  endedAt: number | null
  durationSeconds: number
  startFraction: number | null
  endFraction: number | null
  progressScale?: number | null
  wordCount: number | null
  revisionId?: string | null
  startCfi?: string | null
  endCfi?: string | null
  startChapterIndex?: number | null
  endChapterIndex?: number | null
  coverage: ReadingCoverageInterval[]
  projectedCoverage?: ReadingCoverageInterval[]
  unalignedCoverage?: boolean
  fragments: ReadingTimeFragment[]
  timezone: string
  contributionDates?: string[]
}

export interface ReadingLedgerRes {
  format?: BookFormat | null
  coverKey?: string | null
  /** Remote cover for imported archives (coverKey is null there). */
  coverUrl?: string | null
  /** Import provenance; null/undefined for native archives. */
  importSource?: 'weread' | 'legado' | null
  bookId: string
  title: string
  author: string
  sourceAvailable: boolean
  currentRoundId: string | null
  legacyCoverage: boolean
  rounds: ReadingLedgerRound[]
  sessions: ReadingLedgerSession[]
  coverage: number
  totalSeconds: number
  legacyDaily: Array<{ date: string; durationSeconds: number }>
  legacyIntervals: ReadingCoverageInterval[]
  legacyWordCount: number | null
  legacyRevisionId?: string | null
  projectedLegacyIntervals?: ReadingCoverageInterval[]
  unalignedCoverage?: boolean
  coverageEstimated?: boolean
}

export interface ReadingLedgerOverview {
  format?: BookFormat | null
  coverKey?: string | null
  /** Remote cover for imported archives (coverKey is null there). */
  coverUrl?: string | null
  /** Import provenance; null/undefined for native archives. */
  importSource?: 'weread' | 'legado' | null
  bookId: string
  title: string
  author: string
  sourceAvailable: boolean
  currentRoundId: string | null
  legacyCoverage: boolean
  rounds: ReadingLedgerRound[]
  coverage: number
  coverageIntervals: ReadingCoverageInterval[]
  totalSeconds: number
  undatedDurationSeconds: number
  referenceDurationSeconds: number
  totalWordsRead: number | null
  wordState: ReadingWordState
  readingDays: number
  earliestDate: string | null
  legacyIntervals: ReadingCoverageInterval[]
  legacyWordCount: number | null
  legacyRevisionId?: string | null
  projectedLegacyIntervals?: ReadingCoverageInterval[]
  unalignedCoverage?: boolean
  coverageEstimated?: boolean
  dataVersion: number
}

export interface ReadingLedgerStatsDay {
  date: string
  durationSeconds: number
  totalWordsRead: number | null
  wordState: ReadingWordState
  cumulativeCoverage: number | null
  progressDelta: number
}

export interface ReadingLedgerStatsHour {
  hour: number
  durationSeconds: number
  days: number
}

export interface ReadingLedgerStatsRes {
  dataVersion: number
  from?: string
  to?: string
  totalSeconds: number
  undatedDurationSeconds: number
  referenceDurationSeconds: number
  totalWordsRead: number | null
  wordState: ReadingWordState
  readingDays: number
  daily: ReadingLedgerStatsDay[]
  hourly: ReadingLedgerStatsHour[]
  legacyDaily: Array<{ date: string; durationSeconds: number }>
  remainingSeconds?: number | null
}

export interface ReadingLedgerSessionPage {
  dataVersion: number
  items: ReadingLedgerSession[]
  nextCursor: string | null
  hasMore: boolean
}

export interface ReadingTimerClaim {
  granted: boolean
  ownerDeviceId: string
  mode: 'auto' | 'manual'
  expiresAt: number
}

export const readingDateSchema = calendarDateSchema
export const readingTimeFragmentBoundsSchema = z.object({
  startedAt: z.number().int().positive(),
  endedAt: z.number().int().positive(),
})
export const readingTimeFragmentSchema = readingTimeFragmentBoundsSchema.refine((value) => value.endedAt > value.startedAt && value.endedAt - value.startedAt <= 24 * 3600_000, 'Invalid reading interval')
export const readingCoverageSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])
export const readingRoundActionSchema = z.object({ action: z.enum(['reread', 'continue', 'finish', 'abandon']) })
export const readingTimerClaimSchema = z.object({
  deviceId: z.string().min(1).max(100),
  mode: z.enum(['auto', 'manual']),
  activityAt: z.number().int().positive(),
  explicit: z.boolean().default(false),
})
export const readingTimerReleaseSchema = z.object({ deviceId: z.string().min(1).max(100), activityAt: z.number().int().positive().optional() })
export const readingLedgerStatsQuerySchema = z.object({
  from: readingDateSchema.optional(), to: readingDateSchema.optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: 'Range ends before it starts', path: ['to'] })
export const readingLedgerSessionsQuerySchema = z.object({
  from: readingDateSchema.optional(), to: readingDateSchema.optional(),
  cursor: z.string().max(500).optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: 'Range ends before it starts', path: ['to'] })
