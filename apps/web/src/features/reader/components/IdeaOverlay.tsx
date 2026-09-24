import { useEffect, useRef, useState } from 'react'

import type { AnnotationRes } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { avatarUrl } from '@/lib/avatar'
import { cn } from '@/lib/utils'

import { getLastHighlightStyle } from './annotation-colors'
import { AiSparkleIcon, BulbIcon, ChevronDownIcon, ChevronLeftIcon, CloseIcon, CopyIcon, ExcerptShareIcon, PencilIcon, QuoteLeftIcon, SearchIcon, StyleGlyph, TrashIcon } from './annotation-icons'
import { formatFullDateTime } from './format-relative-time'
import { markEscConsumed } from '../lib/esc-consumed'

/**
 * One idea shown in the overlay. `authorName`/`authorAvatarKey`/`own` are the
 * seam for future private-circle sharing: entries from other readers render
 * without the 我的笔记 badge and without edit/delete actions.
 */
export interface IdeaEntry {
  annotation: AnnotationRes
  authorName?: string
  authorAvatarKey?: string | null
  own?: boolean
}

interface IdeaOverlayProps {
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
  const _ = useTranslation()
  const [detail, setDetail] = useState<IdeaEntry | null>(null)
  const quoteRef = useRef<HTMLParagraphElement>(null)
  const [quoteExpanded, setQuoteExpanded] = useState(false)
  const [quoteClamped, setQuoteClamped] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        markEscConsumed()
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // A deleted entry vanishes from `entries` once the annotations query refetches;
  // drop back to the list level instead of showing a stale detail card
  useEffect(() => {
    if (detail && !entries.some((e) => e.annotation.id === detail.annotation.id)) setDetail(null)
  }, [detail, entries])

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

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/50 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      {fontCss && <style data-reader-font>{fontCss}</style>}
      <div className="min-h-0 flex-1 overflow-y-auto reader-scrollbar [scrollbar-gutter:stable]">
        <div
          className="flex min-h-full flex-col items-center justify-center p-3 pb-20 sm:p-4 sm:pb-[14vh]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          {detail ? (
            <div className={`${card} w-full max-w-md`}>
              <div className="flex items-center px-2 pt-2">
                <button onClick={() => setDetail(null)} title={_('annotation.cancel')} className={iconBtn}>
                  <ChevronLeftIcon />
                </button>
              </div>
              <div className="px-5 pb-4">
                <div className="flex items-center gap-2.5">
                  {detailAvatarUrl ? (
                    <img src={detailAvatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-500/10 text-[var(--bd-read-sub)]">
                      <BulbIcon size={16} />
                    </span>
                  )}
                  <span className="truncate text-sm font-medium">{detail.authorName ?? _('annotation.myNote')}</span>
                </div>
                <p className="whitespace-pre-wrap pt-4 text-base leading-7">{detail.annotation.note}</p>
                {quoteText && (
                  <div className="mt-5 border-t border-[var(--bd-read-accent)]/60 pt-3">
                    <span className="text-[var(--bd-read-sub)]">
                      <QuoteLeftIcon height={14} />
                    </span>
                    <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-[var(--bd-read-sub)]">{quoteText}</p>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-4 text-xs text-[var(--bd-read-sub)]">
                  <span>
                    {_('annotation.publishedAt')} {formatFullDateTime(_, detail.annotation.createdAt)}
                  </span>
                  <div className="flex-1" />
                  {detail.own && (
                    <button onClick={() => onEdit(detail)} title={_('annotation.editNote')} className={detailActionBtn}>
                      <PencilIcon />
                    </button>
                  )}
                  <button onClick={() => onCopyNote(detail)} title={_('annotation.copy')} className={detailActionBtn}>
                    <CopyIcon />
                  </button>
                  <button onClick={() => onShareNote(detail)} title={_('annotation.share')} className={detailActionBtn}>
                    <ExcerptShareIcon />
                  </button>
                  {detail.own && (
                    <button
                      onClick={() => onDelete(detail)}
                      title={_('annotation.deleteAnnotation')}
                      className={`${detailActionBtn} ml-0.5 hover:bg-red-500/10 hover:text-red-400`}
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-md">
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
                <div className="mt-3 flex items-center justify-around border-t border-[var(--bd-read-accent)]/60 px-2 py-1.5">
                  {quoteActions.map((a) => (
                    <button key={a.key} onClick={a.onClick} title={a.title} className={iconBtn}>
                      {a.icon}
                    </button>
                  ))}
                </div>
              </div>
              {entries.map((entry) => {
                const entryAvatarUrl = avatarUrl(entry.authorAvatarKey)
                return (
                  <button
                    key={entry.annotation.id}
                    onClick={() => setDetail(entry)}
                    className={cn(
                      card,
                      'mt-3 block w-full p-4 text-left transition-all hover:bg-[color-mix(in_srgb,var(--bd-read-bg)_94%,var(--bd-read-text))] active:scale-[0.99]',
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      {entryAvatarUrl ? (
                        <img src={entryAvatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-500/10 text-[var(--bd-read-sub)]">
                          <BulbIcon size={16} />
                        </span>
                      )}
                      <span className="truncate text-sm font-medium">{entry.authorName ?? _('annotation.myNote')}</span>
                      {entry.own && (
                        <span className="ml-auto shrink-0 rounded-full bg-stone-500/10 px-2.5 py-0.5 text-xs text-[var(--bd-read-sub)]">
                          {_('annotation.myNote')}
                        </span>
                      )}
                    </div>
                    <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-base leading-relaxed">{entry.annotation.note}</p>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onClose}
        title={_('annotation.cancel')}
        className="mb-[calc(1.5rem+env(safe-area-inset-bottom))] mt-2 flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-full bg-black/80 text-white shadow-xl transition-transform hover:scale-105"
      >
        <CloseIcon />
      </button>
    </div>
  )
}
