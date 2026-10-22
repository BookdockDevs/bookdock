import { useState } from 'react'

import type { Review } from '@bookdock/shared'

import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { HeartIcon } from '@/features/reader/components/annotation-icons'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

import { useDeleteReview, useReviewAction } from '../hooks/useReviews'

export function ReviewDetailModalTitle({ onBack }: { onBack: () => void }) {
  const _ = useTranslation()
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        aria-label={_('common.back')}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <span>{_('review.detailTitle')}</span>
    </div>
  )
}

export interface ReviewDetailHeaderActionsProps {
  review: Review
  onEdit?: (review: Review) => void
  onDeleted?: () => void
}

/** Modal top-bar actions for the review detail: like (countless), edit and delete. */
export default function ReviewDetailHeaderActions({ review, onEdit, onDeleted }: ReviewDetailHeaderActionsProps) {
  const _ = useTranslation()
  const user = useAuthStore((state) => state.user)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const likeAction = useReviewAction(review.id)
  const deleteReview = useDeleteReview()

  function toggleLike() {
    if (!user || likeAction.isPending) return
    likeAction.mutate(
      { type: 'like', liked: !review.liked },
      {
        onError: (error) => notify.error(getUserErrorNotification(error, 'review.discussionFailed')),
      },
    )
  }

  async function confirmDeleteReview() {
    try {
      await deleteReview.mutateAsync(review.id)
      notify.success({ key: 'review.deletedNotice' })
      setConfirmDelete(false)
      onDeleted?.()
    } catch (error) {
      notify.error(getUserErrorNotification(error, 'review.deleteFailed'))
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={toggleLike}
        disabled={!user || likeAction.isPending}
        title={review.liked ? _('comment.unlike') : _('comment.like')}
        className={cn(
          'rounded-lg p-1.5 transition-colors disabled:cursor-not-allowed disabled:opacity-60',
          review.liked
            ? 'text-red-500 hover:text-red-600'
            : 'text-stone-400 hover:bg-stone-100 hover:text-red-500 dark:text-stone-500 dark:hover:bg-stone-800',
          !user && 'cursor-default opacity-80',
        )}
      >
        <HeartIcon size={15} filled={review.liked} strokeWidth={2} />
      </button>
      {review.own && onEdit && (
        <button
          type="button"
          onClick={() => onEdit(review)}
          title={_('comment.edit')}
          className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      )}
      {review.canDelete && (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          title={_('comment.delete')}
          className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-stone-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
          </svg>
        </button>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={_('review.deleteConfirmTitle')}
          message={_('review.deleteConfirmMessage')}
          confirmLabel={_('comment.delete')}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void confirmDeleteReview()}
        />
      )}
    </div>
  )
}
