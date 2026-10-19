import { z } from 'zod'

import { calendarDateSchema, readingTimezoneSchema } from './reading-range'

export { readingTimezoneSchema } from './reading-range'

export type ReadingCoverageInterval = [number, number]
export interface ReadingTimeFragment { startedAt: number; endedAt: number }
export type ReadingSource = 'auto' | 'manual' | 'retroactive' | 'legacy'

export interface ReadingLedgerRound {
  id: string
  ordinal: number
  status: 'reading' | 'finished' | 'abandoned'
  startedAt: number
  endedAt: number | null
  coverage: number
  totalSeconds: number
  wordCount: number | null
  legacyCoverage: boolean
  unalignedCoverage?: boolean
  coverageEstimated?: boolean
}

export interface ReadingWriteReceipt {
  requestId: string
  bodyHash: string
  sessionId: string | null
  status: 'accepted' | 'skipped' | 'deleted'
}

export interface ReadingLedgerSession {
  id: string
  roundId: string
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
}

export interface ReadingLedgerRes {
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

export interface ReadingTransfer {
  version: 1
  detachedReceipts?: Array<ReadingWriteReceipt & { bookId: string }>
  archives: Array<{
    bookId: string
    title: string
    author: string
    legacyIntervals: ReadingCoverageInterval[]
    legacyDaily?: Array<{ date: string; durationSeconds: number }>
    legacyWordCount?: number | null
    legacyRevisionId?: string | null
    rounds: ReadingLedgerRound[]
    sessions: ReadingLedgerSession[]
    receipts?: ReadingWriteReceipt[]
  }>
}

export interface ReadingTransferPreview { archives: number; sessions: number; duplicates: number }
export interface ReadingTimerClaim {
  granted: boolean
  ownerDeviceId: string
  mode: 'auto' | 'manual'
  expiresAt: number
}

export const readingDateSchema = calendarDateSchema
export const readingTimeFragmentSchema = z.object({
  startedAt: z.number().int().positive(),
  endedAt: z.number().int().positive(),
}).refine((value) => value.endedAt > value.startedAt && value.endedAt - value.startedAt <= 24 * 3600_000, 'Invalid reading interval')
export const readingCoverageSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])
export const readingRoundActionSchema = z.object({ action: z.enum(['reread', 'continue', 'finish', 'abandon']) })
export const readingTimerClaimSchema = z.object({
  deviceId: z.string().min(1).max(100),
  mode: z.enum(['auto', 'manual']),
  activityAt: z.number().int().positive(),
  explicit: z.boolean().default(false),
})
export const readingTimerReleaseSchema = z.object({ deviceId: z.string().min(1).max(100), activityAt: z.number().int().positive().optional() })

const roundSchema = z.object({
  id: z.string().min(1).max(100), ordinal: z.number().int().positive(),
  status: z.enum(['reading', 'finished', 'abandoned']),
  startedAt: z.number().int().positive(), endedAt: z.number().int().positive().nullable(),
  coverage: z.number().min(0).max(1), totalSeconds: z.number().nonnegative(),
  wordCount: z.number().int().nonnegative().nullable(), legacyCoverage: z.boolean(), unalignedCoverage: z.boolean().optional(),
})
const transferSessionSchema = z.object({
  id: z.string().min(1).max(100), roundId: z.string().min(1).max(100),
  source: z.enum(['auto', 'manual', 'retroactive', 'legacy']),
  date: readingDateSchema,
  startedAt: z.number().int().positive().nullable(), endedAt: z.number().int().positive().nullable(),
  durationSeconds: z.number().nonnegative().max(24 * 3600),
  startFraction: z.number().min(0).max(1).nullable(), endFraction: z.number().min(0).max(1).nullable(),
  wordCount: z.number().int().nonnegative().nullable(), revisionId: z.string().max(100).nullish(),
  startCfi: z.string().max(10000).nullish(), endCfi: z.string().max(10000).nullish(),
  startChapterIndex: z.number().int().nonnegative().nullish(), endChapterIndex: z.number().int().nonnegative().nullish(),
  projectedCoverage: z.array(readingCoverageSchema).max(10000).optional(), unalignedCoverage: z.boolean().optional(),
  coverage: z.array(readingCoverageSchema).max(10000), fragments: z.array(readingTimeFragmentSchema).max(10000),
  timezone: z.union([readingTimezoneSchema, z.literal('')]),
})
const transferReceiptSchema = z.object({
  requestId: z.string().min(1).max(100), bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  sessionId: z.string().min(1).max(100).nullable(), status: z.enum(['accepted', 'skipped', 'deleted']),
})
export const readingTransferSchema = z.object({
  version: z.literal(1),
  detachedReceipts: z.array(transferReceiptSchema.extend({ bookId: z.string().min(1).max(100) })).max(100000).optional(),
  archives: z.array(z.object({
    bookId: z.string().min(1).max(100), title: z.string().max(2000), author: z.string().max(2000),
    legacyIntervals: z.array(readingCoverageSchema).max(10000),
    legacyDaily: z.array(z.object({ date: readingDateSchema, durationSeconds: z.number().nonnegative() })).max(100000).optional(),
    legacyWordCount: z.number().int().nonnegative().nullable().optional(),
    legacyRevisionId: z.string().max(100).nullable().optional(),
    rounds: z.array(roundSchema).max(1000), sessions: z.array(transferSessionSchema).max(100000),
    receipts: z.array(transferReceiptSchema).max(100000).optional(),
  })).max(10000),
})
