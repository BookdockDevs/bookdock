import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'

import type { AnnotationRes, AnnotationStyle } from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'

import { useReaderApi } from '../hooks/useReaderApi'
import { useDeleteAnnotation, useUpdateAnnotation } from '../hooks/useAnnotations'
import { kindOf, type NoteSort } from '../hooks/useNotesFilter'
import { isCustomBookmarkTitle } from '../lib/annotation-text'
import { compareCfiPosition } from '../lib/cfi-overlap'
import { buildChapterOrderLookup, type ChapterOrderItem } from '../lib/chapter-order'
import { markEscConsumed } from '../lib/esc-consumed'
import { useReaderState } from '../state/reader-state'
import AnnotationExportDialog from './AnnotationExportDialog'
import { HIGHLIGHT_COLORS } from './annotation-colors'
import { BookmarkIcon, BulbIcon, CheckIcon, CloseIcon, CopyIcon, DocumentExportIcon, PencilIcon, SelectionIcon, ShareIcon, TrashIcon } from './annotation-icons'
import { formatFullDateTime, formatRelativeTime } from './format-relative-time'

/**
 * A clamped paragraph that only offers the expand toggle when it is genuinely
 * cut off.
 *
 * A character count cannot answer that. The panel is resizable and the reader
 * picks their own font and size, so the same 80 characters take two lines on a
 * wide panel and five on a narrow one. A count-only guess showed the toggle
 * no matter what, then expanded into
 * nothing but the padding reserved for the button. Only the rendered box knows,
 * so measure it and re-measure when it resizes.
 *
 * `minLengthForToggle` is the fallback for when no layout exists to measure
 * (JSDOM), and a cheap way to skip observing paragraphs that cannot overflow.
 */
