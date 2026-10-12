import { useMemo, useRef, useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import type { AnnotationRes, AnnotationUpdateReq, ArchiveRecordType, Review } from '@bookdock/shared'

import { useBookChapters } from '@/api/hooks/useBookChapters'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import SmartMenu, { menuItemClass } from '@/components/ui/SmartMenu'
import ContentImages from '@/features/content-files/components/ContentImages'
import { BookmarkIcon, CheckIcon, CloseIcon, CopyIcon, DocumentExportIcon, PencilIcon, SelectionIcon, TrashIcon } from '@/features/reader/components/annotation-icons'
import AnnotationExportDialog from '@/features/reader/components/AnnotationExportDialog'
import AnnotationInlineEditor from '@/features/reader/components/AnnotationInlineEditor'
import { ClampedText, HighlightQuote } from '@/features/reader/components/annotation-render'
import { formatFullDateTime, formatRelativeTime } from '@/features/reader/components/format-relative-time'
import IdeaDiscussionPanel from '@/features/reader/components/IdeaDiscussionPanel'
import IdeaDetailCard from '@/features/reader/components/IdeaDetailCard'
import type { IdeaEntry } from '@/features/reader/components/IdeaOverlay'
import ShareCardDialog from '@/features/reader/components/share/ShareCardDialog'
import BookCover from '@/features/library/components/BookCover'
import { useBook } from '@/features/library/hooks'
import { useDeleteAnnotation, useUpdateAnnotation } from '@/features/reader/hooks/useAnnotations'
import { useIdeaAction, useIdeaComposer, useIdeaDiscussion } from '@/features/reader/hooks/useIdeas'
import { buildAnnotationCopyText, isCustomBookmarkTitle } from '@/features/reader/lib/annotation-text'
import { compareAnnotations, groupAnnotationsByChapter } from '@/features/reader/lib/annotation-order'
import { buildChapterOrderLookup, type ChapterOrderItem } from '@/features/reader/lib/chapter-order'
import { useReaderState } from '@/features/reader/state/reader-state'
import { reviewExcerpt } from '@/features/reviews/lib/markdown'
import ReviewCard from '@/features/reviews/components/ReviewCard'
import StarRating from '@/features/reviews/components/StarRating'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage, getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { computeFromAnchor, PADDING, type SmartPosition } from '@/lib/position'
import { cn } from '@/lib/utils'
import type { ArchiveSearch } from '@/routes/archive'
import { useAuthStore } from '@/stores/auth.store'

import { useArchiveBookDetail } from './hooks'
import { formatCounts, hasReadableText, readStatusLabel } from './components/archive-helpers'

type BookTab = ArchiveRecordType | 'all'
type BookSort = 'chapter' | 'recent'

const TABS: BookTab[] = ['all', 'highlight', 'bookmark', 'idea', 'review']

const itemActionBtn =
  'flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-200'

export default function BookNotesView({ bookVersionId, bookType, bookSort, onChange, onBack }: {
  bookVersionId: string
  bookType: BookTab
  bookSort: BookSort
  onChange: (next: Partial<Pick<ArchiveSearch, 'bookType' | 'bookSort'>>) => void
  onBack: () => void
}) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const setShareTarget = useReaderState((s) => s.setShareTarget)
  const [exportOpen, setExportOpen] = useState(false)
  const [openReviewId, setOpenReviewId] = useState<string | null>(null)
  const [openIdeaId, setOpenIdeaId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const saveLock = useRef(false)
  const [noteDeleteTarget, setNoteDeleteTarget] = useState<AnnotationRes | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectExportOpen, setSelectExportOpen] = useState(false)
  const [exportMenu, setExportMenu] = useState<SmartPosition | null>(null)
  const exportMenuAnchorRef = useRef<HTMLDivElement>(null)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  const book = useBook(bookVersionId)
  const chapters = useBookChapters(bookVersionId)
  const detail = useArchiveBookDetail(bookVersionId)
  const updateAnnotation = useUpdateAnnotation(bookVersionId)
  const deleteAnnotation = useDeleteAnnotation(bookVersionId)
  const composer = useIdeaComposer(bookVersionId, !!user)

  const chapterOrder: ChapterOrderItem[] = useMemo(
    () => (chapters.data?.data ?? []).map((c) => ({ label: c.title, href: c.id })),
    [chapters.data],
  )
  const lookup = useMemo(() => buildChapterOrderLookup(chapterOrder), [chapterOrder])

  const tab = bookType
  const sort = bookSort

  const filteredAnnotations = useMemo(() => {
    const items = detail.data?.data.annotations ?? []
    if (tab === 'all' || tab === 'review') return tab === 'review' ? [] : items
    return items.filter((a) => (tab === 'idea' ? a.type === 'note' : a.type === tab))
  }, [detail.data, tab])

  const annotations = useMemo(() => {
    const orderIndex = (g: { chapter: string; chapterHref: string | null }) => {
      const i = lookup(g.chapter, g.chapterHref)
      return i < 0 ? chapterOrder.length : i
    }
    return groupAnnotationsByChapter(filteredAnnotations, _('reader.uncategorized'))
      .map((g) => ({ ...g, list: [...g.list].sort(compareAnnotations) }))
      .sort((g1, g2) => orderIndex(g1) - orderIndex(g2))
  }, [filteredAnnotations, lookup, chapterOrder.length, _])

  const reviews = useMemo(() => {
    const list = detail.data?.data.reviews ?? []
    return tab === 'all' || tab === 'review' ? list : []
  }, [detail.data, tab])
  const recentRecords = useMemo(() => [
    ...filteredAnnotations.map((item) => ({ kind: 'annotation' as const, item })),
    ...reviews.map((item) => ({ kind: 'review' as const, item })),
  ].sort((a, b) => b.item.updatedAt - a.item.updatedAt || a.item.id.localeCompare(b.item.id)), [filteredAnnotations, reviews])
  const openReview = reviews.find((r) => r.id === openReviewId) ?? null
  const allAnnotations = detail.data?.data.annotations ?? []
  const visibleIds = useMemo(() => annotations.flatMap((g) => g.list.map((a) => a.id)), [annotations])
  const headerCounts = {
    highlights: allAnnotations.filter((a) => a.type === 'highlight').length,
    bookmarks: allAnnotations.filter((a) => a.type === 'bookmark').length,
    ideas: allAnnotations.filter((a) => a.type === 'note').length,
    reviews: detail.data?.data.reviews.length ?? 0,
  }
  const tabCounts: Record<BookTab, number> = {
    all: allAnnotations.length + (detail.data?.data.reviews.length ?? 0),
    highlight: allAnnotations.filter((a) => a.type === 'highlight').length,
    bookmark: allAnnotations.filter((a) => a.type === 'bookmark').length,
    idea: allAnnotations.filter((a) => a.type === 'note').length,
    review: detail.data?.data.reviews.length ?? 0,
  }

  function jumpHref(a: AnnotationRes): string | null {
    if (a.locationAvailable === false) return null
    return `/books/${encodeURIComponent(bookVersionId)}?annotation=${encodeURIComponent(a.id)}`
  }

  function refreshArchive() {
    void queryClient.invalidateQueries({ queryKey: ['archive'] })
  }

  async function copyItem(item: AnnotationRes) {
    try {
      await navigator.clipboard.writeText(buildAnnotationCopyText(item, _('reader.bookmark')))
      notify.success({ key: 'reader.copied' })
    } catch {
      notify.error({ key: 'reader.copyFailed' })
    }
  }

  function shareItem(item: AnnotationRes) {
    setShareTarget({
      text: item.text,
      chapter: item.chapter,
      note: item.note ?? undefined,
      createdAt: item.createdAt,
    })
  }

  function saveEdit(item: AnnotationRes, value: string, visibility?: 'private' | 'shared', files?: Pick<AnnotationUpdateReq, 'imageIds' | 'draftId'>) {
    if (saveLock.current || updateAnnotation.isPending) return
    saveLock.current = true
    setEditError(null)
    updateAnnotation.mutate({
      id: item.id,
      body: item.type === 'bookmark' ? { text: value } : { note: value, visibility, ...files },
    }, {
      onSuccess: () => {
        saveLock.current = false
        setEditingId(null)
        refreshArchive()
      },
      onError: (error) => {
        saveLock.current = false
        setEditError(getUserErrorMessage(error, _, 'annotation.editSaveFailed'))
      },
    })
  }

  function startEdit(id: string) {
    if (saveLock.current || updateAnnotation.isPending) return
    setEditError(null)
    setEditingId(id)
  }

  function deleteItem(item: AnnotationRes, confirmed = false) {
    if (item.type === 'note' && !confirmed) {
      setNoteDeleteTarget(item)
      return
    }
    deleteAnnotation.mutate(item.id, {
      onSuccess: () => {
        setNoteDeleteTarget(null)
        refreshArchive()
        notify.success({ key: item.type === 'bookmark' ? 'reader.bookmarkRemoved' : 'annotation.deleted' })
      },
      onError: (error) => notify.error(getUserErrorNotification(error, 'annotation.deleteFailed')),
    })
  }

  function toggleSelected(id: string) {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllVisible() {
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
    setSelectedIds((previous) => {
      const next = new Set(previous)
      for (const id of visibleIds) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  function exitSelection() {
    setSelectionMode(false)
    setSelectedIds(new Set())
    setSelectExportOpen(false)
  }

  function toggleExportMenu() {
    const anchor = exportMenuAnchorRef.current
    if (!anchor) return
    if (exportMenu) {
      setExportMenu(null)
      return
    }
    const rect = anchor.getBoundingClientRect()
    const width = 176
    const position = computeFromAnchor(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      width,
      88,
    )
    setExportMenu({
      ...position,
      left: Math.max(PADDING, Math.min(rect.right - width, window.innerWidth - width - PADDING)),
    })
  }

  function renderEditor(a: AnnotationRes) {
    const isBookmark = a.type === 'bookmark'
    return (
      <AnnotationInlineEditor
        saving={updateAnnotation.isPending}
        error={editError}
        initial={isBookmark ? (isCustomBookmarkTitle(a, _('reader.bookmark')) ? a.text : '') : (a.note ?? '')}
        placeholder={isBookmark ? _('annotation.renamePlaceholder') : _('annotation.notePlaceholder')}
        allowEmpty={isBookmark}
        onSave={(value, visibility, files) => saveEdit(a, value, visibility, files)}
        bookVersionId={a.type === 'note' ? bookVersionId : undefined}
        targetId={a.type === 'note' ? a.id : undefined}
        initialImages={a.images}
        initialVisibility={a.visibility ?? 'private'}
        visibilityEligible={a.type === 'note' && composer.data?.data.eligible}
        sourceReadable={composer.data?.data.sourceReadable}
        onCancel={() => { setEditingId(null); setEditError(null) }}
        theme="app"
      />
    )
  }

  function renderActions(a: AnnotationRes) {
    if (selectionMode) return null
    return (
      <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/archive-item:opacity-100 focus-within:opacity-100 max-md:opacity-100">
        {a.type !== 'highlight' && (
          <button type="button" onClick={() => startEdit(a.id)} title={a.type === 'bookmark' ? _('annotation.rename') : _('annotation.editNote')} aria-label={a.type === 'bookmark' ? _('annotation.rename') : _('annotation.editNote')} className={itemActionBtn}>
            <PencilIcon />
          </button>
        )}
        <button type="button" onClick={() => void copyItem(a)} title={_('annotation.copy')} aria-label={_('annotation.copy')} className={itemActionBtn}>
          <CopyIcon />
        </button>
        <button
          type="button"
          onClick={() => deleteItem(a)}
          title={_('annotation.deleteHighlight')}
          aria-label={_('annotation.deleteHighlight')}
          className={cn(itemActionBtn, 'hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400')}
        >
          <TrashIcon />
        </button>
      </span>
    )
  }

  function renderMeta(a: AnnotationRes) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <span
          title={formatFullDateTime(_, a.createdAt)}
          aria-label={formatFullDateTime(_, a.createdAt)}
          className="shrink-0 text-xs tabular-nums text-stone-400 dark:text-stone-500"
        >
          {formatRelativeTime(_, a.createdAt)}
        </span>
        <span className="flex-1" />
        {renderActions(a)}
        {(() => {
          const href = jumpHref(a)
          return href ? (
            <a
              href={href}
              className="shrink-0 text-[13px] text-stone-500 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200"
            >
              {_('archive.readLocation')} ↗
            </a>
          ) : (
            <span className="shrink-0 text-xs text-amber-700 dark:text-amber-400">{_('profileArchive.positionUnavailable')}</span>
          )
        })()}
      </div>
    )
  }

  function renderReviewItem(review: Review) {
    return (
      <li key={review.id} className="border-b border-stone-200/70 py-4 first:pt-0 last:border-b-0 dark:border-stone-800/70">
        <div className="flex items-center gap-2">
          <StarRating value={review.rating} size={14} />
          {review.rating != null && <span className="text-sm font-semibold tabular-nums">{review.rating.toFixed(1)}</span>}
          {review.visibility === 'private' && <span className="text-[13px] text-stone-400">{_('review.visibilityPrivate')}</span>}
        </div>
        {review.body && (
          <p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-stone-800 dark:text-stone-200">
            {reviewExcerpt(review.body, review.bodyFormat, 300)}
          </p>
        )}
        <button
          type="button"
          onClick={() => setOpenReviewId(review.id)}
          className="mt-2 text-sm text-stone-500 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200"
        >
          {_('archive.viewFullReview')} →
        </button>
      </li>
    )
  }

  function renderAnnotationItem(a: AnnotationRes) {
    const customBookmark = isCustomBookmarkTitle(a, _('reader.bookmark'))
    const bookmarkQuote = hasReadableText(a.contextText) ? a.contextText : hasReadableText(a.text) ? a.text : null
    return (
      <li key={a.id} className="group/archive-item relative border-b border-stone-200/70 pb-4 last:border-b-0 dark:border-stone-800/70">
        {selectionMode && (
          <button
            type="button"
            onClick={() => toggleSelected(a.id)}
            aria-pressed={selectedIds.has(a.id)}
            aria-label={_('annotation.toggleSelected')}
            className={cn(
              'absolute top-0 right-0 z-10 flex h-5 w-5 items-center justify-center rounded-full border transition-colors',
              selectedIds.has(a.id)
                ? 'border-blue-600 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-400 dark:text-stone-950'
                : 'border-stone-300 bg-transparent dark:border-stone-600',
            )}
          >
            {selectedIds.has(a.id) && <CheckIcon size={13} strokeWidth={2.4} />}
          </button>
        )}
        {editingId === a.id ? (
          renderEditor(a)
        ) : (
          <>
            {a.type === 'highlight' && hasReadableText(a.text) && (
              <div className="border-l-[3px] border-amber-400/70 pl-4 dark:border-amber-400/50">
                {(() => {
                  const href = selectionMode ? null : jumpHref(a)
                  const quote = (
                    <HighlightQuote
                      item={a}
                      theme="app"
                      expanded
                      allowToggle={false}
                      onToggle={() => {}}
                      expandLabel={_('annotation.expand')}
                      collapseLabel={_('annotation.collapse')}
                    />
                  )
                  return href
                    ? <a href={href} title={_('archive.readLocation')} className="block transition-opacity hover:opacity-80">{quote}</a>
                    : quote
                })()}
                {renderMeta(a)}
              </div>
            )}
            {a.type === 'bookmark' && (
               <div className="min-w-0">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-blue-500 dark:text-blue-400"><BookmarkIcon /></span>
                  {customBookmark ? (
                    <ClampedText
                      text={a.text}
                      clampClassName="line-clamp-2"
                      className="text-sm font-medium leading-relaxed text-stone-800 whitespace-pre-wrap break-words dark:text-stone-200"
                      expanded
                      allowToggle={false}
                      onToggle={() => {}}
                      expandLabel={_('annotation.expand')}
                      collapseLabel={_('annotation.collapse')}
                      minLengthForToggle={40}
                      theme="app"
                    />
                  ) : bookmarkQuote ? (
                    <ClampedText
                      text={bookmarkQuote}
                      clampClassName="line-clamp-4"
                      className="text-xs leading-relaxed text-stone-600 whitespace-pre-wrap break-words dark:text-stone-300"
                      wrapperClassName="rounded-md border-l-2 border-blue-300/40 px-2 py-1 dark:border-blue-400/25"
                      expanded
                      allowToggle={false}
                      onToggle={() => {}}
                      expandLabel={_('annotation.expand')}
                      collapseLabel={_('annotation.collapse')}
                      minLengthForToggle={65}
                      theme="app"
                    />
                  ) : null}
                </div>
                {customBookmark && hasReadableText(a.contextText) && (
                  <ClampedText
                    text={a.contextText}
                    clampClassName="line-clamp-3"
                    className="text-xs leading-relaxed text-stone-600 whitespace-pre-wrap break-words dark:text-stone-300"
                    wrapperClassName="ml-7 mt-2 rounded-md border-l-2 border-blue-300/40 px-2 py-1 dark:border-blue-400/25"
                    expanded
                    allowToggle={false}
                    onToggle={() => {}}
                    expandLabel={_('annotation.expand')}
                    collapseLabel={_('annotation.collapse')}
                    minLengthForToggle={50}
                    theme="app"
                  />
                )}
                <div className="ml-7">{renderMeta(a)}</div>
              </div>
            )}
            {a.type === 'note' && (
              <div className="min-w-0">
                {a.note && (
                  <button
                    type="button"
                    onClick={() => { if (!selectionMode) setOpenIdeaId(a.id) }}
                    title={_('archive.viewIdeaDetail')}
                    aria-label={_('archive.viewIdeaDetail')}
                    className="block w-full cursor-pointer text-left"
                  >
                    <ClampedText
                      text={a.note}
                      clampClassName="line-clamp-3"
                      className="text-sm font-medium leading-relaxed text-stone-800 whitespace-pre-wrap break-words dark:text-stone-200"
                      expanded
                      allowToggle={false}
                      onToggle={() => {}}
                      expandLabel={_('annotation.expand')}
                      collapseLabel={_('annotation.collapse')}
                      minLengthForToggle={60}
                      theme="app"
                    />
                  </button>
                )}
                {hasReadableText(a.text) && (
                  <div className={cn('border-l-[3px] border-amber-400/70 pl-4 dark:border-amber-400/50', a.note && 'mt-2')}>
                    {(() => {
                      const href = selectionMode ? null : jumpHref(a)
                      const quote = (
                        <ClampedText
                          text={a.text}
                          clampClassName="line-clamp-2"
                          className="text-xs leading-relaxed text-stone-500 whitespace-pre-wrap break-words dark:text-stone-400"
                          expanded
                          allowToggle={false}
                          onToggle={() => {}}
                          expandLabel={_('annotation.expand')}
                          collapseLabel={_('annotation.collapse')}
                          minLengthForToggle={40}
                          theme="app"
                        />
                      )
                      return href
                        ? <a href={href} title={_('archive.readLocation')} className="block transition-opacity hover:opacity-80">{quote}</a>
                        : quote
                    })()}
                  </div>
                )}
                <ContentImages images={a.images} />
                {renderMeta(a)}
              </div>
            )}
          </>
        )}
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 border-b border-stone-200/70 pb-3 dark:border-stone-800/70">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          aria-label={_('archive.back')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </button>
        <h1 className="min-w-0 truncate text-xl font-bold tracking-tight text-stone-900 dark:text-stone-50">
          {_('archive.bookNotes')}
        </h1>
      </div>
        {book.isPending ? (
          <div role="status" className="flex gap-4">
            <div className="h-24 w-[4.5rem] animate-pulse rounded-xl bg-stone-500/10" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-6 w-48 animate-pulse rounded bg-stone-500/10" />
              <div className="h-4 w-32 animate-pulse rounded bg-stone-500/10" />
            </div>
          </div>
        ) : book.isError ? (
          <QueryErrorState isRetrying={book.isFetching} onRetry={() => void book.refetch()} />
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
            <BookCover book={book.data.data} size="card" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-bold tracking-tight text-stone-900 dark:text-stone-50">{book.data.data.title}</h2>
              <p className="truncate text-sm text-stone-500 dark:text-stone-400">
                {[book.data.data.author, readStatusLabel(book.data.data.readStatus, _)].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-1 text-sm tabular-nums text-stone-500 dark:text-stone-400">{formatCounts(headerCounts, _)}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                <a
                  href={`/books/${encodeURIComponent(bookVersionId)}`}
                  className="inline-flex h-8 items-center rounded-lg bg-stone-100 px-3 font-medium text-stone-700 transition-colors hover:bg-stone-200 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700 dark:hover:text-white dark:focus-visible:ring-stone-500/60"
                >
                  {_('archive.backToReading')} ↗
                </a>
                <div ref={exportMenuAnchorRef} className="relative">
                  <button
                    type="button"
                    onClick={toggleExportMenu}
                    disabled={allAnnotations.length === 0}
                    aria-haspopup="menu"
                    aria-expanded={Boolean(exportMenu)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-stone-200 px-3 font-medium text-stone-500 transition-colors hover:border-stone-300 hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-100 dark:focus-visible:ring-stone-500/60"
                  >
                    <DocumentExportIcon size={15} />
                    {_('archive.export')}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  {exportMenu && (
                    <SmartMenu
                      innerRef={exportMenuRef}
                      triggerRef={exportMenuAnchorRef}
                      position={exportMenu}
                      onClose={() => setExportMenu(null)}
                    >
                      <button
                        type="button"
                        className={menuItemClass}
                        onClick={() => {
                          setExportMenu(null)
                          setExportOpen(true)
                        }}
                      >
                        {_('archive.exportAll')}
                      </button>
                      <button
                        type="button"
                        className={menuItemClass}
                        onClick={() => {
                          setExportMenu(null)
                          setSelectedIds(new Set())
                          setSelectionMode(true)
                        }}
                      >
                        {_('archive.selectExport')}
                      </button>
                    </SmartMenu>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200/70 dark:border-stone-800/70">
        <div role="tablist" aria-label={_('archive.filterByType')} className="flex min-w-0 max-w-full flex-wrap items-center gap-x-5 gap-y-1 px-1">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => onChange({ bookType: t })}
              className={cn(
                '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-1 pb-2 text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60',
                tab === t
                  ? 'border-stone-900 font-semibold text-stone-900 dark:border-stone-100 dark:text-stone-50'
                  : 'border-transparent text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300',
              )}
            >
              {_(`archive.type${t[0].toUpperCase()}${t.slice(1)}`)}
              <span className="text-xs font-normal tabular-nums text-stone-400 dark:text-stone-500">{tabCounts[t]}</span>
            </button>
          ))}
        </div>
        <label className="relative mb-1 flex shrink-0 items-center gap-1.5 rounded-lg border border-stone-200/80 bg-white px-2.5 py-1.5 text-stone-400 focus-within:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:focus-within:border-stone-500">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 6h16M7 12h10M10 18h4" />
          </svg>
          <span className="sr-only">{_('archive.sortBy')}</span>
          <select
            value={sort}
            onChange={(event) => onChange({ bookSort: event.target.value as BookSort })}
            className="appearance-none bg-transparent pr-4 text-sm text-stone-700 outline-none dark:text-stone-200"
          >
            <option value="chapter">{_('archive.sortChapter')}</option>
            <option value="recent">{_('archive.sortRecent')}</option>
          </select>
          <svg className="pointer-events-none absolute right-2" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </label>
      </div>

      {detail.isPending ? (
        <div role="status" className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-500/10" />)}
        </div>
      ) : detail.isError ? (
        <QueryErrorState isRetrying={detail.isFetching} onRetry={() => void detail.refetch()} />
      ) : (
        <div className="flex flex-col gap-8">
          {selectionMode && (
            <div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 rounded-xl border border-stone-200/60 bg-white px-3 py-2 text-xs shadow-xs dark:border-stone-800/60 dark:bg-stone-900">
              <button
                type="button"
                onClick={selectAllVisible}
                title={_('annotation.selectAll')}
                aria-label={_('annotation.selectAll')}
                className="flex items-center gap-1.5 text-stone-500 transition-colors hover:text-current dark:text-stone-400"
              >
                <SelectionIcon
                  state={
                    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id))
                      ? 'all'
                      : visibleIds.some((id) => selectedIds.has(id))
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
                onClick={() => setSelectExportOpen(true)}
                disabled={selectedIds.size === 0}
                title={_('annotation.exportTitle')}
                aria-label={_('annotation.exportTitle')}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-500/10 hover:text-current disabled:opacity-35 dark:text-stone-400"
              >
                <DocumentExportIcon size={16} />
              </button>
              <button
                type="button"
                onClick={exitSelection}
                title={_('annotation.cancel')}
                aria-label={_('annotation.cancel')}
                className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-500/10 hover:text-current dark:text-stone-400"
              >
                <CloseIcon size={16} />
              </button>
            </div>
          )}

          {sort === 'recent' ? (
            recentRecords.length === 0 ? (
              <p className="py-10 text-center text-sm text-stone-500 dark:text-stone-400">{_('archive.noRecords')}</p>
            ) : (
              <section aria-label={_('archive.recentRecords')}>
                <ul className="flex flex-col gap-4">
                  {recentRecords.map((record) => record.kind === 'review' ? renderReviewItem(record.item) : renderAnnotationItem(record.item))}
                </ul>
              </section>
            )
          ) : (
            <>
          {reviews.length > 0 && (
            <section aria-label={_('archive.reviews')}>
              <h3 className="mb-3 text-lg font-bold text-stone-900 dark:text-stone-50">{_('archive.reviews')}</h3>
              <ul className="flex flex-col">
                {reviews.map(renderReviewItem)}
              </ul>
            </section>
          )}

          {annotations.map((group) => {
            const firstHref = group.list.map((a) => jumpHref(a)).find((href) => href !== null) ?? null
            return (
              <section key={`${group.chapterHref ?? ''}|${group.chapter}`} aria-label={group.chapter}>
                {firstHref ? (
                  <a href={firstHref} className="mb-3 block truncate text-lg font-bold text-stone-900 transition-colors hover:text-stone-600 dark:text-stone-50 dark:hover:text-stone-300">{group.chapter}</a>
                ) : (
                  <h3 className="mb-3 truncate text-lg font-bold text-stone-900 dark:text-stone-50">{group.chapter}</h3>
                )}
                <ul className="flex flex-col gap-4">
                  {group.list.map((a) => (
                    <li key={a.id} className="group/archive-item relative">
                      {selectionMode && (
                        <button
                          type="button"
                          onClick={() => toggleSelected(a.id)}
                          aria-pressed={selectedIds.has(a.id)}
                          aria-label={_('annotation.toggleSelected')}
                          className={cn(
                            'absolute top-0 right-0 z-10 flex h-5 w-5 items-center justify-center rounded-full border transition-colors',
                            selectedIds.has(a.id)
                              ? 'border-blue-600 bg-blue-600 text-white dark:border-blue-400 dark:bg-blue-400 dark:text-stone-950'
                              : 'border-stone-300 bg-transparent dark:border-stone-600',
                          )}
                        >
                          {selectedIds.has(a.id) && <CheckIcon size={13} strokeWidth={2.4} />}
                        </button>
                      )}
                      {editingId === a.id ? (
                        renderEditor(a)
                      ) : (
                        <>
                          {a.type === 'highlight' && hasReadableText(a.text) && (
                            <div className="border-l-[3px] border-amber-400/70 pl-4 dark:border-amber-400/50">
                              {(() => {
                                const href = selectionMode ? null : jumpHref(a)
                                const quote = (
                                  <HighlightQuote
                                    item={a}
                                    theme="app"
                                    expanded
                                    allowToggle={false}
                                    onToggle={() => {}}
                                    expandLabel={_('annotation.expand')}
                                    collapseLabel={_('annotation.collapse')}
                                  />
                                )
                                return href
                                  ? <a href={href} title={_('archive.readLocation')} className="block transition-opacity hover:opacity-80">{quote}</a>
                                  : quote
                              })()}
                              {renderMeta(a)}
                            </div>
                          )}
                          {a.type === 'bookmark' && (
                            <div className="min-w-0">
                              <div className="flex items-start gap-2">
                                <span className="mt-0.5 text-blue-500 dark:text-blue-400"><BookmarkIcon /></span>
                                {isCustomBookmarkTitle(a, _('reader.bookmark')) ? (
                                  <ClampedText
                                    text={a.text}
                                    clampClassName="line-clamp-2"
                                    className="text-sm font-medium leading-relaxed text-stone-800 whitespace-pre-wrap break-words dark:text-stone-200"
                                    expanded
                                    allowToggle={false}
                                    onToggle={() => {}}
                                    expandLabel={_('annotation.expand')}
                                    collapseLabel={_('annotation.collapse')}
                                    minLengthForToggle={40}
                                    theme="app"
                                  />
                                ) : hasReadableText(a.contextText) || hasReadableText(a.text) ? (
                                  <ClampedText
                                    text={hasReadableText(a.contextText) ? a.contextText : a.text}
                                    clampClassName="line-clamp-4"
                                    className="text-xs leading-relaxed text-stone-600 whitespace-pre-wrap break-words dark:text-stone-300"
                                    wrapperClassName="rounded-md border-l-2 border-blue-300/40 px-2 py-1 dark:border-blue-400/25"
                                    expanded
                                    allowToggle={false}
                                    onToggle={() => {}}
                                    expandLabel={_('annotation.expand')}
                                    collapseLabel={_('annotation.collapse')}
                                    minLengthForToggle={65}
                                    theme="app"
                                  />
                                ) : null}
                              </div>
                              {isCustomBookmarkTitle(a, _('reader.bookmark')) && hasReadableText(a.contextText) && (
                                <ClampedText
                                  text={a.contextText}
                                  clampClassName="line-clamp-3"
                                  className="text-xs leading-relaxed text-stone-600 whitespace-pre-wrap break-words dark:text-stone-300"
                                  wrapperClassName="ml-7 mt-2 rounded-md border-l-2 border-blue-300/40 px-2 py-1 dark:border-blue-400/25"
                                  expanded
                                  allowToggle={false}
                                  onToggle={() => {}}
                                  expandLabel={_('annotation.expand')}
                                  collapseLabel={_('annotation.collapse')}
                                  minLengthForToggle={50}
                                  theme="app"
                                />
                              )}
                              <div className="ml-7">{renderMeta(a)}</div>
                            </div>
                          )}
                          {a.type === 'note' && (
                            <div className="min-w-0">
                              {a.note && (
                                <button
                                  type="button"
                                  onClick={() => { if (!selectionMode) setOpenIdeaId(a.id) }}
                                  title={_('archive.viewIdeaDetail')}
                                  aria-label={_('archive.viewIdeaDetail')}
                                  className="block w-full cursor-pointer text-left"
                                >
                                  <ClampedText
                                    text={a.note}
                                    clampClassName="line-clamp-3"
                                    className="text-sm font-medium leading-relaxed text-stone-800 whitespace-pre-wrap break-words dark:text-stone-200"
                                    wrapperClassName="px-0 py-1 transition-colors hover:text-stone-950 dark:hover:text-stone-50"
                                    expanded
                                    allowToggle={false}
                                    onToggle={() => {}}
                                    expandLabel={_('annotation.expand')}
                                    collapseLabel={_('annotation.collapse')}
                                    minLengthForToggle={60}
                                    theme="app"
                                  />
                                </button>
                              )}
                              {hasReadableText(a.text) && (
                                <div className={cn('border-l-[3px] border-amber-400/70 pl-4 dark:border-amber-400/50', a.note && 'mt-2')}>
                                  {(() => {
                                    const href = selectionMode ? null : jumpHref(a)
                                    const quote = (
                                      <ClampedText
                                        text={a.text}
                                        clampClassName="line-clamp-2"
                                        className="text-xs leading-relaxed text-stone-500 whitespace-pre-wrap break-words dark:text-stone-400"
                                        expanded
                                        allowToggle={false}
                                        onToggle={() => {}}
                                        expandLabel={_('annotation.expand')}
                                        collapseLabel={_('annotation.collapse')}
                                        minLengthForToggle={40}
                                        theme="app"
                                      />
                                    )
                                    return href
                                      ? <a href={href} title={_('archive.readLocation')} className="block transition-opacity hover:opacity-80">{quote}</a>
                                      : quote
                                  })()}
                                </div>
                              )}
                              <ContentImages images={a.images} />
                              {renderMeta(a)}
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}

          {reviews.length === 0 && annotations.length === 0 && (
            <p className="py-10 text-center text-sm text-stone-500 dark:text-stone-400">{_('archive.noRecords')}</p>
          )}
            </>
          )}
        </div>
      )}

      {exportOpen && (
        <AnnotationExportDialog
          bookId={bookVersionId}
          annotations={allAnnotations}
          sort="chapter"
          chapterOrder={chapterOrder}
          onClose={() => setExportOpen(false)}
        />
      )}
      {selectExportOpen && (
        <AnnotationExportDialog
          bookId={bookVersionId}
          annotations={allAnnotations.filter((a) => selectedIds.has(a.id))}
          sort="chapter"
          chapterOrder={chapterOrder}
          onClose={() => setSelectExportOpen(false)}
        />
      )}
      {openReview && (
        <Modal title={book.data?.data.title ?? _('review.sourceGoneTitle')} onClose={() => setOpenReviewId(null)} closeLabel={_('library.close')} size="xl">
          <ReviewCard
            review={openReview}
            onDeleted={() => {
              setOpenReviewId(null)
              void detail.refetch()
            }}
          />
        </Modal>
      )}
      {openIdeaId && (
        <IdeaDetailModal
          ideaId={openIdeaId}
          bookVersionId={bookVersionId}
          bookTitle={book.data?.data.title ?? _('review.sourceGoneTitle')}
          onClose={() => { setOpenIdeaId(null); void detail.refetch() }}
          onShare={(entry) => shareItem(entry.annotation)}
          onEdit={(entry) => { setOpenIdeaId(null); startEdit(entry.annotation.id) }}
          onDelete={(entry) => { setOpenIdeaId(null); deleteItem(entry.annotation) }}
        />
      )}
      <ShareCardDialog bookId={bookVersionId} />
      {noteDeleteTarget && (
        <ConfirmDialog
          title={_('archive.deleteIdeaTitle')}
          message={_('archive.deleteIdeaMessage')}
          confirmLabel={_('reader.delete')}
          confirmVariant="danger"
          confirmDisabled={deleteAnnotation.isPending}
          onClose={() => { if (!deleteAnnotation.isPending) setNoteDeleteTarget(null) }}
          onConfirm={() => deleteItem(noteDeleteTarget, true)}
        />
      )}
    </div>
  )
}

/**
 * The reader's idea detail card (author + note + quote + like/comment counts +
 * discussion thread), mounted in a centered modal. Reading-theme variables are
 * scoped to this subtree so the shared card renders identically without any
 * reader-file changes.
 */
function IdeaDetailModal({ ideaId, bookVersionId, bookTitle, onClose, onShare, onEdit, onDelete }: {
  ideaId: string
  bookVersionId: string
  bookTitle: string
  onClose: () => void
  onShare: (entry: IdeaEntry) => void
  onEdit: (entry: IdeaEntry) => void
  onDelete: (entry: IdeaEntry) => void
}) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const discussion = useIdeaDiscussion(ideaId, bookVersionId)
  const likeAction = useIdeaAction(ideaId, bookVersionId)
  if (discussion.isPending) {
    return (
      <Modal title={bookTitle} onClose={onClose} closeLabel={_('library.close')} variant="reader" size="idea" centered hideHeader contentClassName="!flex-none !overflow-hidden !p-0">
        <div className="p-4"><div role="status" className="h-48 animate-pulse rounded-xl bg-stone-500/10" /></div>
      </Modal>
    )
  }
  if (discussion.isError || !discussion.data) {
    return (
      <Modal title={bookTitle} onClose={onClose} closeLabel={_('library.close')} variant="reader" size="idea" centered hideHeader contentClassName="!flex-none !overflow-hidden !p-0">
        <div className="p-4"><QueryErrorState isRetrying={discussion.isFetching} onRetry={() => void discussion.refetch()} /></div>
      </Modal>
    )
  }
  const idea = discussion.data.data.idea
  const entry: IdeaEntry = {
    annotation: idea.annotation,
    authorName: idea.author.name,
    authorAvatarKey: idea.author.avatarKey,
    own: idea.own,
    canDelete: idea.canDelete,
    liked: idea.liked,
    likeCount: idea.likeCount,
    commentCount: idea.commentCount,
    locationAvailable: idea.locationAvailable,
  }
  const jumpHref = idea.locationAvailable !== false
    ? `/books/${encodeURIComponent(bookVersionId)}?annotation=${encodeURIComponent(idea.annotation.id)}`
    : null
  return (
    <Modal title={bookTitle} onClose={onClose} closeLabel={_('library.close')} variant="reader" size="idea" centered hideHeader contentClassName="!flex-none !overflow-hidden !p-0">
      <div className="flex min-h-0 max-h-[calc(100dvh-2rem)] flex-col overflow-hidden">
        <IdeaDetailCard
          detail={entry}
          liked={idea.liked}
          theme="reader"
          surface
          onBack={onClose}
          onJump={jumpHref ? () => window.location.assign(jumpHref) : undefined}
          onToggleLike={() => likeAction.mutate({ type: 'like', liked: !idea.liked }, {
            onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['archive'] }),
            onError: (error) => notify.error(getUserErrorNotification(error, 'comment.actionFailed')),
          })}
          onCopy={() => {
            const text = buildAnnotationCopyText(idea.annotation, _('reader.bookmark'))
            if (!text) return
            void navigator.clipboard.writeText(text).then(
              () => notify.success({ key: 'reader.copied' }),
              () => notify.error({ key: 'reader.copyFailed' }),
            )
          }}
          onShare={onShare}
          onEdit={onEdit}
          onDelete={onDelete}
        >
          <IdeaDiscussionPanel
            ideaId={idea.annotation.id}
            bookId={bookVersionId}
            detailLayout
            initialCommentCount={idea.commentCount}
            initialLikeCount={idea.likeCount}
          />
        </IdeaDetailCard>
      </div>
    </Modal>
  )
}
