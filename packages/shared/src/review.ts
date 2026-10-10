import { z } from 'zod'

/**
 * Book reviews (书评) v1 contract. Reviews anchor to works, never to file
 * versions or content revisions: a pure private work anchors to its private
 * `library_books` row, a collected work anchors to its source work as
 * plain-text `(sourceLibraryId, sourceLibraryBookId)` provenance.
 */

export type ReviewVisibility = 'private' | 'shared'
export const reviewVisibilitySchema = z.enum(['private', 'shared'])

export type ReviewBodyFormat = 'plain' | 'markdown'
export const reviewBodyFormatSchema = z.enum(['plain', 'markdown'])

/** Ten half-star steps from 0.5 to 5. Unrated is null, never zero. */
export const REVIEW_RATINGS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5] as const
export type ReviewRating = (typeof REVIEW_RATINGS)[number]

export const reviewRatingSchema = z
  .number()
  .min(0.5)
  .max(5)
  .refine((value) => Math.round(value * 2) === value * 2, { message: 'rating must be a half-star step' })

/** Storage unit: integer halves 1–10, so the ten buckets never lose precision. */
export function reviewRatingToHalves(rating: number): number {
  return Math.round(rating * 2)
}

export function reviewHalvesToRating(halves: number): number {
  return halves / 2
}

export const REVIEW_BODY_MAX_LENGTH = 20000
export const REVIEW_COMMENT_MAX_LENGTH = 10000
/** Independent preference key from the ideas composer (never shared). */
export const REVIEW_VISIBILITY_KEY = 'reviews.last-created-visibility'

export interface ReviewAuthor {
  id: string
  name: string
  avatarKey: string | null
}

export interface ReviewSourceRef {
  libraryId: string
  libraryBookId: string
  /** Null once the source library is gone; the ids are still kept. */
  libraryName: string | null
}

export interface ReviewProvenance {
  listingId: string | null
  bookVersionId: string | null
  revisionId: string | null
  /** Resolved version label; null when the provenance no longer reads. */
  versionName: string | null
  available: boolean
}

export interface Review {
  id: string
  rating: number | null
  body: string | null
  bodyFormat: ReviewBodyFormat
  visibility: ReviewVisibility
  /** Set for source-anchored reviews; null for pure private reviews. */
  source: ReviewSourceRef | null
  /** Set for pure private reviews; null for source-anchored reviews. */
  privateLibraryBookId: string | null
  provenance: ReviewProvenance | null
  author: ReviewAuthor
  own: boolean
  canDelete: boolean
  likeCount: number
  liked: boolean
  commentCount: number
  createdAt: number
  updatedAt: number
  editedAt: number | null
}

export interface ReviewRatingBucket {
  rating: number
  count: number
}

export interface ReviewSummary {
  average: number | null
  count: number
  /** Always ten buckets (0.5–5), zero-filled, never rounded away. */
  distribution: ReviewRatingBucket[]
}

export interface ReviewComposerContext {
  /** Which anchor a publish from this book would use. */
  anchor: 'private' | 'source' | null
  /** Whether the caller currently holds the work. */
  eligible: boolean
  /** Whether the source work currently reads for a shared choice. */
  sourceReadable: boolean
  /**
   * Whether a shared publish is currently allowed from the held version:
   * the work reads AND the collector's own source listing still reads. Other
   * versions of the same work being readable never substitutes for this.
   */
  canPublishShared: boolean
  defaultVisibility: ReviewVisibility
  existing: Review | null
  /** Held private version the composer publishes from; null when not held. */
  bookVersionId: string | null
}

export interface ReviewComment {
  id: string
  parentId: string | null
  replyToId: string | null
  replyToName: string | null
  author: ReviewAuthor
  body: string | null
  createdAt: number
  editedAt: number | null
  deletedAt: number | null
  own: boolean
  canDelete: boolean
  liked: boolean
  likeCount: number
}

export interface ReviewDiscussion {
  review: Review
  comments: ReviewComment[]
  likers: ReviewAuthor[]
}

export type ReviewSourceStatus = 'ok' | 'unavailable' | 'trashed' | 'deleted' | 'library-deleted' | 'private'

export interface MyReviewEntry {
  review: Review
  /** Private-anchored rows always report `private`. */
  sourceStatus: ReviewSourceStatus
  workTitle: string | null
}

export interface ReviewBookContext {
  composer: ReviewComposerContext
  /** The caller's own review under either anchor, regardless of visibility. */
  own: Review | null
  /** Shared statistics; null when the work has no shared scope for the viewer. */
  summary: ReviewSummary | null
  /** Shared reviews visible to the viewer, newest last. */
  reviews: Review[]
}

const reviewIdSchema = z.string().min(1).max(128)

export const reviewCreateSchema = z
  .object({
    /** Private BookVersion being read; the server resolves the work anchor. */
    bookVersionId: reviewIdSchema,
    rating: reviewRatingSchema.nullable().optional(),
    body: z.string().max(REVIEW_BODY_MAX_LENGTH).nullable().optional(),
    visibility: reviewVisibilitySchema.optional(),
  })
  .strict()
  .refine((value) => value.rating != null || (value.body != null && value.body.trim() !== ''), {
    message: 'rating or body is required',
  })

export type ReviewCreateReq = z.infer<typeof reviewCreateSchema>

export const reviewUpdateSchema = z
  .object({
    rating: reviewRatingSchema.nullable().optional(),
    body: z.string().max(REVIEW_BODY_MAX_LENGTH).nullable().optional(),
    visibility: reviewVisibilitySchema.optional(),
  })
  .strict()

export type ReviewUpdateReq = z.infer<typeof reviewUpdateSchema>

export const reviewCommentCreateSchema = z
  .object({
    body: z.string().trim().min(1).max(REVIEW_COMMENT_MAX_LENGTH),
    replyToId: z.string().min(1).optional(),
  })
  .strict()

export const reviewCommentUpdateSchema = z
  .object({
    body: z.string().trim().min(1).max(REVIEW_COMMENT_MAX_LENGTH),
  })
  .strict()

export const reviewLikeSchema = z.object({ liked: z.boolean() }).strict()
