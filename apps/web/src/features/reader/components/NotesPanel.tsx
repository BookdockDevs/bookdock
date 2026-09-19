import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react'

import type { AnnotationRes, AnnotationStyle } from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'

import { useReaderApi } from '../hooks/useReaderApi'
import { useDeleteAnnotation, useUpdateAnnotation } from '../hooks/useAnnotations'
import { kindOf, type NoteSort } from '../hooks/useNotesFilter'
import { markEscConsumed } from '../lib/esc-consumed'
import { useReaderState } from '../state/reader-state'
import AnnotationExportDialog from './AnnotationExportDialog'
import { HIGHLIGHT_COLORS } from './annotation-colors'
import { BookmarkIcon, BulbIcon, CheckIcon, CloseIcon, CopyIcon, DocumentExportIcon, PencilIcon, SelectionIcon, ShareIcon, TrashIcon } from './annotation-icons'
import { formatFullDateTime, formatRelativeTime } from './format-relative-time'

function hexOf(a: AnnotationRes): string {
  return HIGHLIGHT_COLORS.find((c) => c.name === a.color)?.hex ?? '#eab308'
}

/** Render the marked text the way it appears in the book: underline / wavy / tinted background */
function highlightDecoration(style: AnnotationStyle, hex: string): CSSProperties {
  if (style === 'highlight') {
    return {
      backgroundColor: `${hex}2e`,
      borderRadius: 2,
      padding: '0 1px',
      boxDecorationBreak: 'clone',
      WebkitBoxDecorationBreak: 'clone',
    }
  }
  return {
    textDecoration: 'underline',
    textDecorationColor: hex,
    textDecorationStyle: style === 'squiggly' ? 'wavy' : 'solid',
    textDecorationThickness: '1.5px',
    textUnderlineOffset: '3px',
  }
}

const actionBtn =
  'flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current'

function autoGrow(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

/** Inline card editor replacing the prompt-based rename: auto-growing
 *  textarea, Ctrl+Enter saves, Escape / outside click cancels (mirrors the
 *  selection-toolbar NoteEditorPopup interaction) */
function InlineEditor({
  initial,
  placeholder,
  onSave,
  onCancel,
}: {
  initial: string
  placeholder: string
  onSave: (value: string) => void
  onCancel: () => void
}) {
  const _ = useTranslation()
  const [draft, setDraft] = useState(initial)
  const rootRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        markEscConsumed()
        onCancel()
      }
    }
    function onPointerDown(e: globalThis.MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('mousedown', onPointerDown)
    textareaRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('mousedown', onPointerDown)
    }
  }, [onCancel])

  function submit() {
    const value = draft.trim()
    if (value) onSave(value)
    else onCancel()
  }

  return (
    <div ref={rootRef} className="p-3" onContextMenu={(e) => e.stopPropagation()}>
      <textarea
        ref={textareaRef}
        rows={1}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          autoGrow(e.target)
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            onCancel()
          }
        }}
        placeholder={placeholder}
        className="w-full resize-none bg-transparent text-sm leading-relaxed text-current outline-none placeholder:text-[var(--bd-read-sub)]"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-xs text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current"
        >
          {_('annotation.cancel')}
        </button>
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="rounded-md bg-blue-500 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:opacity-60"
        >
          {_('annotation.save')}
        </button>
      </div>
    </div>
  )
}

interface NotesPanelProps {
  items: AnnotationRes[]
  allItems?: AnnotationRes[]
  total?: number
  sort: NoteSort
  locked?: boolean
  onClose?: () => void
  /** Chapter titles in book order, used to sort chapter groups and exports */
  chapterOrder: string[]
  bookId: string
  selectionMode?: boolean
  onExitSelection?: () => void
  allExpanded?: boolean
  selectedIds?: Set<string>
  onToggleSelected?: (id: string) => void
  hideSelectionToolbar?: boolean
}

