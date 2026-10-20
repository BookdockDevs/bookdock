import { useMemo, useRef, useState } from 'react'

import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'

import type { AnnotationRes, AnnotationStyle, AnnotationUpdateReq, ArchiveRecordType, ReadingRange, Review } from '@bookdock/shared'

import { ApiError } from '@/api/client'
import { useReadingLedger } from '@/api/hooks/reading-records'
import { useBookChapters } from '@/api/hooks/useBookChapters'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import ContentImages from '@/features/content-files/components/ContentImages'
import { BatchSelectIcon, BookmarkIcon, BulbIcon, ChatBubbleIcon, CheckIcon, DocumentExportIcon, HighlighterIcon, SelectionIcon, TrashIcon } from '@/features/reader/components/annotation-icons'
import AnnotationExportDialog from '@/features/reader/components/AnnotationExportDialog'
import AnnotationInlineEditor from '@/features/reader/components/AnnotationInlineEditor'
import { annotationHex } from '@/features/reader/components/annotation-colors'
import { ClampedText, HighlightQuote } from '@/features/reader/components/annotation-render'
import { formatFullDateTime, formatRelativeTime } from '@/features/reader/components/format-relative-time'
import IdeaDetailModal from '@/features/reader/components/IdeaDetailModal'
import ShareCardDialog from '@/features/reader/components/share/ShareCardDialog'
import BookCover from '@/features/library/components/BookCover'
import BookDetailDialog from '@/features/library/components/BookDetailDialog'
import { useBook } from '@/features/library/hooks'
import { useDeleteAnnotation, useBatchDeleteAnnotations, useUpdateAnnotation } from '@/features/reader/hooks/useAnnotations'
import { useIdeaComposer } from '@/features/reader/hooks/useIdeas'
import { isCustomBookmarkTitle } from '@/features/reader/lib/annotation-text'
import { compareAnnotations, groupAnnotationsByChapter } from '@/features/reader/lib/annotation-order'
import { buildChapterOrderLookup, type ChapterOrderItem } from '@/features/reader/lib/chapter-order'
import { useReaderState } from '@/features/reader/state/reader-state'
import { reviewExcerpt } from '@/features/reviews/lib/markdown'
import ReviewDetailHeaderActions from '@/features/reviews/components/ReviewDetailHeaderActions'
import ReviewDetailView from '@/features/reviews/components/ReviewDetailView'
import ReviewEditor from '@/features/reviews/components/ReviewEditor'
import { useReviewBookContext } from '@/features/reviews/hooks/useReviews'
import StarRating from '@/features/reviews/components/StarRating'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage, getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'
import type { ArchiveSearch } from '@/routes/archive'
import { useAuthStore } from '@/stores/auth.store'

import { useArchiveBookDetail } from './hooks'
import { hasReadableText, readStatusLabel } from './components/archive-helpers'
import BookReadingData from './components/BookReadingData'
import HighlightFilterMenu from './components/HighlightFilterMenu'
import SortMenu from './components/SortMenu'

type BookTab = ArchiveRecordType | 'all'
type BookSort = NonNullable<ArchiveSearch['bookSort']>

const TABS: BookTab[] = ['all', 'highlight', 'bookmark', 'idea', 'review']

