import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import { avatarUrl } from '@/lib/avatar'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import ContentImages from '@/features/content-files/components/ContentImages'

import type { IdeaEntry } from './IdeaOverlay'
import { BulbIcon, ChevronLeftIcon, CopyIcon, HeartIcon, PencilIcon, QuoteLeftIcon, ShareIcon, TrashIcon } from './annotation-icons'
import { formatFullDateTime } from './format-relative-time'

export type IdeaDetailTheme = 'reader' | 'app'

const detailActionBtnReader =
  'flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current'
const detailActionBtnApp =
  'flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-500/10 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'

/**
 * The idea detail header shared by the reader overlay and the archive modal:
 * back affordance, author row with like/share/copy/edit/delete actions, the
 * note, its images, the quoted source block and the publish timestamp. The
 * discussion thread stays with the caller. 'reader' keeps the reading-theme
 * variables byte-identical; 'app' uses the stone app palette.
 */
export default function IdeaDetailCard({
  detail,
  quoteText,
  fontStack,
  theme = 'reader',
  surface = false,
  children,
  liked,
  onBack,
  onJump,
  onToggleLike,
  onShare,
  onCopy,
  onEdit,
  onDelete,
}: {
  detail: IdeaEntry
  quoteText?: string | null
  fontStack?: string
  theme?: IdeaDetailTheme
  surface?: boolean
  children?: ReactNode
  liked: boolean
  onBack: () => void
  onJump?: (entry: IdeaEntry) => void
  onToggleLike?: (entry: IdeaEntry) => void
  onShare?: (entry: IdeaEntry) => void
  onCopy?: (entry: IdeaEntry) => void
  onEdit?: (entry: IdeaEntry) => void
  onDelete?: (entry: IdeaEntry) => void
}) {
  const _ = useTranslation()
  const detailAvatarUrl = avatarUrl(detail.authorAvatarKey)
  const actionBtn = theme === 'reader' ? detailActionBtnReader : detailActionBtnApp
  const subText = theme === 'reader' ? 'text-[var(--bd-read-sub)]' : 'text-stone-500 dark:text-stone-400'
  const quoteJumpRing = theme === 'reader'
    ? 'outline-none focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)]'
    : 'outline-none focus-visible:ring-1 focus-visible:ring-stone-400 dark:focus-visible:ring-stone-500'
  const surfaceBg = theme === 'reader' ? 'bg-[var(--bd-read-bg)]' : 'bg-white dark:bg-stone-900'
  const quote = quoteText ?? detail.annotation.text
  const authorName = detail.authorName ?? _('annotation.myNote')
  const authorIdentity = (
    <>
      {detailAvatarUrl ? (
        <img src={detailAvatarUrl} alt="" decoding="async" className="h-7 w-7 shrink-0 rounded-full object-cover" />
      ) : (
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-500/10', subText)}>
          <BulbIcon size={15} />
        </span>
      )}
      <span className="truncate text-sm font-medium">{authorName}</span>
    </>
  )
  const header = (
      <div className={cn('flex items-center justify-between px-3 pt-3 pb-2 border-b border-stone-200/40 dark:border-stone-800/40', surface && `shrink-0 ${surfaceBg}`)}>
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            title={_('annotation.cancel')}
            className={cn('-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-stone-500/10 hover:text-current', subText)}
          >
            <ChevronLeftIcon />
          </button>
          {detail.authorId ? <Link to="/profile" search={{ userId: detail.authorId }} onClick={(event) => event.stopPropagation()} className="relative z-10 flex min-w-0 items-center gap-2">{authorIdentity}</Link> : authorIdentity}
        </div>
        <div className={cn('flex items-center gap-0.5 shrink-0 text-xs', subText)}>
          {onToggleLike && (
            <button
              onClick={() => onToggleLike({ ...detail, liked })}
              title={liked ? _('comment.unlike') : _('comment.like')}
              className={cn(actionBtn, liked && 'text-red-500')}
            >
              <HeartIcon filled={liked} size={15} />
            </button>
          )}
          {onShare && (
            <button onClick={() => onShare(detail)} title={_('annotation.share')} className={actionBtn}>
              <ShareIcon size={16} />
            </button>
          )}
          {onCopy && (
            <button onClick={() => onCopy(detail)} title={_('annotation.copy')} className={actionBtn}>
              <CopyIcon />
            </button>
          )}
          {(detail.own || detail.canDelete) && (
            <div className="mx-0.5 h-3 w-px bg-stone-300/60 dark:bg-stone-700/60" />
          )}
          {detail.own && onEdit && (
            <button onClick={() => onEdit(detail)} title={_('annotation.editNote')} className={actionBtn}>
              <PencilIcon />
            </button>
          )}
          {(detail.own || detail.canDelete) && onDelete && (
            <button
              onClick={() => onDelete(detail)}
              title={_('annotation.deleteAnnotation')}
              className={`${actionBtn} hover:bg-red-500/10 hover:text-red-500`}
            >
              <TrashIcon />
            </button>
          )}
        </div>
      </div>
  )
  const body = (
      <div className="px-5 pb-3 pt-3">
        <p className="whitespace-pre-wrap text-base leading-7">{detail.annotation.note}</p>
        <ContentImages images={detail.annotation.images} />
        {quote && (
          onJump && detail.locationAvailable !== false ? (
            <button
              type="button"
              onClick={() => onJump(detail)}
              title={_('annotation.jumpToSource')}
              aria-label={_('annotation.jumpToSource')}
              className={cn('mt-4 w-full cursor-pointer rounded-xl border border-stone-200/50 bg-stone-500/[0.04] p-3 transition-colors text-left hover:bg-stone-500/10 hover:border-stone-300 dark:border-stone-800/50 dark:bg-stone-500/[0.08] dark:hover:border-stone-700', quoteJumpRing)}
            >
              <span className={cn('flex items-center gap-1.5', subText)}>
                <QuoteLeftIcon height={13} />
              </span>
              <span
                className={cn('mt-1.5 line-clamp-4 whitespace-pre-wrap text-sm leading-6', subText)}
                style={fontStack ? { fontFamily: fontStack } : undefined}
              >
                {quote}
              </span>
            </button>
          ) : (
            <div
              title={detail.locationAvailable === false ? _('annotation.locationUnavailable') : undefined}
              className={cn(
                'mt-4 rounded-xl border border-stone-200/50 bg-stone-500/[0.04] p-3 text-left dark:border-stone-800/50 dark:bg-stone-500/[0.08]',
                detail.locationAvailable === false && 'opacity-60',
              )}
            >
              <div className={cn('flex items-center gap-1.5', subText)}>
                <QuoteLeftIcon height={13} />
              </div>
              <p
                className={cn('mt-1.5 line-clamp-4 whitespace-pre-wrap text-sm leading-6', subText)}
                style={fontStack ? { fontFamily: fontStack } : undefined}
              >
                {quote}
              </p>
            </div>
          )
        )}
        <div className={cn('flex items-center gap-2 pt-3 text-xs', subText)}>
          <span>
            {_('annotation.publishedAt')} {formatFullDateTime(_, detail.annotation.createdAt)}
          </span>
          {detail.annotation.editedAt && <span>· {_('annotation.edited')}</span>}
        </div>
      </div>
  )
  return surface ? (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto reader-scrollbar">
        {body}
        {children}
      </div>
    </div>
  ) : (
    <>
      {header}
      {body}
      {children}
    </>
  )
}
