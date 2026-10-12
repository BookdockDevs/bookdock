import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'

import type { AnnotationRes, AnnotationUpdateReq } from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import ContentImages from '@/features/content-files/components/ContentImages'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'
import { getUserErrorMessage, getUserErrorNotification } from '@/lib/error-message'

import { useReaderApi } from '../hooks/useReaderApi'
import { useAuthStore } from '@/stores/auth.store'
import { useDeleteAnnotation, useUpdateAnnotation } from '../hooks/useAnnotations'
import { kindOf, type NoteSort } from '../hooks/useNotesFilter'
import { buildAnnotationCopyText, isCustomBookmarkTitle } from '../lib/annotation-text'
import { compareAnnotations, groupAnnotationsByChapter } from '../lib/annotation-order'
import { buildChapterOrderLookup, type ChapterOrderItem } from '../lib/chapter-order'
import { useReaderState } from '../state/reader-state'
import AnnotationExportDialog from './AnnotationExportDialog'
import AnnotationInlineEditor from './AnnotationInlineEditor'
import { useIdeaComposer } from '../hooks/useIdeas'
import { annotationHex } from './annotation-colors'
import { ClampedText, HighlightQuote } from './annotation-render'
import { BookmarkIcon, BulbIcon, CheckIcon, CloseIcon, CopyIcon, DocumentExportIcon, PencilIcon, SelectionIcon, ShareIcon, TrashIcon } from './annotation-icons'
import { formatFullDateTime, formatRelativeTime } from './format-relative-time'

