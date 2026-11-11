import { z } from 'zod'

import { ANNOTATION_MAX_TEXT_LENGTH, COVER_PALETTE_IDS } from './constants'
import { readingCoverageSchema, readingTimeFragmentSchema } from './reading-ledger'
import { REVIEW_BODY_MAX_LENGTH, REVIEW_TITLE_MAX_LENGTH } from './review'
import { bookMetadataSchema, readerBookSettingsSchema, tocRulePatternsSchema } from './schema'

export const LOCAL_IMPORT_MAX_NOTES = 20_000
export const LOCAL_IMPORT_MAX_ROUNDS = 500
export const LOCAL_IMPORT_MAX_SESSIONS = 50_000
export const LOCAL_IMPORT_MAX_POINT_RULES = 10_000
export const LOCAL_IMPORT_MAX_OVERRIDES = 10_000
export const LOCAL_IMPORT_MAX_IMAGES = 500
export const LOCAL_IMPORT_MAX_PAYLOAD_BYTES = 32 * 1024 * 1024

const idSchema = z.string().min(1).max(160)
const timestampSchema = z.number().int().nonnegative()
const fractionSchema = z.number().finite().min(0).max(1)

export const localBookDuplicateCheckSchema = z.object({
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  format: z.enum(['epub', 'txt']),
})
export type LocalBookDuplicateCheckReq = z.infer<typeof localBookDuplicateCheckSchema>

export interface LocalBookDuplicateCheckRes {
  duplicated: boolean
  bookId?: string
  title?: string
}

export const localBookImportNoteSchema = z.object({
  id: idSchema,
  kind: z.enum(['bookmark', 'highlight', 'idea']),
  title: z.string().max(500).optional(),
  context: z.string().max(2_000).optional(),
  text: z.string().max(ANNOTATION_MAX_TEXT_LENGTH).optional(),
  color: z.string().max(100).optional(),
  style: z.enum(['underline', 'squiggly', 'highlight']).optional(),
  body: z.string().max(ANNOTATION_MAX_TEXT_LENGTH).optional(),
  chapter: z.string().max(500).nullable().optional(),
  href: z.string().max(2_000).nullable().optional(),
  cfi: z.string().max(2_000).nullable().optional(),
  contentId: idSchema.nullable().optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  imageIds: z.array(idSchema).max(9).optional(),
})
export type LocalBookImportNote = z.infer<typeof localBookImportNoteSchema>

export const localBookImportRoundSchema = z.object({
  ordinal: z.number().int().positive(),
  status: z.enum(['reading', 'finished', 'abandoned']),
  startedAt: timestampSchema.nullable(),
  endedAt: timestampSchema.nullable(),
  coverageIntervals: z.array(readingCoverageSchema).optional(),
})
export type LocalBookImportRound = z.infer<typeof localBookImportRoundSchema>

export const localBookImportSessionSchema = z.object({
  roundOrdinal: z.number().int().positive(),
  requestId: idSchema,
  source: z.enum(['auto', 'manual', 'retroactive', 'legacy']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startedAt: timestampSchema.nullable(),
  endedAt: timestampSchema.nullable().optional(),
  durationSeconds: z.number().finite().positive().max(86400),
  timezone: z.string().min(1).max(100).nullable().optional(),
  fragments: z.array(readingTimeFragmentSchema).max(10_000).default([]),
  coverage: z.array(readingCoverageSchema).max(10_000).default([]),
  startCfi: z.string().max(2_000).nullable().optional(),
  endCfi: z.string().max(2_000).nullable().optional(),
  startFraction: fractionSchema.nullable().optional(),
  endFraction: fractionSchema.nullable().optional(),
  startChapterIndex: z.number().int().min(-1).nullable().optional(),
  endChapterIndex: z.number().int().min(-1).nullable().optional(),
  wordCount: z.number().int().nonnegative().nullable().optional(),
  contentId: idSchema.nullable().optional(),
})
export type LocalBookImportSession = z.infer<typeof localBookImportSessionSchema>

export const localBookImportPointRuleSchema = z.object({
  name: z.string().max(100).nullable().optional(),
  group: z.string().max(100).nullable().optional(),
  replacement: z.string().max(5000),
  spineHref: z.string().min(1),
  textOffset: z.number().int().nonnegative(),
  originalText: z.string().min(1),
  contentId: idSchema.nullable().optional(),
  relocation: z.enum(['ok', 'unresolved']).default('ok'),
  enabled: z.boolean().default(true),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
})

export const localBookImportPayloadSchema = z.object({
  requestId: idSchema,
  book: z.object({
    title: z.string().min(1).max(500),
    authors: z.array(z.string().max(200)).max(20),
    format: z.enum(['epub', 'txt']),
    fileName: z.string().min(1).max(500).nullable().optional(),
    contentId: idSchema,
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    catalog: z.object({
      metadata: bookMetadataSchema.optional(),
      shelfId: idSchema.nullable().optional(),
      categoryId: idSchema.nullable().optional(),
      tagIds: z.array(idSchema).optional(),
      pinnedAt: timestampSchema.nullable().optional(),
      hidden: z.boolean().optional(),
      coverPaletteId: z.enum(COVER_PALETTE_IDS).nullable().optional(),
    }).optional(),
    txtRulePatterns: tocRulePatternsSchema.nullable().optional(),
    txtChapters: z.array(z.object({
      title: z.string(),
      level: z.number().int().nonnegative(),
      startOffset: z.number().int().nonnegative(),
      endOffset: z.number().int().nonnegative(),
      contentStartOffset: z.number().int().nonnegative(),
      wordCount: z.number().int().nonnegative(),
    })).max(10_000).optional(),
  }),
  state: z.object({
    readStatus: z.enum(['wishlist', 'reading', 'idle', 'finished', 'abandoned']),
    cfi: z.string().max(2_000).nullable().optional(),
    layoutCfi: z.string().max(2_000).nullable().optional(),
    chapter: z.string().max(500).nullable().optional(),
    fraction: fractionSchema.nullable().optional(),
    positionContentId: idSchema.nullable().optional(),
    coverageIntervals: z.array(readingCoverageSchema).max(10_000).default([]),
    coverageContentId: idSchema.nullable().optional(),
    lastReadAt: timestampSchema.nullable().optional(),
  }).nullable().optional(),
  notes: z.array(localBookImportNoteSchema).max(LOCAL_IMPORT_MAX_NOTES).default([]),
  review: z.object({
    ratingHalves: z.number().int().min(0).max(10).nullable(),
    title: z.string().max(REVIEW_TITLE_MAX_LENGTH),
    body: z.string().max(REVIEW_BODY_MAX_LENGTH),
    bodyFormat: z.enum(['plain', 'markdown']),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  }).nullable().optional(),
  rounds: z.array(localBookImportRoundSchema).max(LOCAL_IMPORT_MAX_ROUNDS).default([]),
  sessions: z.array(localBookImportSessionSchema).max(LOCAL_IMPORT_MAX_SESSIONS).default([]),
  readerSettings: readerBookSettingsSchema.nullable().optional(),
  pointRules: z.array(localBookImportPointRuleSchema).max(LOCAL_IMPORT_MAX_POINT_RULES).default([]),
  replacementOverrides: z.record(idSchema, z.boolean()).default({}).refine(
    (value) => Object.keys(value).length <= LOCAL_IMPORT_MAX_OVERRIDES,
    `Too many replacement overrides (max ${LOCAL_IMPORT_MAX_OVERRIDES})`,
  ),
})
export type LocalBookImportPayload = z.infer<typeof localBookImportPayloadSchema>
