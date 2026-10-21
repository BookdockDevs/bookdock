import { useState } from 'react'

import type { Review } from '@bookdock/shared'

import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { ChatBubbleIcon, HeartIcon, LockIcon, PencilIcon, TrashIcon } from '@/features/reader/components/annotation-icons'
import { formatFullDateTime, formatRelativeTime } from '@/features/reader/components/format-relative-time'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'

import { useDeleteReview, useReviewAction } from '../hooks/useReviews'
import { reviewExcerpt } from '../lib/markdown'
import ReviewDiscussionPanel from './ReviewDiscussionPanel'
import ReviewMarkdown from './ReviewMarkdown'
import StarRating from './StarRating'
import ProfileIdentityLink from '@/features/profile/components/ProfileIdentityLink'

const EXCERPT_LENGTH = 220

export default function ReviewCard({
  review,
  onEdit,
  onDeleted,
  initialDiscussionTab,
  focusCommentId,
  hideDelete = false,
}: {
  review: Review
  onEdit?: (review: Review) => void
  onDeleted?: () => void
  initialDiscussionTab?: 'comments' | 'likes'
  focusCommentId?: string
  /** Notification entries show the review without management actions. */
  hideDelete?: boolean
}) {
  const _ = useTranslation()
  const user = useAuthStore((state) => state.user)
  const [discussionOpen, setDiscussionOpen] = useState(Boolean(initialDiscussionTab || focusCommentId))
  const [bodyOpen, setBodyOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const likeAction = useReviewAction(review.id)
  const deleteReview = useDeleteReview()

  function toggleLike() {
    if (!user || likeAction.isPending) return
    // Like state derives from the query cache: the hook invalidates on
    // settle, so the count refreshes from the server instead of a local copy
    // that a concurrent refetch could overwrite with a stale value.
    likeAction.mutate({ type: 'like', liked: !review.liked }, {
      onError: (error) => notify.error(getUserErrorNotification(error, 'review.discussionFailed')),
    })
  }

  async function remove() {
    try {
      await deleteReview.mutateAsync(review.id)
      notify.success({ key: 'review.deletedNotice' })
      setConfirmDelete(false)
      onDeleted?.()
    } catch (error) {
      notify.error(getUserErrorNotification(error, 'review.deleteFailed'))
    }
  }

  const longBody = (review.body?.length ?? 0) > EXCERPT_LENGTH
  const excerpt = review.body ? reviewExcerpt(review.body, review.bodyFormat, EXCERPT_LENGTH) : ''

  return (
    <article className="rounded-xl border border-stone-200/70 bg-white/60 p-3.5 dark:border-stone-800/70 dark:bg-stone-900/40">
      <div className="flex items-start gap-2.5">
        <ProfileIdentityLink userId={review.author.id} name={review.author.name} avatarKey={review.author.avatarKey} className="inline-flex shrink-0 items-center" avatarClassName="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ProfileIdentityLink userId={review.author.id} name={review.author.name} avatarKey={review.author.avatarKey} className="text-sm font-medium text-stone-800 hover:underline dark:text-stone-100" avatarClassName="hidden" />
            {review.own && (
              <span className="rounded bg-stone-500/15 px-1.5 py-px text-[10px] text-stone-500 dark:text-stone-400">
                {_('review.ownBadge')}
              </span>
            )}
            {review.visibility === 'private' && (
              <span
                title={_('review.visibilityPrivateHint')}
                className="inline-flex items-center gap-1 rounded bg-stone-500/15 px-1.5 py-px text-[10px] text-stone-500 dark:text-stone-400"
              >
                <LockIcon size={10} />
                {_('review.visibilityPrivate')}
              </span>
            )}
            <span
              title={formatFullDateTime(_, review.updatedAt)}
              className="text-[11px] text-stone-400 dark:text-stone-500"
            >
              {formatRelativeTime(_, review.updatedAt)}
              {review.editedAt ? ` · ${_('review.edited')}` : ''}
            </span>
          </div>
          <div className="mt-1.5">
            <StarRating value={review.rating} size={15} />
          </div>
        </div>
        {(review.own || review.canDelete) && (
          <div className="flex shrink-0 items-center gap-0.5">
            {review.own && onEdit && (
              <button
                type="button"
                onClick={() => onEdit(review)}
                title={_('comment.edit')}
                className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              >
                <PencilIcon />
              </button>
            )}
            {review.canDelete && !hideDelete && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                title={_('comment.delete')}
                className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-stone-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
              >
                <TrashIcon size={14} strokeWidth={2} />
              </button>
            )}
          </div>
        )}
      </div>

      {review.title && (
        <h4 className="mt-2 text-sm font-semibold text-stone-800 dark:text-stone-100">{review.title}</h4>
      )}

      {review.body && (
        <div className="mt-2.5">
          {longBody && !bodyOpen ? (
            <div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed break-words text-stone-600 dark:text-stone-300">{excerpt}</p>
              <button
                type="button"
                onClick={() => setBodyOpen(true)}
                className="mt-1 text-xs font-medium text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
              >
                {_('review.expandBody')}
              </button>
            </div>
          ) : (
            <div>
              <ReviewMarkdown body={review.body} format={review.bodyFormat} />
              {longBody && (
                <button
                  type="button"
                  onClick={() => setBodyOpen(false)}
                  className="mt-1 text-xs font-medium text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
                >
                  {_('review.collapseBody')}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {review.provenance && (
        <p
          className="mt-2 text-[11px] text-stone-400 dark:text-stone-500"
          title={review.provenance.available ? _('review.provenanceHint') : _('review.provenanceUnavailableHint')}
        >
          {review.provenance.available
            ? _('review.provenanceLabel', { name: review.provenance.versionName || _('review.versionFallback') })
            : _('review.provenanceUnavailable')}
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-3 border-t border-stone-200/50 pt-2 dark:border-stone-800/50">
        <button
          type="button"
          disabled={!user || likeAction.isPending}
          onClick={() => void toggleLike()}
          title={review.liked ? _('comment.unlike') : _('comment.like')}
          className={cn(
            'flex items-center gap-1 text-xs transition-colors',
            review.liked ? 'font-medium text-red-500' : 'text-stone-400 hover:text-red-500 dark:text-stone-500',
            !user && 'cursor-default opacity-80',
          )}
        >
          <HeartIcon filled={review.liked} size={14} strokeWidth={2} />
          {review.likeCount > 0 && <span className="tabular-nums">{review.likeCount}</span>}
        </button>
        <button
          type="button"
          onClick={() => setDiscussionOpen((v) => !v)}
          aria-expanded={discussionOpen}
          className="flex items-center gap-1 text-xs text-stone-400 transition-colors hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200"
        >
          <ChatBubbleIcon size={14} strokeWidth={2} />
          {review.commentCount > 0 ? (
            <span className="tabular-nums">{_('comment.tabComments', { count: review.commentCount })}</span>
          ) : (
            <span>{user ? _('review.writeComment') : _('comment.tabComments', { count: 0 })}</span>
          )}
        </button>
      </div>

      {discussionOpen && (
        <ReviewDiscussionPanel
          reviewId={review.id}
          reviewAuthorId={review.author.id}
          initialCommentCount={review.commentCount}
          initialLikeCount={review.likeCount}
          initialTab={initialDiscussionTab}
          focusCommentId={focusCommentId}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={_('review.deleteConfirmTitle')}
          message={_('review.deleteConfirmMessage')}
          confirmLabel={_('comment.delete')}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
        />
      )}
    </article>
  )
}
