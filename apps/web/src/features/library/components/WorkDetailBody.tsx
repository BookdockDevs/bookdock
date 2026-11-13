import { useState } from 'react'

import { useNavigate } from '@tanstack/react-router'

import type { CatalogBook, Library, Review } from '@bookdock/shared'

import { ApiError } from '@/api/client'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useWarmReaderEntry } from '@/features/reading-data/reader-entry-prefetch'
import ReviewEditor from '@/features/reviews/components/ReviewEditor'
import ReviewPreviewSection from '@/features/reviews/components/ReviewPreviewSection'
import { useReviewWorkContext } from '@/features/reviews/hooks/useReviews'
import { reviewIconPaths } from '@/features/reviews/lib/review-icon'
import { useTranslation } from '@/hooks/useTranslation'
import { useAuthStore } from '@/stores/auth.store'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import { catalogWorkRow, rowCover, versionOrdinal, versionTabLabel } from '../book-row'
import { copyCover, downloadCover } from '../download'
import { useBook, useCollectBook, useUpdateCatalogBook, useUpdateCatalogVersion } from '../hooks'
import { getHiddenCause } from '../hidden-status'
import BookCover from './BookCover'
import DetailActions, { type DetailAction } from './book-detail/DetailActions'
import CategoryChip from './book-detail/CategoryChip'
import DetailHeader from './book-detail/DetailHeader'
import DetailCoverEditor from './book-detail/DetailCoverEditor'
import DescriptionSection from './book-detail/DescriptionSection'
import MetadataFieldDialog from './book-detail/MetadataFieldDialog'
import type { EditableMetadataField } from './book-detail/metadata-field'
import DownloadMenu from './book-detail/DownloadMenu'
import MetaGrid from './book-detail/MetaGrid'
import { buildMetaRows } from './book-detail/meta-rows'
import type { MoreActionsMenuItem } from './book-detail/MoreActionsMenu'
import RatingBadge from './book-detail/RatingBadge'
import ReadingProgress from './book-detail/ReadingProgress'
import { ActionIcon, FilterChip } from './book-detail/ui'
import DeleteVersionsDialog from './DeleteVersionsDialog'
import WorkEditDialog from './WorkEditDialog'
import CatalogUploadSheet from './CatalogUploadSheet'

/**
 * What a work in a shared library knows about itself, told the way a private
 * book's detail tells it: artwork, title, author, actions, description, facts.
 * What a work cannot have - read status, progress, shelf, personal metadata -
 * is absent rather than stubbed. Which version is on screen is picked from the
 * dialog title bar, so the body only ever describes the version it is given.
 */
