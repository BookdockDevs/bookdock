import { z } from 'zod'

export const BOOK_SHARE_DURATIONS = ['1h', '1d', '7d', '30d', 'permanent'] as const
export const DEFAULT_BOOK_SHARE_DURATION = '7d'

export const bookShareSourceSchema = z.object({ libraryId: z.string().min(1).max(128).optional() })
export const bookShareRequestSchema = bookShareSourceSchema.extend({ duration: z.enum(BOOK_SHARE_DURATIONS) })
export const bookShareGenerateRequestSchema = bookShareRequestSchema.extend({ replace: z.boolean().optional() })
export type BookShareDuration = (typeof BOOK_SHARE_DURATIONS)[number]

export interface BookShareLink {
  url: string
  duration: BookShareDuration
  expiresAt: number | null
}
