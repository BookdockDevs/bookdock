import type { ReactNode } from 'react'

import DiscussionThread, { type DiscussionThreadAction } from '@/components/discussion/DiscussionThread'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import { useReviewAction, useReviewDiscussion, type ReviewAction } from '../hooks/useReviews'

export interface ReviewDiscussionPanelProps {
  reviewId: string
  reviewAuthorId?: string
  initialCommentCount?: number
  initialLikeCount?: number
  hideTabs?: boolean
  detailLayout?: boolean
  className?: string
  initialTab?: 'comments' | 'likes'
  focusCommentId?: string
  theme?: 'reader' | 'app'
  headerRight?: ReactNode
}

export default function ReviewDiscussionPanel({
  reviewId,
  reviewAuthorId,
  initialCommentCount = 0,
  initialLikeCount = 0,
  hideTabs = false,
  detailLayout = false,
  className,
  initialTab = 'comments',
  focusCommentId,
  theme = 'app',
  headerRight,
}: ReviewDiscussionPanelProps) {
  const _ = useTranslation()
  const query = useReviewDiscussion(reviewId)
  const action = useReviewAction(reviewId)

  const data = query.data?.data

  async function handleAction(threadAction: DiscussionThreadAction): Promise<boolean> {
    try {
      await action.mutateAsync(threadAction as ReviewAction)
      return true
    } catch (error) {
      notify.error(getUserErrorNotification(error, 'review.discussionFailed'))
      return false
    }
  }

  return (
    <DiscussionThread
      comments={data?.comments}
      likers={data?.likers}
      commentCount={data?.review.commentCount ?? initialCommentCount}
      likeCount={data?.review.likeCount ?? initialLikeCount}
      isPending={query.isPending}
      isError={query.isError || !data}
      onRetry={() => void query.refetch()}
      onAction={handleAction}
      isActionPending={action.isPending}
      hostAuthorId={reviewAuthorId ?? data?.review.author.id}
      hideTabs={hideTabs}
      detailLayout={detailLayout}
      className={className}
      initialTab={initialTab}
      focusCommentId={focusCommentId}
      theme={theme}
      submitLabel={_('comment.submit')}
      editLabel={_('comment.save')}
      headerRight={headerRight}
    />
  )
}