const actionBtn =
  'flex h-7 w-7 items-center justify-center rounded-lg text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current'

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
  const setSelection = useReaderState((s) => s.setSelection)
  // Annotations whose CFI no longer resolves (P2): badge them and refuse to
  // navigate instead of silently landing nowhere
  const orphanedKeys = useReaderState((s) => s.orphanedAnnotationKeys)
  const user = useAuthStore((s) => s.user)
  const composer = useIdeaComposer(bookId, !!user)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: AnnotationRes } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const saveLock = useRef(false)
  const [internalSelectedIds, setInternalSelectedIds] = useState<Set<string>>(new Set())
  const selectedIds = externalSelectedIds ?? internalSelectedIds
  const [exportOpen, setExportOpen] = useState(false)
  const [noteDeleteTarget, setNoteDeleteTarget] = useState<AnnotationRes | null>(null)
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
      const grouped = groupAnnotationsByChapter(items, _('reader.uncategorized'))
      const lookupChapter = buildChapterOrderLookup(chapterOrder)
      const orderIndex = (group: { chapter: string; chapterHref: string | null }) => {
        const i = lookupChapter(group.chapter, group.chapterHref)
        return i < 0 ? chapterOrder.length : i
      }
      const reverse = sort === 'chapter-desc'
      return grouped
        .map((group) => ({
          ...group,
          list: [...group.list].sort((a, b) => (reverse ? -1 : 1) * compareAnnotations(a, b)),
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
    if (item.locationAvailable === false || orphanedKeys.includes(`${item.cfiRange}|${item.type}`)) {
      notify.info({ key: 'annotation.orphanedNotice' })
      return
    }
    renderer?.display(item.cfiRange)
    if (!locked) onClose?.()
  }

  function openIdeaDetail(item: AnnotationRes) {
    const current = useReaderState.getState().selection
    if (current?.cfiRange === item.cfiRange) {
      setSelection(null)
      return
    }
    const hasComments = Boolean(
      item.visibility !== 'private' &&
      item.commentCount &&
      item.commentCount > 0,
    )
    setSelection({
      cfiRange: item.cfiRange,
      text: item.text,
      initialDetailId: hasComments ? item.id : undefined,
      isIdea: true,
    })
  }

  function handleContextMenu(e: MouseEvent, item: AnnotationRes) {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, item })
  }

  async function copyItem(item: AnnotationRes) {
    try {
      await navigator.clipboard.writeText(buildAnnotationCopyText(item, _('reader.bookmark')))
      notify.success({ key: 'reader.copied' })
    } catch {
      notify.error({ key: 'reader.copyFailed' })
    }
  }

  function saveEdit(item: AnnotationRes, value: string, visibility?: 'private' | 'shared', files?: Pick<AnnotationUpdateReq, 'imageIds' | 'draftId'>) {
    if (saveLock.current || updateAnnotation.isPending) return
    saveLock.current = true
    setEditError(null)
    updateAnnotation.mutate({
      id: item.id,
      body: item.type === 'bookmark' ? { text: value } : { note: value, visibility, ...files },
    }, {
      onSuccess: () => { saveLock.current = false; setEditingId(null) },
      onError: (error) => { saveLock.current = false; setEditError(getUserErrorMessage(error, _, 'annotation.editSaveFailed')) },
    })
  }

  function startEdit(id: string) {
    if (saveLock.current || updateAnnotation.isPending) return
    setEditError(null)
    setEditingId(id)
  }

  function deleteItem(item: AnnotationRes, confirmed = false) {
    if (item.type === 'note' && !confirmed) { setNoteDeleteTarget(item); return }
    deleteAnnotation.mutate(item.id, {
      onSuccess: () => {
        setNoteDeleteTarget(null)
        notify.success({ key: item.type === 'bookmark' ? 'reader.bookmarkRemoved' : 'annotation.deleted' })
      },
      onError: (error) => notify.error(getUserErrorNotification(error, 'annotation.deleteFailed')),
    })
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
    const hex = annotationHex(a.color)
    const kind = kindOf(a)
    const orphaned = a.locationAvailable === false || orphanedKeys.includes(`${a.cfiRange}|${a.type}`)
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
          <AnnotationInlineEditor
            saving={updateAnnotation.isPending}
            error={editError}
            initial={a.type === 'bookmark' ? (hasCustomTitle ? a.text : '') : (a.note ?? '')}
            placeholder={a.type === 'bookmark' ? _('annotation.renamePlaceholder') : _('annotation.notePlaceholder')}
            allowEmpty={a.type === 'bookmark'}
            onSave={(value, visibility, files) => saveEdit(a, value, visibility, files)}
            bookVersionId={a.type === 'note' ? bookId : undefined}
            targetId={a.type === 'note' ? a.id : undefined}
            initialImages={a.images}
            initialVisibility={a.visibility ?? 'private'}
            visibilityEligible={a.type === 'note' && composer.data?.data.eligible}
            sourceReadable={composer.data?.data.sourceReadable}
            onCancel={() => { setEditingId(null); setEditError(null) }}
          />
        ) : (
          <>
            <div
              className={cn('relative w-full text-left rounded-lg', selectionMode && 'pr-8')}
            >
              {selectionMode && (
                <>
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
                  <button
                    type="button"
                    onClick={() => toggleSelected(a.id)}
                    aria-label={_('annotation.toggleSelected')}
                    className="absolute inset-0 z-0 cursor-pointer rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)]"
                  />
                </>
              )}
              {kind === 'bookmark' && (
                <div className="relative">
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
                          toggleClassName="z-10"
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
                            toggleClassName="z-10"
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
                        toggleClassName="z-10"
                      />
                    )}
                  </div>
                  {!selectionMode && (
                    <button
                      type="button"
                      onClick={() => goTo(a)}
                      aria-label={_('annotation.jumpToSource')}
                      className="absolute inset-0 z-0 cursor-pointer rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)]"
                    />
                  )}
                  </div>
                </div>
              )}
              {kind === 'idea' && (
                <div className="space-y-2">
                  <div className="relative">
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
                        toggleClassName="z-10"
                      />
                    </div>
                    <div className="ml-[1.875rem] min-w-0">
                      <ContentImages images={a.images} />
                    </div>
                    {!selectionMode && (
                      <button
                        type="button"
                        onClick={() => openIdeaDetail(a)}
                        aria-label={_('annotation.openIdeaDetail')}
                        className="absolute inset-0 z-0 cursor-pointer rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)]"
                      />
                    )}
                  </div>
                  {a.text && (
                    <div
                      title={selectionMode ? undefined : _('annotation.jumpToSource')}
                      className="relative ml-7 rounded-md border-l-2 border-amber-300/40 bg-stone-500/3 px-2 py-1 transition-colors hover:bg-stone-500/8 hover:border-amber-400 dark:border-amber-400/25 dark:hover:bg-stone-500/12"
                    >
                      <ClampedText
                        text={a.text}
                        clampClassName="line-clamp-2"
                        className="text-xs leading-relaxed text-[var(--bd-read-text)]/80 whitespace-pre-wrap break-words"
                        expanded={isQuoteExpanded}
                        onToggle={(e) => toggleQuoteExpand(a.id, e)}
                        expandLabel={_('annotation.expand')}
                        collapseLabel={_('annotation.collapse')}
                        minLengthForToggle={40}
                        toggleClassName="z-10"
                      />
                      {!selectionMode && (
                        <button
                          type="button"
                          onClick={() => goTo(a)}
                          title={_('annotation.jumpToSource')}
                          aria-label={_('annotation.jumpToSource')}
                          className="absolute inset-0 z-0 cursor-pointer rounded-md outline-none focus-visible:ring-1 focus-visible:ring-amber-400"
                        />
                      )}
                    </div>
                  )}

                </div>
              )}
              {kind === 'highlight' && (
                <div className="relative">
                  <div className="flex items-start gap-2.5">
                    <span
                      className="mt-1 flex h-3.5 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: hex }}
                      aria-hidden="true"
                    />
                    <HighlightQuote
                      item={a}
                      expanded={isNoteExpanded}
                      onToggle={(e) => toggleNoteExpand(a.id, e)}
                      expandLabel={_('annotation.expand')}
                      collapseLabel={_('annotation.collapse')}
                      toggleClassName="z-10"
                    />
                  </div>
                  {!selectionMode && (
                    <button
                      type="button"
                      onClick={() => goTo(a)}
                      aria-label={_('annotation.jumpToSource')}
                      className="absolute inset-0 z-0 cursor-pointer rounded-lg outline-none focus-visible:ring-1 focus-visible:ring-[var(--bd-read-primary)]"
                    />
                  )}
                </div>
              )}
            </div>
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
                    <button onClick={() => startEdit(a.id)} title={_('annotation.rename')} className={actionBtn}>
                      <PencilIcon />
                    </button>
                  ) : kind === 'idea' ? (
                    <button onClick={() => startEdit(a.id)} title={_('annotation.editNote')} className={actionBtn}>
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
                startEdit(contextMenu.item.id)
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
                startEdit(contextMenu.item.id)
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
      {noteDeleteTarget && <ConfirmDialog title="删除想法" message="删除后，评论、回复和点赞也会删除。" confirmLabel="删除" confirmDisabled={deleteAnnotation.isPending} onClose={() => { if (!deleteAnnotation.isPending) setNoteDeleteTarget(null) }} onConfirm={() => deleteItem(noteDeleteTarget, true)} />}
    </div>
  )
})
