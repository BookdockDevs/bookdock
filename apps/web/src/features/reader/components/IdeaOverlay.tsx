import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { AnnotationRes } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { useDialogLayout } from '@/components/ui/dialog-layout-context'
import { avatarUrl } from '@/lib/avatar'

import { cn } from '@/lib/utils'

import { getLastHighlightStyle } from './annotation-colors'
import { AiSparkleIcon, BulbIcon, ChevronDownIcon, ChevronLeftIcon, CopyIcon, ExcerptShareIcon, HeartIcon, PencilIcon, QuoteLeftIcon, SearchIcon, ShareIcon, StyleGlyph, TrashIcon } from './annotation-icons'
import { formatFullDateTime } from './format-relative-time'
import IdeaCard from './IdeaCard'
import IdeaDiscussionPanel from './IdeaDiscussionPanel'
import { markEscConsumed } from '../lib/esc-consumed'
import { useIdeaDiscussion } from '../hooks/useIdeas'

/**
 * One idea shown in the overlay. `authorName`/`authorAvatarKey`/`own` are the
 * source-aware projection for reader discussion: entries from other readers render
 * without the 我的笔记 badge and without edit/delete actions.
 */
export interface IdeaEntry {
  annotation: AnnotationRes
  authorName?: string
  authorAvatarKey?: string | null
  own?: boolean
  canDelete?: boolean
  likeCount?: number
  commentCount?: number
  liked?: boolean
  locationAvailable?: boolean
}

interface IdeaOverlayProps {
  bookId: string
  onJump?: (entry: IdeaEntry) => void
  onToggleLike?: (entry: IdeaEntry) => void
  initialDetailId?: string
  quoteActionsVisible?: boolean
  entries: IdeaEntry[]
  quoteText?: string
  fontStack?: string
  fontCss?: string
  onCopyQuote: () => void
  onHighlight: () => void
  onWriteNote: () => void
  onAiChat: () => void
  onShareQuote: () => void
  onSearch: () => void
  onCopyNote: (entry: IdeaEntry) => void
  onShareNote: (entry: IdeaEntry) => void
  onEdit: (entry: IdeaEntry) => void
  onDelete: (entry: IdeaEntry) => void
  onClose: () => void
}

const card = 'rounded-2xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] text-[var(--bd-read-text)] shadow-2xl'
const iconBtn =
  'flex h-10 w-10 items-center justify-center rounded-full text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current'
const detailActionBtn =
  'flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current'

/**
 * Android-WeChat-style floating overlay for ideas: a dimmed backdrop with a
 * quote card (original text + range actions) and one entry card per idea.
 * Clicking an entry switches the overlay to a detail level. Centered layout —
 * no anchor positioning, so page/scroll modes behave identically.
 */
