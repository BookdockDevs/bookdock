import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import type { IdeaEntry } from './IdeaOverlay'

import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { buildAnnotationCopyText } from '@/features/reader/lib/annotation-text'
import { catalogBookTarget } from '@/features/reading-data/catalog-navigation'
import type { ReaderReturn } from '@/features/reader/reader-return'

import { useIdeaAction, useIdeaDiscussion } from '../hooks/useIdeas'
import { useAnnotations } from '../hooks/useAnnotations'
import { useLocalReader } from '../../reading-data/reader-source-context'
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
  const local = useLocalReader()
  const annotations = useAnnotations(bookVersionId, { enabled: !!local })
  const discussion = useIdeaDiscussion(ideaId, bookVersionId)
  const source = local ? annotations : discussion
  const likeAction = useIdeaAction(ideaId, bookVersionId)
  const modalVariant = theme === 'reader' ? 'reader' : 'default'
  if (source.isPending) {
    return (
      <Modal title={title} onClose={onClose} closeLabel={_('library.close')} variant={modalVariant} size="xl" centered hideHeader contentClassName="!flex-none !overflow-hidden !p-0">
        <div className="p-4"><div role="status" className="h-48 animate-pulse rounded-xl bg-stone-500/10" /></div>
      </Modal>
    )
  }
  if (source.isError || !source.data) {
    return (
      <Modal title={title} onClose={onClose} closeLabel={_('library.close')} variant={modalVariant} size="xl" centered hideHeader contentClassName="!flex-none !overflow-hidden !p-0">
        <div className="p-4"><QueryErrorState isRetrying={source.isFetching} onRetry={() => void source.refetch()} /></div>
      </Modal>
    )
  }
  const idea = discussion.data?.data.idea
  const annotation = local ? annotations.data?.data.find((item) => item.id === ideaId && item.type === 'note') : idea?.annotation
  if (!annotation) return (
    <Modal title={title} onClose={onClose} closeLabel={_('library.close')} variant={modalVariant}>
      <QueryErrorState isRetrying={source.isFetching} onRetry={() => void source.refetch()} />
    </Modal>
  )
  const entry: IdeaEntry = local ? {
    annotation, own: true, locationAvailable: sourceAvailable && annotation.locationAvailable !== false,
  } : {
    annotation, authorId: idea!.author.id, authorName: idea!.author.name,
    authorAvatarKey: idea!.author.avatarKey, own: idea!.own, canDelete: idea!.canDelete,
    liked: idea!.liked, likeCount: idea!.likeCount, commentCount: idea!.commentCount,
    locationAvailable: sourceAvailable && idea!.locationAvailable !== false,
  }
  const jumpHref = entry.locationAvailable ? `/books/${encodeURIComponent(bookVersionId)}?annotation=${encodeURIComponent(annotation.id)}` : null
  const jumpTarget = catalogBookTarget({ id: bookVersionId, ref: local?.ref, sourceUnavailable: false })
  return (
    <Modal title={title} onClose={onClose} closeLabel={_('library.close')} variant={modalVariant} size="xl" centered hideHeader contentClassName="!flex-none !overflow-hidden !p-0">
      <div className="flex min-h-0 max-h-[calc(100dvh-2rem)] flex-col overflow-hidden">
        <IdeaDetailCard
          detail={entry}
          liked={entry.liked}
          privateNote={!!local}
          theme={theme}
          surface
          onBack={onClose}
          onJump={jumpHref ? () => {
            onBeforeReaderNavigate?.()
            if (local) {
              void navigate({ to: jumpTarget.to, params: jumpTarget.params, search: { annotation: annotation.id } })
            } else if (readerReturn) {
              void navigate({ to: jumpTarget.to, params: jumpTarget.params, search: { annotation: annotation.id }, state: (previous) => ({ ...previous, readerReturn }) })
            } else {
              window.location.assign(jumpHref)
            }
          } : undefined}
          onToggleLike={local ? undefined : () => likeAction.mutate({ type: 'like', liked: !entry.liked }, {
            onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['archive'] }),
            onError: (error) => notify.error(getUserErrorNotification(error, 'comment.actionFailed')),
          })}
          onCopy={() => {
            const text = buildAnnotationCopyText(annotation, _('reader.bookmark'))
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
          {!local && idea && <IdeaDiscussionPanel
            ideaId={annotation.id}
            bookId={bookVersionId}
            detailLayout
            theme={theme}
            initialCommentCount={idea.commentCount}
            initialLikeCount={idea.likeCount}
            initialTab={initialTab}
            focusCommentId={focusCommentId}
            createdAt={annotation.createdAt}
            editedAt={annotation.editedAt}
          />}
        </IdeaDetailCard>
      </div>
    </Modal>
  )
}
