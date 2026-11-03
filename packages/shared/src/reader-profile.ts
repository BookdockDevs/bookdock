import { z } from 'zod'

import { isOrderedReadingRange, readingRangeShape } from './reading-range'

import type { AnnotationRes } from './contract'
import type { AnnotationStyle } from './domain'
import type { BookFormat, ReadStatus } from './constants'
import type { MyReviewEntry, Review } from './review'

export interface ProfileReadingSummary {
  totalSeconds: number
  totalWordsRead: number
  totalBooks: number
  finishedBooks: number
  totalDays: number
  currentStreak: number
  longestStreak: number
}

export interface ProfileReadingBook {
  id: string
  title: string
  author: string
  format: BookFormat
  coverKey: string | null
  progress: number
}

export const archiveQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  bookId: z.string().min(1).optional(),
})
export type ArchiveQuery = z.infer<typeof archiveQuerySchema>

export interface ArchivePage<T> {
  entries: T[]
  page: number
  hasMore: boolean
}

export interface NoteArchiveEntry {
  annotation: AnnotationRes
  bookTitle: string | null
  locationStatus: 'available' | 'source-unavailable' | 'position-unavailable'
}

/** Structured notes export (结构化笔记导出): the archive notes surface as a
 * user-owned standalone file. Live rows only — no tombstones, no images or
 * attachments, no discussion threads or likes, and never another user's
 * content. Grouping/visibility mirror the archive notes view, including the
 * archive-snapshot title/author fallback for lost sources. */
export interface NotesExportHighlight {
  id: string
  /** Null = position unknown (imported notes without a source-derivable CFI). */
  cfiRange: string | null
  cfiAnchor: string | null
  color: string
  style: AnnotationStyle
  text: string
  chapter: string | null
  chapterHref: string | null
  createdAt: number
  updatedAt: number
}

export interface NotesExportBookmark {
  id: string
  cfi: string | null
  title: string | null
  contextText: string | null
  chapter: string | null
  chapterHref: string | null
  createdAt: number
  updatedAt: number
}

export interface NotesExportIdea {
  id: string
  cfiRange: string | null
  cfiAnchor: string | null
  color: string
  style: AnnotationStyle
  text: string
  note: string | null
  visibility: 'private' | 'shared'
  chapter: string | null
  chapterHref: string | null
  createdAt: number
  updatedAt: number
  editedAt: number | null
}

export interface NotesExportBook {
  /** Anchored book version; null for an idea detached from any version. */
  bookId: string | null
  title: string | null
  author: string | null
  highlights: NotesExportHighlight[]
  bookmarks: NotesExportBookmark[]
  ideas: NotesExportIdea[]
}

export interface NotesExportReview {
  id: string
  /** 0.5–5 half-star steps; null = unrated. */
  rating: number | null
  title: string | null
  body: string | null
  bodyFormat: 'plain' | 'markdown'
  visibility: 'private' | 'shared'
  /** Work anchor provenance, exactly one side populated. */
  privateLibraryBookId: string | null
  sourceLibraryId: string | null
  sourceLibraryBookId: string | null
  /** The read-time version this review was written from, if recorded. */
  bookVersionId: string | null
  /** Work attribution; a source the caller can no longer read contributes
   * nothing — the retained reading-archive snapshot is the fallback. */
  workTitle: string | null
  workAuthor: string | null
  createdAt: number
  updatedAt: number
  editedAt: number | null
}

export interface NotesExport {
  version: 1
  exportedAt: number
  books: NotesExportBook[]
  reviews: NotesExportReview[]
}

export interface ReaderProfile {
  author: { id: string; name: string; avatarKey: string | null; bio?: string; createdAt?: number }
  isOwner?: boolean
  visibility?: 'public' | 'private'
  showStats?: boolean
  showShowcase?: boolean
  showPublicActivity?: boolean
  summary?: ProfileReadingSummary
  currentlyReading?: ProfileReadingBook[]
  reviews: ArchivePage<MyReviewEntry>
}

/**
 * Reading archive (阅读档案): the owner's own highlights, bookmarks, ideas
 * and reviews aggregated per book version. All counts are live rows only
 * (deleted_at IS NULL); reviews are hard-deleted so every owned row counts.
 */
export const archiveRecordTypeSchema = z.enum(['highlight', 'bookmark', 'idea', 'review'])
export type ArchiveRecordType = z.infer<typeof archiveRecordTypeSchema>

export const archiveSortSchema = z.enum([
  'recent',
  'earliest',
  'most',
  'fewest',
  'reading-time',
  'reading-time-asc',
  'title-asc',
  'title-desc',
])
export type ArchiveSort = z.infer<typeof archiveSortSchema>

export function parseArchiveRecordTypes(typeStr?: string | null): ArchiveRecordType[] {
  if (!typeStr || typeStr === 'all') return []
  const allowed = new Set<string>(['highlight', 'bookmark', 'idea', 'review'])
  return typeStr.split(',').map((s) => s.trim()).filter((s): s is ArchiveRecordType => allowed.has(s))
}

export function parseArchiveReadStatuses(statusStr?: string | null): ReadStatus[] {
  if (!statusStr || statusStr === 'all') return []
  const allowed = new Set<string>(['reading', 'finished', 'wishlist', 'idle', 'abandoned'])
  return statusStr.split(',').map((s) => s.trim()).filter((s): s is ReadStatus => allowed.has(s))
}

export const archiveBooksQuerySchema = z.object({
  ...readingRangeShape,
  search: z.string().trim().max(200).optional(),
  type: z.string().trim().optional(),
  readStatus: z.string().trim().optional(),
  tag: z.string().trim().max(100).optional(),
  sort: archiveSortSchema.default('recent'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).refine(isOrderedReadingRange, { message: 'Range ends before it starts', path: ['to'] })
export type ArchiveBooksQuery = z.infer<typeof archiveBooksQuerySchema>

export interface ArchiveCounts {
  highlights: number
  bookmarks: number
  ideas: number
  reviews: number
  total: number
}

export interface ArchiveBookItem {
  bookVersionId: string
  title: string | null
  author: string | null
  coverKey: string | null
  /** Remote cover URL for imported archive rows (coverKey is null there). */
  coverUrl?: string | null
  /** True for imported reading history rows (no bookdock work/version behind the id). */
  imported?: boolean
  importSource?: 'weread' | 'legado' | null
  format: BookFormat | null
  readStatus: ReadStatus | null
  highlights: number
  bookmarks: number
  ideas: number
  reviews: number
  total: number
  durationSeconds?: number
  referenceDurationSeconds?: number
  readingDays?: number | null
  progress?: number | null
  /** Max created_at across live annotations/reviews, scoped to the requested type. */
  lastRecordAt: number | null
  /** Min created_at across live annotations/reviews, scoped to the requested type. */
  firstRecordAt: number | null
}

export interface ArchiveOverview {
  counts: ArchiveCounts
  totalBooks: number
}

export interface ArchiveBookDetail {
  annotations: AnnotationRes[]
  reviews: Review[]
}
