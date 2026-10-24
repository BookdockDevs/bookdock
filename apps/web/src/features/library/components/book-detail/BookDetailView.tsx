import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import i18n from 'i18next'

import type { BookDetailRes, BookListItem, ReadStatus, Review, UndoReceipt } from '@bookdock/shared'

import { apiPatch } from '@/api/client'
import { Button } from '@/components/ui/Button'
import { formatRelativeTime } from '@/features/reader/components/format-relative-time'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { formatBytes, formatDate, formatDateTime } from '@/lib/utils'

import { copyCover, downloadCover } from '../../download'
import { useForkBook } from '../../hooks'
import { getHiddenCause } from '../../hidden-status'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import BookCover from '../BookCover'
import DetailCoverEditor from './DetailCoverEditor'
import DetailHeader from './DetailHeader'
import DownloadMenu from './DownloadMenu'
import MetaGrid, { type MetaRow } from './MetaGrid'
import MetadataFieldDialog from './MetadataFieldDialog'
import type { EditableMetadataField } from './metadata-field'
import MoreActionsMenu, { type MoreActionsMenuItem } from './MoreActionsMenu'
import ReadStatusChip from './ReadStatusChip'
import { isMachineIdentifier, formatLanguage, formatWordCount } from './types'
import { ActionIcon, FilterChip, GroupLabel } from './ui'
import TaxonomyIcon from '../TaxonomyIcon'
import ReviewEditor from '@/features/reviews/components/ReviewEditor'
import ReviewPreviewSection from '@/features/reviews/components/ReviewPreviewSection'
import { useReviewBookContext } from '@/features/reviews/hooks/useReviews'
import { reviewIconPaths } from '@/features/reviews/lib/review-icon'

interface BookDetailViewProps {
  book: BookListItem
  readOnly?: boolean
  detail?: BookDetailRes
  categoryName?: string
  memberTags: Array<{ id: string; name: string }>
  isLoading?: boolean
  reviewContext?: import('@bookdock/shared').ReviewBookContext | null
  moreActions?: MoreActionsMenuItem[]
  /** Drill into the personal reading data; absent when there is none to show. */
  onOpenReadingData?: () => void
  onOpenAllReviews?: () => void
  onOpenReviewDetail?: (review: Review) => void
  onEdit: () => void
  onDelete: (book: BookListItem) => void
  onClose: () => void
  onPublish?: (book: BookListItem) => void
}

