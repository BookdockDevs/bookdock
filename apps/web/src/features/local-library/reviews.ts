import type { ClientReview, Review, ReviewBookContext, ReviewComposerContext } from '@bookdock/shared'
import { reviewHalvesToRating, reviewRatingToHalves } from '@bookdock/shared'

/**
 * A device review is the private half of a server review. The server row
 * carries an author, likes, comments and a source listing; none of those exist
 * on a device book, so the projection fills in the inert values the shared
 * presentation reads and the local views hide the social half entirely.
 */
export function localReviewView(review: ClientReview): Review {
  return {
    id: review.id,
    rating: review.ratingHalves === null || review.ratingHalves === 0 ? null : reviewHalvesToRating(review.ratingHalves),
    title: review.title.trim() ? review.title : null,
    body: review.body.trim() ? review.body : null,
    bodyFormat: review.bodyFormat,
    visibility: 'private',
    source: null,
    privateLibraryBookId: null,
    provenance: null,
    author: { id: '', name: '', avatarKey: null },
    own: true,
    canDelete: true,
    likeCount: 0,
    liked: false,
    commentCount: 0,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    editedAt: review.updatedAt > review.createdAt ? review.updatedAt : null,
  }
}

/** The stored halves for a composer rating; decimals never leave the UI. */
export function localRatingHalves(rating: number | null): number | null {
  return rating === null ? null : reviewRatingToHalves(rating)
}

export function localReviewComposer(review: ClientReview | null, bookVersionId: string): ReviewComposerContext {
  return {
    anchor: 'private',
    eligible: true,
    // A device book has no source listing, so a shared publish is impossible
    // by construction rather than by permission.
    sourceReadable: false,
    canPublishShared: false,
    defaultVisibility: 'private',
    existing: review ? localReviewView(review) : null,
    bookVersionId,
  }
}

export function localReviewBookContext(review: ClientReview | null, bookVersionId: string): ReviewBookContext {
  return {
    composer: localReviewComposer(review, bookVersionId),
    own: review ? localReviewView(review) : null,
    // Nothing aggregates across devices, so there is no shared summary.
    summary: null,
    reviews: [],
  }
}