export function IdeaOverlay({
  bookId,
  onJump,
  onToggleLike,
  initialDetailId,
  quoteActionsVisible = true,
  entries,
  quoteText,
  fontStack,
  fontCss,
  onCopyQuote,
  onHighlight,
  onWriteNote,
  onAiChat,
  onShareQuote,
  onSearch,
  onCopyNote,
  onShareNote,
  onEdit,
  onDelete,
  onClose,
}: IdeaOverlayProps) {
  const dialogLayout = useDialogLayout()
  const _ = useTranslation()
  const [detailId, setDetailId] = useState<string | null>(initialDetailId ?? null)
  const detail = entries.find((entry) => entry.annotation.id === detailId) ?? null
  const discussion = useIdeaDiscussion(detail?.annotation.id ?? null, bookId)
  const isDetailLiked = discussion.data?.data.idea.liked ?? detail?.liked ?? false
  const quoteRef = useRef<HTMLParagraphElement>(null)
  const [quoteExpanded, setQuoteExpanded] = useState(false)
  const [quoteClamped, setQuoteClamped] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !document.querySelector('[role="alertdialog"][aria-modal="true"]')) {
        markEscConsumed()
        if (detailId && !initialDetailId) {
          setDetailId(null)
        } else {
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, detailId, initialDetailId])

  // A deleted entry vanishes from `entries` once the annotations query refetches;
  // drop back to the list level instead of showing a stale detail card
  useEffect(() => {
    if (detailId && !entries.some((e) => e.annotation.id === detailId)) setDetailId(null)
  }, [detailId, entries])

  // While line-clamped, scrollHeight exceeding clientHeight means the quote
  // overflows four lines — only then is the expand chevron shown
  useEffect(() => {
    const el = quoteRef.current
    if (el) setQuoteClamped(el.scrollHeight > el.clientHeight + 1)
  }, [quoteText])

  const quoteActions = [
    { key: 'copy', title: _('annotation.copy'), icon: <CopyIcon />, onClick: onCopyQuote },
    { key: 'highlight', title: _('annotation.drawHighlight'), icon: <StyleGlyph style={getLastHighlightStyle().style} />, onClick: onHighlight },
    { key: 'note', title: _('annotation.writeNote'), icon: <BulbIcon />, onClick: onWriteNote },
    { key: 'ai-chat', title: _('reader.aiChatSelection'), icon: <AiSparkleIcon size={20} />, onClick: onAiChat },
    { key: 'search', title: _('reader.search'), icon: <SearchIcon />, onClick: onSearch },
    { key: 'share', title: _('annotation.shareExcerpt'), icon: <ExcerptShareIcon />, onClick: onShareQuote },
  ]
  const detailAvatarUrl = detail ? avatarUrl(detail.authorAvatarKey) : undefined

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-black/50 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm ${dialogLayout.className}`}
      style={dialogLayout.style}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {fontCss && <style data-reader-font>{fontCss}</style>}
      <div className="min-h-0 flex-1 overflow-y-auto reader-scrollbar [scrollbar-gutter:stable]">
        <div
          className="flex min-h-full flex-col items-center justify-center p-4 sm:p-6"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          {detail ? (
            <div className={`${card} w-full max-w-lg overflow-hidden`}>
              <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-stone-200/40 dark:border-stone-800/40">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={() => setDetailId(null)}
                    title={_('annotation.cancel')}
                    className="-ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
                  >
                    <ChevronLeftIcon />
                  </button>
                  {detailAvatarUrl ? (
                    <img src={detailAvatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-stone-500/10 text-[var(--bd-read-sub)]">
                      <BulbIcon size={15} />
                    </span>
                  )}
                  <span className="truncate text-sm font-medium">{detail.authorName ?? _('annotation.myNote')}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0 text-xs text-[var(--bd-read-sub)]">
                  {onToggleLike && (
                    <button
                      onClick={() => onToggleLike({ ...detail, liked: isDetailLiked })}
                      title={isDetailLiked ? _('comment.unlike') : _('comment.like')}
                      className={cn(detailActionBtn, isDetailLiked && 'text-red-500')}
                    >
                      <HeartIcon filled={isDetailLiked} size={15} />
                    </button>
                  )}
                  <button onClick={() => onShareNote(detail)} title={_('annotation.share')} className={detailActionBtn}>
                    <ShareIcon size={16} />
                  </button>
                  <button onClick={() => onCopyNote(detail)} title={_('annotation.copy')} className={detailActionBtn}>
                    <CopyIcon />
                  </button>
                  {(detail.own || detail.canDelete) && (
                    <div className="mx-0.5 h-3 w-px bg-stone-300/60 dark:bg-stone-700/60" />
                  )}
                  {detail.own && (
                    <button onClick={() => onEdit(detail)} title={_('annotation.editNote')} className={detailActionBtn}>
                      <PencilIcon />
                    </button>
                  )}
                  {(detail.own || detail.canDelete) && (
                    <button
                      onClick={() => onDelete(detail)}
                      title={_('annotation.deleteAnnotation')}
                      className={`${detailActionBtn} hover:bg-red-500/10 hover:text-red-500`}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              </div>
              <div className="px-5 pb-5 pt-3">
                <p className="whitespace-pre-wrap text-base leading-7">{detail.annotation.note}</p>
                {quoteText && (
                  onJump && detail.locationAvailable !== false ? (
                    <button
                      type="button"
                      onClick={() => onJump(detail)}
                      title={_('annotation.jumpToSource')}
                      aria-label={_('annotation.jumpToSource')}
                      className="mt-4 w-full cursor-pointer rounded-xl border border-stone-200/50 bg-stone-500/[0.04] p-3 transition-colors text-left hover:bg-stone-500/10 hover:border-stone-300 dark:border-stone-800/50 dark:bg-stone-500/[0.08] dark:hover:border-stone-700 outline-none focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)]"
                    >
                      <span className="flex items-center gap-1.5 text-[var(--bd-read-sub)]">
                        <QuoteLeftIcon height={13} />
                      </span>
                      <span className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-[var(--bd-read-sub)]">{quoteText}</span>
                    </button>
                  ) : (
                    <div
                      title={detail.locationAvailable === false ? _('annotation.locationUnavailable') : undefined}
                      className={cn(
                        'mt-4 rounded-xl border border-stone-200/50 bg-stone-500/[0.04] p-3 text-left dark:border-stone-800/50 dark:bg-stone-500/[0.08]',
                        detail.locationAvailable === false && 'opacity-60',
                      )}
                    >
                      <div className="flex items-center gap-1.5 text-[var(--bd-read-sub)]">
                        <QuoteLeftIcon height={13} />
                      </div>
                      <p className="mt-1.5 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-[var(--bd-read-sub)]">{quoteText}</p>
                    </div>
                  )
                )}
                <div className="flex items-center gap-2 pt-3 text-xs text-[var(--bd-read-sub)]">
                  <span>
                    {_('annotation.publishedAt')} {formatFullDateTime(_, detail.annotation.createdAt)}
                  </span>
                  {detail.annotation.editedAt && <span>· {_('annotation.edited')}</span>}
                </div>
                <IdeaDiscussionPanel
                  key={detail.annotation.id}
                  ideaId={detail.annotation.id}
                  bookId={bookId}
                  initialCommentCount={detail.commentCount}
                  initialLikeCount={detail.likeCount}
                />
              </div>
            </div>
          ) : (
            <div className="w-full max-w-lg">
              <div className={card}>
                <div className="relative px-5 pt-4">
                  <span className="text-[var(--bd-read-sub)]">
                    <QuoteLeftIcon height={20} />
                  </span>
                  {quoteClamped && (
                    <button
                      onClick={() => setQuoteExpanded((v) => !v)}
                      title={_(quoteExpanded ? 'annotation.collapseQuote' : 'annotation.expandQuote')}
                      aria-expanded={quoteExpanded}
                      className="absolute right-2 top-3 flex h-8 w-8 items-center justify-center rounded-full text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
                    >
                      <span className={`transition-transform ${quoteExpanded ? 'rotate-180' : ''}`}>
                        <ChevronDownIcon />
                      </span>
                    </button>
                  )}
                  <p
                    ref={quoteRef}
                    className={`mt-2 whitespace-pre-wrap text-base leading-relaxed ${quoteExpanded ? '' : 'line-clamp-4'}`}
                    style={fontStack ? { fontFamily: fontStack } : undefined}
                  >
                    {quoteText}
                  </p>
                </div>
                {quoteActionsVisible && <div className="mt-3 flex items-center justify-around border-t border-[var(--bd-read-accent)]/60 px-2 py-1.5">
                  {quoteActions.map((a) => (
                    <button key={a.key} onClick={a.onClick} title={a.title} className={iconBtn}>
                      {a.icon}
                    </button>
                  ))}
                </div>}
              </div>
              {entries.map((entry) => {
                return (
                  <IdeaCard
                    key={entry.annotation.id}
                    entry={entry}
                    showQuote={false}
                    onOpen={() => setDetailId(entry.annotation.id)}
                    onToggleLike={onToggleLike ? () => onToggleLike(entry) : undefined}
                    onCopy={() => onCopyNote(entry)}
                    onShare={() => onShareNote(entry)}
                    onEdit={() => onEdit(entry)}
                    onDelete={() => onDelete(entry)}
                    onJump={onJump && entry.locationAvailable !== false ? () => onJump(entry) : undefined}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
