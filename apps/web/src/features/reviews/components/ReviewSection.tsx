import { useState } from 'react'

import type { Review, ReviewBookContext } from '@bookdock/shared'

import QueryErrorState from '@/components/ui/QueryErrorState'
import { GroupLabel } from '@/features/library/components/book-detail/ui'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'

import { useReviewBookContext, useReviewWorkContext } from '../hooks/useReviews'
import ReviewCard from './ReviewCard'
import ReviewEditor from './ReviewEditor'
import StarRating from './StarRating'

function DistributionBars({ summary }: { summary: NonNullable<ReviewBookContext['summary']> }) {
  const _ = useTranslation()
  const [open, setOpen] = useState(false)
  const max = Math.max(1, ...summary.distribution.map((bucket) => bucket.count))
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-xs text-stone-400 transition-colors hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200"
      >
        <span className="tabular-nums">{_('review.ratingCount', { count: summary.count })}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={open ? 'rotate-180' : ''}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="mt-2 space-y-1" role="list" aria-label={_('review.distributionLabel')}>
          {summary.distribution.map((bucket) => (
            <div key={bucket.rating} role="listitem" className="flex items-center gap-2 text-[11px]">
              <span className="w-7 shrink-0 tabular-nums text-stone-500 dark:text-stone-400">{bucket.rating}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200/70 dark:bg-stone-700/70">
                <div
                  className="h-full rounded-full bg-amber-400"
                  style={{ width: `${(bucket.count / max) * 100}%` }}
                />
              </div>
              <span className="w-6 shrink-0 text-right tabular-nums text-stone-400 dark:text-stone-500">{bucket.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ReviewSectionBody({
  context,
  canCollect,
  isWorkScope,
}: {
  context: ReviewBookContext
  canCollect?: boolean
  isWorkScope: boolean
}) {
  const _ = useTranslation()
  const user = useAuthStore((state) => state.user)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Review | null>(null)

  const { composer, own, summary, reviews } = context
  const others = own ? reviews.filter((review) => review.id !== own.id) : reviews

  function openCompose() {
    setEditing(null)
    setEditorOpen(true)
  }

  function openEdit(review: Review) {
    setEditing(review)
    setEditorOpen(true)
  }

  // The editor publishes from the composer's held version, which keeps
  // multi-version holdings and version switches on the same review.
  const editorVersionId = composer.bookVersionId

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {summary && summary.count > 0 ? (
          <>
            <StarRating
              value={Math.round(summary.average! * 2) / 2}
              size={17}
              label={_('review.averageApprox', { value: summary.average!.toFixed(1) })}
            />
            <span className="text-sm font-semibold tabular-nums text-stone-800 dark:text-stone-100">
              {summary.average!.toFixed(1)}
            </span>
            <DistributionBars summary={summary} />
          </>
        ) : (
          <span className="text-xs text-stone-400 dark:text-stone-500">{_('review.noRatings')}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {user && composer.eligible && editorVersionId && !own && (
            <button
              type="button"
              onClick={openCompose}
              className="rounded-full bg-stone-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-stone-700 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300"
            >
              {summary ? _('review.writeReview') : _('review.rateOrReview')}
            </button>
          )}
          {user && composer.eligible && editorVersionId && own && (
            <button
              type="button"
              onClick={() => openEdit(own)}
              className="rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              {own.rating == null ? _('review.addRating') : _('review.editReview')}
            </button>
          )}
          {user && !composer.eligible && isWorkScope && canCollect && (
            <span className="text-[11px] text-stone-400 dark:text-stone-500">{_('review.collectToReviewHint')}</span>
          )}
        </div>
      </div>

      {own && (
        <div className="mt-3">
          <ReviewCard review={own} onEdit={editorVersionId ? openEdit : undefined} />
        </div>
      )}

      {others.length > 0 ? (
        <div className="mt-3 space-y-2.5">
          {others.map((review) => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      ) : (
        summary != null && (
          <p className="mt-3 text-xs text-stone-400 dark:text-stone-500">
            {own ? _('review.noOtherReviews') : _('review.noReviews')}
          </p>
        )
      )}

      {editorOpen && editorVersionId && (
        <ReviewEditor
          bookVersionId={editorVersionId}
          existing={editing}
          composer={composer}
          onClose={() => {
            setEditorOpen(false)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

export default function ReviewSection({
  bookVersionId,
  libraryId,
  libraryBookId,
  canCollect,
}: {
  /** Private-detail scope: the held version id. Omit for shared-work scope. */
  bookVersionId?: string | null
  libraryId?: string | null
  libraryBookId?: string | null
  canCollect?: boolean
}) {
  const _ = useTranslation()
  const isWorkScope = bookVersionId == null
  const bookQuery = useReviewBookContext(isWorkScope ? null : (bookVersionId ?? null))
  const workQuery = useReviewWorkContext(
    isWorkScope ? (libraryId ?? null) : null,
    isWorkScope ? (libraryBookId ?? null) : null,
  )
  const query = isWorkScope ? workQuery : bookQuery
  const raw = query.data?.data
  // Coarse test doubles (and any contract drift) may resolve an unrelated
  // payload for this endpoint; degrade to the error state instead of
  // crashing the whole detail dialog on a malformed body.
  const context: ReviewBookContext | null =
    raw && typeof raw === 'object' && typeof (raw as ReviewBookContext).composer === 'object' && Array.isArray((raw as ReviewBookContext).reviews)
      ? (raw as ReviewBookContext)
      : null

  return (
    <section className="mt-5" aria-label={_('review.sectionTitle')}>
      <GroupLabel>{_('review.sectionTitle')}</GroupLabel>
      {query.isPending ? (
        <div className="animate-pulse space-y-2">
          <div className="h-4 w-40 rounded bg-stone-500/15" />
          <div className="h-16 rounded-xl bg-stone-500/10" />
        </div>
      ) : query.isError || !context ? (
        <QueryErrorState isRetrying={query.isFetching} onRetry={() => void query.refetch()} />
      ) : (
        <ReviewSectionBody
          context={context}
          canCollect={canCollect}
          isWorkScope={isWorkScope}
        />
      )}
    </section>
  )
}
