import { useEffect, useRef, useState } from 'react'

import type { AnnotationRes } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { avatarUrl } from '@/lib/avatar'

import { getLastHighlightStyle } from './annotation-colors'
import { BulbIcon, ChevronDownIcon, ChevronLeftIcon, CloseIcon, CopyIcon, ExcerptShareIcon, PencilIcon, QuoteLeftIcon, SearchIcon, StyleGlyph, TrashIcon } from './annotation-icons'
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
  onCopyQuote: () => void
  onHighlight: () => void
  onWriteNote: () => void
  onShareQuote: () => void
  onSearch: () => void
  onCopyNote: (entry: IdeaEntry) => void
  onShareNote: (entry: IdeaEntry) => void
  onEdit: (entry: IdeaEntry) => void
  onDelete: (entry: IdeaEntry) => void
  onClose: () => void
}

const card = 'rounded-2xl bg-stone-700 text-stone-100 shadow-2xl'
const iconBtn =
  'flex h-10 w-10 items-center justify-center rounded-full text-stone-200 transition-colors hover:bg-white/10 hover:text-white'
const detailActionBtn =
  'flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-white/10 hover:text-stone-200'

/**
 * Android-WeChat-style floating overlay for ideas: a dimmed backdrop with a
 * quote card (original text + range actions) and one entry card per idea.
 * Clicking an entry switches the overlay to a detail level. Centered layout —
 * no anchor positioning, so page/scroll modes behave identically.
 */
export function IdeaOverlay({
  entries,
  quoteText,
  onCopyQuote,
  onHighlight,
  onWriteNote,
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
  // overflows three lines — only then is the expand chevron shown
  useEffect(() => {
    const el = quoteRef.current
    if (el) setQuoteClamped(el.scrollHeight > el.clientHeight + 1)
  }, [quoteText])

  const quoteActions = [
    { key: 'copy', title: _('annotation.copy'), icon: <CopyIcon />, onClick: onCopyQuote },
    { key: 'highlight', title: _('annotation.drawHighlight'), icon: <StyleGlyph style={getLastHighlightStyle().style} />, onClick: onHighlight },
    { key: 'note', title: _('annotation.writeNote'), icon: <BulbIcon />, onClick: onWriteNote },
    { key: 'share', title: _('annotation.shareExcerpt'), icon: <ExcerptShareIcon />, onClick: onShareQuote },
    { key: 'search', title: _('reader.search'), icon: <SearchIcon />, onClick: onSearch },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
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
                  {avatarUrl(detail.authorAvatarKey) ? (
                    <img src={avatarUrl(detail.authorAvatarKey)} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-stone-300">
                      <BulbIcon size={16} />
                    </span>
                  )}
                  <span className="truncate text-sm font-medium">{detail.authorName ?? _('annotation.myNote')}</span>
                </div>
                <p className="whitespace-pre-wrap pt-4 text-base leading-7">{detail.annotation.note}</p>
                {quoteText && (
                  <div className="mt-5 border-t border-white/10 pt-3">
                    <span className="text-stone-500">
                      <QuoteLeftIcon height={14} />
                    </span>
                    <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-stone-400">{quoteText}</p>
                  </div>
                )}
                <div className="flex items-center gap-2 pt-4 text-xs text-stone-400">
                  <span>
                    {_('annotation.publishedAt')} {formatFullDateTime(_, detail.annotation.createdAt)}
                  </span>
                  <div className="flex-1" />
                  <button onClick={() => onCopyNote(detail)} title={_('annotation.copy')} className={detailActionBtn}>
                    <CopyIcon />
                  </button>
                  <button onClick={() => onShareNote(detail)} title={_('annotation.share')} className={detailActionBtn}>
                    <ExcerptShareIcon />
                  </button>
                  {detail.own && (
                    <>
                      <button onClick={() => onEdit(detail)} title={_('annotation.editNote')} className={detailActionBtn}>
                        <PencilIcon />
                      </button>
                      <button
                        onClick={() => onDelete(detail)}
                        title={_('annotation.deleteAnnotation')}
                        className={`${detailActionBtn} hover:bg-red-500/10 hover:text-red-400`}
                      >
                        <TrashIcon />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-md">
              <div className={card}>
                <div className="relative px-5 pt-4">
                  <span className="text-stone-500">
                    <QuoteLeftIcon height={20} />
                  </span>
                  {quoteClamped && (
                    <button
                      onClick={() => setQuoteExpanded((v) => !v)}
                      title={_(quoteExpanded ? 'annotation.collapseQuote' : 'annotation.expandQuote')}
                      aria-expanded={quoteExpanded}
                      className="absolute right-2 top-3 flex h-8 w-8 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-white/10 hover:text-stone-200"
                    >
                      <span className={`transition-transform ${quoteExpanded ? 'rotate-180' : ''}`}>
                        <ChevronDownIcon />
                      </span>
                    </button>
                  )}
                  <p
                    ref={quoteRef}
                    className={`mt-2 whitespace-pre-wrap text-base leading-relaxed ${quoteExpanded ? '' : 'line-clamp-3'}`}
                  >
                    {quoteText}
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-around border-t border-white/10 px-2 py-1.5">
                  {quoteActions.map((a) => (
                    <button key={a.key} onClick={a.onClick} title={a.title} className={iconBtn}>
                      {a.icon}
                    </button>
                  ))}
                </div>
              </div>
              {entries.map((entry) => (
                <button
                  key={entry.annotation.id}
                  onClick={() => setDetail(entry)}
                  className={`${card} mt-3 block w-full p-4 text-left transition-colors hover:bg-stone-600`}
                >
                  <div className="flex items-center gap-2.5">
                    {avatarUrl(entry.authorAvatarKey) ? (
                      <img src={avatarUrl(entry.authorAvatarKey)} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-stone-300">
                        <BulbIcon size={16} />
                      </span>
                    )}
                    <span className="truncate text-sm font-medium">{entry.authorName ?? _('annotation.myNote')}</span>
                    {entry.own && (
                      <span className="ml-auto shrink-0 rounded-full bg-white/10 px-2.5 py-0.5 text-xs text-stone-300">
                        {_('annotation.myNote')}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-base leading-relaxed">{entry.annotation.note}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onClose}
        title={_('annotation.cancel')}
        className="mb-6 mt-2 flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-full bg-black/80 text-white shadow-xl transition-transform hover:scale-105"
      >
        <CloseIcon />
      </button>
    </div>
  )
}
