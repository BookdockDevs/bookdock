import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type { AnnotationRes, AnnotationUpdateReq } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { useDialogLayout } from '@/components/ui/dialog-layout-context'
import { avatarUrl } from '@/lib/avatar'

import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

import { getLastHighlightStyle } from './annotation-colors'
import { AiSparkleIcon, BulbIcon, ChevronDownIcon, CloseIcon, CopyIcon, ExcerptShareIcon, PencilIcon, QuoteLeftIcon, SearchIcon, StyleGlyph } from './annotation-icons'
import IdeaImageEditor, { type IdeaImageEditorHandle } from '@/features/content-files/components/IdeaImageEditor'
import IdeaCard from './IdeaCard'
import IdeaDetailCard from './IdeaDetailCard'
import IdeaDiscussionPanel from './IdeaDiscussionPanel'
import IdeaVisibilityControl from './IdeaVisibilityControl'
import { markEscConsumed } from '../lib/esc-consumed'
import { useIdeaDiscussion } from '../hooks/useIdeas'
import { useIsTouch } from '../hooks/useIsTouch'

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
  onSaveIdea?: (note: string, visibility?: 'private' | 'shared', files?: Pick<AnnotationUpdateReq, 'imageIds' | 'draftId'>) => Promise<void>
  defaultVisibility?: 'private' | 'shared'
  visibilityEligible?: boolean
  sourceReadable?: boolean
  onAiChat: () => void
  onShareQuote: () => void
  onSearch: () => void
  onCopyNote: (entry: IdeaEntry) => void
  onShareNote: (entry: IdeaEntry) => void
  onEdit: (entry: IdeaEntry) => void
  onDelete: (entry: IdeaEntry) => void
  onClose: () => void
}

