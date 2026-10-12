import { useEffect } from 'react'

import type { InteractionNotification } from '@bookdock/shared'

import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import IdeaDetailModal from '@/features/reader/components/IdeaDetailModal'
import { useIdeaDiscussion } from '@/features/reader/hooks/useIdeas'
import ReviewCard from '@/features/reviews/components/ReviewCard'
import { useReviewDiscussion } from '@/features/reviews/hooks/useReviews'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import { useNotificationRead, useNotificationTarget } from '../hooks'

function NotificationIdeaBody({ notification, onClose }: { notification: InteractionNotification; onClose: () => void }) {
  const _ = useTranslation()
  // bookId is resolved from the discussion itself: the target payload carries
  // no book, and the modal below needs the real version for navigation and
  // cache updates. Same query key as the modal's internal load, so no refetch.
  const discussion = useIdeaDiscussion(notification.targetId, '')
  if (discussion.isPending || !discussion.data) {
    return (
      <Modal title={_('notificationCenter.ideaTitle')} onClose={onClose} closeLabel={_('library.close')} size="idea" centered hideHeader contentClassName="!flex-none !overflow-hidden !p-0">
        <div className="p-4"><div role="status" className="h-48 animate-pulse rounded-xl bg-stone-500/10" /></div>
      </Modal>
    )
  }
  if (discussion.isError) {
    return (
      <Modal title={_('notificationCenter.ideaTitle')} onClose={onClose} closeLabel={_('library.close')} size="idea" centered hideHeader contentClassName="!flex-none !overflow-hidden !p-0">
        <div className="p-4"><QueryErrorState isRetrying={discussion.isFetching} onRetry={() => void discussion.refetch()} /></div>
      </Modal>
    )
  }
  return (
    <IdeaDetailModal
      title={_('notificationCenter.ideaTitle')}
      ideaId={notification.targetId}
      bookVersionId={discussion.data.data.idea.annotation.bookId}
      theme="app"
      initialTab={notification.event === 'like' && !notification.commentId ? 'likes' : 'comments'}
      focusCommentId={notification.commentId ?? undefined}
      onClose={onClose}
    />
  )
}

function NotificationReviewBody({ notification, onClose }: { notification: InteractionNotification; onClose: () => void }) {
  const _ = useTranslation()
  const review = useReviewDiscussion(notification.targetId)
  if (review.isPending || !review.data) {
    return (
      <Modal title={_('notificationCenter.reviewTitle')} onClose={onClose} closeLabel={_('library.close')} size="xl">
        <div role="status" className="h-24 animate-pulse rounded-xl bg-stone-500/10" />
      </Modal>
    )
  }
  if (review.isError) {
    return (
      <Modal title={_('notificationCenter.reviewTitle')} onClose={onClose} closeLabel={_('library.close')} size="xl">
        <QueryErrorState isRetrying={review.isFetching} onRetry={() => void review.refetch()} />
      </Modal>
    )
  }
  return (
    <Modal title={_('notificationCenter.reviewTitle')} onClose={onClose} closeLabel={_('library.close')} size="xl">
      <ReviewCard
        review={review.data.data.review}
        initialDiscussionTab={notification.event === 'like' && !notification.commentId ? 'likes' : 'comments'}
        focusCommentId={notification.commentId ?? undefined}
        hideDelete
      />
    </Modal>
  )
}

/**
 * Notification-owned shell around the shared detail bodies: permission
 * precheck and mark-on-open live here, while the content itself reuses the
 * archive detail components (including their own loading states).
 *
 * The list row is passed in so the bodies can render immediately without
 * waiting for target resolution; target only gates the unavailable case.
 */
export default function NotificationDetailModal({ notificationId, entry, onClose }: { notificationId: string; entry?: InteractionNotification; onClose: () => void }) {
  const _ = useTranslation()
  const target = useNotificationTarget(notificationId)
  const read = useNotificationRead()
  const markRead = read.mutate
  const notification = target.data?.data.available ? target.data.data.notification : null
  const source = notification ?? entry ?? null
  const openedId = notification?.id
  const unreadTarget = !!notification && notification.readAt === null
  useEffect(() => {
    if (openedId && unreadTarget) {
      markRead({ id: openedId, read: true }, {
        onError: (error) => notify.error(getUserErrorNotification(error, 'notificationCenter.readFailed')),
      })
    }
  }, [openedId, unreadTarget, markRead])
  if (!source) {
    // Deep link to an id outside the loaded list: nothing to render until
    // target resolves. Headerless states, no generic copy.
    if (target.isPending) {
      return (
        <Modal title="" onClose={onClose} closeLabel={_('library.close')} hideHeader>
          <div role="status" className="h-24 animate-pulse rounded-xl bg-stone-500/10" />
        </Modal>
      )
    }
    if (target.isError) {
      return (
        <Modal title="" onClose={onClose} closeLabel={_('library.close')} hideHeader>
          <QueryErrorState isRetrying={target.isFetching} onRetry={() => void target.refetch()} />
        </Modal>
      )
    }
    return (
      <Modal title="" onClose={onClose} closeLabel={_('library.close')} hideHeader>
        <p role="status" className="py-6 text-sm text-stone-500">{_('notificationCenter.unavailable')}</p>
      </Modal>
    )
  }
  const title = source.domain === 'review' ? _('notificationCenter.reviewTitle') : _('notificationCenter.ideaTitle')
  if (target.data && !target.data.data.available) {
    return (
      <Modal title={title} onClose={onClose} closeLabel={_('library.close')}>
        <p role="status" className="py-6 text-sm text-stone-500">{_('notificationCenter.unavailable')}</p>
      </Modal>
    )
  }
  return source.domain === 'review'
    ? <NotificationReviewBody notification={source} onClose={onClose} />
    : <NotificationIdeaBody notification={source} onClose={onClose} />
}
