import { useState } from 'react'

import type { InteractionNotification } from '@bookdock/shared'

import IdeaCard from '@/features/reader/components/IdeaCard'
import IdeaDiscussionPanel from '@/features/reader/components/IdeaDiscussionPanel'
import { useIdeaAction, useIdeaDiscussion } from '@/features/reader/hooks/useIdeas'
import ReviewCard from '@/features/reviews/components/ReviewCard'
import { useReviewDiscussion } from '@/features/reviews/hooks/useReviews'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

interface NotificationContentProps { notification: InteractionNotification }

export default function NotificationContent({ notification }: NotificationContentProps) {
  const _ = useTranslation()
  const idea = useIdeaDiscussion(notification.domain === 'idea' ? notification.targetId : null, '')
  const review = useReviewDiscussion(notification.domain === 'review' ? notification.targetId : null)
  const ideaAction = useIdeaAction(notification.targetId, idea.data?.data.idea.annotation.bookId ?? '')
  const [expanded, setExpanded] = useState(true)
  const initialTab = notification.event === 'like' && !notification.commentId ? 'likes' : 'comments'
  const active = notification.domain === 'idea' ? idea : review
  if (active.isPending) return <div role="status" className="h-24 animate-pulse rounded-xl bg-stone-500/10" />
  if (active.isError) return <p role="status" className="py-6 text-sm text-stone-500">{_('notificationCenter.unavailable')}</p>
  if (notification.domain === 'review') {
    return review.data && <ReviewCard review={review.data.data.review} initialDiscussionTab={initialTab} focusCommentId={notification.commentId ?? undefined} />
  }
  if (!idea.data) return null
  const entry = idea.data.data.idea
  return <>
    <IdeaCard entry={{ ...entry, authorName: entry.author.name, authorAvatarKey: entry.author.avatarKey }} isExpanded={expanded} onOpen={() => setExpanded(!expanded)}
      onToggleLike={() => ideaAction.mutate({ type: 'like', liked: !entry.liked }, { onError: (error) => notify.error(getUserErrorNotification(error, 'comment.actionFailed')) })} />
    <IdeaDiscussionPanel ideaId={notification.targetId} bookId={entry.annotation.bookId} initialTab={initialTab} focusCommentId={notification.commentId ?? undefined} initialCommentCount={entry.commentCount} initialLikeCount={entry.likeCount} />
  </>
}
