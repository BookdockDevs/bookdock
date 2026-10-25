import type { ReactNode } from 'react'

import DiscussionThread, { type DiscussionThreadAction } from '@/components/discussion/DiscussionThread'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import { formatFullDateTime, formatRelativeTime } from './format-relative-time'
import { useIdeaAction, useIdeaDiscussion, type IdeaAction } from '../hooks/useIdeas'

export interface IdeaDiscussionPanelProps {
  ideaId: string
  bookId: string
  initialCommentCount?: number
  initialLikeCount?: number
  hideTabs?: boolean
  detailLayout?: boolean
  className?: string
  initialTab?: 'comments' | 'likes'
  focusCommentId?: string
  theme?: 'reader' | 'app'
  createdAt?: number
  editedAt?: number | null
  headerRight?: ReactNode
}

export default function IdeaDiscussionPanel({
  ideaId,
  bookId,
  initialCommentCount = 0,
  initialLikeCount = 0,
  hideTabs = false,
  detailLayout = false,
  className,
  initialTab = 'comments',
  focusCommentId,
  theme = 'reader',
  createdAt,
  editedAt,
  headerRight,
}: IdeaDiscussionPanelProps) {
  const _ = useTranslation()
  const query = useIdeaDiscussion(ideaId, bookId)
  const action = useIdeaAction(ideaId, bookId)

  const data = query.data?.data

  async function handleAction(threadAction: DiscussionThreadAction): Promise<boolean> {
    try {
      await action.mutateAsync(threadAction as IdeaAction)
      return true
    } catch (error) {
      notify.error(getUserErrorNotification(error, 'annotation.saveFailed'))
      return false
    }
  }

  const effectiveCreatedAt = createdAt ?? data?.idea?.annotation?.createdAt
  const effectiveEditedAt = editedAt !== undefined ? editedAt : data?.idea?.annotation?.editedAt

  const defaultHeaderRight = effectiveCreatedAt ? (
    <span
      className="flex items-center gap-1 cursor-default select-none"
      title={_('review.publishedTimeTitle', { value: formatFullDateTime(_, effectiveCreatedAt) })}
    >
      <span>{_('annotation.publishedAt')}</span>
      <span>{formatRelativeTime(_, effectiveCreatedAt)}</span>
      {effectiveEditedAt && (
        <span title={_('review.editedTimeTitle', { value: formatFullDateTime(_, effectiveEditedAt) })}>
          · {_('annotation.edited')}
        </span>
      )}
    </span>
  ) : null

  return (
    <DiscussionThread
      comments={data?.comments}
      likers={data?.likers}
      commentCount={data?.idea.commentCount ?? initialCommentCount}
      likeCount={data?.idea.likeCount ?? initialLikeCount}
      isPending={query.isPending}
      isError={query.isError || !data}
      onRetry={() => void query.refetch()}
      onAction={handleAction}
      isActionPending={action.isPending}
      hostAuthorId={data?.idea.author?.id}
      hideTabs={hideTabs}
      detailLayout={detailLayout}
      className={className}
      initialTab={initialTab}
      focusCommentId={focusCommentId}
      theme={theme}
      submitLabel={_('comment.submit')}
      editLabel={_('comment.save')}
      contextMenuId="idea-comment-context-menu"
      headerRight={headerRight ?? defaultHeaderRight}
    />
  )
}
