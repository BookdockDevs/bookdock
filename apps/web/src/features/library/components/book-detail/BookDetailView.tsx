import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import type { ClientLibraryDetailView, ClientLibraryBookView, ReadStatus, Review, UndoReceipt } from '@bookdock/shared'

import { catalogBookTarget, catalogHomeTarget } from '@/features/reading-data/catalog-navigation'
import { isDeviceBook } from '@/features/reading-data/book-source'
import { warmReaderEntry } from '@/features/reading-data/reader-entry-prefetch'
import { useLocalCatalog } from '@/features/reading-data/catalog-source-context'
import { clientScopeKey } from '@bookdock/shared'
import { apiPatch, apiPut } from '@/api/client'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import { copyCover, downloadCover } from '../../download'
import { invalidateDeviceMembershipQueries, useForkBook, useVaultOperations } from '../../hooks'
import { getHiddenCause } from '../../hidden-status'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import BookCover from '../BookCover'
import CategoryChip from './CategoryChip'
import DetailActions, { type DetailAction } from './DetailActions'
import DetailCoverEditor from './DetailCoverEditor'
import DetailHeader from './DetailHeader'
import DescriptionSection from './DescriptionSection'
import DownloadMenu from './DownloadMenu'
import MetaGrid from './MetaGrid'
import { buildMetaRows } from './meta-rows'
import MetadataFieldDialog from './MetadataFieldDialog'
import type { EditableMetadataField } from './metadata-field'
import type { MoreActionsMenuItem } from './MoreActionsMenu'
import RatingBadge from './RatingBadge'
import ReadStatusChip from './ReadStatusChip'
import ReadingProgress from './ReadingProgress'
import { ActionIcon, FilterChip } from './ui'
import ReviewEditor from '@/features/reviews/components/ReviewEditor'
import ReviewPreviewSection from '@/features/reviews/components/ReviewPreviewSection'
import { useReviewBookContext } from '@/features/reviews/hooks/useReviews'
import { reviewIconPaths } from '@/features/reviews/lib/review-icon'

interface BookDetailViewProps {
  book: ClientLibraryBookView
  readOnly?: boolean
  detail?: ClientLibraryDetailView
  /** The taxonomy this book is filed under; null reads the device catalog's. */
  categoryLibraryId?: string | null
  memberTags: Array<{ id: string; name: string }>
  isLoading?: boolean
  reviewContext?: import('@bookdock/shared').ReviewBookContext | null
  /** Device books persist their review to the vault. */
  saveLocalReview?: (input: import('@/features/reviews/hooks/useReviews').SaveReviewInput) => Promise<void>
  moreActions?: MoreActionsMenuItem[]
  /** Drill into the personal reading data; absent when there is none to show. */
  onOpenReadingData?: () => void
  onOpenAllReviews?: () => void
  onOpenReviewDetail?: (review: Review) => void
  onEdit: () => void
  onDelete: (book: ClientLibraryBookView) => void
  onClose: () => void
  onPublish?: (book: ClientLibraryBookView) => void
}