export default function BookNotesView({ bookVersionId, bookView = 'notes', bookType, bookSort, onChange, onBack, hideBack = false, range }: {
  bookVersionId: string
  bookView?: 'data' | 'notes'
  bookType: BookTab
  bookSort: BookSort
  onChange: (next: Partial<Pick<ArchiveSearch, 'bookType' | 'bookSort' | 'bookView'>>) => void
  onBack: () => void
  hideBack?: boolean
  range?: ReadingRange
}) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const setShareTarget = useReaderState((s) => s.setShareTarget)
  const [openReviewId, setOpenReviewId] = useState<string | null>(null)
  const [editingReviewId, setEditingReviewId] = useState<string | null>(null)
  const [openIdeaId, setOpenIdeaId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const saveLock = useRef(false)
  const [noteDeleteTarget, setNoteDeleteTarget] = useState<AnnotationRes | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectExportOpen, setSelectExportOpen] = useState(false)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [bookDetailOpen, setBookDetailOpen] = useState(false)
  const [colorFilter, setColorFilter] = useState<Set<string>>(new Set())
  const [styleFilter, setStyleFilter] = useState<Set<AnnotationStyle>>(new Set())

  const ledger = useReadingLedger(bookVersionId)
  const book = useBook(bookVersionId)
  const sourceUnavailable = book.isError && book.error instanceof ApiError && (book.error.status === 404 || book.error.status === 403)
  const archivedBook = sourceUnavailable && ledger.data?.data ? {
    id: bookVersionId, title: ledger.data.data.title, author: ledger.data.data.author,
    format: ledger.data.data.format ?? 'txt', coverKey: ledger.data.data.coverKey ?? null,
  } : null
  const displayedBook = sourceUnavailable ? archivedBook : book.data?.data
  const hasProgress = (book.data?.data.progress ?? 0) > 0
  const chapters = useBookChapters(bookVersionId, bookView === 'notes' && !sourceUnavailable)
  const detail = useArchiveBookDetail(bookVersionId, bookView === 'notes', range)
  // Composer context for the review editor; fetched only while editing so
  // opening a review detail stays a zero-extra-request action.
  const reviewBookContext = useReviewBookContext(bookVersionId, editingReviewId !== null)
  const updateAnnotation = useUpdateAnnotation(bookVersionId)
  const deleteAnnotation = useDeleteAnnotation(bookVersionId)
  const batchDeleteMutation = useBatchDeleteAnnotations(bookVersionId)
  const batchDeleteLock = useRef(false)
  // Composer context for the note inline editor; fetched only while editing so
  // opening a book archive stays a zero-extra-request action.
  const composer = useIdeaComposer(bookVersionId, !!user && editingId !== null)

  const chapterOrder: ChapterOrderItem[] = useMemo(
    () => (chapters.data?.data ?? []).map((c) => ({ label: c.title, href: c.id })),
    [chapters.data],
  )
  const lookup = useMemo(() => buildChapterOrderLookup(chapterOrder), [chapterOrder])

  const tab = bookType
  const sort = bookSort
  const normalizedSort: 'chapter' | 'chapter-desc' | 'time-desc' | 'time-asc' =
    sort === 'recent' ? 'time-desc' : sort ?? 'chapter'
  const isChapterSort = normalizedSort === 'chapter' || normalizedSort === 'chapter-desc'

  const filteredAnnotations = useMemo(() => {
    const items = detail.data?.data.annotations ?? []
    if (tab === 'all' || tab === 'review') return tab === 'review' ? [] : items
    let list = items.filter((a) => (tab === 'idea' ? a.type === 'note' : a.type === tab))
    if (tab === 'highlight') {
      if (colorFilter.size > 0) {
        list = list.filter((a) => colorFilter.has(a.color ?? 'yellow'))
      }
      if (styleFilter.size > 0) {
        list = list.filter((a) => styleFilter.has((a.style as AnnotationStyle) ?? 'highlight'))
      }
    }
    return list
  }, [detail.data, tab, colorFilter, styleFilter])

  const annotations = useMemo(() => {
    if (!isChapterSort) return []
    const reverse = normalizedSort === 'chapter-desc'
    const orderIndex = (g: { chapter: string; chapterHref: string | null }) => {
      const i = lookup(g.chapter, g.chapterHref)
      return i < 0 ? chapterOrder.length : i
    }
    return groupAnnotationsByChapter(filteredAnnotations, _('reader.uncategorized'))
      .map((g) => ({
        ...g,
        list: [...g.list].sort((a, b) => (reverse ? -1 : 1) * compareAnnotations(a, b)),
      }))
      .sort((g1, g2) => {
        const a = orderIndex(g1)
        const b = orderIndex(g2)
        const aUnknown = a === chapterOrder.length
        const bUnknown = b === chapterOrder.length
        if (aUnknown !== bUnknown) return aUnknown ? 1 : -1
        return (reverse ? -1 : 1) * (a - b)
      })
  }, [filteredAnnotations, lookup, chapterOrder.length, isChapterSort, normalizedSort, _])

  const reviews = useMemo(() => {
    const list = detail.data?.data.reviews ?? []
    return tab === 'all' || tab === 'review' ? list : []
  }, [detail.data, tab])

  const timeRecords = useMemo(() => {
    if (isChapterSort) return []
    const list: Array<{ kind: 'annotation' | 'review'; item: AnnotationRes | Review }> = [
      ...filteredAnnotations.map((item) => ({ kind: 'annotation' as const, item })),
      ...reviews.map((item) => ({ kind: 'review' as const, item })),
    ]
    const asc = normalizedSort === 'time-asc'
    return list.sort((a, b) => {
      const timeA = a.item.createdAt ?? 0
      const timeB = b.item.createdAt ?? 0
      const diff = asc ? timeA - timeB : timeB - timeA
      return diff || a.item.id.localeCompare(b.item.id)
    })
  }, [filteredAnnotations, reviews, isChapterSort, normalizedSort])

  const openReview = reviews.find((r) => r.id === openReviewId) ?? null
  const editingReview = reviews.find((r) => r.id === editingReviewId) ?? null
  const reviewComposer = reviewBookContext.data?.data.composer
  const allAnnotations = detail.data?.data.annotations ?? []
  const visibleIds = useMemo(() => {
    if (isChapterSort) {
      return annotations.flatMap((g) => g.list.map((a) => a.id))
    }
    return timeRecords
      .filter((r): r is { kind: 'annotation'; item: AnnotationRes } => r.kind === 'annotation')
      .map((r) => r.item.id)
  }, [annotations, timeRecords, isChapterSort])
  const tabCounts: Record<BookTab, number> = {
    all: allAnnotations.length + (detail.data?.data.reviews.length ?? 0),
    highlight: allAnnotations.filter((a) => a.type === 'highlight').length,
    bookmark: allAnnotations.filter((a) => a.type === 'bookmark').length,
    idea: allAnnotations.filter((a) => a.type === 'note').length,
    review: detail.data?.data.reviews.length ?? 0,
  }

  // SPA navigation (not a native anchor): a full-document load would reset
  // the router history index and break the reader's page-level back button.
  function jumpLink(a: AnnotationRes): { to: '/books/$id'; params: { id: string }; search: { annotation: string } } | null {
    if (sourceUnavailable || a.locationAvailable === false) return null
    return { to: '/books/$id', params: { id: bookVersionId }, search: { annotation: a.id } }
  }

  function refreshArchive() {
    void queryClient.invalidateQueries({ queryKey: ['archive'] })
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

  function enterSelection() {
    setEditingId(null)
    setEditError(null)
    setSelectedIds(new Set(visibleIds))
    setSelectionMode(true)
  }

  async function deleteSelected() {
    if (selectedIds.size === 0 || batchDeleteLock.current) return
    batchDeleteLock.current = true
    try {
      const result = await batchDeleteMutation.mutateAsync(Array.from(selectedIds))
      setSelectedIds(new Set(result.failedIds))
      setBatchDeleteOpen(false)
      refreshArchive()
      if (result.failedIds.length) {
        const showResult = result.succeeded > 0 ? notify.warning : notify.error
        showResult({ key: 'annotation.batchDeletePartial', params: { succeeded: result.succeeded, failed: result.failedIds.length } })
      } else notify.success({ key: 'annotation.batchDeleted', params: { count: result.succeeded } })
    } catch (error) {
      notify.error(getUserErrorNotification(error, 'annotation.deleteFailed'))
    } finally {
      batchDeleteLock.current = false
    }
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

  function renderItemTimeMeta(timeValue: number) {
    return (
      <div className={cn('flex shrink-0 items-center gap-1.5 pt-0.5', selectionMode && 'pr-7')}>
        <span
          title={formatFullDateTime(_, timeValue)}
          className="text-xs tabular-nums text-stone-400 dark:text-stone-500"
        >
          {formatRelativeTime(_, timeValue)}
        </span>
      </div>
    )
  }

  function renderReviewItem(review: Review) {
    const hasTitle = Boolean(review.title && review.title.trim())
    const hasBody = Boolean(review.body && review.body.trim())
    const hasRating = review.rating != null

    // 标题、正文、评分均为空时不展示书评卡片
    if (!hasTitle && !hasBody && !hasRating) {
      return null
    }

    const isRatingOnly = !hasTitle && !hasBody && hasRating

    // 时间语义：
    // - 有标题或正文的书评：显示 updatedAt
    // - 纯评分记录：显示 createdAt
    const timeValue = review.createdAt

    if (isRatingOnly) {
      return (
        <li
          key={review.id}
          onClick={() => { if (!selectionMode) setOpenReviewId(review.id) }}
          className={cn(
            'group/archive-item relative rounded-xl border border-stone-200/80 bg-white p-2.5 sm:px-3.5 sm:py-2.5 shadow-2xs transition-all hover:border-stone-300 dark:border-stone-800/80 dark:bg-stone-900/60',
            !selectionMode && 'cursor-pointer hover:shadow-xs',
          )}
          title={_('archive.viewFullReview')}
          aria-label={_('archive.viewFullReview')}
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-purple-500/10 text-purple-600 dark:bg-purple-400/10 dark:text-purple-400">
              <ChatBubbleIcon size={13} />
            </span>
            <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <StarRating value={review.rating} size={14} />
              </div>
              {renderItemTimeMeta(timeValue)}
            </div>
          </div>
        </li>
      )
    }

    const bodyText = hasBody ? reviewExcerpt(review.body!.trim(), review.bodyFormat, 300) : null

    return (
      <li
        key={review.id}
        onClick={() => { if (!selectionMode) setOpenReviewId(review.id) }}
        className={cn(
          'group/archive-item relative rounded-xl border border-stone-200/80 bg-white p-3.5 shadow-2xs transition-all hover:border-stone-300 dark:border-stone-800/80 dark:bg-stone-900/60',
          !selectionMode && 'cursor-pointer hover:shadow-xs',
        )}
        title={_('archive.viewFullReview')}
        aria-label={_('archive.viewFullReview')}
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-purple-500/10 text-purple-600 dark:bg-purple-400/10 dark:text-purple-400">
            <ChatBubbleIcon size={13} />
          </span>
          <div className="min-w-0 flex-1">
            {/* 头部信息行：评分（如有） + 标题（若无标题则正文占用首行） ↔ 最右侧时间 */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {hasTitle ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {hasRating && <StarRating value={review.rating} size={14} />}
                    <h4 className="min-w-0 font-semibold text-stone-900 dark:text-stone-100 text-sm break-words">
                      {review.title!.trim()}
                    </h4>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {hasRating && <StarRating value={review.rating} size={14} />}
                    {bodyText && (
                      <p className="min-w-0 text-sm font-medium leading-relaxed text-stone-800 whitespace-pre-wrap break-words line-clamp-3 dark:text-stone-200">
                        {bodyText}
                      </p>
                    )}
                  </div>
                )}
              </div>
              {renderItemTimeMeta(timeValue)}
            </div>

            {/* 内容区域：仅在有标题且有正文时，在次行全宽展开展示正文 */}
            {hasTitle && bodyText && (
              <p className="mt-2 text-sm leading-relaxed text-stone-700 whitespace-pre-wrap break-words line-clamp-3 dark:text-stone-300">
                {bodyText}
              </p>
            )}
          </div>
        </div>
      </li>
    )
  }

  function renderAnnotationItem(a: AnnotationRes) {
    const customBookmark = isCustomBookmarkTitle(a, _('reader.bookmark'))
    const bookmarkQuote = hasReadableText(a.contextText) ? a.contextText : hasReadableText(a.text) ? a.text : null
    const hex = annotationHex(a.color)
    return (
      <li
        key={a.id}
        onClick={selectionMode && editingId !== a.id ? () => toggleSelected(a.id) : undefined}
        className={cn(
          'group/archive-item relative rounded-xl border border-stone-200/80 bg-white p-3.5 shadow-2xs transition-all hover:border-stone-300 dark:border-stone-800/80 dark:bg-stone-900/60',
          selectionMode && 'cursor-pointer',
          selectionMode && selectedIds.has(a.id) && 'border-stone-400/90 bg-stone-100/50 ring-1 ring-stone-900/5 dark:border-stone-600 dark:bg-stone-800/40 dark:ring-white/5',
        )}
      >
        {selectionMode && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); toggleSelected(a.id) }}
            aria-pressed={selectedIds.has(a.id)}
            aria-label={_('annotation.toggleSelected')}
            className={cn(
              'absolute top-3 right-3 z-10 flex h-5 w-5 items-center justify-center rounded-md border transition-colors',
              selectedIds.has(a.id)
                ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                : 'border-stone-300 bg-white hover:border-stone-400 dark:border-stone-600 dark:bg-stone-800',
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
              <div className="flex items-start gap-2.5">
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-stone-100 dark:bg-stone-800"
                  style={{ color: hex }}
                >
                  <HighlighterIcon size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {(() => {
                        const link = selectionMode ? null : jumpLink(a)
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
                        return link
                          ? <Link to={link.to} params={link.params} search={link.search} title={_('archive.readLocation')} className="block rounded transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 dark:focus-visible:outline-stone-500">{quote}</Link>
                          : quote
                      })()}
                    </div>
                    {renderItemTimeMeta(a.createdAt)}
                  </div>
                </div>
              </div>
            )}
            {a.type === 'bookmark' && (() => {
              const link = selectionMode ? null : jumpLink(a)
              return (
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:bg-blue-400/10 dark:text-blue-400">
                    <BookmarkIcon />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
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
                          <div className="rounded-lg border-l-2 border-blue-300/40 bg-stone-50/50 px-2.5 py-1.5 dark:border-blue-400/25 dark:bg-stone-800/40">
                            {link ? (
                              <Link to={link.to} params={link.params} search={link.search} title={_('archive.readLocation')} className="block rounded transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 dark:focus-visible:outline-stone-500">
                                <ClampedText
                                  text={bookmarkQuote}
                                  clampClassName="line-clamp-4"
                                  className="text-xs leading-relaxed text-stone-600 whitespace-pre-wrap break-words dark:text-stone-300"
                                  expanded
                                  allowToggle={false}
                                  onToggle={() => {}}
                                  expandLabel={_('annotation.expand')}
                                  collapseLabel={_('annotation.collapse')}
                                  minLengthForToggle={65}
                                  theme="app"
                                />
                              </Link>
                            ) : (
                              <ClampedText
                                text={bookmarkQuote}
                                clampClassName="line-clamp-4"
                                className="text-xs leading-relaxed text-stone-600 whitespace-pre-wrap break-words dark:text-stone-300"
                                expanded
                                allowToggle={false}
                                onToggle={() => {}}
                                expandLabel={_('annotation.expand')}
                                collapseLabel={_('annotation.collapse')}
                                minLengthForToggle={65}
                                theme="app"
                              />
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-stone-500 dark:text-stone-400">{_('reader.bookmark')}</span>
                        )}
                      </div>
                      {renderItemTimeMeta(a.createdAt)}
                    </div>

                    {customBookmark && hasReadableText(a.contextText) && (
                      <div className="mt-2 rounded-lg border-l-2 border-blue-300/40 bg-stone-50/50 px-2.5 py-1.5 dark:border-blue-400/25 dark:bg-stone-800/40">
                        {link ? (
                          <Link to={link.to} params={link.params} search={link.search} title={_('archive.readLocation')} className="block rounded transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 dark:focus-visible:outline-stone-500">
                            <ClampedText
                              text={a.contextText}
                              clampClassName="line-clamp-3"
                              className="text-xs leading-relaxed text-stone-600 whitespace-pre-wrap break-words dark:text-stone-300"
                              expanded
                              allowToggle={false}
                              onToggle={() => {}}
                              expandLabel={_('annotation.expand')}
                              collapseLabel={_('annotation.collapse')}
                              minLengthForToggle={50}
                              theme="app"
                            />
                          </Link>
                        ) : (
                          <ClampedText
                            text={a.contextText}
                            clampClassName="line-clamp-3"
                            className="text-xs leading-relaxed text-stone-600 whitespace-pre-wrap break-words dark:text-stone-300"
                            expanded
                            allowToggle={false}
                            onToggle={() => {}}
                            expandLabel={_('annotation.expand')}
                            collapseLabel={_('annotation.collapse')}
                            minLengthForToggle={50}
                            theme="app"
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })()}
            {a.type === 'note' && (
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400">
                  <BulbIcon size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {a.note ? (
                        <button
                          type="button"
                          onClick={() => { if (!selectionMode) setOpenIdeaId(a.id) }}
                          title={_('archive.viewIdeaDetail')}
                          aria-label={_('archive.viewIdeaDetail')}
                          className="block w-full cursor-pointer text-left transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 dark:focus-visible:outline-stone-500"
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
                      ) : (
                        <span className="text-xs text-stone-400">{_('archive.idea')}</span>
                      )}
                    </div>
                    {renderItemTimeMeta(a.createdAt)}
                  </div>

                  {a.images && a.images.length > 0 && (
                    <div className="mt-2.5">
                      <ContentImages images={a.images} />
                    </div>
                  )}

                  {hasReadableText(a.text) && (
                    <div className={cn(
                      'rounded-lg border-l-2 border-amber-300/50 bg-stone-500/[0.03] px-2.5 py-1.5 transition-colors hover:border-amber-400 hover:bg-stone-500/[0.06] dark:border-amber-400/30 dark:bg-stone-500/[0.05] dark:hover:border-amber-400/60 dark:hover:bg-stone-500/[0.09]',
                      (a.note || (a.images && a.images.length > 0)) && 'mt-2.5',
                    )}>
                      {(() => {
                        const link = selectionMode ? null : jumpLink(a)
                        const quote = (
                          <ClampedText
                            text={a.text}
                            clampClassName="line-clamp-2"
                            className="text-xs leading-relaxed text-stone-600 whitespace-pre-wrap break-words dark:text-stone-400"
                            expanded
                            allowToggle={false}
                            onToggle={() => {}}
                            expandLabel={_('annotation.expand')}
                            collapseLabel={_('annotation.collapse')}
                            minLengthForToggle={40}
                            theme="app"
                          />
                        )
                        return link
                          ? <Link to={link.to} params={link.params} search={link.search} title={_('archive.readLocation')} className="block rounded transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-400 dark:focus-visible:outline-stone-500">{quote}</Link>
                          : quote
                      })()}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </li>
    )
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-3">
        {!hideBack && (
          <div className="flex items-center gap-2 border-b border-stone-200/70 pb-2.5 lg:hidden dark:border-stone-800/70">
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
            <span className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              {_('archive.bookNotes')}
            </span>
          </div>
        )}
        {book.isPending ? (
          <div role="status" className="flex gap-4">
            <div className="h-24 w-[4.5rem] animate-pulse rounded-xl bg-stone-500/10" />
            <div className="flex-1 space-y-2 py-1">
              <div className="h-6 w-48 animate-pulse rounded bg-stone-500/10" />
              <div className="h-4 w-32 animate-pulse rounded bg-stone-500/10" />
            </div>
          </div>
        ) : book.isError && !archivedBook && !book.data ? (
          <QueryErrorState isRetrying={book.isFetching} onRetry={() => void book.refetch()} />
        ) : (
          <div className="flex items-center justify-between gap-4">
            {/* 左侧：封面 + 书名 + 作者状态（为未来分类标签预留良好延展空间） */}
            <div className="flex items-center gap-3 sm:gap-4 min-w-0">
              <div
                onClick={sourceUnavailable ? undefined : () => setBookDetailOpen(true)}
                className={cn('group/cover shrink-0', !sourceUnavailable && 'cursor-pointer transition-transform hover:scale-[1.02] active:scale-[0.99]')}
                title={sourceUnavailable ? undefined : _('library.bookDetails')}
              >
                <BookCover book={displayedBook!} size="card" coverSrc={sourceUnavailable ? (displayedBook?.coverKey ? `/api/v1/archive/books/${encodeURIComponent(bookVersionId)}/cover?v=${encodeURIComponent(displayedBook.coverKey)}` : null) : undefined} />
              </div>
              <div className="min-w-0">
                <h2
                  onClick={sourceUnavailable ? undefined : () => setBookDetailOpen(true)}
                  className={cn('truncate text-xl font-bold tracking-tight text-stone-900 dark:text-stone-50', !sourceUnavailable && 'cursor-pointer transition-colors hover:text-stone-600 dark:hover:text-stone-300')}
                  title={sourceUnavailable ? undefined : _('library.bookDetails')}
                >
                  {displayedBook?.title}
                </h2>
                <p className="mt-1 truncate text-sm text-stone-500 dark:text-stone-400">
                  {[displayedBook?.author, sourceUnavailable ? _('archive.sourceUnavailable') : readStatusLabel(book.data!.data.readStatus, _)].filter(Boolean).join(' · ')}
                </p>
              </div>
            </div>

            {/* 右侧：同列分层（上层继续阅读主操作，下层视图切换滑块） */}
            <div className="flex flex-col items-end gap-2.5 shrink-0">
              {!sourceUnavailable && (
                <Button
                  size="sm"
                  className="gap-1.5 rounded-full px-3.5 h-8 text-xs font-medium cursor-pointer shadow-2xs"
                  onClick={() => {
                    void navigate({ to: '/books/$id', params: { id: bookVersionId } })
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                  </svg>
                  <span>{hasProgress ? _('library.continueReading') : _('library.startReading')}</span>
                </Button>
              )}

              {/* 视图切换器（数据 / 笔记） */}
              <div
                role="tablist"
                aria-label={_('readingData.views')}
                className="inline-flex items-center rounded-xl bg-stone-100 p-0.5 dark:bg-stone-800/80"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={bookView === 'data'}
                  onClick={() => onChange({ bookView: 'data' })}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition-all cursor-pointer select-none',
                    bookView === 'data'
                      ? 'bg-white text-stone-900 shadow-xs dark:bg-stone-900 dark:text-stone-100 font-semibold'
                      : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
                  )}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                  <span>{_('readingData.viewData')}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={bookView === 'notes'}
                  onClick={() => onChange({ bookView: 'notes' })}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-medium transition-all cursor-pointer select-none',
                    bookView === 'notes'
                      ? 'bg-white text-stone-900 shadow-xs dark:bg-stone-900 dark:text-stone-100 font-semibold'
                      : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
                  )}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                  <span>{_('readingData.viewNotes')}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {bookView === 'data' ? <BookReadingData key={bookVersionId} bookId={bookVersionId} onDeleted={onBack} /> : <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200/70 pb-2 dark:border-stone-800/70">
        <div role="tablist" aria-label={_('archive.filterByType')} className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => onChange({ bookType: t })}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60 cursor-pointer',
                tab === t
                  ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900 shadow-2xs'
                  : 'text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200',
              )}
            >
              <span>{_(`archive.type${t[0].toUpperCase()}${t.slice(1)}`)}</span>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.2 text-[11px] tabular-nums',
                  tab === t
                    ? 'bg-white/20 font-semibold text-white dark:bg-black/15 dark:text-stone-900'
                    : 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
                )}
              >
                {tabCounts[t]}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { if (selectionMode) exitSelection(); else enterSelection() }}
            disabled={!selectionMode && allAnnotations.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-stone-200/90 bg-white px-2.5 text-xs font-medium text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700/80 dark:bg-stone-900/80 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            {selectionMode ? <CheckIcon size={13} /> : <BatchSelectIcon size={13} />}
            {selectionMode ? _('library.done') : _('annotation.select')}
          </button>
          {tab === 'highlight' && (
            <HighlightFilterMenu
              colorFilter={colorFilter}
              styleFilter={styleFilter}
              onToggleColor={(c) => {
                setColorFilter((prev) => {
                  const next = new Set(prev)
                  if (next.has(c)) next.delete(c)
                  else next.add(c)
                  return next
                })
              }}
              onToggleStyle={(s) => {
                setStyleFilter((prev) => {
                  const next = new Set(prev)
                  if (next.has(s)) next.delete(s)
                  else next.add(s)
                  return next
                })
              }}
              onReset={() => {
                setColorFilter(new Set())
                setStyleFilter(new Set())
              }}
            />
          )}
          <SortMenu
            value={normalizedSort}
            options={[
              { value: 'chapter' as const, label: _('reader.sortChapter') },
              { value: 'chapter-desc' as const, label: _('reader.sortChapterReverse') },
              { value: 'time-desc' as const, label: _('reader.sortTimeDesc') },
              { value: 'time-asc' as const, label: _('reader.sortTimeAsc') },
            ]}
            onChange={(bookSort) => onChange({ bookSort })}
            label={_('archive.sortBy')}
            menuWidth={135}
            triggerClassName="h-8 gap-1 rounded-lg border border-stone-200/90 bg-white px-2.5 text-xs text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-stone-700/80 dark:bg-stone-900/80 dark:text-stone-300 dark:hover:text-stone-100"
          />
        </div>
      </div>

      {detail.isPending ? (
        <div role="status" className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-500/10" />)}
        </div>
      ) : detail.isError ? (
        <QueryErrorState isRetrying={detail.isFetching} onRetry={() => void detail.refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          {selectionMode && (
            <div className="sticky top-0 z-10 -mx-1 flex items-center gap-1 overflow-x-auto rounded-xl border border-stone-200/60 bg-white px-2 py-1.5 text-xs whitespace-nowrap shadow-xs dark:border-stone-800/60 dark:bg-stone-900">
              <button
                type="button"
                onClick={selectAllVisible}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 font-medium text-stone-600 transition-colors hover:bg-stone-500/10 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
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
                {visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id)) ? _('annotation.deselectAll') : _('annotation.selectAll')}
              </button>
              <span className="shrink-0 px-1 tabular-nums text-stone-500 dark:text-stone-400">
                {_('annotation.exportSelected', { n: selectedIds.size })}
              </span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setSelectExportOpen(true)}
                disabled={selectedIds.size === 0}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 font-medium text-stone-600 transition-colors hover:bg-stone-500/10 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-stone-300 dark:hover:text-stone-100"
              >
                <DocumentExportIcon size={16} />
                {_('annotation.exportTitle')}
              </button>
              <button
                type="button"
                onClick={() => setBatchDeleteOpen(true)}
                disabled={selectedIds.size === 0}
                className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 font-medium text-stone-500 transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 dark:text-stone-400 dark:hover:text-red-400"
              >
                <TrashIcon />
                {_('annotation.batchDelete')}
              </button>
            </div>
          )}

          {isChapterSort ? (
            <>
              {normalizedSort === 'chapter' && reviews.length > 0 && (
                <section aria-label={_('archive.reviews')}>
                  <div className="mb-3 flex items-center justify-between border-b border-stone-200/60 pb-2 dark:border-stone-800/60">
                    <h3 className="text-base font-bold text-stone-900 dark:text-stone-50">
                      {_('archive.reviews')}
                    </h3>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium tabular-nums text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                      {reviews.length}
                    </span>
                  </div>
                  <ul className="flex w-full flex-col gap-3">
                    {reviews.map(renderReviewItem)}
                  </ul>
                </section>
              )}

              {annotations.map((group) => {
                const firstLink = group.list.map((a) => jumpLink(a)).find((link) => link !== null) ?? null
                return (
                  <section key={`${group.chapterHref ?? ''}|${group.chapter}`} aria-label={group.chapter}>
                    <div className="mb-3 flex items-center justify-between border-b border-stone-200/60 pb-2 dark:border-stone-800/60">
                      {firstLink ? (
                        <Link
                          to={firstLink.to}
                          params={firstLink.params}
                          search={firstLink.search}
                          className="min-w-0 text-base font-bold text-stone-900 transition-colors hover:text-stone-600 dark:text-stone-50 dark:hover:text-stone-300"
                        >
                          <span className="truncate">{group.chapter}</span>
                        </Link>
                      ) : (
                        <h3 className="min-w-0 text-base font-bold text-stone-900 dark:text-stone-50">
                          <span className="truncate">{group.chapter}</span>
                        </h3>
                      )}
                      <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium tabular-nums text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                        {group.list.length}
                      </span>
                    </div>
                    <ul className="flex w-full flex-col gap-3">
                      {group.list.map(renderAnnotationItem)}
                    </ul>
                  </section>
                )
              })}

              {normalizedSort === 'chapter-desc' && reviews.length > 0 && (
                <section aria-label={_('archive.reviews')}>
                  <div className="mb-3 flex items-center justify-between border-b border-stone-200/60 pb-2 dark:border-stone-800/60">
                    <h3 className="text-base font-bold text-stone-900 dark:text-stone-50">
                      {_('archive.reviews')}
                    </h3>
                    <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium tabular-nums text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                      {reviews.length}
                    </span>
                  </div>
                  <ul className="flex w-full flex-col gap-3">
                    {reviews.map(renderReviewItem)}
                  </ul>
                </section>
              )}

              {reviews.length === 0 && annotations.length === 0 && (
                <p className="py-10 text-center text-sm text-stone-500 dark:text-stone-400">{_('archive.noRecords')}</p>
              )}
            </>
          ) : (
            timeRecords.length === 0 ? (
              <p className="py-10 text-center text-sm text-stone-500 dark:text-stone-400">{_('archive.noRecords')}</p>
            ) : (
              <section aria-label={_('archive.recentRecords')}>
                <ul className="flex w-full flex-col gap-3">
                  {timeRecords.map((record) =>
                    record.kind === 'review'
                      ? renderReviewItem(record.item as Review)
                      : renderAnnotationItem(record.item as AnnotationRes),
                  )}
                </ul>
              </section>
            )
          )}
        </div>
      )}

      </>}

      {selectExportOpen && (
        <AnnotationExportDialog
          bookId={bookVersionId}
          annotations={allAnnotations.filter((a) => selectedIds.has(a.id))}
          sort={normalizedSort}
          chapterOrder={chapterOrder}
          onClose={() => setSelectExportOpen(false)}
        />
      )}
      {openReview && (
        <Modal
          title={displayedBook?.title ?? _('review.sourceGoneTitle')}
          onClose={() => {
            setOpenReviewId(null)
            void detail.refetch()
          }}
          closeLabel={_('library.close')}
          size="xl"
          actions={
            <ReviewDetailHeaderActions
              review={openReview}
              onEdit={(r) => setEditingReviewId(r.id)}
              onDeleted={() => {
                setOpenReviewId(null)
                void detail.refetch()
              }}
            />
          }
        >
          <ReviewDetailView review={openReview} />
        </Modal>
      )}
      {editingReviewId && (reviewComposer?.bookVersionId && editingReview ? (
        <ReviewEditor
          bookVersionId={reviewComposer.bookVersionId}
          existing={editingReview}
          composer={reviewComposer}
          onClose={() => setEditingReviewId(null)}
          onSaved={() => {
            void detail.refetch()
          }}
        />
      ) : (
        <Modal title={_('review.editTitle')} onClose={() => setEditingReviewId(null)} closeLabel={_('library.close')} size="xl">
          {reviewBookContext.isError || (!reviewBookContext.isPending && !reviewComposer?.bookVersionId) ? (
            reviewBookContext.isError ? (
              <QueryErrorState isRetrying={reviewBookContext.isFetching} onRetry={() => void reviewBookContext.refetch()} />
            ) : (
              <p role="status" className="py-6 text-sm text-stone-500">{_('review.provenanceUnavailable')}</p>
            )
          ) : (
            <div role="status" className="h-24 animate-pulse rounded-xl bg-stone-500/10" />
          )}
        </Modal>
      ))}
      {openIdeaId && (
        <IdeaDetailModal
          ideaId={openIdeaId}
          bookVersionId={bookVersionId}
          title={displayedBook?.title ?? _('review.sourceGoneTitle')}
          theme="app"
          sourceAvailable={!sourceUnavailable}
          onClose={() => { setOpenIdeaId(null); void detail.refetch() }}
          onShare={(entry) => shareItem(entry.annotation)}
          onEdit={(entry) => { setOpenIdeaId(null); startEdit(entry.annotation.id) }}
          onDelete={(entry) => { setOpenIdeaId(null); deleteItem(entry.annotation) }}
        />
      )}
      <ShareCardDialog bookId={bookVersionId} />
      {bookDetailOpen && book.data?.data && (
        <BookDetailDialog
          book={book.data.data}
          onClose={() => setBookDetailOpen(false)}
          onDelete={() => {
            setBookDetailOpen(false)
            onBack()
          }}
        />
      )}
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
      {batchDeleteOpen && (
        <ConfirmDialog
          title={_('annotation.batchDelete')}
          message={_('annotation.batchDeleteConfirm', { n: selectedIds.size })}
          confirmLabel={_('annotation.batchDelete')}
          confirmVariant="danger"
          confirmDisabled={batchDeleteMutation.isPending}
          onClose={() => { if (!batchDeleteLock.current) setBatchDeleteOpen(false) }}
          onConfirm={() => deleteSelected()}
        />
      )}
    </div>
  )
}
