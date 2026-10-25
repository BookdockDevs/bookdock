import { useState } from 'react'

import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { CopyIcon, HeartIcon, PencilIcon, ShareIcon, TrashIcon } from '@/features/reader/components/annotation-icons'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

export type InteractionTheme = 'reader' | 'app'

export interface InteractionHeaderActionsProps {
  liked?: boolean
  likeCount?: number
  onToggleLike?: () => void
  isLikePending?: boolean
  canLike?: boolean

  onShare?: () => void
  onCopy?: () => void
  onEdit?: () => void
  onDelete?: () => void

  canEdit?: boolean
  canDelete?: boolean

  editTitle?: string
  deleteTitle?: string

  deleteConfirmTitle?: string
  deleteConfirmMessage?: string
  deleteConfirmLabel?: string

  theme?: InteractionTheme
  className?: string
}

const actionBtnReader =
  'flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current cursor-pointer disabled:cursor-not-allowed disabled:opacity-50'
const actionBtnApp =
  'flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50'

/**
 * Unified action button group for Review & Idea headers:
 * Like, Share, Copy, Edit, Delete with ConfirmDialog.
 */
export default function InteractionHeaderActions({
  liked = false,
  likeCount,
  onToggleLike,
  isLikePending = false,
  canLike = true,
  onShare,
  onCopy,
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = true,
  editTitle,
  deleteTitle,
  deleteConfirmTitle,
  deleteConfirmMessage,
  deleteConfirmLabel,
  theme = 'app',
  className,
}: InteractionHeaderActionsProps) {
  const _ = useTranslation()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const btnStyle = theme === 'reader' ? actionBtnReader : actionBtnApp
  const subTextStyle = theme === 'reader' ? 'text-[var(--bd-read-sub)]' : 'text-stone-400 dark:text-stone-500'
  const dividerStyle =
    theme === 'reader' ? 'bg-stone-300/40 dark:bg-stone-700/40' : 'bg-stone-200 dark:bg-stone-800'

  const hasManagement = (canEdit && onEdit) || (canDelete && onDelete)

  return (
    <div className={cn('flex items-center gap-0.5 text-xs', subTextStyle, className)}>
      {onToggleLike && (
        <button
          type="button"
          onClick={onToggleLike}
          disabled={!canLike || isLikePending}
          title={liked ? _('comment.unlike') : _('comment.like')}
          className={cn(
            btnStyle,
            liked && 'text-red-500 hover:text-red-600',
            !canLike && 'cursor-default opacity-80',
          )}
        >
          <HeartIcon filled={liked} size={15} strokeWidth={2} />
          {likeCount != null && likeCount > 0 && (
            <span className="ml-1 text-[11px] tabular-nums">{likeCount}</span>
          )}
        </button>
      )}

      {onShare && (
        <button
          type="button"
          onClick={onShare}
          title={_('annotation.share')}
          className={btnStyle}
        >
          <ShareIcon size={15} />
        </button>
      )}

      {onCopy && (
        <button
          type="button"
          onClick={onCopy}
          title={_('annotation.copy')}
          className={btnStyle}
        >
          <CopyIcon />
        </button>
      )}

      {hasManagement && (
        <div className={cn('mx-1 h-3.5 w-px', dividerStyle)} />
      )}

      {canEdit && onEdit && (
        <button
          type="button"
          onClick={onEdit}
          title={editTitle ?? _('comment.edit')}
          className={btnStyle}
        >
          <PencilIcon />
        </button>
      )}

      {canDelete && onDelete && (
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          title={deleteTitle ?? _('comment.delete')}
          className={cn(
            btnStyle,
            'hover:bg-red-500/10 hover:text-red-500 dark:hover:bg-red-950/40 dark:hover:text-red-400',
          )}
        >
          <TrashIcon />
        </button>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={deleteConfirmTitle ?? _('comment.deleteConfirmTitle')}
          message={deleteConfirmMessage ?? _('comment.deleteConfirmMessage')}
          confirmLabel={deleteConfirmLabel ?? _('comment.delete')}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false)
            onDelete?.()
          }}
        />
      )}
    </div>
  )
}
