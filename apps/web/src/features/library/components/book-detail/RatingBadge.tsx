import type { ReviewSummary } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'

/**
 * The work's public rating. Both detail bodies drew this block themselves and
 * could therefore disagree about when it appears; the threshold lives here now:
 * a summary without rated reviews has no average worth showing, and a private
 * note is not a public rating.
 */
export default function RatingBadge({
  summary,
  onClick,
}: {
  summary: ReviewSummary | null | undefined
  /** Opens the review list; absent makes the badge inert. */
  onClick?: () => void
}) {
  const _ = useTranslation()
  if (!summary || summary.count <= 0 || summary.average == null) return null
  const average = summary.average
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col items-end text-right transition-opacity hover:opacity-80"
    >
      <div className="flex items-center gap-1.5 text-amber-500">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <span className="text-2xl font-bold tabular-nums text-stone-900 dark:text-stone-100">
          {average.toFixed(1)}
        </span>
      </div>
      <span className="text-xs tabular-nums text-stone-400 dark:text-stone-500">
        {_('review.ratingCount', { count: summary.count })}
      </span>
    </button>
  )
}
