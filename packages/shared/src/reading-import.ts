import { z } from 'zod'

import type { NotesExportBook, NotesExportReview } from './reader-profile'
import type { ReadingCoverageInterval, ReadingSource, ReadingTimeFragment } from './reading-ledger'

/** Reading history import (阅读历史导入): WeRead and legado history converted
 * into the importing user's own unified archive. Sources are read
 * credentials, not user-managed accounts; imported data uses the same archive
 * surfaces as native data. */

export type ReadingImportSource = 'weread' | 'legado'
export const readingImportSourceSchema = z.enum(['weread', 'legado'])

/** 全部/仅时长/仅笔记: import and export both gate on it, and preview/result
 * counts only ever cover the selected scope. */
export type ReadingImportScope = 'all' | 'time' | 'notes'
export const readingImportScopeSchema = z.enum(['all', 'time', 'notes'])

export interface ReadingImportBookCounts {
  new: number
  updated: number
}

export interface ReadingImportRecordCounts {
  new: number
  updated: number
  unchanged: number
}

export interface ReadingImportReviewCounts {
  new: number
  updated: number
  unchanged: number
}

export interface ReadingImportUnprocessable {
  reason: string
  count: number
}

/** A record both sides changed: the source brings a new version, and the row
 * in the archive no longer matches what the source last delivered because the
 * reader edited it. Neither version can win by default, so the import keeps the
 * local one and reports the record here — the reader decides, and `key` is what
 * an overwriting re-import sends back.
 *
 * This is the *content* conflict; a locator report's `conflict` state is a
 * *position* conflict (two records asking for the same CFI) and is unrelated. */
export interface ReadingImportConflict {
  /** Import identity of the row; opaque, send back verbatim to overwrite. */
  key: string
  kind: 'highlight' | 'idea' | 'review'
  /** What the source offers now. */
  incomingText: string
  /** What the row says now (the reader's edited version). */
  localText: string
  chapter: string | null
  /** Source book this record belongs to, for grouping in the UI. */
  bookKey: string
}

/** Archive status of one source book, decided by the dataset's stored identity
 * keys alone — the preview never compares records one by one. `mounted` becomes
 * reachable once a source book is bound to a real book version. */
export type ReadingImportBookStatus = 'new' | 'imported' | 'mounted'

export interface ReadingImportBookItem {
  /** Stable source-side book key; apply sends back exactly these. */
  bookKey: string
  title: string
  author: string | null
  coverUrl: string | null
  status: ReadingImportBookStatus
  notes: number
  reviews: number
  durationFacts: number
  /** False when the selected scope leaves nothing to import for this book. */
  selectable: boolean
}

export interface ReadingImportPreview {
  previewId: string
  source: ReadingImportSource
  scope: ReadingImportScope
  /** One row per book the source listed, in the source's own order. */
  items: ReadingImportBookItem[]
  /** Books listed in the source but skipped by scope. */
  skipped: number
  unprocessable: ReadingImportUnprocessable[]
}

/** The book list before any record is fetched. Same rows as a preview, but no
 * `previewId`: nothing has been downloaded yet, so there is nothing to confirm.
 * Counts here are the source's own per-book tallies, not a walk over records. */
export interface ReadingImportBookList extends Omit<ReadingImportPreview, 'previewId'> {}

export interface ReadingImportResult {
  source: ReadingImportSource
  scope: ReadingImportScope
  books: ReadingImportBookCounts
  notes: ReadingImportRecordCounts
  reviews: ReadingImportReviewCounts
  durationFacts: ReadingImportRecordCounts
  skipped: number
  unprocessable: ReadingImportUnprocessable[]
  /** Re-imported records the reader had edited locally; left untouched. */
  conflicts: ReadingImportConflict[]
}

/** Mounting (挂载) locator report. It answers one question only: could this
 * record carry a position in the target book? "No" never blocks the migration
 * itself — records without a position still move, they just cannot jump back
 * to the text (see reading-data-import 0.10). */
export type ReadingImportLocatorState = 'located' | 'ambiguous' | 'missing' | 'conflict'

/** Why a record could not carry a position. `no-text` covers chapters whose
 * body is images or otherwise has no searchable text. */
export type ReadingImportLocatorReason = 'not-found' | 'no-text'

/** Located, but not cleanly: matched only after normalizing punctuation, only
 * across a paragraph boundary, or in a different chapter than the source says. */
export type ReadingImportLocatorWarning = 'punctuation' | 'cross-paragraph' | 'chapter-mismatch'

/** Which evidence decided the position. `order` means the text alone was not
 * unique, but the record's own source offset placed it between two uniquely
 * located neighbours in the same chapter. It is not an estimated offset: only
 * the ordering is used, because the source offset and our text offset do not
 * share a scale. */
export type ReadingImportLocatorResolvedBy = 'text' | 'order'

export interface ReadingImportLocatorItem {
  recordId: string
  kind: 'highlight' | 'idea'
  text: string
  color?: string | null
  style?: string | null
  state: ReadingImportLocatorState
  /** Matches found in the target book; only meaningful for ambiguous/conflict. */
  hits: number
  /** Heading of the target chapter the text was found in. */
  chapter: string | null
  /** Chapter title the source recorded, when it had one. */
  sourceChapter: string | null
  warning: ReadingImportLocatorWarning | null
  reason: ReadingImportLocatorReason | null
  /** How the position was decided; null when there is none. */
  resolvedBy: ReadingImportLocatorResolvedBy | null
  /** The position that would be written on migration; null when unresolved. */
  cfiRange: string | null
  /** For `ambiguous` only: the CFI of the first candidate in book order.
   * Migration uses it because "many candidates" is rare and usually a
   * mis-merged source record (a proofreading mark, not a reader highlight);
   * leaving the note without a position would hide it from the text forever.
   * The state stays `ambiguous` so the report never claims a unique match. */
  fallbackCfiRange: string | null
}

