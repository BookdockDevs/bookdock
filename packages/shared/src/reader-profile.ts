import { z } from 'zod'

import { isOrderedReadingRange, readingRangeShape } from './reading-range'

import type { AnnotationRes } from './contract'
import type { BookFormat, ReadStatus } from './constants'
import type { MyReviewEntry, Review } from './review'

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

export interface ReaderProfile {
  author: { id: string; name: string; avatarKey: string | null }
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
  format: BookFormat
  readStatus: ReadStatus
  highlights: number
  bookmarks: number
  ideas: number
  reviews: number
  total: number
  durationSeconds?: number
  readingDays?: number
  progress?: number
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
