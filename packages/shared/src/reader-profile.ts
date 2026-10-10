import { z } from 'zod'

import type { AnnotationRes } from './contract'
import type { MyReviewEntry } from './review'

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
