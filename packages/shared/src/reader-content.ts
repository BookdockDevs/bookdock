import { z } from 'zod'

/**
 * Reader content delivery contracts. The server derives these from the
 * immutable source blob; the browser and Legado project them differently.
 */

export const READER_MANIFEST_FORMAT_VERSION = 1

/** A single raw ZIP entry may not exceed this in a reader response. */
export const READER_ENTRY_MAX_BYTES = 32 * 1024 * 1024
/** Background text batching only; a foreground chapter never waits for a batch. */
export const READER_TEXT_BATCH_MAX_ENTRIES = 8
export const READER_TEXT_ENTRY_MAX_BYTES = 1024 * 1024
export const READER_TEXT_BATCH_MAX_BYTES = 2 * 1024 * 1024
/** Bound for container/OPF/navigation files shipped with the manifest. */
export const READER_STARTUP_MAX_BYTES = 4 * 1024 * 1024
export const READER_ENTRY_PATH_MAX_LENGTH = 4096
export const READER_MANIFEST_MAX_ENTRIES = 100_000

export const readerEntryCompressionSchema = z.enum(['store', 'deflate', 'unsupported'])
export type ReaderEntryCompression = z.infer<typeof readerEntryCompressionSchema>

export const readerManifestEntrySchema = z.object({
  path: z.string().min(1).max(READER_ENTRY_PATH_MAX_LENGTH),
  size: z.number().int().nonnegative(),
  compressedSize: z.number().int().nonnegative(),
  compression: readerEntryCompressionSchema,
  mediaType: z.string().min(1),
})

export const readerManifestFileSchema = z.object({
  path: z.string().min(1).max(READER_ENTRY_PATH_MAX_LENGTH),
  text: z.string(),
})

export const readerManifestSpineItemSchema = z.object({
  path: z.string().min(1).max(READER_ENTRY_PATH_MAX_LENGTH),
  mediaType: z.string().min(1),
  linear: z.boolean(),
})

export const readerManifestSchema = z.object({
  formatVersion: z.literal(READER_MANIFEST_FORMAT_VERSION),
  bookId: z.string().min(1),
  revisionId: z.string().min(1),
  contentHash: z.string().min(1).nullable(),
  size: z.number().int().nonnegative(),
  entryCount: z.number().int().nonnegative(),
  entries: z.array(readerManifestEntrySchema).max(READER_MANIFEST_MAX_ENTRIES),
  spine: z.array(readerManifestSpineItemSchema).max(READER_MANIFEST_MAX_ENTRIES),
  startupFiles: z.array(readerManifestFileSchema).max(16),
  opfPath: z.string().min(1).max(READER_ENTRY_PATH_MAX_LENGTH),
  navPath: z.string().max(READER_ENTRY_PATH_MAX_LENGTH).nullable(),
  ncxPath: z.string().max(READER_ENTRY_PATH_MAX_LENGTH).nullable(),
  generated: z.boolean(),
})

export type ReaderManifestEntry = z.infer<typeof readerManifestEntrySchema>
export type ReaderManifestFile = z.infer<typeof readerManifestFileSchema>
export type ReaderManifestSpineItem = z.infer<typeof readerManifestSpineItemSchema>
export type ReaderManifest = z.infer<typeof readerManifestSchema>

export const readerResourceDimensionsSchema = z.object({
  path: z.string().min(1).max(READER_ENTRY_PATH_MAX_LENGTH),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})
export type ReaderResourceDimensions = z.infer<typeof readerResourceDimensionsSchema>

/** Layout metadata travels with chapter markup; the image bytes remain independently lazy-loaded. */
export const readerMarkupEntryDataSchema = z.object({
  text: z.string(),
  resources: z.array(readerResourceDimensionsSchema).max(8),
})
export type ReaderMarkupEntryData = z.infer<typeof readerMarkupEntryDataSchema>
export const readerMarkupEntryResponseSchema = z.object({ data: readerMarkupEntryDataSchema })

export const readerMarkupEntryQuerySchema = z.object({
  includeResourceDimensions: z.enum(['true', 'false']).default('true').transform((value) => value === 'true'),
  imageVariant: z.enum(['eink']).optional(),
})

