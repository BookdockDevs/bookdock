import type { ReviewBookContext } from '@bookdock/shared'

/** Visible review total: counts rows on hand, not rated shared rows, so a
 *  private own review never hides other visible reviews from the entry. */
export function getReviewTotalCount(context: ReviewBookContext | null | undefined): number {
  if (!context) return 0
  const shared = Array.isArray(context.reviews) ? context.reviews : []
  if (context.own && !shared.some((r) => r.id === context.own!.id)) return shared.length + 1
  return shared.length
}