export interface ReadingImportLocatorReport {
  archiveId: string
  targetBookVersionId: string
  targetRevisionId: string
  chapters: number
  total: number
  located: number
  ambiguous: number
  missing: number
  conflict: number
  warnings: { punctuation: number; crossParagraph: number; chapterMismatch: number }
  items: ReadingImportLocatorItem[]
}

/** Result of mounting one archive onto one real book. Every note, review and
 * duration fact moves in a single transaction; the counts describe what the
 * transaction actually did, not what the report predicted. */
export interface ReadingImportMountResult {
  archiveId: string
  targetBookVersionId: string
  notes: {
    migrated: number
    /** Records that carry a CFI in the target book. */
    positioned: number
    /** Moved, but without a position (missing / conflict / no candidate). */
    unpositioned: number
    /** Of `positioned`, how many took the first candidate of an ambiguous match. */
    inferred: number
  }
  reviews: number
  durationFacts: number
}

export interface WereadQrLoginStart {
  id: string
  confirmUrl: string
  expiresAt: number
}

export interface WereadQrLoginFailure {
  stage: 'getinfo' | 'weblogin' | 'session-init' | 'unknown'
  kind: 'network' | 'timeout' | 'http' | 'invalid-json' | 'invalid-response' | 'api-error' | 'missing-credentials' | 'missing-cookies' | 'unexpected'
  httpStatus?: number
  upstreamCode?: number
  observedFields?: string[]
}

export interface WereadQrLoginStatus {
  status: 'pending' | 'complete' | 'expired' | 'failed'
  session: {
    configured: boolean
    vid: string | null
    updatedAt: number | null
  } | null
  failure?: WereadQrLoginFailure | null
}

export interface WereadWebSessionStatus {
  configured: boolean
  vid: string | null
  updatedAt: number | null
  /** False only after a definitive upstream auth rejection; the cookie is
   * kept so a later successful verification can restore it. */
  valid: boolean
}

/** Standalone data export (用户数据导出): user-owned structured data, never restorable. */
export interface ArchiveDataExport {
  version: 1
  kind: 'bookdock-data-export'
  scope: ReadingImportScope
  exportedAt: number
  books?: NotesExportBook[]
  reviews?: NotesExportReview[]
  sessions?: ArchiveDataExportSession[]
  durationFacts?: Array<{
    archiveId: string | null
    title: string | null
    author: string | null
    granularity: 'book_total' | 'book_day' | 'account_total' | 'account_day'
    date: string | null
    durationSeconds: number
    aggregationRole: 'additive' | 'reference'
    overlapGroup: string | null
    source: ReadingImportSource | 'native'
  }>
}

/** One reading session inside a data export. Not the ledger's internal detail
 * type: a full export flattens every book's sessions, so each row carries its
 * own attribution, and projection-only fields (progress scale, projected
 * coverage) are left out rather than exported dead weight. */
export interface ArchiveDataExportSession {
  bookId: string
  title: string | null
  author: string | null
  id: string
  roundId: string | null
  source: ReadingSource
  date: string
  startedAt: number | null
  endedAt: number | null
  durationSeconds: number
  startFraction: number | null
  endFraction: number | null
  startCfi: string | null
  endCfi: string | null
  startChapterIndex: number | null
  endChapterIndex: number | null
  coverage: ReadingCoverageInterval[]
  fragments: ReadingTimeFragment[]
  timezone: string
  revisionId: string | null
  wordCount: number | null
}

/** Source book identities bound the selection arrays. WeRead ids are short,
 * but a legado identity is `name::author` with up to 2000 characters per side
 * (legado-import.ts), so the cap follows the widest source instead of
 * rejecting books that previewed fine. */
const SOURCE_BOOK_KEY_SCHEMA = z.string().min(1).max(4200)

/** Book-list request: loads the source's shelf/notebook overview only. */
export const wereadBookListReqSchema = z.object({
  channel: z.enum(['skill', 'web']).default('skill'),
  scope: readingImportScopeSchema.default('all'),
})

/** Preview request: fetches per-book records for the ticked books. Absent
 * `bookKeys` means "every listed book"; an empty array is a real choice and
 * fetches nothing. */
export const wereadPreviewReqSchema = wereadBookListReqSchema.extend({
  bookKeys: z.array(SOURCE_BOOK_KEY_SCHEMA).max(500).optional(),
})

/** Apply request: consumes a stored preview snapshot. */
export const readingImportApplyReqSchema = z.object({
  previewId: z.string().min(1).max(128),
  bookKeys: z.array(SOURCE_BOOK_KEY_SCHEMA).max(500).optional(),
  /** Import identities the reader decided to overwrite with the source. */
  overwrite: z.array(SOURCE_BOOK_KEY_SCHEMA).max(500).optional(),
})

/** Locator-report and mount requests: the archive is the URL parameter. */
export const importTargetBookReqSchema = z.object({
  targetBookVersionId: z.string().min(1).max(128),
})