export const NotesPanel = memo(function NotesPanel({
  items,
  allItems = items,
  total: _total,
  sort,
  locked,
  onClose,
  chapterOrder,
  bookId,
  selectionMode = false,
  onExitSelection,
  allExpanded,
  selectedIds: externalSelectedIds,
  onToggleSelected,
  hideSelectionToolbar = false,
}: NotesPanelProps) {
  const _ = useTranslation()
  const { renderer } = useReaderApi()
  const deleteAnnotation = useDeleteAnnotation(bookId)
  const updateAnnotation = useUpdateAnnotation(bookId)
  const setShareTarget = useReaderState((s) => s.setShareTarget)
  // Annotations whose CFI no longer resolves (P2): badge them and refuse to
  // navigate instead of silently landing nowhere
  const orphanedKeys = useReaderState((s) => s.orphanedAnnotationKeys)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: AnnotationRes } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(new Set())
  const selectedIds = externalSelectedIds ?? internalSelectedIds
  const [exportOpen, setExportOpen] = useState(false)
  const [expandedCardIds, setExpandedCardIds] = useState<Set<string>>(new Set())
  const [expandedQuoteIds, setExpandedQuoteIds] = useState<Set<string>>(new Set())
  const wasSelectionMode = useRef(false)

  useEffect(() => {
    if (externalSelectedIds) return
    if (selectionMode && !wasSelectionMode.current) {
      setInternalSelectedIds(new Set(items.map((item) => item.id)))
    } else if (!selectionMode) {
      setInternalSelectedIds(new Set())
      setExportOpen(false)
    }
    wasSelectionMode.current = selectionMode
  }, [items, selectionMode, externalSelectedIds])

  useEffect(() => {
    if (allExpanded === undefined) return
    if (allExpanded) {
      setExpandedCardIds(new Set(items.map((item) => item.id)))
      setExpandedQuoteIds(new Set(items.map((item) => item.id)))
    } else {
      setExpandedCardIds(new Set())
      setExpandedQuoteIds(new Set())
    }
  }, [allExpanded, items])

  function toggleSelected(id: string) {
    if (onToggleSelected) {
      onToggleSelected(id)
      return
    }
    setInternalSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    const visibleIds = items.map((item) => item.id)
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
    setInternalSelectedIds((previous) => {
      const next = new Set(previous)
      for (const id of visibleIds) {
        if (allVisibleSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  function toggleNoteExpand(id: string, e: MouseEvent) {
    e.stopPropagation()
    setExpandedCardIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleQuoteExpand(id: string, e: MouseEvent) {
    e.stopPropagation()
    setExpandedQuoteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Chapter-grouped view, or null when a flat time-sorted list should render */
  const groups = useMemo(() => {
    if (sort !== 'chapter' && sort !== 'chapter-desc') return null
    const byChapter = new Map<string, AnnotationRes[]>()
    for (const a of items) {
      const key = a.chapter || _('reader.uncategorized')
      if (!byChapter.has(key)) byChapter.set(key, [])
      byChapter.get(key)!.push(a)
    }
    const orderIndex = (name: string) => {
      const i = chapterOrder.indexOf(name)
      return i < 0 ? chapterOrder.length : i
    }
    const reverse = sort === 'chapter-desc'
    return Array.from(byChapter.entries())
      .map(([chapter, list]) => ({
        chapter,
        list: list.sort((a, b) => (reverse ? -1 : 1) * a.cfiRange.localeCompare(b.cfiRange)),
      }))
      .sort((g1, g2) => {
        const a = orderIndex(g1.chapter)
        const b = orderIndex(g2.chapter)
        const aUnknown = a === chapterOrder.length
        const bUnknown = b === chapterOrder.length
        if (aUnknown !== bUnknown) return aUnknown ? 1 : -1
        return (reverse ? -1 : 1) * (a - b)
      })
  }, [items, sort, chapterOrder, _])

  const flat = useMemo(() => {
    if (sort === 'chapter' || sort === 'chapter-desc') return null
    return [...items].sort((a, b) => (sort === 'time-asc' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt))
  }, [items, sort])



  // The click that dismisses the context menu must not also turn a page
  useEffect(() => {
    if (!contextMenu || !renderer) return
    renderer.pushPopupGuard()
    return () => renderer.popPopupGuard()
  }, [contextMenu, renderer])

  function goTo(item: AnnotationRes) {
    if (orphanedKeys.includes(`${item.cfiRange}|${item.type}`)) {
      notify.info({ key: 'annotation.orphanedNotice' })
      return
    }
    renderer?.display(item.cfiRange)
    if (!locked) onClose?.()
  }

  function handleContextMenu(e: MouseEvent, item: AnnotationRes) {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, item })
  }

  async function copyItem(item: AnnotationRes) {
    try {
      await navigator.clipboard.writeText(kindOf(item) === 'idea' ? (item.note ?? '') : item.text)
      notify.success({ key: 'reader.copied' })
    } catch {
      notify.error({ key: 'reader.copyFailed' })
    }
  }

  function saveEdit(item: AnnotationRes, value: string) {
    updateAnnotation.mutate({
      id: item.id,
      body: item.type === 'bookmark' ? { text: value } : { note: value },
    })
    setEditingId(null)
  }

  function deleteItem(item: AnnotationRes) {
    deleteAnnotation.mutate(item.id)
  }

  function shareItem(item: AnnotationRes) {
    setShareTarget({
      text: item.text,
      chapter: item.chapter,
      note: kindOf(item) === 'idea' ? (item.note ?? undefined) : undefined,
      createdAt: item.createdAt,
    })
  }

  function renderCard(a: AnnotationRes) {
    const hex = hexOf(a)
    const kind = kindOf(a)
    const orphaned = orphanedKeys.includes(`${a.cfiRange}|${a.type}`)
    const isNoteExpanded = expandedCardIds.has(a.id)
    const isQuoteExpanded = expandedQuoteIds.has(a.id)
    const isLongIdeaNote =
      kind === 'idea' &&
      ((a.note?.length ?? 0) > 60 || (a.note?.includes('\n') ?? false))
    const isLongQuote =
      kind === 'idea' &&
      ((a.text?.length ?? 0) > 40 || (a.text?.includes('\n') ?? false))
    const isLongHighlight =
      kind === 'highlight' &&
      ((a.text?.length ?? 0) > 65 || (a.text?.includes('\n') ?? false))

    return (
      <div
        onContextMenu={(e) => handleContextMenu(e, a)}
        className={cn(
          'group relative rounded-xl border border-stone-200/50 bg-stone-500/[0.03] p-2.5 transition-all hover:border-stone-300/80 hover:bg-stone-500/[0.07] hover:shadow-xs dark:border-stone-800/60 dark:bg-stone-500/[0.05] dark:hover:border-stone-700/70 dark:hover:bg-stone-500/[0.1]',
          orphaned && 'opacity-60',
          selectionMode && selectedIds.has(a.id) && 'border-[var(--bd-read-primary)]/50 bg-[var(--bd-read-primary)]/[0.06] ring-1 ring-[var(--bd-read-primary)]/20',
        )}
      >
        {orphaned && (
          <span
            title={_('annotation.orphanedNotice')}
            className="absolute right-2 top-2 z-10 shrink-0 rounded border border-red-300 px-1.5 py-0.5 text-[10px] text-red-500 dark:border-red-800 dark:text-red-400"
          >
            {_('annotation.orphaned')}
          </span>
        )}
        {editingId === a.id ? (
          <InlineEditor
            initial={a.type === 'bookmark' ? a.text : (a.note ?? '')}
            placeholder={a.type === 'bookmark' ? _('annotation.renamePlaceholder') : _('annotation.notePlaceholder')}
            onSave={(value) => saveEdit(a, value)}
            onCancel={() => setEditingId(null)}
          />
        ) : (
          <>
            <button
              onClick={() => (selectionMode ? toggleSelected(a.id) : goTo(a))}
              className={cn('w-full text-left', selectionMode && 'pr-8')}
            >
              {selectionMode && (
                <span
                  className={cn(
                    'absolute right-2.5 top-3 flex h-5 w-5 items-center justify-center rounded-full border transition-colors',
                    selectedIds.has(a.id)
                      ? 'border-[var(--bd-read-primary)] bg-[var(--bd-read-primary)] text-[var(--bd-read-bg)]'
                      : 'border-stone-300 bg-transparent dark:border-stone-600',
                  )}
                >
                  {selectedIds.has(a.id) && <CheckIcon size={13} strokeWidth={2.4} />}
                </span>
              )}
              {kind === 'bookmark' && (
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-500 dark:text-blue-400">
                    <BookmarkIcon />
                  </span>
                  <p className="line-clamp-2 flex-1 text-sm font-medium text-current">{a.text || _('reader.bookmark')}</p>
                </div>
              )}
              {kind === 'idea' && (
                <div className="space-y-2">
                  <div className="group/note flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-500 dark:text-amber-400">
                      <BulbIcon />
                    </span>
                    <div className={cn('relative flex-1 min-w-0', isNoteExpanded && isLongIdeaNote && 'pb-5')}>
                      <p
                        className={cn(
                          'text-sm font-medium leading-relaxed text-current whitespace-pre-wrap break-words',
                          !isNoteExpanded && 'line-clamp-3',
                        )}
                      >
                        {a.note}
                      </p>
                      {isLongIdeaNote && (
                        <button
                          type="button"
                          onClick={(e) => toggleNoteExpand(a.id, e)}
                          className="absolute bottom-0 right-0 inline-flex items-center gap-0.5 rounded-md border border-stone-200/80 bg-[var(--bd-read-bg)]/95 px-1.5 py-0.5 text-[11px] text-[var(--bd-read-sub)] shadow-xs opacity-0 transition-opacity duration-150 group-hover/note:opacity-100 hover:text-current max-md:opacity-100 dark:border-stone-700/80"
                        >
                          <span>{isNoteExpanded ? _('annotation.collapse') : _('annotation.expand')}</span>
                          <svg
                            className={cn('h-2.5 w-2.5 transition-transform duration-150', isNoteExpanded && 'rotate-180')}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  {a.text && (
                    <div
                      className={cn(
                        'group/quote relative ml-7 rounded-lg border-l-2 border-[var(--bd-read-accent)]/70 bg-stone-500/5 px-2.5 py-1.5 text-xs text-[var(--bd-read-sub)]',
                        isQuoteExpanded && isLongQuote && 'pb-5',
                      )}
                    >
                      <p className={cn('leading-relaxed', !isQuoteExpanded && 'line-clamp-2')}>{a.text}</p>
                      {isLongQuote && (
                        <button
                          type="button"
                          onClick={(e) => toggleQuoteExpand(a.id, e)}
                          className="absolute bottom-1 right-1.5 inline-flex items-center gap-0.5 rounded border border-stone-200/80 bg-[var(--bd-read-bg)]/95 px-1.5 py-0.5 text-[10px] text-[var(--bd-read-sub)] shadow-xs opacity-0 transition-opacity duration-150 group-hover/quote:opacity-100 hover:text-current max-md:opacity-100 dark:border-stone-700/80"
                        >
                          <span>{isQuoteExpanded ? _('annotation.collapse') : _('annotation.expand')}</span>
                          <svg
                            className={cn('h-2.5 w-2.5 transition-transform duration-150', isQuoteExpanded && 'rotate-180')}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="m6 9 6 6 6-6" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
              {kind === 'highlight' && (
                <div className="flex items-start gap-2.5">
                  <span
                    className="mt-1 flex h-3.5 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: hex }}
                    aria-hidden="true"
                  />
                  <div className={cn('relative flex-1 min-w-0', isNoteExpanded && isLongHighlight && 'pb-5')}>
                    <p
                      className={cn(
                        'text-sm leading-relaxed text-current',
                        !isNoteExpanded && 'line-clamp-4',
                      )}
                    >
                      <span style={highlightDecoration(a.style, hex)}>{a.text}</span>
                    </p>
                    {isLongHighlight && (
                      <button
                        type="button"
                        onClick={(e) => toggleNoteExpand(a.id, e)}
                        className="absolute bottom-0 right-0 inline-flex items-center gap-0.5 rounded-md border border-stone-200/80 bg-[var(--bd-read-bg)]/95 px-1.5 py-0.5 text-[11px] text-[var(--bd-read-sub)] shadow-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-current max-md:opacity-100 dark:border-stone-700/80"
                      >
                        <span>{isNoteExpanded ? _('annotation.collapse') : _('annotation.expand')}</span>
                        <svg
                          className={cn('h-2.5 w-2.5 transition-transform duration-150', isNoteExpanded && 'rotate-180')}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </button>
            {!selectionMode && (
              <div className="mt-2 flex h-6 items-center px-0.5 text-xs text-[var(--bd-read-sub)]">
                <span
                  aria-label={formatFullDateTime(_, a.createdAt)}
                  className="group/time text-[11px] tabular-nums text-[var(--bd-read-sub)] opacity-70 transition-opacity cursor-default select-none hover:opacity-100 truncate"
                >
                  <span className="inline group-hover/time:hidden">{formatRelativeTime(_, a.createdAt)}</span>
                  <span className="hidden group-hover/time:inline font-normal text-[var(--bd-read-text)]">
                    {formatFullDateTime(_, a.createdAt)}
                  </span>
                </span>
                <div className="flex-1" />
                <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 max-md:opacity-100">
                  {a.type === 'bookmark' ? (
                    <button onClick={() => setEditingId(a.id)} title={_('annotation.rename')} className={actionBtn}>
                      <PencilIcon />
                    </button>
                  ) : kind === 'idea' ? (
                    <button onClick={() => setEditingId(a.id)} title={_('annotation.editNote')} className={actionBtn}>
                      <PencilIcon />
                    </button>
                  ) : null}
                  <button onClick={() => copyItem(a)} title={_('annotation.copy')} className={actionBtn}>
                    <CopyIcon />
                  </button>
                  {a.type !== 'bookmark' && (
                    <button onClick={() => shareItem(a)} title={_('annotation.share')} className={actionBtn}>
                      <ShareIcon />
                    </button>
                  )}
                  <button
                    onClick={() => deleteItem(a)}
                    title={_('annotation.deleteHighlight')}
                    className={cn(actionBtn, 'ml-0.5 hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400')}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className={cn('space-y-4 pt-3 pb-6', items.length === 0 && 'flex flex-1 flex-col pt-0 pb-0')}>
      {selectionMode && !hideSelectionToolbar && (
        <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 rounded-xl border border-stone-200/60 bg-[var(--bd-read-bg)] px-3 py-2 text-xs shadow-xs dark:border-stone-800/60">
          <button
            type="button"
            onClick={selectAll}
            title={_('annotation.selectAll')}
            aria-label={_('annotation.selectAll')}
            className="flex items-center gap-1.5 text-[var(--bd-read-sub)] hover:text-current transition-colors"
          >
            <SelectionIcon
              state={
                items.length > 0 && items.every((item) => selectedIds.has(item.id))
                  ? 'all'
                  : items.some((item) => selectedIds.has(item.id))
                    ? 'partial'
                    : 'none'
              }
            />
            <span className="tabular-nums font-medium text-current">
              {_('annotation.exportSelected', { n: selectedIds.size })}
            </span>
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            disabled={selectedIds.size === 0}
            title={_('annotation.exportTitle')}
            aria-label={_('annotation.exportTitle')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current disabled:opacity-35 transition-colors"
          >
            <DocumentExportIcon size={16} />
          </button>
          {onExitSelection && (
            <button
              type="button"
              onClick={onExitSelection}
              title={_('annotation.cancel')}
              aria-label={_('annotation.cancel')}
              className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current transition-colors"
            >
              <CloseIcon size={16} />
            </button>
          )}
        </div>
      )}
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center pb-24 px-4 text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-stone-500/10 text-[var(--bd-read-sub)]">
            <svg
              className="h-7 w-7"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </div>
          <p className="text-base font-normal text-current">{_('reader.noNotes')}</p>
          <p className="mt-1.5 text-xs text-[var(--bd-read-sub)] max-w-64 leading-relaxed">
            {_('reader.noNotesHint')}
          </p>
        </div>
      ) : groups ? (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.chapter} className="space-y-2">
              <div className="group flex items-center justify-between px-1">
                <button
                  type="button"
                  onClick={() => {
                    const first = g.list[0]
                    if (first) goTo(first)
                  }}
                  className="font-semibold text-sm text-current hover:text-[var(--bd-read-primary)] transition-colors text-left truncate"
                  title={g.chapter}
                >
                  {g.chapter}
                </button>
                {g.list.length > 1 && (
                  <span className="shrink-0 text-xs text-[var(--bd-read-sub)] tabular-nums opacity-0 transition-opacity duration-150 group-hover:opacity-80">
                    {g.list.length}
                  </span>
                )}
              </div>
              <ul className="space-y-2">
                {g.list.map((a) => (
                  <li key={a.id}>{renderCard(a)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {flat!.map((a) => (
            <li key={a.id}>{renderCard(a)}</li>
          ))}
        </ul>
      )}

      {contextMenu && (
        <SmartMenu
          id="notes-context-menu"
          innerRef={contextMenuRef}
          variant="reader"
          width={130}
          position={{ left: contextMenu.x, top: contextMenu.y, dir: 'down' }}
          onClose={() => setContextMenu(null)}
        >
          <button
            type="button"
            onClick={() => {
              void copyItem(contextMenu.item)
              setContextMenu(null)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-stone-500/10"
          >
            <span className="text-[var(--bd-read-sub)] [&>svg]:h-3.5 [&>svg]:w-3.5">
              <CopyIcon />
            </span>
            {_('annotation.copy')}
          </button>
          {contextMenu.item.type !== 'bookmark' && (
            <button
              type="button"
              onClick={() => {
                shareItem(contextMenu.item)
                setContextMenu(null)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-stone-500/10"
            >
              <span className="text-[var(--bd-read-sub)] [&>svg]:h-3.5 [&>svg]:w-3.5">
                <ShareIcon />
              </span>
              {_('annotation.share')}
            </button>
          )}
          {contextMenu.item.type === 'bookmark' && (
            <button
              type="button"
              onClick={() => {
                setEditingId(contextMenu.item.id)
                setContextMenu(null)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-stone-500/10"
            >
              <span className="text-[var(--bd-read-sub)] [&>svg]:h-3.5 [&>svg]:w-3.5">
                <PencilIcon />
              </span>
              {_('annotation.rename')}
            </button>
          )}
          {kindOf(contextMenu.item) === 'idea' && (
            <button
              type="button"
              onClick={() => {
                setEditingId(contextMenu.item.id)
                setContextMenu(null)
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-stone-500/10"
            >
              <span className="text-[var(--bd-read-sub)] [&>svg]:h-3.5 [&>svg]:w-3.5">
                <PencilIcon />
              </span>
              {_('annotation.editNote')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              deleteItem(contextMenu.item)
              setContextMenu(null)
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-red-500 transition-colors hover:bg-red-500/10"
          >
            <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">
              <TrashIcon />
            </span>
            {_('reader.delete')}
          </button>
        </SmartMenu>
      )}
      {exportOpen && (
        <AnnotationExportDialog
          bookId={bookId}
          annotations={allItems.filter((item) => selectedIds.has(item.id))}
          sort={sort}
          chapterOrder={chapterOrder}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  )
})
