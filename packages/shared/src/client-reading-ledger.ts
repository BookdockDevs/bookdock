import { z } from 'zod'

import type { ClientBook, ClientNote, ClientOrganization, ClientReadingState, ClientReview } from './client-reading'
import { clientBookRefSchema, clientContentRefSchema, sameClientBook } from './client-reading'
import { readingImportScopeSchema } from './reading-import'
import { readingTimeFragmentBoundsSchema } from './reading-ledger'
import { readingRecordCreateSchema, readingRecordFieldsSchema, readingSessionUpdateFieldsSchema, isOrderedReadingSessionUpdate } from './schema'

const { bookId: _bookId, expectedUserId: _expectedUserId, replaceSessionIds: _replaceSessionIds, finished: _finished, ...captureFields } = readingRecordFieldsSchema.shape

export const clientReadingCaptureSchema = z.object({
  ...captureFields,
  durationSeconds: z.number().finite().positive().max(86400),
  book: clientBookRefSchema,
  requestId: captureFields.requestId.unwrap(),
  source: captureFields.source.unwrap(),
  startedAt: captureFields.startedAt.unwrap(),
}).strict().superRefine((capture, context) => {
  // Server request precision must not round persisted local reading facts.
  const parsed = readingRecordCreateSchema.safeParse({ ...capture, durationSeconds: Math.ceil(capture.durationSeconds), bookId: capture.book.bookId })
  if (!parsed.success) for (const issue of parsed.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message })
  if (capture.source !== 'retroactive' && (capture.startedAt === null || !capture.fragments?.length)) {
    context.addIssue({ code: 'custom', path: ['fragments'], message: 'Captured reading requires known active time fragments' })
  }
  if ((capture.coverage?.length || capture.startFraction !== undefined || capture.endFraction !== undefined || capture.startCfi || capture.endCfi) && !capture.revisionId) {
    context.addIssue({ code: 'custom', path: ['revisionId'], message: 'Reading positions require their content revision' })
  }
  if (capture.fragments?.some((fragment) => capture.startedAt !== null && fragment.startedAt < capture.startedAt || capture.endedAt !== undefined && fragment.endedAt > capture.endedAt)) {
    context.addIssue({ code: 'custom', path: ['fragments'], message: 'Active fragments must stay within known capture bounds' })
  }
})
export type ClientReadingCapture = z.infer<typeof clientReadingCaptureSchema>

export const clientReadingSessionSchema = z.object({
  id: z.string().min(1),
  groupId: z.string().min(1).max(100).optional(),
  roundId: z.string().min(1).optional(),
  capture: clientReadingCaptureSchema,
  acceptedFragments: z.array(readingRecordFieldsSchema.shape.fragments.unwrap().element),
  durationSeconds: z.number().finite().positive().max(86400),
  version: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
}).strict()
export type ClientReadingSession = z.infer<typeof clientReadingSessionSchema>

export interface ClientReadingLedger {
  version: number
  sessions: ClientReadingSession[]
}

export const clientReadingTimerDraftSchema = z.object({
  capture: clientReadingCaptureSchema.refine((capture) => capture.source !== 'retroactive', 'Retroactive entries are not active timer drafts'),
  phase: z.enum(['suspended', 'queued']),
  suspendedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  updatedAt: z.number().int().positive(),
}).strict().refine((draft) => draft.expiresAt >= draft.suspendedAt, 'Draft expiry precedes suspension')
export type ClientReadingTimerDraft = z.infer<typeof clientReadingTimerDraftSchema>

export const clientReadingCaptureGroupSchema = z.object({
  id: z.string().min(1).max(100),
  book: clientBookRefSchema,
  captures: z.array(clientReadingCaptureSchema).min(1).max(128),
}).strict().superRefine((group, context) => {
  const ids = new Set<string>()
  for (const capture of group.captures) {
    if (!sameClientBook(capture.book, group.book) || capture.source !== group.captures[0]!.source || capture.revisionId !== group.captures[0]!.revisionId || capture.timezone !== group.captures[0]!.timezone || capture.deviceId !== group.captures[0]!.deviceId || capture.source === 'retroactive' || ids.has(capture.requestId)) context.addIssue({ code: 'custom', path: ['captures'], message: 'Capture group must contain unique timer chunks for one book, source and revision' })
    ids.add(capture.requestId)
  }
})
export type ClientReadingCaptureGroup = z.infer<typeof clientReadingCaptureGroupSchema>

export const clientManualTimerSnapshotSchema = z.object({
  book: clientBookRefSchema,
  requestId: readingRecordFieldsSchema.shape.requestId.unwrap(),
  deviceId: readingRecordFieldsSchema.shape.deviceId,
  date: readingRecordFieldsSchema.shape.date,
  timezone: readingRecordFieldsSchema.shape.timezone.unwrap(),
  phase: z.enum(['paused', 'suspended']),
  startedAt: z.number().int().positive(),
  elapsedMs: z.number().int().nonnegative(),
  lastResumeAt: z.null(),
  suspendedAt: z.number().int().positive().nullable(),
  expiresAt: z.number().int().positive().nullable(),
  updatedAt: z.number().int().positive(),
  fragments: z.array(readingTimeFragmentBoundsSchema.refine((fragment) => fragment.endedAt > fragment.startedAt, 'Manual timer fragment must have positive measured time')).max(10000),
  coverage: readingRecordFieldsSchema.shape.coverage.unwrap(),
  startCfi: readingRecordFieldsSchema.shape.startCfi.unwrap().nullable(),
  lastCfi: readingRecordFieldsSchema.shape.endCfi.unwrap().nullable(),
  startFraction: readingRecordFieldsSchema.shape.startFraction.unwrap().nullable(),
  lastFraction: readingRecordFieldsSchema.shape.endFraction.unwrap().nullable(),
  startChapterIndex: z.number().int().min(-1).nullable(),
  lastChapterIndex: z.number().int().min(-1).nullable(),
  revisionId: readingRecordFieldsSchema.shape.revisionId,
  wordCount: readingRecordFieldsSchema.shape.wordCount,
  transferred: z.boolean().optional(),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.phase === 'paused' ? snapshot.expiresAt !== null : snapshot.suspendedAt === null || snapshot.expiresAt === null || snapshot.expiresAt < snapshot.suspendedAt) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Manual timer expiry does not match its phase' })
  const elapsedMs = snapshot.fragments.reduce((sum, fragment) => sum + fragment.endedAt - fragment.startedAt, 0)
  if (elapsedMs !== snapshot.elapsedMs) context.addIssue({ code: 'custom', path: ['elapsedMs'], message: 'Manual timer duration must match measured fragments' })
})
export type ClientManualTimerSnapshot = z.infer<typeof clientManualTimerSnapshotSchema>