export default function WorkDetailBody({
  work, library, canManage, canCollect, canContribute = false, onClose,
  selectedVersionId, onVersionsUploaded, moreActions,
  onOpenReadingData,
  onOpenAllReviews,
  onOpenReviewDetail,
}: {
  work: CatalogBook
  library: Library
  canManage: boolean
  canCollect: boolean
  /** Member upload lane: the library opened member uploads. Server still refuses non-owners. */
  canContribute?: boolean
  /**
   * Which version is on screen is owned by the dialog, not here: the header
   * picker, the overflow menu and the actions all read that same id, so they
   * cannot disagree about it.
   */
  selectedVersionId: string | null
  onVersionsUploaded: (versionLinkIds: string[]) => void
  moreActions?: MoreActionsMenuItem[]
  /** Drill into the personal reading data; absent when there is none to show. */
  onOpenReadingData?: () => void
  onOpenAllReviews?: () => void
  onOpenReviewDetail?: (review: Review) => void
  onClose: () => void
}) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const warmReader = useWarmReaderEntry()
  const row = catalogWorkRow(work)
  // The visible version drives everything below: header, actions and manager
  // operations all read the selection, never a hardcoded first row.
  const selected = work.versions.find((v) => v.id === selectedVersionId) ?? work.versions[0]
  const bookDetailQuery = useBook(selected?.bookVersionId ?? null)
  const bookDetail = bookDetailQuery.data?.data
  const progress = bookDetail?.progress
  const lastReadAt = bookDetail?.lastReadAt
  const hasProgress = progress != null && progress > 0

  const collect = useCollectBook()
  const updateVersion = useUpdateCatalogVersion()
  const updateWork = useUpdateCatalogBook()
  const [collectedIds, setCollectedIds] = useState<Record<string, boolean>>({})
  // Collected and owns-source share one disabled state: both mean the private
  // library already holds this content, one as a B card and one as its source.
  const alreadyJoined = selected ? (collectedIds[selected.id] || selected.collected === true || selected.ownsSource === true) : false
  const [copyingCover, setCopyingCover] = useState(false)
  const [confirmUnlist, setConfirmUnlist] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [metadataField, setMetadataField] = useState<{ field: EditableMetadataField; label: string; versionId: string } | null>(null)
  const [coverEditingId, setCoverEditingId] = useState<string | null>(null)
  const coverEditing = coverEditingId === selected?.id
  const [reviewEditorOpen, setReviewEditorOpen] = useState(false)
  const [openingReview, setOpeningReview] = useState(false)
  const signedIn = useAuthStore((state) => Boolean(state.user))
  const reviewQuery = useReviewWorkContext(library.id, work.id)
  const reviewContext = reviewQuery.data?.data
  const reviewComposer = reviewContext?.composer
  const canReview = Boolean(reviewComposer?.eligible && reviewComposer.bookVersionId)
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
  function metadataEdit(field: EditableMetadataField, label: string) {
    if (!canManage || !selected) return undefined
    return () => setMetadataField({ field, label, versionId: selected.id })
  }
  const [uploadOpen, setUploadOpen] = useState(false)

  // Uploading a version is a once-per-version job, so it waits in the overflow
  // menu instead of taking a slot beside edit and download.
  const overflowItems: MoreActionsMenuItem[] = [
    ...((canManage || canContribute)
      ? [{
          key: 'upload-version',
          label: _('library.uploadNewVersion'),
          icon: (
            <>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="12" y1="18" x2="12" y2="12" />
              <line x1="9" y1="15" x2="15" y2="15" />
            </>
          ),
          onSelect: () => setUploadOpen(true),
        }]
      : []),
    ...(moreActions ?? []),
  ]

  const hasCoverImage = Boolean(selected?.effective.coverKey || selected?.format === 'epub')
  // The two hides resolve independently (see the Hidden boundary in
  // architecture.md), so the dialog must not collapse them into one flag: the
  // list badges a work the dialog called visible when it keyed off `work.hidden`
  // alone, because a category- or tag-derived hide never sets that flag.
  const workHidden = work.hidden || work.effectiveHidden === true
  // A taxonomy-derived hide has no work flag to clear, so the control is
  // read-only: offering an action here would write the version layer instead.
  // The cause names the exact layer (category or tag) for the tooltip.
  const hiddenCause = getHiddenCause(work, 'category')
  const singleVersion = work.versions.length === 1
  const versionHidden = selected?.status === 'unlisted'
  const selectedHidden = versionHidden || (singleVersion && workHidden)
  // Hidden is a listing switch for ordinary readers; managers keep reading,
  // downloading and editing the work as if it were merely delisted.
  const readable = Boolean(selected) && (canManage || !selectedHidden)
  const canDownload = canCollect && readable && Boolean(selected)

  function goToFilter(search: { author?: string; tag?: string; series?: string; category?: string; categoryScope?: 'direct' | 'subtree' }) {
    onClose()
    void navigate({ to: '/', search: { libraryId: library.id, ...(search.category !== undefined ? { category: search.category, shelf: undefined, tag: undefined } : {}), ...(search.tag !== undefined ? { tag: search.tag, shelf: undefined, category: undefined, categoryScope: undefined } : {}), ...search } })
  }

  function readSelected() {
    if (!selected) return
    onClose()
    warmReader({ bookId: selected.bookVersionId, isLocal: false })
    void navigate({ to: '/books/$id', params: { id: selected.bookVersionId } })
  }

  async function handleCopyCover() {
    if (!selected || copyingCover) return
    setCopyingCover(true)
    try {
      await copyCover(selected.bookVersionId)
      notify.success(_('library.coverCopied'))
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'library.copyCoverFailed'))
    } finally {
      setCopyingCover(false)
    }
  }

  async function handleDownloadCover() {
    if (!selected) return
    try {
      await downloadCover(selected.bookVersionId, selected.effective.title)
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'errors.downloadFailed'))
    }
  }

  // A one-version work is the work, so its two layers must end up agreeing.
  // Hiding only needs the work flag; showing has to clear whichever layer is
  // still hiding it - the lone version's status and/or the work flag - or the
  // button says "show" and leaves the work hidden.
  async function showOneVersionWork() {
    if (!selected) return
    try {
      if (versionHidden) {
        await updateVersion.mutateAsync({
          libraryId: library.id,
          libraryBookId: work.id,
          versionLinkId: selected.id,
          patch: { status: 'published' },
        })
      }
      if (workHidden) {
        await updateWork.mutateAsync({ libraryId: library.id, libraryBookId: work.id, patch: { hidden: false } })
      }
      notify.success({ key: 'library.catalogWorkShown' })
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'library.catalogVisibilityFailed'))
    }
  }

  function togglePublish() {
    if (!selected) return
    if (singleVersion && !hiddenCause) {
      if (selectedHidden) {
        void showOneVersionWork()
        return
      }
      updateWork.mutate({
        libraryId: library.id,
        libraryBookId: work.id,
        patch: { hidden: true },
      }, {
        onSuccess: () => notify.success({ key: 'library.catalogWorkHidden' }),
        onError: (err) => notify.error(getUserErrorNotification(err, 'library.catalogVisibilityFailed')),
      })
      return
    }
    // Unlisting the last published version breaks every collected B at once:
    // confirm that case, republishing stays one click.
    if (!selectedHidden
      && !work.versions.some((v) => v.id !== selected.id && v.status === 'published')) {
      setConfirmUnlist(true)
      return
    }
    const publishing = versionHidden
    updateVersion.mutate({
      libraryId: library.id,
      libraryBookId: work.id,
      versionLinkId: selected.id,
      patch: { status: publishing ? 'published' : 'unlisted' },
    }, {
      onSuccess: () => notify.success({ key: publishing ? 'library.catalogVersionShown' : 'library.catalogVersionHidden' }),
      onError: (err) => notify.error(getUserErrorNotification(err, 'library.catalogVisibilityFailed')),
    })
  }

  function runConfirmedUnlist() {
    if (!selected) return
    setConfirmUnlist(false)
    // The confirm dialog only opens on the version layer, so it can only ever
    // write a version; a one-version work never reaches it.
    updateVersion.mutate({
      libraryId: library.id,
      libraryBookId: work.id,
      versionLinkId: selected.id,
      patch: { status: 'unlisted' },
    }, {
      onSuccess: () => notify.success({ key: 'library.catalogVersionHidden' }),
      onError: (err) => notify.error(getUserErrorNotification(err, 'library.catalogVisibilityFailed')),
    })
  }

  // Filing a work is its own small write: the edit dialog batches it with the
  // rest of the record, but a right-click on the chip carries nothing else.
  async function changeCategory(categoryId: string | null) {
    try {
      await updateWork.mutateAsync({ libraryId: library.id, libraryBookId: work.id, patch: { categoryId } })
      notify.success({ key: 'toast.bookUpdated' })
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'library.catalogWorkSaveFailed'))
    }
  }

  function collectSelected() {
    if (!selected) return
    collect.mutate({ libraryId: library.id, versionLinkId: selected.id }, {
      onSuccess: (res) => {
        setCollectedIds((prev) => ({ ...prev, [selected.id]: true }))
        notify[res.data.alreadyExists ? 'info' : 'success'](
          res.data.alreadyExists ? _('library.collectAlready') : _('library.collectSuccess'),
        )
      },
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'ALREADY_OWNS_SOURCE') {
          notify.info(_('library.collectAlready'))
        } else {
          notify.error(getUserErrorNotification(err, 'library.collectFailed'))
        }
      },
    })
  }

  const metaRows = buildMetaRows(
    {
      bookmeta: selected?.effective.bookmeta,
      format: selected?.format ?? '',
      size: selected?.size ?? null,
      wordCount: selected?.wordCount ?? null,
      createdAt: selected?.createdAt ?? 0,
      updatedAt: selected?.updatedAt ?? 0,
      fileName: selected?.effective.fileName,
    },
    {
      t: _,
      onFilterSeries: (series) => goToFilter({ series }),
      onEdit: metadataEdit,
    },
  )

  if (!selected) return null

  // Cover and palette follow the visible version, the same rule the work row
  // uses for artwork: a stored cover or an EPUB that can carry an embedded one.
  const selectedMayHaveArtwork = Boolean(selected.effective.coverKey) || selected.format === 'epub'
  const selectedRow = {
    ...row,
    id: selected.bookVersionId,
    coverKey: selected.effective.coverKey,
    title: selected.effective.title,
    format: selected.format,
    coverSrc: selectedMayHaveArtwork ? `/api/v1/books/${selected.bookVersionId}/cover?size=thumb&v=${encodeURIComponent(selected.effective.coverKey ?? 'auto')}` : null,
    coverPaletteKey: selected.effective.coverPaletteKey ?? selected.bookVersionId,
    size: selected.size,
  }

  const actions: DetailAction[] = []
  // Action order: collect, edit, download, review, reading data, visibility, more, delete.
  if (canCollect) {
    actions.push({
      key: 'collect',
      label: alreadyJoined ? _('library.collected') : _('library.collect'),
      disabled: alreadyJoined || collect.isPending,
      onClick: alreadyJoined ? undefined : collectSelected,
      icon: (
        <>
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          {alreadyJoined ? (
            <polyline points="9 11 11 13 15 9" />
          ) : (
            <>
              <line x1="12" y1="7" x2="12" y2="13" />
              <line x1="9" y1="10" x2="15" y2="10" />
            </>
          )}
        </>
      ),
    })
  }
  if (canManage) {
    actions.push({
      key: 'edit',
      label: _('library.edit'),
      onClick: () => setEditOpen(true),
      icon: (
        <>
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </>
      ),
    })
  }
  if (canDownload) {
    actions.push({
      key: 'download',
      label: _('library.download'),
      node: (
        <DownloadMenu
          bookId={selected.bookVersionId}
          title={selected.effective.title}
          format={selected.format}
          versionLabel={versionTabLabel(selected.name, _('library.versionFallback', { n: versionOrdinal(work.versions, selected.id) }))}
        />
      ),
    })
  }
  if (signedIn) {
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
  if (canManage) {
    // A taxonomy-derived hide has no work flag to clear, so the control is
    // read-only: offering an action here would write the version layer instead.
    // The cause names the exact layer (category or tag) for the tooltip.
    // A one-version work reads its control as a work-level switch, so it says
    // "work"; only a many-version work hides a version the reader could pick.
    const visibilityLabel = selectedHidden
      ? _(singleVersion ? 'library.catalogShowWork' : 'library.versionShowAction')
      : _(singleVersion ? 'library.catalogHideWork' : 'library.versionHideAction')
    actions.push({
      key: 'visibility',
      label: hiddenCause ? _(hiddenCause.shortKey) : visibilityLabel,
      fold: true,
      title: hiddenCause ? _(hiddenCause.hintKey, hiddenCause.hintParams) : undefined,
      disabled: hiddenCause ? true : updateVersion.isPending || updateWork.isPending,
      onClick: hiddenCause ? undefined : togglePublish,
      icon: hiddenCause || selectedHidden ? (
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
        cover={canManage ? <DetailCoverEditor key={selected.id} book={rowCover(selectedRow)} coverPaletteId={null} active={coverEditing} onActiveChange={(active) => setCoverEditingId(active ? selected.id : null)} catalog={{ libraryId: library.id, libraryBookId: work.id, versionLinkId: selected.id, hasVersionCover: Boolean(selected.coverKey) }} /> : <BookCover book={rowCover(selectedRow)} coverSrc={selectedRow.coverSrc} spine={false} />}
        coverEditing={coverEditing}
        hasCoverImage={hasCoverImage}
        copyingCover={copyingCover}
        onCopyCover={() => void handleCopyCover()}
        onDownloadCover={() => void handleDownloadCover()}
        title={selected.effective.title}
        authors={selected.effective.authors ?? []}
        author={selected.effective.author}
        onAuthorClick={(name) => goToFilter({ author: name })}
        onEditTitle={metadataEdit('title', _('library.sortBy.title'))}
        onEditAuthors={metadataEdit('authors', _('library.sortBy.author'))}
        chips={(
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <CategoryChip
              libraryId={library.id}
              categoryId={work.categoryId ?? null}
              editable={canManage}
              onFilter={() => goToFilter({ category: work.categoryId ?? 'none', categoryScope: work.categoryId ? 'subtree' : 'direct' })}
              onChange={(value) => void changeCategory(value.categoryId ?? null)}
            />
            {work.tags.map((tag) => (
              <FilterChip key={tag.id} prefix="#" label={tag.name} onClick={() => goToFilter({ tag: tag.id })} />
            ))}
          </div>
        )}
        reading={<ReadingProgress progress={progress} lastReadAt={lastReadAt} />}
        actions={(
          <DetailActions
            primary={{
              label: hasProgress ? _('library.continueReading') : _('library.startReading'),
              onClick: readSelected,
              disabled: !readable,
              title: !readable ? _('library.catalogUnlistedReadHint') : undefined,
              // Hover warms the route only: the row already holds this
              // version's detail, and prefetching it again under the reader's
              // key would fetch the same payload twice.
              onPointerEnter: () => warmReader({ bookId: selected.bookVersionId, isLocal: false, prefetch: false }),
            }}
            actions={actions}
            overflow={overflowItems}
            trailing={(canManage || selected.maintainable) ? (
              <ActionIcon label={_('library.delete')} danger onClick={() => setDeleteOpen(true)}>
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
              </ActionIcon>
            ) : undefined}
          />
        )}
      />

      {selected.effective.description && (
        <DescriptionSection
          text={selected.effective.description}
          onEdit={metadataEdit('description', _('library.descriptionSection'))}
        />
      )}

      <MetaGrid rows={metaRows} tight={Boolean(selected.effective.description)} />

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

      {confirmUnlist && (
        <ConfirmDialog
          title={_('library.catalogUnlist')}
          message={_('library.catalogUnlistLastConfirm')}
          confirmLabel={_('library.catalogUnlist')}
          onClose={() => setConfirmUnlist(false)}
          onConfirm={runConfirmedUnlist}
        />
      )}
      {deleteOpen && (
        <DeleteVersionsDialog
          work={work}
          libraryId={library.id}
          preselectedIds={[selected.id]}
          // A manager needs no scope; a member contributor gets the exact set
          // the server accepts, so their own version opens checked and anyone
          // else's is visible but cannot be picked.
          deletableIds={canManage
            ? undefined
            : new Set(work.versions.filter((v) => v.maintainable).map((v) => v.id))}
          onClose={() => setDeleteOpen(false)}
          onDeleted={(workDeleted) => {
            setDeleteOpen(false)
            if (workDeleted) onClose()
          }}
        />
      )}
      {canManage && metadataField?.versionId === selected.id && (
        <MetadataFieldDialog key={`${selected.id}:${metadataField.field}`} book={{ id: selected.bookVersionId, title: selected.effective.title, author: selected.effective.author, authors: selected.effective.authors }} bookmeta={{ ...selected.effective.bookmeta, description: selected.effective.description }} field={metadataField.field} label={metadataField.label} catalog={{ libraryId: library.id, libraryBookId: work.id, version: selected }} onClose={() => setMetadataField(null)} />
      )}
      {editOpen && (
        <WorkEditDialog
          work={work}
          libraryId={library.id}
          version={selected}
          onClose={() => setEditOpen(false)}
        />
      )}
      {uploadOpen && (
        <CatalogUploadSheet
          open
          libraryId={library.id}
          libraryBookId={work.id}
          workTitle={work.title}
          nextVersionIndex={work.versions.length + 1}
          onUploadedVersion={onVersionsUploaded}
          onClose={() => setUploadOpen(false)}
        />
      )}
    </div>
  )
}

