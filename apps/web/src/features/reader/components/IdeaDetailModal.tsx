import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import type { IdeaEntry } from './IdeaOverlay'

import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { buildAnnotationCopyText } from '@/features/reader/lib/annotation-text'
import type { ReaderReturn } from '@/features/reader/reader-return'

import { useIdeaAction, useIdeaDiscussion } from '../hooks/useIdeas'
import IdeaDetailCard from './IdeaDetailCard'
import IdeaDiscussionPanel from './IdeaDiscussionPanel'

/**
 * The reader's idea detail card (author + note + quote + like/comment counts +
 * discussion thread), mounted in a centered modal. Reading-theme variables are
 * scoped to this subtree so the shared card renders identically without any
 * reader-file changes.
 */
export default function IdeaDetailModal({ ideaId, bookVersionId, title, onClose, onShare, onEdit, onDelete, initialTab, focusCommentId, theme = 'reader', sourceAvailable = true, readerReturn, onBeforeReaderNavigate }: {
  ideaId: string
  bookVersionId: string
  title: string
  onClose: () => void
  onShare?: (entry: IdeaEntry) => void
  onEdit?: (entry: IdeaEntry) => void
  onDelete?: (entry: IdeaEntry) => void
  initialTab?: 'comments' | 'likes'
  focusCommentId?: string
  sourceAvailable?: boolean
  theme?: 'reader' | 'app'
  readerReturn?: ReaderReturn
  onBeforeReaderNavigate?: () => void
}) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const discussion = useIdeaDiscussion(ideaId, bookVersionId)
  const likeAction = useIdeaAction(ideaId, bookVersionId)
  const modalVariant = theme === 'reader' ? 'reader' : 'default'
  if (discussion.isPending) {
    return (
      <Modal title={title} onClose={onClose} closeLabel={_('library.close')} variant={modalVariant} size="xl" centered hideHeader contentClassName="!flex-none !overflow-hidden !p-0">
        <div className="p-4"><div role="status" className="h-48 animate-pulse rounded-xl bg-stone-500/10" /></div>
      </Modal>
    )
  }
  if (discussion.isError || !discussion.data) {
    return (
      <Modal title={title} onClose={onClose} closeLabel={_('library.close')} variant={modalVariant} size="xl" centered hideHeader contentClassName="!flex-none !overflow-hidden !p-0">
        <div className="p-4"><QueryErrorState isRetrying={discussion.isFetching} onRetry={() => void discussion.refetch()} /></div>
      </Modal>
    )
  }
  const idea = discussion.data.data.idea
  const entry: IdeaEntry = {
    annotation: idea.annotation,
    authorId: idea.author.id,
    authorName: idea.author.name,
    authorAvatarKey: idea.author.avatarKey,
    own: idea.own,
    canDelete: idea.canDelete,
    liked: idea.liked,
    likeCount: idea.likeCount,
    commentCount: idea.commentCount,
    locationAvailable: sourceAvailable && idea.locationAvailable !== false,
  }
  const jumpHref = sourceAvailable && idea.locationAvailable !== false
    ? `/books/${encodeURIComponent(bookVersionId)}?annotation=${encodeURIComponent(idea.annotation.id)}`
    : null
  return (
    <Modal title={title} onClose={onClose} closeLabel={_('library.close')} variant={modalVariant} size="xl" centered hideHeader contentClassName="!flex-none !overflow-hidden !p-0">
      <div className="flex min-h-0 max-h-[calc(100dvh-2rem)] flex-col overflow-hidden">
        <IdeaDetailCard
          detail={entry}
          liked={idea.liked}
          theme={theme}
          surface
          onBack={onClose}
          onJump={jumpHref ? () => {
            onBeforeReaderNavigate?.()
            if (readerReturn) {
              void navigate({ to: '/books/$id', params: { id: bookVersionId }, search: { annotation: idea.annotation.id }, state: (previous) => ({ ...previous, readerReturn }) })
            } else {
              window.location.assign(jumpHref)
            }
          } : undefined}
          onToggleLike={() => likeAction.mutate({ type: 'like', liked: !idea.liked }, {
            onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['archive'] }),
            onError: (error) => notify.error(getUserErrorNotification(error, 'comment.actionFailed')),
          })}
          onCopy={() => {
            const text = buildAnnotationCopyText(idea.annotation, _('reader.bookmark'))
            if (!text) return
            void navigator.clipboard.writeText(text).then(
              () => notify.success({ key: 'reader.copied' }),
              () => notify.error({ key: 'reader.copyFailed' }),
            )
          }}
          onShare={onShare}
          onEdit={onEdit}
          onDelete={onDelete}
        >
          <IdeaDiscussionPanel
            ideaId={idea.annotation.id}
            bookId={bookVersionId}
            detailLayout
            theme={theme}
            initialCommentCount={idea.commentCount}
            initialLikeCount={idea.likeCount}
            initialTab={initialTab}
            focusCommentId={focusCommentId}
            createdAt={idea.annotation.createdAt}
            editedAt={idea.annotation.editedAt}
          />
        </IdeaDetailCard>
      </div>
    </Modal>
  )
}