const roundCoverageSchema = z.object({ content: clientContentRefSchema, intervals: readingRecordFieldsSchema.shape.coverage.unwrap() }).strict()

export const clientReadingRoundsSchema = z.object({
  book: clientBookRefSchema,
  version: z.number().int().nonnegative(),
  rounds: z.array(z.object({
    id: z.string().min(1), ordinal: z.number().int().positive(),
    status: z.enum(['reading', 'finished', 'abandoned']),
    coverage: roundCoverageSchema.optional(),
    coverageHistory: z.array(roundCoverageSchema).optional(),
    startedAt: z.number().int().nonnegative().nullable(),
    endedAt: z.number().int().nonnegative().nullable(),
  }).strict()),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>()
  for (const [index, round] of value.rounds.entries()) {
    if (round.coverage && !sameClientBook(round.coverage.content.book, value.book) || ids.has(round.id) || round.ordinal !== index + 1 || round.status === 'reading' && (round.endedAt !== null || index !== value.rounds.length - 1) || round.startedAt !== null && round.endedAt !== null && round.endedAt < round.startedAt) context.addIssue({ code: 'custom', path: ['rounds', index], message: 'Invalid reading round history' })
    const bases = [...(round.coverage ? [round.coverage] : []), ...(round.coverageHistory ?? [])]
    if (bases.some((basis) => !sameClientBook(basis.content.book, value.book)) || new Set(bases.map((basis) => basis.content.contentId)).size !== bases.length) context.addIssue({ code: 'custom', path: ['rounds', index, 'coverageHistory'], message: 'Invalid round coverage history' })
    ids.add(round.id)
  }
})
export type ClientReadingRounds = z.infer<typeof clientReadingRoundsSchema>
export type ClientReadingRoundAction = 'reread' | 'continue' | 'finish' | 'abandon'


export const clientReadingEntrySchema = z.object({
  capture: clientReadingCaptureSchema,
  finished: z.boolean().default(false),
  expectedManualUpdatedAt: z.number().int().positive().optional(),
  replaceSessionIds: readingRecordFieldsSchema.shape.replaceSessionIds,
}).strict()
export type ClientReadingEntry = z.infer<typeof clientReadingEntrySchema>


export const clientReadingGroupEntrySchema = z.object({
  group: clientReadingCaptureGroupSchema.refine((group) => group.captures.every((capture) => capture.source === 'manual'), 'Explicit grouped entries require manual capture'),
  finished: z.boolean().default(false),
  expectedManualUpdatedAt: z.number().int().positive().optional(),
}).strict()
export type ClientReadingGroupEntry = z.infer<typeof clientReadingGroupEntrySchema>


export interface ClientReadingBookSnapshot {
  book: ClientBook
  state: ClientReadingState | null
  rounds: ClientReadingRounds
  ledger: ClientReadingLedger
  coverageIntervals: Array<[number, number]>
}
export interface ClientVaultReadingSnapshot {
  books: ClientReadingBookSnapshot[]
  notes: ClientNote[]
  organization: ClientOrganization
  /** Device reviews, one per book at most. Optional so older readers agree. */
  reviews?: ClientReview[]
}
export const clientReadingCoverageIntervalsSchema = readingRecordFieldsSchema.shape.coverage.unwrap()


export const clientReadingSessionCommandSchema = z.object({
  book: clientBookRefSchema, id: z.string().min(1).max(100),
  requestId: z.string().min(1).max(100),
  members: z.array(z.object({ id: z.string().min(1).max(100), version: z.number().int().nonnegative() }).strict()).min(1).max(128),
}).strict().refine((command) => new Set(command.members.map((member) => member.id)).size === command.members.length, 'Reading command members must be unique')
export type ClientReadingSessionCommand = z.infer<typeof clientReadingSessionCommandSchema>

export const clientReadingLedgerClearSchema = z.object({
  book: clientBookRefSchema,
  requestId: z.string().min(1).max(100),
  expectedVersion: z.number().int().nonnegative(),
  scope: readingImportScopeSchema.optional(),
}).strict()
export type ClientReadingLedgerClear = z.infer<typeof clientReadingLedgerClearSchema>


export const clientReadingSessionUpdateSchema = readingSessionUpdateFieldsSchema.extend({
  durationSeconds: z.number().finite().positive().max(128 * 86400).optional(),
}).strict().refine(isOrderedReadingSessionUpdate, { message: 'endedAt must be after startedAt', path: ['endedAt'] })
export type ClientReadingSessionUpdate = z.infer<typeof clientReadingSessionUpdateSchema>