export type ReaderTextItemError =
  | 'READER_ENTRY_NOT_FOUND'
  | 'READER_ENTRY_UNSUPPORTED'
  | 'READER_ENTRY_TOO_LARGE'
  | 'READER_TEXT_BUDGET_EXCEEDED'
  | 'READER_ENTRY_FAILED'

export type ReaderTextBatchItem =
  | { path: string; text: string; bytes: number; resources?: ReaderResourceDimensions[] }
  | { path: string; error: ReaderTextItemError }

export const readerTextBatchItemSchema = z.union([
  z.object({
    path: z.string().min(1),
    text: z.string(),
    bytes: z.number().int().nonnegative(),
    resources: z.array(readerResourceDimensionsSchema).max(8).optional(),
  }),
  z.object({ path: z.string().min(1), error: z.enum([
    'READER_ENTRY_NOT_FOUND',
    'READER_ENTRY_UNSUPPORTED',
    'READER_ENTRY_TOO_LARGE',
    'READER_TEXT_BUDGET_EXCEEDED',
    'READER_ENTRY_FAILED',
  ]) }),
])

export const readerTextBatchResSchema = z.object({
  revisionId: z.string().min(1),
  items: z.array(readerTextBatchItemSchema).max(READER_TEXT_BATCH_MAX_ENTRIES),
})

export type ReaderTextBatchRes = z.infer<typeof readerTextBatchResSchema>

export const readerTextBatchSchema = z.object({
  revisionId: z.string().min(1),
  includeResourceDimensions: z.boolean().default(true),
  paths: z.array(z.string().min(1).max(READER_ENTRY_PATH_MAX_LENGTH))
    .min(1)
    .max(READER_TEXT_BATCH_MAX_ENTRIES),
})

export type ReaderTextBatchReq = z.infer<typeof readerTextBatchSchema>

export const readerSearchReplacementSchema = z.object({
  id: z.string().min(1).max(200),
  matchType: z.enum(['pattern', 'point']),
  pattern: z.string().max(512).nullable(),
  replacement: z.string().max(1000).nullable(),
  isRegex: z.boolean(),
  applyTo: z.enum(['content', 'title', 'both']),
  enabled: z.boolean(),
  effectiveEnabled: z.boolean().nullable().optional(),
  spineHref: z.string().max(READER_ENTRY_PATH_MAX_LENGTH).nullable(),
  textOffset: z.number().int().nonnegative().nullable(),
  originalText: z.string().max(1000).nullable(),
})

export const readerSearchRequestSchema = z.object({
  revisionId: z.string().min(1).max(200),
  query: z.string().min(1).max(1000),
  mode: z.enum(['contains', 'regex']).default('contains'),
  matchCase: z.boolean().default(false),
  chineseConversion: z.enum(['off', 'simplified', 'traditional']).default('off'),
  replacements: z.array(readerSearchReplacementSchema).max(40).default([]),
})

export type ReaderSearchRequest = z.infer<typeof readerSearchRequestSchema>

export const readerSearchExcerptSchema = z.object({ pre: z.string().max(256), match: z.string().max(4001), post: z.string().max(256) })
export const readerSearchHitSchema = z.object({
  sectionIndex: z.number().int().nonnegative(),
  chapter: z.string().max(500).optional(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  excerpt: readerSearchExcerptSchema,
})
export const readerSearchEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('batch'), revisionId: z.string().min(1), scanned: z.number().int().nonnegative(), total: z.number().int().nonnegative(), hits: z.array(readerSearchHitSchema).max(100) }),
  z.object({ type: z.literal('terminal'), revisionId: z.string().min(1), status: z.enum(['complete', 'truncated', 'partial', 'canceled']), scanned: z.number().int().nonnegative(), total: z.number().int().nonnegative(), error: z.enum(['regex-timeout', 'regex-failed']).optional() }),
])

export type ReaderSearchHit = z.infer<typeof readerSearchHitSchema>
export type ReaderSearchEvent = z.infer<typeof readerSearchEventSchema>

export function isReaderMarkupType(mediaType: string): boolean {
  const type = mediaType.split(';', 1)[0]?.trim().toLowerCase()
  return type === 'application/xhtml+xml' || type === 'text/html' || type === 'text/xml' || type === 'application/xml'
}