function ClampedText({
  text,
  clampClassName,
  className,
  wrapperClassName,
  renderText,
  expanded,
  onToggle,
  expandLabel,
  collapseLabel,
  minLengthForToggle,
}: {
  text: string
  clampClassName: string
  className: string
  /** Extra box treatment some call sites wrap the paragraph in. */
  wrapperClassName?: string
  /** Lets a call site decorate the text (a highlight's underline) without
   *  giving up the plain string the length check needs. */
  renderText?: (text: string) => ReactNode
  expanded: boolean
  onToggle: (e: MouseEvent) => void
  expandLabel: string
  collapseLabel: string
  minLengthForToggle: number
}) {
  const ref = useRef<HTMLParagraphElement | null>(null)
  const [clipped, setClipped] = useState(false)
  const [measurable, setMeasurable] = useState(false)
  const couldOverflow = text.length > minLengthForToggle || text.includes('\n')
  const paragraphs = text.replace(/\r\n?/g, '\n').split(/\n(?:[\t ]*\n)+/)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      // JSDOM lays nothing out, so there is no answer to give. Report that
      // rather than claiming every box is unclipped.
      if (el.clientHeight === 0) return
      setMeasurable(true)
      setClipped(el.scrollHeight - el.clientHeight > 1)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [text, expanded])

  const showToggle = couldOverflow && (measurable ? clipped || expanded : true)

  return (
    <div
      className={cn(
        'group/clamp relative min-w-0 flex-1',
        wrapperClassName,
      )}
    >
      <p ref={ref} className={cn(className, !expanded && clampClassName)}>
        {paragraphs.map((paragraph, paragraphIndex) => {
          const content = renderText ? paragraph.split('\n').map((line, lineIndex) => (
            <Fragment key={lineIndex}>
              {lineIndex > 0 && '\n'}
              {line.trim() ? renderText(line) : line}
            </Fragment>
          )) : paragraph
          return paragraphs.length === 1 ? content : (
            <span key={paragraphIndex} className="block [&+span]:mt-[0.4em]" data-note-paragraph>
              {content}
            </span>
          )
        })}
      </p>
      {showToggle && (
        <button
          type="button"
          onClick={onToggle}
          className="absolute bottom-1 right-1.5 inline-flex items-center gap-0.5 rounded border border-stone-200/80 bg-[var(--bd-read-bg)]/95 px-1.5 py-0.5 text-[10px] text-[var(--bd-read-sub)] shadow-xs opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-current max-md:opacity-100 dark:border-stone-700/80"
        >
          <span>{expanded ? collapseLabel : expandLabel}</span>
          <svg
            className={cn('h-2.5 w-2.5 transition-transform duration-150', expanded && 'rotate-180')}
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
  )
}

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
  const path = style === 'squiggly'
    ? 'M0 1.7 Q4 0.2 8 1.7 T16 1.7 L16 2.9 Q12 4.4 8 2.9 T0 2.9 Z'
    : 'M0 2 Q2 1.25 5 1.25 L95 1.25 Q98 1.25 100 2 Q98 2.75 95 2.75 L5 2.75 Q2 2.75 0 2 Z'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${style === 'squiggly' ? 16 : 100} 4" preserveAspectRatio="none"><path fill="${hex}" fill-opacity="0.85" d="${path}"/></svg>`
  return {
    backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
    backgroundRepeat: style === 'squiggly' ? 'repeat-x' : 'no-repeat',
    backgroundSize: style === 'squiggly' ? '16px 4px' : '100% 4px',
    backgroundPosition: 'left bottom',
    paddingBottom: '4px',
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
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
  allowEmpty = false,
  onSave,
  onCancel,
}: {
  initial: string
  placeholder: string
  allowEmpty?: boolean
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
    else if (allowEmpty && initial.trim()) onSave('')
    else onCancel()
  }

  const isChanged = draft.trim() !== initial.trim()
  const canSave = allowEmpty ? isChanged : Boolean(draft.trim())

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
          disabled={!canSave}
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
  /** TOC entries in book order, used to sort chapter groups and exports */
  chapterOrder: ChapterOrderItem[]
  /** Chapter grouping must wait for the book order to avoid showing API arrival order. */
  chapterOrderReady?: boolean
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
  chapterOrderReady = true,
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

  const isChapterSort = sort === 'chapter' || sort === 'chapter-desc'

  /** Grouped view: either by book chapter order or consecutive chapters in time order */
  const groups = useMemo(() => {
    if (isChapterSort) {
      const byChapter = new Map<string, { chapter: string; chapterHref: string | null; list: AnnotationRes[] }>()
      for (const a of items) {
        const chapter = a.chapter || _('reader.uncategorized')
        const chapterHref = a.chapterHref ?? null
        const key = chapterHref ? `href:${chapterHref}` : `label:${chapter}`
        const group = byChapter.get(key)
        if (group) group.list.push(a)
        else byChapter.set(key, { chapter, chapterHref, list: [a] })
      }
      const lookupChapter = buildChapterOrderLookup(chapterOrder)
      const orderIndex = (group: { chapter: string; chapterHref: string | null }) => {
        const i = lookupChapter(group.chapter, group.chapterHref)
        return i < 0 ? chapterOrder.length : i
      }
      const reverse = sort === 'chapter-desc'
      const compareItems = (a: AnnotationRes, b: AnnotationRes) =>
        compareCfiPosition(a.cfiRange, b.cfiRange)
        || compareCfiPosition(a.cfiRange, b.cfiRange, true)
        || a.createdAt - b.createdAt
        || a.id.localeCompare(b.id)
      return Array.from(byChapter.entries())
        .map(([key, group]) => ({
          key,
          ...group,
          list: group.list.sort((a, b) => (reverse ? -1 : 1) * compareItems(a, b)),
        }))
        .sort((g1, g2) => {
          const a = orderIndex(g1)
          const b = orderIndex(g2)
          const aUnknown = a === chapterOrder.length
          const bUnknown = b === chapterOrder.length
          if (aUnknown !== bUnknown) return aUnknown ? 1 : -1
          return (reverse ? -1 : 1) * (a - b)
        })
    }

    // Time sort: sort by time, then group consecutive items belonging to the same chapter
    const sorted = [...items].sort((a, b) => (sort === 'time-asc' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt))
    const timeGroups: { key: string; chapter: string; chapterHref: string | null; list: AnnotationRes[] }[] = []
    let counter = 0
    for (const a of sorted) {
      const chapter = a.chapter || _('reader.uncategorized')
      const chapterHref = a.chapterHref ?? null
      const last = timeGroups[timeGroups.length - 1]
      if (last && last.chapter === chapter && last.chapterHref === chapterHref) {
        last.list.push(a)
      } else {
        timeGroups.push({
          key: `time-group-${counter++}-${chapterHref ?? chapter}`,
          chapter,
          chapterHref,
          list: [a],
        })
      }
    }
    return timeGroups
  }, [items, sort, isChapterSort, chapterOrder, _])



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
      const parts: string[] = []
      if (kindOf(item) === 'idea') {
        if (item.note) parts.push(item.note)
        if (item.text) parts.push(item.text)
      } else if (item.type === 'bookmark') {
        const hasCustom = isCustomBookmarkTitle(item, _('reader.bookmark'))
        if (hasCustom && item.text) parts.push(item.text)
        if (item.contextText) parts.push(item.contextText)
        else if (!hasCustom && item.text) parts.push(item.text)
      } else {
        if (item.text) parts.push(item.text)
      }
      await navigator.clipboard.writeText(parts.filter(Boolean).join('\n\n'))
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
    const isBookmark = kind === 'bookmark'
    const hasCustomTitle = isBookmark && isCustomBookmarkTitle(a, _('reader.bookmark'))
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
            initial={a.type === 'bookmark' ? (hasCustomTitle ? a.text : '') : (a.note ?? '')}
            placeholder={a.type === 'bookmark' ? _('annotation.renamePlaceholder') : _('annotation.notePlaceholder')}
            allowEmpty={a.type === 'bookmark'}
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
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-500/5 text-blue-500 dark:bg-blue-400/5 dark:text-blue-400">
                    <BookmarkIcon />
                  </span>
                  <div className="min-w-0 flex-1 space-y-2">
                    {hasCustomTitle ? (
                      <>
                        <ClampedText
                          text={a.text}
                          clampClassName="line-clamp-2"
                          className="text-sm font-medium leading-relaxed text-current whitespace-pre-wrap break-words"
                          expanded={isQuoteExpanded}
                          onToggle={(e) => toggleQuoteExpand(a.id, e)}
                          expandLabel={_('annotation.expand')}
                          collapseLabel={_('annotation.collapse')}
                          minLengthForToggle={40}
                        />
                        {a.contextText && (
                          <ClampedText
                            text={a.contextText}
                            clampClassName="line-clamp-3"
                            className="text-xs leading-relaxed text-[var(--bd-read-text)]/80 whitespace-pre-wrap break-words"
                            wrapperClassName="rounded-md border-l-2 border-blue-300/40 bg-stone-500/3 px-2 py-1 dark:border-blue-400/25"
                            expanded={isNoteExpanded}
                            onToggle={(e) => toggleNoteExpand(a.id, e)}
                            expandLabel={_('annotation.expand')}
                            collapseLabel={_('annotation.collapse')}
                            minLengthForToggle={50}
                          />
                        )}
                      </>
                    ) : (
                      <ClampedText
                        text={a.contextText || a.text || _('reader.bookmark')}
                        clampClassName="line-clamp-4"
                        className="text-xs leading-relaxed text-[var(--bd-read-text)]/80 whitespace-pre-wrap break-words"
                        wrapperClassName="rounded-md border-l-2 border-blue-300/40 bg-stone-500/3 px-2 py-1 dark:border-blue-400/25"
                        expanded={isQuoteExpanded}
                        onToggle={(e) => toggleQuoteExpand(a.id, e)}
                        expandLabel={_('annotation.expand')}
                        collapseLabel={_('annotation.collapse')}
                        minLengthForToggle={65}
                      />
                    )}
                  </div>
                </div>
              )}
              {kind === 'idea' && (
                <div className="space-y-2">
                  <div className="group/note flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-amber-500/5 text-amber-500 dark:bg-amber-400/5 dark:text-amber-400">
                      <BulbIcon />
                    </span>
                    <ClampedText
                      text={a.note ?? ''}
                      clampClassName="line-clamp-3"
                      className="text-sm font-medium leading-relaxed text-current whitespace-pre-wrap break-words"
                      expanded={isNoteExpanded}
                      onToggle={(e) => toggleNoteExpand(a.id, e)}
                      expandLabel={_('annotation.expand')}
                      collapseLabel={_('annotation.collapse')}
                      minLengthForToggle={60}
                    />
                  </div>
                  {a.text && (
                    <ClampedText
                      text={a.text}
                      clampClassName="line-clamp-2"
                      className="text-xs leading-relaxed text-[var(--bd-read-text)]/80 whitespace-pre-wrap break-words"
                      wrapperClassName="ml-7 rounded-md border-l-2 border-amber-300/40 bg-stone-500/3 px-2 py-1 dark:border-amber-400/25"
                      expanded={isQuoteExpanded}
                      onToggle={(e) => toggleQuoteExpand(a.id, e)}
                      expandLabel={_('annotation.expand')}
                      collapseLabel={_('annotation.collapse')}
                      minLengthForToggle={40}
                    />
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
                  <ClampedText
                    text={a.text}
                    clampClassName="line-clamp-4"
                    className={cn('text-sm leading-relaxed text-current whitespace-pre-wrap break-words', a.style !== 'highlight' && 'pb-1')}
                    renderText={(value) => <span style={highlightDecoration(a.style, hex)}>{value}</span>}
                    expanded={isNoteExpanded}
                    onToggle={(e) => toggleNoteExpand(a.id, e)}
                    expandLabel={_('annotation.expand')}
                    collapseLabel={_('annotation.collapse')}
                    minLengthForToggle={65}
                  />
                </div>
              )}
            </button>
            {!selectionMode && (
              <div className="mt-2 flex h-6 items-center px-0.5 text-xs text-[var(--bd-read-sub)]">
                <span
                  title={formatFullDateTime(_, a.createdAt)}
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
      ) : isChapterSort && !chapterOrderReady ? (
        <div className="flex flex-1 items-center justify-center py-12 text-xs text-[var(--bd-read-sub)]">
          {_('reader.loading')}
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.key} className="space-y-2">
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
