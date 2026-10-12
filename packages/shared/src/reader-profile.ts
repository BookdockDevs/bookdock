import { z } from 'zod'

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

export const archiveBooksQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  type: archiveRecordTypeSchema.optional(),
  sort: z.enum(['recent', 'records', 'title']).default('recent'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})
export type ArchiveBooksQuery = z.infer<typeof archiveBooksQuerySchema>

export interface ArchiveCounts {
  highlights: number
  bookmarks: number
  ideas: number
  reviews: number
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
  lastRecordAt: number | null
}

export interface ArchiveOverview {
  counts: ArchiveCounts
  recent: ArchiveBookItem[]
}

export interface ArchiveBookDetail {
  annotations: AnnotationRes[]
  reviews: Review[]
}
