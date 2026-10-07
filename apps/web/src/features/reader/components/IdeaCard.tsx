import { useRef, useState } from 'react'

import type { IdeaEntry } from './IdeaOverlay'

import SmartMenu from '@/components/ui/SmartMenu'
import { useContextMenu } from '@/features/library/components/use-context-menu'
import { useTranslation } from '@/hooks/useTranslation'
import { avatarUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'

import { BulbIcon, ChatBubbleIcon, CopyIcon, DotsHorizontalIcon, HeartIcon, LockIcon, PencilIcon, ShareIcon, TrashIcon } from './annotation-icons'
import { formatFullDateTime, formatRelativeTime } from './format-relative-time'

interface IdeaCardProps {
  entry: IdeaEntry
  onOpen: () => void
  showQuote?: boolean
  variant?: 'card' | 'flat'
  onToggleLike?: () => void
  onCopy?: () => void
  onShare?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onJump?: () => void
  fontStack?: string
  isExpanded?: boolean
}

export default function IdeaCard({
  entry,
  onOpen,
  showQuote = true,
  variant = 'card',
  onToggleLike,
  onCopy,
  onShare,
  onEdit,
  onDelete,
  onJump,
  fontStack,
  isExpanded = false,
}: IdeaCardProps) {
  const [quoteExpanded, setQuoteExpanded] = useState(false)
  const contextMenu = useContextMenu()
  const touchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartPos = useRef<{ x: number; y: number } | null>(null)

  const _ = useTranslation()
  const avatar = avatarUrl(entry.authorAvatarKey)
  const isPrivate = entry.annotation.visibility === 'private'

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    contextMenu.openFromEvent(e)
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 1) return
    const touch = e.touches[0]
    touchStartPos.current = { x: touch.clientX, y: touch.clientY }
    if (touchTimer.current) clearTimeout(touchTimer.current)
    touchTimer.current = setTimeout(() => {
      touchTimer.current = null
      contextMenu.openFromPoint(touchStartPos.current ?? { x: touch.clientX, y: touch.clientY })
    }, 500)
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!touchStartPos.current) return
    const touch = e.touches[0]
    if (Math.abs(touch.clientX - touchStartPos.current.x) > 10 || Math.abs(touch.clientY - touchStartPos.current.y) > 10) {
      if (touchTimer.current) {
        clearTimeout(touchTimer.current)
        touchTimer.current = null
      }
    }
  }

  function handleTouchEnd() {
    if (touchTimer.current) {
      clearTimeout(touchTimer.current)
      touchTimer.current = null
    }
  }

  return (
    <>
      <div
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={cn(
          'block w-full text-left text-[var(--bd-read-text)] transition-all',
          variant === 'flat'
            ? 'border-b border-stone-200/40 py-3 first:pt-1 last:border-b-0 dark:border-stone-800/40'
            : 'mt-3 rounded-2xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] p-4 shadow-md hover:bg-[color-mix(in_srgb,var(--bd-read-bg)_94%,var(--bd-read-text))] hover:border-stone-300 dark:hover:border-stone-700',
        )}
      >
        <div className="relative">
          <div className="flex items-center gap-2.5">
          {avatar ? (
            <img src={avatar} alt="" decoding="async" className={cn('rounded-full object-cover shrink-0', variant === 'flat' ? 'h-7 w-7' : 'h-8 w-8')} />
          ) : (
            <span className={cn('flex shrink-0 items-center justify-center rounded-full bg-stone-500/10 text-[var(--bd-read-sub)]', variant === 'flat' ? 'h-7 w-7' : 'h-8 w-8')}>
              <BulbIcon size={variant === 'flat' ? 14 : 16} />
            </span>
          )}
          <span className="truncate text-sm font-medium">{entry.authorName ?? _('annotation.myNote')}</span>
          {variant !== 'flat' && (
            <span
              title={formatFullDateTime(_, entry.annotation.createdAt)}
              aria-label={formatFullDateTime(_, entry.annotation.createdAt)}
              className="cursor-default select-none text-xs text-[var(--bd-read-sub)] opacity-60 hover:opacity-100 transition-opacity shrink-0"
            >
              · {formatRelativeTime(_, entry.annotation.createdAt)}
            </span>
          )}

          {entry.own && (
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              {isPrivate && (
                <span title={_('annotation.visibilityPrivate')} className="flex items-center text-[var(--bd-read-sub)] opacity-70">
                  <LockIcon size={12} />
                </span>
              )}
              <span className="rounded-md bg-stone-500/10 px-1.5 py-0.5 text-[10px] text-[var(--bd-read-sub)] font-medium tracking-tight">
                {_('annotation.myNote')}
              </span>
            </div>
          )}
        </div>

        <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6">{entry.annotation.note}</p>
        <button
          type="button"
          onClick={onOpen}
          aria-label={isExpanded ? _('annotation.collapse') : _('annotation.openIdeaDetail')}
          className="absolute inset-0 z-0 cursor-pointer rounded-xl outline-none focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)]"
        />
        </div>

        {showQuote && entry.annotation.text && (
          <div
            title={onJump && entry.locationAvailable !== false ? _('annotation.jumpToSource') : undefined}
            className={cn(
              'group relative mt-2.5 rounded-lg border-l-2 border-stone-300/50 bg-stone-500/5 p-2 dark:border-stone-700/50',
              onJump && entry.locationAvailable !== false && 'hover:bg-stone-500/10 transition-colors',
            )}
          >
            <p
              className={cn('whitespace-pre-wrap text-xs text-[var(--bd-read-sub)]', !quoteExpanded && 'line-clamp-2')}
              style={fontStack ? { fontFamily: fontStack } : undefined}
            >
              {entry.annotation.text}
            </p>
            {entry.annotation.text.length > 40 && (
              <button
                type="button"
                onClick={() => setQuoteExpanded(!quoteExpanded)}
                className="relative z-10 mt-1 text-[11px] text-[var(--bd-read-primary)] hover:underline"
              >
                {_(quoteExpanded ? 'annotation.collapse' : 'annotation.expand')}
              </button>
            )}
            {onJump && entry.locationAvailable !== false && (
              <button
                type="button"
                onClick={onJump}
                title={_('annotation.jumpToSource')}
                aria-label={_('annotation.jumpToSource')}
                className="absolute inset-0 z-0 cursor-pointer rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)]"
              />
            )}
          </div>
        )}

        {variant === 'flat' ? (
          /* QiDian style stream action row: bottom-right aligned, no top border */
          <div className="mt-2.5 flex items-center justify-between text-xs text-[var(--bd-read-sub)]">
            <span
              title={formatFullDateTime(_, entry.annotation.createdAt)}
              aria-label={formatFullDateTime(_, entry.annotation.createdAt)}
              className="cursor-default select-none text-[11px] opacity-60 hover:opacity-100 transition-opacity"
            >
              {formatRelativeTime(_, entry.annotation.createdAt)}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleLike?.()
                }}
                className={cn(
                  'flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors hover:bg-stone-500/10 cursor-pointer',
                  entry.liked ? 'text-red-500 font-medium' : 'text-[var(--bd-read-sub)] hover:text-current',
                )}
                title={entry.liked ? _('comment.unlike') : _('comment.like')}
              >
                <HeartIcon filled={entry.liked} size={14} />
                {entry.likeCount != null && entry.likeCount > 0 ? (
                  <span className="tabular-nums text-xs">{entry.likeCount}</span>
                ) : null}
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpen()
                }}
                className={cn(
                  'flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors cursor-pointer',
                  isExpanded
                    ? 'bg-[var(--bd-read-primary)]/15 text-[var(--bd-read-primary)] font-medium'
                    : 'text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-[var(--bd-read-text)]',
                )}
                title={isExpanded ? _('annotation.collapse') : _('annotation.openIdeaDetail')}
              >
                <ChatBubbleIcon size={14} />
                {entry.commentCount != null && entry.commentCount > 0 ? (
                  <span className="tabular-nums text-xs">{entry.commentCount}</span>
                ) : null}
              </button>

              {(onShare || onCopy || onEdit || onDelete) && (
                <button
                  ref={contextMenu.btnRef}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    contextMenu.toggleFromButton()
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-stone-500/10 text-[var(--bd-read-sub)] hover:text-[var(--bd-read-text)] transition-colors cursor-pointer"
                  title={_('reader.more')}
                  aria-label={_('reader.more')}
                >
                  <DotsHorizontalIcon size={14} />
                </button>
              )}
            </div>
          </div>
        ) : (
          /* WeChat Read style action row: 2 equal blocks, centered icons */
          <div className="mt-3.5 grid grid-cols-2 border-t border-stone-200/40 dark:border-stone-800/40 pt-2 text-xs text-[var(--bd-read-sub)]">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onToggleLike?.()
              }}
              className={cn(
                'flex items-center justify-center gap-1.5 py-1 transition-colors hover:text-red-500',
                entry.liked ? 'text-red-500 font-medium' : 'text-[var(--bd-read-sub)]',
              )}
              title={entry.liked ? _('comment.unlike') : _('comment.like')}
            >
              <HeartIcon filled={entry.liked} size={16} />
              {entry.likeCount != null && entry.likeCount > 0 ? (
                <span className="tabular-nums">{entry.likeCount}</span>
              ) : null}
            </button>

            <div className="flex items-center justify-center gap-1.5 py-1 text-[var(--bd-read-sub)]">
              <ChatBubbleIcon size={16} />
              {entry.commentCount != null && entry.commentCount > 0 ? (
                <span className="tabular-nums">{entry.commentCount}</span>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {contextMenu.open && (
        <SmartMenu
          id="idea-card-context-menu"
          triggerRef={contextMenu.btnRef}
          innerRef={contextMenu.menuRef}
          variant="reader"
          position={contextMenu.position(130, 140)}
          onClose={contextMenu.close}
          width={130}
        >
          {onShare && (
            <button
              type="button"
              onClick={() => {
                contextMenu.close()
                onShare()
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-stone-500/10 cursor-pointer"
            >
              <span className="text-[var(--bd-read-sub)] [&>svg]:h-3.5 [&>svg]:w-3.5">
                <ShareIcon />
              </span>
              {_('annotation.share')}
            </button>
          )}
          {onCopy && entry.annotation.note && (
            <button
              type="button"
              onClick={() => {
                contextMenu.close()
                onCopy()
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-stone-500/10 cursor-pointer"
            >
              <span className="text-[var(--bd-read-sub)] [&>svg]:h-3.5 [&>svg]:w-3.5">
                <CopyIcon />
              </span>
              {_('annotation.copy')}
            </button>
          )}
          {entry.own && onEdit && (
            <button
              type="button"
              onClick={() => {
                contextMenu.close()
                onEdit()
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-stone-500/10 cursor-pointer"
            >
              <span className="text-[var(--bd-read-sub)] [&>svg]:h-3.5 [&>svg]:w-3.5">
                <PencilIcon />
              </span>
              {_('annotation.editNote')}
            </button>
          )}
          {(entry.own || entry.canDelete) && onDelete && (
            <button
              type="button"
              onClick={() => {
                contextMenu.close()
                onDelete()
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-red-500 transition-colors hover:bg-red-500/10 cursor-pointer"
            >
              <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">
                <TrashIcon />
              </span>
              {_('reader.delete')}
            </button>
          )}
        </SmartMenu>
      )}
    </>
  )
}