export default function BookDetailView({
  book,
  readOnly = false,
  detail,
  categoryLibraryId = null,
  memberTags,
  isLoading,
  reviewContext: reviewContextProp,
  saveLocalReview,
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
  const local = useLocalCatalog()
  const vault = useVaultOperations()
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
  const [openingReview, setOpeningReview] = useState(false)
  const signedIn = useAuthStore((state) => Boolean(state.user))
  // Reviews are a server-book feature; the ref decides, even on the unified
  // shelf where no catalog context marks the book as local.
  const isLocalBook = isDeviceBook(book?.ref)
  const reviewQuery = useReviewBookContext(local || reviewContextProp !== undefined || isLocalBook ? null : (book?.id ?? null))
  const reviewContext = reviewContextProp !== undefined ? reviewContextProp : reviewQuery.data?.data
  const reviewComposer = reviewContext?.composer
  // A device book's review never leaves the browser, so holding an account is
  // not what makes it writable: the book's own source does.
  const canReview = Boolean(reviewComposer?.eligible && reviewComposer.bookVersionId) && (isLocalBook || signedIn)
  const ownReview = reviewContext?.own

  // The review glyph carries no state: it opens the caller's own review when
  // there is one and the composer when there is not.
  async function openReviewAction() {
    setOpeningReview(true)
    try {
      const context = reviewContext ?? (await reviewQuery.refetch()).data?.data
      if (!context?.composer?.eligible || !context.composer.bookVersionId) {
        notify.error(_('errors.loadFailed'))
      } else if (context.own) {
        onOpenReviewDetail?.(context.own)
      } else {
        setReviewEditorOpen(true)
      }
    } catch (error) {
      notify.error(getUserErrorNotification(error, 'errors.loadFailed'))
    } finally {
      setOpeningReview(false)
    }
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
      await copyCover(book.id, book.ref)
      notify.success(_('library.coverCopied'))
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'library.copyCoverFailed'))
    } finally {
      setCopyingCover(false)
    }
  }

  async function handleDownloadCover() {
    try {
      await downloadCover(book.id, book.title, book.ref)
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'errors.downloadFailed'))
    }
  }

  async function toggleHidden() {
    try {
      if (isLocalBook) {
        if (displayBook.clientVersion === undefined) throw new Error('The displayed local book version is required')
        const targetRef = book.ref!
        await vault.update(targetRef, { catalog: { hidden: !displayBook.hidden } }, displayBook.clientVersion)
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(targetRef.scope)] })
        if (!local) invalidateDeviceMembershipQueries(queryClient)
        notify.success({ key: 'toast.bookUpdated' })
        return
      }
      const result = await apiPatch<{ undo?: UndoReceipt }>(`/books/${book.id}`, { hidden: !displayBook.hidden })
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      notify.success({ key: 'toast.bookUpdated' }, { undo: result.undo })
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'toast.updateBookFailed'))
    }
  }

  // Filing a book is its own small write: the edit form batches it with the
  // rest of the record, but a right-click on the chip carries nothing else.
  async function changeCategory(categoryId: string | null) {
    try {
      let undo: UndoReceipt | undefined
      if (isLocalBook) {
        if (displayBook.clientVersion === undefined) throw new Error('The displayed local book version is required')
        const targetRef = book.ref!
        await vault.update(targetRef, { catalog: { categoryId } }, displayBook.clientVersion)
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(targetRef.scope)] })
        if (!local) invalidateDeviceMembershipQueries(queryClient)
      } else {
        const result = await apiPut<{ undo?: UndoReceipt }>(`/books/${book.id}/organization`, { categoryId })
        undo = result.undo
        void queryClient.invalidateQueries({ queryKey: ['books'] })
        void queryClient.invalidateQueries({ queryKey: ['book', book.id] })
      }
      notify.success({ key: 'toast.bookUpdated' }, { undo })
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'toast.updateBookFailed'))
    }
  }

  function goToFilter(search: { shelf?: string; category?: string; tag?: string; author?: string; series?: string; status?: ReadStatus }) {
    onClose()
    const taxonomy = search.category !== undefined || search.tag !== undefined
      ? { shelf: undefined, category: search.category, tag: search.tag }
      : {}
    void navigate({ ...catalogHomeTarget(), search: { ...taxonomy, ...search } })
  }

  const hasProgress = displayBook.progress != null && displayBook.progress > 0

  const metaRows = buildMetaRows(
    {
      bookmeta,
      format: displayBook.format,
      size: displayBook.size,
      wordCount: detail?.meta?.wordCount,
      createdAt: displayBook.createdAt,
      updatedAt: displayBook.updatedAt,
      fileName: detail?.meta?.fileName,
    },
    {
      t: _,
      onFilterSeries: (series) => goToFilter({ series }),
      onEdit: metadataEdit,
    },
  )

  // Action order: edit, download, review, reading data, visibility, more, delete.
  const actions: DetailAction[] = []
  if (!readOnly) {
    actions.push({
      key: 'edit',
      label: _('library.edit'),
      onClick: onEdit,
      icon: (
        <>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </>
      ),
    })
    actions.push({
      key: 'download',
      label: _('library.download'),
      node: <DownloadMenu bookId={book.id} bookRef={book.ref} title={displayBook.title} format={displayBook.format} />,
    })
  }
  if (signedIn || isLocalBook) {
    actions.push({
      key: 'review',
      label: _('review.reviewsTitle'),
      fold: true,
      disabled: openingReview,
      className: openingReview ? 'animate-pulse' : undefined,
      title: openingReview ? _('reader.loading') : undefined,
      onClick: () => void openReviewAction(),
      icon: reviewIconPaths,
    })
  }
  if (onOpenReadingData) {
    actions.push({
      key: 'reading-data',
      label: _('readingData.data'),
      fold: true,
      onClick: onOpenReadingData,
      icon: <path d="M4 19V9m8 10V4m8 15v-7" />,
    })
  }
  if (!readOnly) {
    // A taxonomy-derived hide has no book flag to clear, so the toggle stays
    // inert and the tooltip names the cause.
    actions.push({
      key: 'visibility',
      label: hiddenCause
        ? _(hiddenCause.shortKey)
        : displayBook.hidden ? _('library.show') : _('library.hide'),
      fold: true,
      title: hiddenCause ? _(hiddenCause.hintKey, hiddenCause.hintParams) : undefined,
      disabled: Boolean(hiddenCause),
      onClick: hiddenCause ? undefined : () => void toggleHidden(),
      icon: displayBook.hidden || hiddenCause ? (
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
      ),
    })
  }

  return (
    <div>
      <DetailHeader
        rating={<RatingBadge summary={reviewContext?.summary} onClick={onOpenAllReviews} />}
        cover={readOnly ? <BookCover book={displayBook} coverPaletteId={detail?.meta?.coverPaletteId} spine={false} /> : <DetailCoverEditor key={book.id} book={displayBook} coverPaletteId={detail?.meta?.coverPaletteId ?? displayBook.coverPaletteId ?? null} active={coverEditing} onActiveChange={setCoverEditing} />}
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
            {displayBook.categoryId !== undefined && (
              <CategoryChip
                libraryId={categoryLibraryId}
                categoryId={displayBook.categoryId}
                fallbackLabel={displayBook.categoryName ?? undefined}
                editable={!readOnly}
                onFilter={() => goToFilter({ category: displayBook.categoryId ?? 'none' })}
                onChange={(value) => void changeCategory(value.categoryId ?? null)}
              />
            )}
            {memberTags.map((tag) => (
              <FilterChip key={tag.id} prefix="#" label={tag.name} onClick={() => goToFilter({ tag: tag.id })} />
            ))}
          </div>
        )}
        reading={<ReadingProgress progress={displayBook.progress} lastReadAt={displayBook.lastReadAt} />}
        actions={(
          <DetailActions
            leading={displayBook.hasUnreadUpdate && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-blue-50/80 px-2.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
                title={_('library.unreadUpdateHint')}
              >
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-blue-500 dark:bg-blue-400" />
                <span>{_('library.unreadUpdate')}</span>
              </span>
            )}
            primary={{
              label: hasProgress ? _('library.continueReading') : _('library.startReading'),
              onPointerEnter: () => warmReaderEntry(queryClient, { bookId: book.id, isLocal: isDeviceBook(book.ref), prefetch: false }),
              onClick: () => {
                onClose()
                warmReaderEntry(queryClient, { bookId: book.id, isLocal: isDeviceBook(book.ref) })
                void navigate({ ...catalogBookTarget(book) })
              },
            }}
            actions={actions}
            overflow={readOnly ? [] : overflowItems}
            trailing={!readOnly ? (
              <ActionIcon label={displayBook.source ? _('library.removeFromLibrary') : _('library.delete')} danger onClick={() => onDelete(book)}>
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
              </ActionIcon>
            ) : undefined}
          />
        )}
      />

      {bookmeta?.description && (
        <DescriptionSection
          text={bookmeta.description}
          onEdit={canEditBookmeta
            ? () => setMetadataField({ field: 'description', label: _('library.descriptionSection') })
            : undefined}
        />
      )}

      <MetaGrid rows={metaRows} isLoading={isLoading} tight={Boolean(bookmeta?.description)} />

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
          saveLocal={saveLocalReview}
          onClose={() => setReviewEditorOpen(false)}
          onSaved={() => {
            // The vault mutation already invalidates its own query; probing a
            // server review endpoint for a device book would be the leak.
            if (!isLocalBook) void reviewQuery.refetch()
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