const card = 'rounded-2xl border border-[var(--bd-read-accent)] bg-[var(--bd-read-bg)] text-[var(--bd-read-text)] shadow-xl'
const iconBtn =
  'flex h-10 w-10 items-center justify-center rounded-full text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current'

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
  onSaveIdea,
  defaultVisibility = 'private',
  visibilityEligible = false,
  sourceReadable = false,
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
  const isTouch = useIsTouch()
  const ideaDisplayMode = useUiStore((s) => s.ideaDisplayMode)
  // Sidebar mode is for non-touch desktop viewports; touch always falls back to modal
  const effectiveMode = isTouch ? 'modal' : ideaDisplayMode

  const isAutoExpandable = useCallback((id: string | null | undefined) => {
    if (!id) return false
    const entry = entries.find((e) => e.annotation.id === id)
    if (!entry) return false
    return Boolean(
      entry.annotation.visibility !== 'private' &&
      entry.commentCount &&
      entry.commentCount > 0,
    )
  }, [entries])

  const [detailId, setDetailId] = useState<string | null>(effectiveMode === 'modal' ? (initialDetailId ?? null) : null)
  const [expandedIdeaId, setExpandedIdeaId] = useState<string | null>(
    effectiveMode === 'sidebar' && isAutoExpandable(initialDetailId) ? (initialDetailId ?? null) : null,
  )
  const detail = entries.find((entry) => entry.annotation.id === detailId) ?? null
  const discussion = useIdeaDiscussion(detail?.annotation.id ?? null, bookId)
  const isDetailLiked = discussion.data?.data.idea.liked ?? detail?.liked ?? false
  const quoteRef = useRef<HTMLParagraphElement>(null)
  const [quoteExpanded, setQuoteExpanded] = useState(false)
  const [quoteClamped, setQuoteClamped] = useState(false)

  const user = useAuthStore((state) => state.user)
  const [sidebarDraft, setSidebarDraft] = useState('')
  const [sidebarFiles, setSidebarFiles] = useState<Pick<AnnotationUpdateReq, 'imageIds' | 'draftId'>>()
  const [sidebarUploading, setSidebarUploading] = useState(false)
  const [sidebarVisibility, setSidebarVisibility] = useState<'private' | 'shared'>(defaultVisibility)
  const [isSidebarFocused, setIsSidebarFocused] = useState(false)
  const [isSidebarSubmitting, setIsSidebarSubmitting] = useState(false)
  const sidebarInputRef = useRef<HTMLTextAreaElement>(null)
  const sidebarImageEditorRef = useRef<IdeaImageEditorHandle>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      if (e.key === 'Escape' && !document.querySelector('[role="alertdialog"][aria-modal="true"]')) {
        markEscConsumed()
        if (effectiveMode === 'sidebar') {
          if (isSidebarFocused) {
            setIsSidebarFocused(false)
            sidebarInputRef.current?.blur()
          } else if (expandedIdeaId) {
            setExpandedIdeaId(null)
          } else {
            onClose()
          }
        } else {
          if (detailId && !initialDetailId) {
            setDetailId(null)
          } else {
            onClose()
          }
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, detailId, initialDetailId, effectiveMode, expandedIdeaId, isSidebarFocused])

  useEffect(() => {
    if (initialDetailId) {
      if (effectiveMode === 'sidebar') {
        if (isAutoExpandable(initialDetailId)) {
          setExpandedIdeaId(initialDetailId)
        }
      } else {
        setDetailId(initialDetailId)
      }
    }
  }, [initialDetailId, effectiveMode, isAutoExpandable])

  // A deleted entry vanishes from `entries` once the annotations query refetches;
  // drop back to the list level instead of showing a stale detail card
  useEffect(() => {
    if (detailId && !entries.some((e) => e.annotation.id === detailId)) setDetailId(null)
    if (expandedIdeaId && !entries.some((e) => e.annotation.id === expandedIdeaId)) setExpandedIdeaId(null)
  }, [detailId, expandedIdeaId, entries])

  async function handleSidebarSubmit() {
    const hasImages = (sidebarFiles?.imageIds?.length ?? 0) > 0
    if ((!sidebarDraft.trim() && !hasImages) || isSidebarSubmitting || sidebarUploading) return
    if (onSaveIdea) {
      setIsSidebarSubmitting(true)
      try {
        await onSaveIdea(sidebarDraft.trim(), sidebarVisibility, sidebarFiles)
        setSidebarDraft('')
        setSidebarFiles(undefined)
        setIsSidebarFocused(false)
      } finally {
        setIsSidebarSubmitting(false)
      }
    } else {
      onWriteNote()
    }
  }

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
  const storedWidth = useUiStore((s) => s.ideaSidebarWidth)
  const setStoredWidth = useUiStore((s) => s.setIdeaSidebarWidth)
  const IDEA_SIDEBAR_MIN = 280
  const IDEA_SIDEBAR_MAX = 720
  const DEFAULT_IDEA_SIDEBAR_WIDTH = 380

  const [panelWidth, setPanelWidth] = useState(storedWidth)
  const [resizing, setResizing] = useState(false)
  const resizingRef = useRef(false)
  const panelRefWidth = useRef(panelWidth)
  const dragState = useRef({ clientX: 0, width: 0 })
  const sidebarRef = useRef<HTMLDivElement>(null)

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    resizingRef.current = true
    dragState.current.width = panelWidth
    dragState.current.clientX = e.clientX
    setResizing(true)
    document.body.classList.add('reader-resizing')
  }, [panelWidth])

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!resizingRef.current) return
    const delta = dragState.current.clientX - e.clientX
    const next = Math.max(IDEA_SIDEBAR_MIN, Math.min(IDEA_SIDEBAR_MAX, dragState.current.width + delta))
    setPanelWidth(next)
    panelRefWidth.current = next
  }, [])

  const handlePointerUp = useCallback(() => {
    if (!resizingRef.current) return
    resizingRef.current = false
    setResizing(false)
    document.body.classList.remove('reader-resizing')
    setStoredWidth(panelRefWidth.current)
  }, [setStoredWidth])

  const handleResetWidth = useCallback(() => {
    setPanelWidth(DEFAULT_IDEA_SIDEBAR_WIDTH)
    panelRefWidth.current = DEFAULT_IDEA_SIDEBAR_WIDTH
    setStoredWidth(DEFAULT_IDEA_SIDEBAR_WIDTH)
  }, [setStoredWidth])

  useEffect(() => () => {
    document.body.classList.remove('reader-resizing')
  }, [])


  if (effectiveMode === 'sidebar') {
    const userAvatar = user?.avatarKey ? avatarUrl(user.avatarKey) : undefined

    return createPortal(
      <div
        className={`fixed inset-0 z-50 flex justify-end pb-[env(safe-area-inset-bottom)] pointer-events-none ${dialogLayout.className}`}
        style={dialogLayout.style}
      >
        {fontCss && <style data-reader-font>{fontCss}</style>}
        <div
          ref={sidebarRef}
          className={cn(
            'relative flex h-full flex-col border-l border-stone-200/80 shadow-2xl animate-in slide-in-from-right duration-200 pointer-events-auto dark:border-stone-800/80',
            !resizing && 'transition-[width] duration-150 will-change-[width]',
          )}
          style={{ width: `${panelWidth}px`, backgroundColor: 'var(--bd-read-bg)', color: 'var(--bd-read-text)' }}
        >
          {/* Resize handle on the left seam (drag to resize width) */}
          <div
            data-testid="idea-sidebar-resize-handle"
            className="group absolute -left-1.5 top-0 z-50 h-full w-3 reader-resize-cursor select-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={handleResetWidth}
            title="双击恢复默认宽度"
          >
            {/* Active dragging guide line along the seam */}
            <div
              className={cn(
                'pointer-events-none absolute left-1/2 top-0 h-full w-[2px] -translate-x-1/2 transition-colors duration-150',
                resizing
                  ? 'bg-[var(--bd-read-primary)]/85 shadow-[0_0_8px_var(--bd-read-primary)]/30'
                  : 'bg-transparent',
              )}
            />
            {/* Tactile centered grip pill */}
            <span
              className={cn(
                'pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-150',
                resizing
                  ? 'h-14 w-1 bg-[var(--bd-read-primary)] shadow-[0_0_0_2px_var(--bd-read-primary)]/20'
                  : 'h-10 w-1 bg-transparent group-hover:bg-[var(--bd-read-sub)]/50',
              )}
            />
          </div>
          {/* Top Header */}
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-stone-200/50 px-4 dark:border-stone-800/60">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-amber-500 dark:text-amber-400"><BulbIcon size={18} /></span>
              <span className="text-sm font-semibold">{_('annotation.idea')}</span>
              {entries.length > 0 && (
                <span className="rounded-full bg-stone-500/10 px-2 py-0.5 text-xs text-[var(--bd-read-sub)] font-medium tabular-nums">
                  {entries.length}
                </span>
              )}
            </div>

            <button
              onClick={onClose}
              title={_('annotation.cancel')}
              aria-label={_('annotation.cancel')}
              className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current cursor-pointer"
            >
              <CloseIcon size={16} />
            </button>
          </div>

          {/* Drawer Body Scroll Area */}
          <div className="flex-1 min-h-0 overflow-y-auto reader-scrollbar px-4 py-3 space-y-3">
            {/* Context Quote Strip (QiDian style: lightweight accent bar) */}
            {quoteText && (
              <div className="relative rounded-r-lg border-l-2 border-[var(--bd-read-primary)]/80 bg-stone-500/[0.04] px-3 py-2 text-xs text-[var(--bd-read-sub)] dark:bg-stone-500/[0.06]">
                <p
                  ref={quoteRef}
                  className={cn('whitespace-pre-wrap leading-relaxed', !quoteExpanded && 'line-clamp-2')}
                  style={fontStack ? { fontFamily: fontStack } : undefined}
                >
                  {quoteText}
                </p>
                <div className="mt-1.5 flex items-center justify-between">
                  {quoteClamped ? (
                    <button
                      type="button"
                      onClick={() => setQuoteExpanded((v) => !v)}
                      title={_(quoteExpanded ? 'annotation.collapseQuote' : 'annotation.expandQuote')}
                      aria-expanded={quoteExpanded}
                      className="flex items-center gap-1 text-[11px] font-medium text-[var(--bd-read-primary)] hover:underline cursor-pointer"
                    >
                      <span>{_(quoteExpanded ? 'annotation.collapse' : 'annotation.expand')}</span>
                      <span className={`transition-transform inline-block ${quoteExpanded ? 'rotate-180' : ''}`}>
                        <ChevronDownIcon size={12} />
                      </span>
                    </button>
                  ) : <span />}
                  {quoteActionsVisible && (
                    <div className="flex items-center gap-0.5 -mr-1">
                      {quoteActions.map((a) => (
                        <button
                          key={a.key}
                          onClick={a.onClick}
                          title={a.title}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/15 hover:text-[var(--bd-read-text)] cursor-pointer [&>svg]:h-3.5 [&>svg]:w-3.5"
                        >
                          {a.icon}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Entry List (Stream Layout with Inline Replies) */}
            {entries.length > 0 ? (
              <div className="pt-0.5 space-y-3">
                {entries.map((entry) => {
                  const isExpanded = expandedIdeaId === entry.annotation.id
                  return (
                    <div key={entry.annotation.id}>
                      <IdeaCard
                        entry={entry}
                        variant="flat"
                        showQuote={false}
                        isExpanded={isExpanded}
                        onOpen={() => setExpandedIdeaId((prev) => (prev === entry.annotation.id ? null : entry.annotation.id))}
                        onToggleLike={onToggleLike ? () => onToggleLike(entry) : undefined}
                        onCopy={() => onCopyNote(entry)}
                        onShare={() => onShareNote(entry)}
                        onEdit={() => onEdit(entry)}
                        onDelete={() => onDelete(entry)}
                        onJump={onJump && entry.locationAvailable !== false ? () => onJump(entry) : undefined}
                        fontStack={fontStack}
                      />
                      {isExpanded && (
                        <div className="mt-1.5 ml-3 border-l-2 border-[var(--bd-read-primary)]/40 pl-3 pb-2 pt-1 animate-in fade-in-50 duration-150">
                          <IdeaDiscussionPanel
                            ideaId={entry.annotation.id}
                            bookId={bookId}
                            initialCommentCount={entry.commentCount}
                            initialLikeCount={entry.likeCount}
                            hideTabs={true}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-[var(--bd-read-sub)]">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-500/10 text-stone-400 dark:text-stone-500 mb-3">
                  <BulbIcon size={22} />
                </span>
                <p className="text-sm font-medium">{_('annotation.notePlaceholder')}</p>
              </div>
            )}
          </div>

          {/* In-situ Bottom Composer (Plan A + QiDian style) - hidden when an idea discussion is expanded to avoid dual input boxes */}
          {!expandedIdeaId && (
            <div className="shrink-0 border-t border-stone-200/60 bg-[var(--bd-read-bg)] p-3 dark:border-stone-800/60">
              {isSidebarFocused || sidebarDraft.trim() ? (
                <div className="space-y-2.5 rounded-xl border border-stone-300/80 bg-stone-500/[0.04] p-3 transition-colors dark:border-stone-700/80 dark:bg-stone-500/[0.06]">
                  <div className="flex items-start gap-2.5">
                    {userAvatar ? (
                      <img src={userAvatar} alt="" className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover" />
                    ) : (
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-stone-400/20 text-[10px] font-medium text-[var(--bd-read-sub)]">
                        {user?.username ? user.username.slice(0, 1) : <BulbIcon size={12} />}
                      </span>
                    )}
                    <textarea
                      ref={sidebarInputRef}
                      autoFocus
                      aria-label={_('annotation.notePlaceholder')}
                      placeholder={_('annotation.notePlaceholder')}
                      value={sidebarDraft}
                      onChange={(e) => setSidebarDraft(e.target.value)}
                      onPaste={(e) => {
                        const files = Array.from(e.clipboardData.files).filter((file) => file.type.startsWith('image/'))
                        if (files.length > 0) { e.preventDefault(); e.stopPropagation(); sidebarImageEditorRef.current?.addFiles(files) }
                      }}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                          e.preventDefault()
                          void handleSidebarSubmit()
                        } else if (e.key === 'Escape') {
                          e.preventDefault()
                          setIsSidebarFocused(false)
                          sidebarInputRef.current?.blur()
                        }
                      }}
                      disabled={isSidebarSubmitting}
                      maxLength={10000}
                      rows={2}
                      className="min-w-0 flex-1 resize-none bg-transparent text-sm leading-relaxed text-[var(--bd-read-text)] placeholder-[var(--bd-read-sub)]/50 focus:outline-hidden"
                    />
                  </div>

                  <IdeaImageEditor ref={sidebarImageEditorRef} bookVersionId={bookId} disabled={isSidebarSubmitting} onChange={(files, pending) => { setSidebarFiles(files); setSidebarUploading(pending) }} />
                  <div className="flex items-center justify-between border-t border-stone-200/40 pt-2 dark:border-stone-800/40">
                    <div className="flex items-center gap-2">
                      {visibilityEligible && (
                        <IdeaVisibilityControl
                          value={sidebarVisibility}
                          onChange={setSidebarVisibility}
                          sourceReadable={sourceReadable}
                          disabled={isSidebarSubmitting}
                        />
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <button
                        type="button"
                        disabled={isSidebarSubmitting}
                        onClick={() => {
                          setSidebarDraft('')
                          setIsSidebarFocused(false)
                        }}
                        className="px-2.5 py-1 text-xs text-[var(--bd-read-sub)] hover:text-[var(--bd-read-text)] transition-colors cursor-pointer"
                      >
                        {_('comment.cancel')}
                      </button>
                      <button
                        type="button"
                        disabled={isSidebarSubmitting || sidebarUploading || (!sidebarDraft.trim() && !(sidebarFiles?.imageIds?.length ?? 0))}
                        onClick={() => void handleSidebarSubmit()}
                        className="rounded-full bg-[var(--bd-read-primary)] px-4 py-1 text-xs font-medium text-white shadow-xs transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer"
                      >
                        {isSidebarSubmitting ? '...' : _('annotation.publish')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (onSaveIdea) {
                      setIsSidebarFocused(true)
                      setTimeout(() => sidebarInputRef.current?.focus(), 50)
                    } else {
                      onWriteNote()
                    }
                  }}
                  className="flex w-full items-center gap-2.5 rounded-full border border-stone-300/70 bg-stone-500/5 px-4 py-2.5 text-left text-xs text-[var(--bd-read-sub)] shadow-xs transition-all hover:border-[var(--bd-read-primary)] hover:bg-stone-500/10 hover:text-[var(--bd-read-text)] dark:border-stone-700/70 cursor-pointer"
                >
                  <span className="text-[var(--bd-read-primary)]"><PencilIcon /></span>
                  <span className="flex-1 truncate">{_('annotation.notePlaceholder')}</span>
                  <span className="rounded-md bg-stone-500/15 px-2 py-0.5 text-[11px] font-medium text-stone-500 dark:text-stone-400">
                    {_('annotation.writeNote')}
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>,
      document.body,
    )
  }

  return createPortal(
    <div
      data-reader-modal=""
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
            <div className={`${card} flex min-h-0 max-h-[calc(100dvh-2rem)] w-full max-w-[420px] flex-col overflow-hidden`}>
              <IdeaDetailCard
                detail={detail}
                quoteText={quoteText}
                fontStack={fontStack}
                surface
                liked={isDetailLiked}
                onBack={() => setDetailId(null)}
                onJump={onJump}
                onToggleLike={onToggleLike}
                onShare={onShareNote}
                onCopy={onCopyNote}
                onEdit={onEdit}
                onDelete={onDelete}
              >
                <IdeaDiscussionPanel
                  key={detail.annotation.id}
                  ideaId={detail.annotation.id}
                  bookId={bookId}
                  detailLayout
                  initialCommentCount={detail.commentCount}
                  initialLikeCount={detail.likeCount}
                />
              </IdeaDetailCard>
            </div>
          ) : (
            <div className="w-full max-w-[420px]">
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
                    fontStack={fontStack}
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
