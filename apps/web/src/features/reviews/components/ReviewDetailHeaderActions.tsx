import type { Review } from '@bookdock/shared'

import InteractionHeaderActions from '@/components/discussion/InteractionHeaderActions'
import { ChevronLeftIcon } from '@/features/reader/components/annotation-icons'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'

import { useDeleteReview, useReviewAction } from '../hooks/useReviews'

export function ReviewDetailModalTitle({ onBack, title }: { onBack: () => void; title?: string }) {
  const _ = useTranslation()
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200 cursor-pointer"
        aria-label={_('common.back')}
      >
        <ChevronLeftIcon />
      </button>
      <span className="font-semibold text-stone-800 dark:text-stone-200">{title ?? _('review.detailTitle')}</span>
    </div>
  )
}

export interface ReviewDetailHeaderActionsProps {
  review: Review
  onEdit?: (review: Review) => void
  onDeleted?: () => void
  onShare?: (review: Review) => void
  theme?: 'reader' | 'app'
}

/** Modal top-bar actions for the review detail: like (countless), copy, share, edit and delete. */
export default function ReviewDetailHeaderActions({
  review,
  onEdit,
  onDeleted,
  onShare,
  theme = 'app',
}: ReviewDetailHeaderActionsProps) {
  const _ = useTranslation()
  const user = useAuthStore((state) => state.user)
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

  async function handleDelete() {
    try {
      await deleteReview.mutateAsync(review.id)
      notify.success({ key: 'review.deletedNotice' })
      onDeleted?.()
    } catch (error) {
      notify.error(getUserErrorNotification(error, 'review.deleteFailed'))
    }
  }

  function handleCopy() {
    const parts: string[] = []
    if (review.title) parts.push(review.title)
    if (review.body) parts.push(review.body)
    const text = parts.join('\n\n')
    if (!text) return
    void navigator.clipboard.writeText(text).then(
      () => notify.success({ key: 'reader.copied' }),
      () => notify.error({ key: 'reader.copyFailed' }),
    )
  }

  return (
    <InteractionHeaderActions
      liked={review.liked}
      onToggleLike={toggleLike}
      isLikePending={likeAction.isPending}
      canLike={Boolean(user)}
      onCopy={handleCopy}
      onShare={onShare ? () => onShare(review) : undefined}
      onEdit={review.own && onEdit ? () => onEdit(review) : undefined}
      onDelete={review.canDelete ? () => void handleDelete() : undefined}
      deleteConfirmTitle={_('review.deleteConfirmTitle')}
      deleteConfirmMessage={_('review.deleteConfirmMessage')}
      deleteConfirmLabel={_('comment.delete')}
      theme={theme}
    />
  )
}