export default function BookDetailView({
  book,
  readOnly = false,
  detail,
  categoryName,
  memberTags,
  isLoading,
  reviewContext: reviewContextProp,
  moreActions,
  onOpenReadingData,
  onOpenAllReviews,
  onOpenReviewDetail,
  onEdit,
  onDelete,
  onClose,
  onPublish,
}: BookDetailViewProps) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const forkBook = useForkBook()

  const displayBook = detail ?? book
  // A private B with a readable source can be detached from it (转存为个人书籍),
  // which is the one thing its source is still needed for.
  const isPrivateB = !readOnly && Boolean(displayBook.source) && displayBook.collected !== false
  const bookmeta = detail?.meta?.bookmeta

  const [forkConfirmOpen, setForkConfirmOpen] = useState(false)
  const [metadataField, setMetadataField] = useState<{ field: EditableMetadataField; label: string } | null>(null)
  const [coverEditing, setCoverEditing] = useState(false)
  const canEditBookmeta = !readOnly && !displayBook.source && Boolean(detail)
  const [reviewEditorOpen, setReviewEditorOpen] = useState(false)
  const reviewQuery = useReviewBookContext(reviewContextProp !== undefined ? null : (book?.id ?? null))
  const reviewContext = reviewContextProp !== undefined ? reviewContextProp : reviewQuery.data?.data
  const reviewComposer = reviewContext?.composer
  const canReview = Boolean(!readOnly && reviewComposer?.eligible && reviewComposer.bookVersionId)
  const ownReview = reviewContext?.own

  // The review glyph carries no state: it opens the caller's own review when
  // there is one and the composer when there is not.
  function openReviewAction() {
    if (ownReview) onOpenReviewDetail?.(ownReview)
    else setReviewEditorOpen(true)
  }

  // Publishing and forking happen once per book, so they wait in the overflow
  // menu instead of taking a slot beside edit and download.
  const overflowItems: MoreActionsMenuItem[] = [
    ...(!readOnly && onPublish
      ? [{
          key: 'publish',
          label: _('library.publish'),
          icon: (
            <>
              <path d="M12 17V3" />
              <path d="m7 8 5-5 5 5" />
              <path d="M5 21h14" />
            </>
          ),
          onSelect: () => onPublish(displayBook),
        }]
      : []),
    ...(isPrivateB && !displayBook.sourceUnavailable
      ? [{
          key: 'fork',
          label: _('library.forkLocal'),
          icon: (
            <>
              <circle cx="12" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="6" r="3" />
              <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
              <path d="M12 12v3" />
            </>
          ),
          onSelect: () => setForkConfirmOpen(true),
        }]
      : []),
    ...(moreActions ?? []),
  ]

  function metadataEdit(field: EditableMetadataField, label: string) {
    if (readOnly || (!canEditBookmeta && field !== 'title' && field !== 'authors')) return undefined
    return () => setMetadataField({ field, label })
  }

  const hasCoverImage = Boolean(displayBook.coverKey || displayBook.format === 'epub')
  const [copyingCover, setCopyingCover] = useState(false)
  // A taxonomy-derived hide has no book flag to clear: the toggle below would
  // write hidden=true on top of it, so the control names the cause and stays inert.
  const hiddenCause = getHiddenCause(displayBook, 'shelf')

  async function handleCopyCover() {
    if (copyingCover) return
    setCopyingCover(true)
    try {
      await copyCover(book.id)
      notify.success(_('library.coverCopied'))
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'library.copyCoverFailed'))
    } finally {
      setCopyingCover(false)
    }
  }

  async function handleDownloadCover() {
    try {
      await downloadCover(book.id, book.title)
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'errors.downloadFailed'))
    }
  }

  async function toggleHidden() {
    try {
      const result = await apiPatch<{ undo?: UndoReceipt }>(`/books/${book.id}`, { hidden: !displayBook.hidden })
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      notify.success({ key: 'toast.bookUpdated' }, { undo: result.undo })
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'toast.updateBookFailed'))
    }
  }

  function goToFilter(search: { shelf?: string; category?: string; tag?: string; author?: string; series?: string; status?: ReadStatus }) {
    onClose()
    const taxonomy = search.category !== undefined || search.tag !== undefined
      ? { shelf: undefined, category: search.category, tag: search.tag }
      : {}
    void navigate({ to: '/', search: { ...taxonomy, ...search } })
  }

  const hasProgress = displayBook.progress != null && displayBook.progress > 0
  const hasReadingState = hasProgress || Boolean(displayBook.lastReadAt)
  const rawIdentifier = bookmeta?.isbn || bookmeta?.identifier || ''
  const isIsbn = Boolean(bookmeta?.isbn)

  const metaRows: MetaRow[] = []
  const groupDigits = (n: number): string => new Intl.NumberFormat(i18n.language).format(n)
  if (bookmeta?.series) {
    metaRows.push({
      label: _('library.seriesSection'),
      value: bookmeta.seriesIndex != null ? `${bookmeta.series} #${bookmeta.seriesIndex}` : bookmeta.series,
      onClick: () => goToFilter({ series: bookmeta.series }),
      onEdit: metadataEdit('series', _('library.seriesSection')),
    })
  }
  if (bookmeta?.publisher) metaRows.push({ label: _('library.publisher'), value: bookmeta.publisher, onEdit: metadataEdit('publisher', _('library.publisher')) })
  if (bookmeta?.published) metaRows.push({ label: _('library.published'), value: bookmeta.published, onEdit: metadataEdit('published', _('library.published')) })
  if (bookmeta?.language) {
    metaRows.push({ label: _('library.language'), value: formatLanguage(bookmeta.language, i18n.language), onEdit: metadataEdit('language', _('library.language')) })
  }
  if (rawIdentifier && (isIsbn || !isMachineIdentifier(rawIdentifier))) {
    metaRows.push({ label: isIsbn ? 'ISBN' : _('library.identifier'), value: rawIdentifier, copyable: true, hint: _('library.copyValue'), onEdit: isIsbn ? metadataEdit('isbn', 'ISBN') : undefined })
  }
  metaRows.push({ label: _('library.format'), value: displayBook.format.toUpperCase() })
  metaRows.push({ label: _('library.sortBy.size'), value: formatBytes(displayBook.size), hint: `${groupDigits(displayBook.size)} B` })
  if (detail?.meta?.wordCount != null) {
    const wordCount = detail.meta.wordCount
    metaRows.push({
      label: _('library.wordCount'),
      value: formatWordCount(wordCount, i18n.language, _),
      hint: _('library.tocRuleWords', { count: groupDigits(wordCount) }),
    })
  }
  metaRows.push({ label: _('library.addedAt'), value: formatDate(displayBook.createdAt), hint: formatDateTime(displayBook.createdAt) })
  if (displayBook.updatedAt !== displayBook.createdAt) {
    metaRows.push({ label: _('library.updatedAt'), value: formatDate(displayBook.updatedAt), hint: formatDateTime(displayBook.updatedAt) })
  }
  if (bookmeta?.subjects?.length) {
    metaRows.push({ label: _('library.subjects'), value: bookmeta.subjects.join('、'), expandable: true, onEdit: metadataEdit('subjects', _('library.subjects')) })
  }
  if (detail?.meta?.fileName) {
    metaRows.push({ label: _('library.originalFile'), value: detail.meta.fileName, copyable: true, expandable: true, hint: _('library.copyFullFileName') })
  }

  const ratingSlot = reviewContext?.summary && reviewContext.summary.count > 0 ? (
    <button
      type="button"
      onClick={onOpenAllReviews}
      className="group flex flex-col items-end text-right transition-opacity hover:opacity-80"
    >
      <div className="flex items-center gap-1.5 text-amber-500">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <span className="text-2xl font-bold tabular-nums text-stone-900 dark:text-stone-100">
          {reviewContext.summary.average!.toFixed(1)}
        </span>
      </div>
      <span className="text-xs tabular-nums text-stone-400 dark:text-stone-500">
        {_('review.ratingCount', { count: reviewContext.summary.count })}
      </span>
    </button>
  ) : null

  return (
    <div>
      <DetailHeader
        rating={ratingSlot}
        cover={readOnly ? <BookCover book={displayBook} coverPaletteId={detail?.meta?.coverPaletteId} /> : <DetailCoverEditor key={book.id} book={displayBook} coverPaletteId={detail?.meta?.coverPaletteId ?? displayBook.coverPaletteId ?? null} active={coverEditing} onActiveChange={setCoverEditing} />}
        coverEditing={!readOnly && coverEditing}
        hasCoverImage={hasCoverImage}
        copyingCover={copyingCover}
        onCopyCover={() => void handleCopyCover()}
        onDownloadCover={() => void handleDownloadCover()}
        title={displayBook.title}
        authors={displayBook.authors ?? []}
        author={displayBook.author}
        onAuthorClick={(name) => goToFilter({ author: name })}
        onEditTitle={metadataEdit('title', _('library.sortBy.title'))}
        onEditAuthors={metadataEdit('authors', _('library.sortBy.author'))}
        chips={(
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <ReadStatusChip book={displayBook} readOnly={readOnly} onFilter={() => goToFilter({ status: displayBook.readStatus })} />
            {displayBook.source && (
              // 7.7: where a collected card came from. A deleted source keeps
              // its id, so the chip degrades to "unavailable" instead of
              // pretending the book was uploaded here.
              <span
                className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-stone-200/80 bg-stone-50/80 px-2 py-0.5 text-xs font-medium text-stone-600 dark:border-stone-700/80 dark:bg-stone-800/80 dark:text-stone-300"
                title={displayBook.source.libraryName ? _('library.fromLibrary', { name: displayBook.source.libraryName }) : _('library.sourceUnavailable')}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400 dark:text-stone-500" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="18" rx="1" />
                  <rect x="14" y="3" width="7" height="18" rx="1" />
                </svg>
                <span className="truncate max-w-[12rem]">
                  {displayBook.source.libraryName || _('library.sourceUnavailable')}
                </span>
              </span>
            )}
            {categoryName && displayBook.categoryId !== undefined && (
              <FilterChip icon={<TaxonomyIcon kind="category" size={13} className="text-stone-400" />} label={categoryName} onClick={() => goToFilter({ category: displayBook.categoryId ?? 'none' })} />
            )}
            {memberTags.map((tag) => (
              <FilterChip key={tag.id} prefix="#" label={tag.name} onClick={() => goToFilter({ tag: tag.id })} />
            ))}
          </div>
        )}
        reading={hasReadingState && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-stone-500 dark:text-stone-400">
              <span className="tabular-nums font-medium text-stone-600 dark:text-stone-300">
                {Math.round(displayBook.progress ?? 0)}%
              </span>
              {displayBook.lastReadAt ? (
                <span className="text-[11px] text-stone-400 dark:text-stone-500" title={formatDateTime(displayBook.lastReadAt)}>
                  {formatRelativeTime(_, displayBook.lastReadAt)}
                </span>
              ) : null}
            </div>
            <div
              role="progressbar"
              aria-label={_('library.readingProgress')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(displayBook.progress ?? 0)}
              className="h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700"
            >
              <div
                className="h-full rounded-full bg-stone-700 dark:bg-stone-400"
                style={{ width: `${displayBook.progress ?? 0}%` }}
              />
            </div>
          </div>
        )}
        actions={(
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {displayBook.hasUnreadUpdate && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-50/80 px-2.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                title={_('library.unreadUpdateHint')}
              >
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-blue-500 dark:bg-blue-400" />
                <span>{_('library.unreadUpdate')}</span>
              </span>
            )}

            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => {
                onClose()
                void navigate({ to: '/books/$id', params: { id: book.id } })
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              {hasProgress ? _('library.continueReading') : _('library.startReading')}
            </Button>
            <div className="flex flex-1 items-center gap-1.5">
              {/* Action order: edit, download, review, reading data, visibility, more, delete. */}
              {!readOnly && (
                <ActionIcon secondary label={_('library.edit')} onClick={onEdit}>
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </ActionIcon>
              )}
              {!readOnly && (
                <DownloadMenu bookId={book.id} title={displayBook.title} format={displayBook.format} />
              )}
              {canReview && (
                <ActionIcon
                  secondary
                  label={_('review.reviewsTitle')}
                  onClick={openReviewAction}
                >
                  {reviewIconPaths}
                </ActionIcon>
              )}
              {onOpenReadingData && (
                <ActionIcon secondary label={_('readingData.data')} onClick={onOpenReadingData}>
                  <path d="M4 19V9m8 10V4m8 15v-7" />
                </ActionIcon>
              )}
              {!readOnly && hiddenCause && (
                <ActionIcon
                  secondary
                  label={_(hiddenCause.shortKey)}
                  title={_(hiddenCause.hintKey, hiddenCause.hintParams)}
                  disabled
                >
                  <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                  <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                  <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                  <line x1="2" x2="22" y1="2" y2="22" />
                </ActionIcon>
              )}
              {!readOnly && !hiddenCause && (
                <ActionIcon
                  secondary
                  label={displayBook.hidden ? _('library.privateHiddenAction') : _('library.privateVisibleAction')}
                  onClick={() => void toggleHidden()}
                >
                  {displayBook.hidden ? (
                    <>
                      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                      <line x1="2" x2="22" y1="2" y2="22" />
                    </>
                  ) : (
                    <>
                      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  )}
                </ActionIcon>
              )}
              {!readOnly && overflowItems.length > 0 && (
                <MoreActionsMenu items={overflowItems} />
              )}
              {!readOnly && <div className="ml-auto">
                <ActionIcon label={displayBook.source ? _('library.removeFromLibrary') : _('library.delete')} danger onClick={() => onDelete(book)}>
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                </ActionIcon>
              </div>}
            </div>
          </div>
        )}
      />

      {bookmeta?.description && (
        <section className="mt-5" onContextMenu={canEditBookmeta ? (event) => { event.preventDefault(); event.stopPropagation(); setMetadataField({ field: 'description', label: _('library.descriptionSection') }) } : undefined}>
          <GroupLabel>{_('library.descriptionSection')}</GroupLabel>
          <p className="max-h-40 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] pr-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-600 dark:text-stone-300">
            {bookmeta.description}
          </p>
        </section>
      )}

      <MetaGrid rows={metaRows} isLoading={isLoading} />

      <ReviewPreviewSection
        context={reviewContext}
        canReview={canReview}
        onCompose={() => setReviewEditorOpen(true)}
        onViewAll={() => onOpenAllReviews?.()}
        onOpenReview={onOpenReviewDetail}
      />

      {reviewEditorOpen && reviewComposer?.bookVersionId && (
        <ReviewEditor
          bookVersionId={reviewComposer.bookVersionId}
          existing={ownReview ?? null}
          composer={reviewComposer}
          onClose={() => setReviewEditorOpen(false)}
          onSaved={() => {
            void reviewQuery.refetch()
          }}
        />
      )}

      {metadataField && !readOnly && (canEditBookmeta || metadataField.field === 'title' || metadataField.field === 'authors') && (
        <MetadataFieldDialog key={`${book.id}:${metadataField.field}`} book={displayBook} bookmeta={bookmeta} field={metadataField.field} label={metadataField.label} onClose={() => setMetadataField(null)} />
      )}

      {forkConfirmOpen && (
        <ConfirmDialog
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="6" r="3" />
              <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9" />
              <path d="M12 12v3" />
            </svg>
          }
          title={_('library.forkLocalTitle')}
          message={_('library.forkLocalConfirm')}
          warning={_('library.forkLocalWarning')}
          confirmLabel={_('library.forkLocalConfirmBtn')}
          confirmVariant="primary"
          confirmDisabled={forkBook.isPending}
          onConfirm={() => forkBook.mutate({ bookId: book.id }, {
            onSuccess: () => {
              notify.success(_('library.forkLocalSuccess'))
              void queryClient.invalidateQueries({ queryKey: ['books'] })
              setForkConfirmOpen(false)
              onClose()
            },
            onError: (err) => {
              notify.error(getUserErrorNotification(err, 'library.forkLocalFailed'))
              setForkConfirmOpen(false)
            },
          })}
          onClose={() => setForkConfirmOpen(false)}
        />
      )}
    </div>
  )
}

