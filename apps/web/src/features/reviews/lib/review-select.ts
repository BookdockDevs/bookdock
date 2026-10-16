import type { Review } from '@bookdock/shared'

import { reviewExcerptLines } from './markdown'

/** A review counts as having a body when its parsed text survives markup
 *  stripping, or when it carries managed images. */
export function hasReviewBody(review: Review): boolean {
  if ((review.files?.length ?? 0) > 0) return true
  if (!review.body) return false
  const text = reviewExcerptLines(review.body, review.bodyFormat, 400)
  return text.replace(/[*_`#>\-|[\]()!~:\\]+/g, '').trim().length > 0
}

const DAY_MS = 86400000

/** Hot score for 6+ candidates: engagement decayed over ~half a year. */
export function scoreReview(review: Review, now = Date.now()): number {
  const days = Math.max(0, (now - review.createdAt) / DAY_MS)
  return (3 * review.likeCount + 2 * review.commentCount + 1) * Math.exp(-days / 180)
}

function compareReviews(a: Review, b: Review): number {
  return b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * Featured-review pick over the already permission-filtered visible set:
 * single review wins directly; bodies beat rating-only; 6+ bodies go by hot
 * score. No weight for stars, identity or ownership.
 */
export function pickFeaturedReview(allReviews: Review[], now = Date.now()): Review | null {
  if (allReviews.length === 0) return null
  if (allReviews.length === 1) return allReviews[0]
  const withBody = allReviews.filter(hasReviewBody).sort(compareReviews)
  const ratingOnly = allReviews.filter((review) => !hasReviewBody(review)).sort(compareReviews)
  if (allReviews.length <= 5) return withBody[0] ?? ratingOnly[0] ?? null
  if (withBody.length > 0) {
    return [...withBody].sort((a, b) =>
      scoreReview(b, now) - scoreReview(a, now) || compareReviews(a, b),
    )[0] ?? null
  }
  return ratingOnly[0] ?? null
}
