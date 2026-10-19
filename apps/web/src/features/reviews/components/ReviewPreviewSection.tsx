import type { Review, ReviewBookContext } from '@bookdock/shared'

import { ChatBubbleIcon, HeartIcon, LockIcon } from '@/features/reader/components/annotation-icons'
import { formatFullDateTime, formatRelativeTime } from '@/features/reader/components/format-relative-time'
import { useTranslation } from '@/hooks/useTranslation'
import { avatarUrl } from '@/lib/avatar'

import { reviewExcerptLines } from '../lib/markdown'
import { reviewIconPaths } from '../lib/review-icon'
import { hasReviewBody, pickFeaturedReview, visibleReviews } from '../lib/review-select'
import StarRating from './StarRating'

export interface ReviewPreviewSectionProps {
  context: ReviewBookContext | null | undefined
  /** Whether the caller may write a review here. */
  canReview?: boolean
  onCompose?: () => void
  onViewAll: () => void
  onOpenReview?: (review: Review) => void
}

export default function ReviewPreviewSection({ context, canReview = false, onCompose, onViewAll, onOpenReview }: ReviewPreviewSectionProps) {
  const _ = useTranslation()

  if (!context || !Array.isArray(context.reviews)) return null

  const { reviews, own } = context

  // The capsule and list entry count visible rows, not rated shared rows:
  // a private own review must never hide other visible reviews.
  const allReviews: Review[] = visibleReviews(own, reviews)

  // Total visible reviews count
  const totalCount = allReviews.length

  if (allReviews.length === 0) {
    return null
  }

  // Featured pick over the visible set; single reviews show directly.
  const previewReview = pickFeaturedReview(allReviews)
  if (!previewReview) {
    return null
  }
  const previewHasBody = hasReviewBody(previewReview)
  const featuredReview: Review = previewReview

  // A single review needs no list entry: the preview itself opens its detail.
  const showListEntry = totalCount > 1

  function openPreview() {
    if (onOpenReview) onOpenReview(featuredReview)
    else onViewAll()
  }

  const authorAvatar = avatarUrl(previewReview.author.avatarKey)
  const excerpt = previewReview.body ? reviewExcerptLines(previewReview.body, previewReview.bodyFormat) : ''

  return (
    <section className="mt-5" aria-label={_('review.reviewsTitle')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h4 className="text-base font-bold text-stone-900 dark:text-stone-100">
            {_('review.reviewsTitle')}
          </h4>
          {showListEntry && (
            <span className="rounded-full bg-stone-200/40 px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums text-stone-500 dark:bg-stone-800/70 dark:text-stone-400">
              {totalCount}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {/* Writing a review belongs here; the action row only offers the
              shortcut that opens this section. */}
          {canReview && !own && onCompose && (
            <button
              type="button"
              onClick={onCompose}
              className="flex min-h-8 shrink-0 items-center gap-1.5 rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {reviewIconPaths}
              </svg>
              <span>{_('review.writeReview')}</span>
            </button>
          )}
          {showListEntry && (
            <button
              type="button"
              onClick={onViewAll}
              className="group inline-flex items-center gap-0.5 text-xs text-stone-500 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100"
            >
              <span>{_('review.viewAll')}</span>
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-transform group-hover:translate-x-0.5"
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={openPreview}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openPreview()
          }
        }}
        className="mt-3 cursor-pointer rounded-xl p-1 transition-colors hover:bg-stone-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 dark:hover:bg-stone-800/50"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {authorAvatar ? (
              <img src={authorAvatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-500/10 text-xs font-medium text-stone-600 dark:text-stone-400">
                {previewReview.author.name.slice(0, 1)}
              </span>
            )}
            <span className="text-sm font-medium text-stone-800 dark:text-stone-200">
              {previewReview.author.name}
            </span>
            {previewReview.own && (
              <span className="rounded bg-stone-500/15 px-1.5 py-px text-[10px] text-stone-500 dark:text-stone-400">
                {_('review.ownBadge')}
              </span>
            )}
            {previewReview.visibility === 'private' && (
              <span className="inline-flex items-center gap-1 rounded bg-stone-500/15 px-1.5 py-px text-[10px] text-stone-500 dark:text-stone-400">
                <LockIcon size={10} />
                {_('review.visibilityPrivate')}
              </span>
            )}
            {!previewHasBody && (
              <span
                title={_('review.publishedTimeTitle', { value: formatFullDateTime(_, previewReview.createdAt) })}
                className="text-xs text-stone-400 dark:text-stone-500"
              >
                {formatRelativeTime(_, previewReview.createdAt)}
              </span>
            )}
          </div>

          {previewReview.rating != null && (
            <div className="flex shrink-0 items-center">
              <StarRating value={previewReview.rating} size={14} />
            </div>
          )}
        </div>

        {previewHasBody && excerpt && (
          <p className="mt-2 line-clamp-4 text-sm leading-[1.55] whitespace-pre-line text-stone-600 dark:text-stone-300">
            {excerpt}
          </p>
        )}

        {previewHasBody && (
          <div className="mt-2.5 flex items-center justify-end gap-3 text-xs text-stone-400 dark:text-stone-500">
            <span className="flex items-center gap-1">
              <HeartIcon size={13} filled={previewReview.liked} strokeWidth={2} />
              <span className="tabular-nums">{previewReview.likeCount}</span>
            </span>
            <span className="flex items-center gap-1">
              <ChatBubbleIcon size={13} strokeWidth={2} />
              <span className="tabular-nums">{previewReview.commentCount}</span>
            </span>
          </div>
        )}
      </div>
    </section>
  )
}
