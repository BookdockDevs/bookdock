import { useState } from 'react'

import { useNavigate } from '@tanstack/react-router'
import i18n from 'i18next'

import type { CatalogBook, Library } from '@bookdock/shared'

import { ApiError } from '@/api/client'
import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { formatBytes, formatDate, formatDateTime } from '@/lib/utils'

import { catalogWorkRow, rowCover, versionOrdinal, versionTabLabel } from '../book-row'
import { copyCover, downloadCover } from '../download'
import { useCollectBook, useUpdateCatalogBook, useUpdateCatalogVersion } from '../hooks'
import { getHiddenCause } from '../hidden-status'
import BookCover from './BookCover'
import DetailHeader from './book-detail/DetailHeader'
import DownloadMenu from './book-detail/DownloadMenu'
import MetaGrid, { type MetaRow } from './book-detail/MetaGrid'
import MoreActionsMenu, { type MoreActionsMenuItem } from './book-detail/MoreActionsMenu'
import { formatLanguage, formatWordCount, isMachineIdentifier } from './book-detail/types'
import { ActionIcon, FilterChip, GroupLabel } from './book-detail/ui'
import DeleteVersionsDialog from './DeleteVersionsDialog'
import VersionTabs from './VersionTabs'
import WorkEditDialog from './WorkEditDialog'
import CatalogUploadSheet from './CatalogUploadSheet'

/**
 * What a work in a shared library knows about itself, told the way a private
 * book's detail tells it: artwork, title, author, actions, description, facts.
 * What a work cannot have - read status, progress, shelf, personal metadata -
 * is absent rather than stubbed. Versions render below only while there is
 * more than one to choose from; a single version is the work, acted on above.
 */
export default function WorkDetailBody({
  work, library, canManage, canCollect, canContribute = false, onClose,
  selectedVersionId, onSelectVersion, onVersionsUploaded, moreActions,
}: {
  work: CatalogBook
  library: Library
  canManage: boolean
  canCollect: boolean
  /** Member upload lane: the library opened member uploads. Server still refuses non-owners. */
  canContribute?: boolean
  /**
   * Which version is on screen is owned by the dialog, not here: the overflow
   * menu offers the content-maintenance actions for that same version, so the
   * two cannot disagree about it.
   */
  selectedVersionId: string | null
  onSelectVersion: (versionLinkId: string) => void
  onVersionsUploaded: (versionLinkIds: string[]) => void
  moreActions?: MoreActionsMenuItem[]
  onClose: () => void
}) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const row = catalogWorkRow(work)
  // The visible version drives everything below: header, actions and manager
  // operations all read the selection, never a hardcoded first row.
  const selected = work.versions.find((v) => v.id === selectedVersionId) ?? work.versions[0]
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
  const [uploadOpen, setUploadOpen] = useState(false)

  const hasCoverImage = Boolean(work.coverKey || selected?.format === 'epub')
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

  function goToFilter(search: { author?: string; tag?: string; series?: string }) {
    onClose()
    void navigate({ to: '/', search: { libraryId: library.id, ...search } })
  }

  function readSelected() {
    if (!selected) return
    onClose()
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

  function togglePublish() {
    if (!selected) return
    // A one-version work has no version-level meaning to toggle: the control
    // reads as a work-level switch, so it must write library_books.hidden.
    // Writing the version here left the work badged as hidden while the button
    // reported it as shown.
    if (singleVersion && !hiddenCause) {
      const showing = workHidden
      updateWork.mutate({
        libraryId: library.id,
        libraryBookId: work.id,
        patch: { hidden: !showing },
      }, {
        onSuccess: () => notify.success(showing ? _('library.catalogShowWork') : _('library.catalogHideWork')),
        onError: (err) => notify.error(getUserErrorNotification(err, 'library.catalogHideWork')),
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
      onSuccess: () => notify.success(publishing ? _('library.catalogShowWork') : _('library.catalogHideWork')),
      onError: (err) => notify.error(getUserErrorNotification(err, 'library.catalogHideWork')),
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
      onSuccess: () => notify.success(_('library.catalogHideWork')),
      onError: (err) => notify.error(getUserErrorNotification(err, 'library.catalogHideWork')),
    })
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

  const metaRows: MetaRow[] = []
  const bookmeta = selected?.effective.bookmeta
  const groupDigits = (n: number): string => new Intl.NumberFormat(i18n.language).format(n)
  if (bookmeta?.series) {
    const series = bookmeta.series
    metaRows.push({
      label: _('library.seriesSection'),
      value: bookmeta.seriesIndex != null ? `${series} #${bookmeta.seriesIndex}` : series,
      onClick: () => goToFilter({ series }),
    })
  }
  if (bookmeta?.publisher) metaRows.push({ label: _('library.publisher'), value: bookmeta.publisher })
  if (bookmeta?.published) metaRows.push({ label: _('library.published'), value: bookmeta.published })
  if (bookmeta?.language) {
    metaRows.push({ label: _('library.language'), value: formatLanguage(bookmeta.language, i18n.language) })
  }
  const rawIdentifier = bookmeta?.isbn || bookmeta?.identifier || ''
  if (rawIdentifier && (bookmeta?.isbn || !isMachineIdentifier(rawIdentifier))) {
    metaRows.push({ label: bookmeta?.isbn ? 'ISBN' : _('library.identifier'), value: rawIdentifier, copyable: true, hint: _('library.copyValue') })
  }
  if (selected) {
    metaRows.push({ label: _('library.format'), value: selected.format.toUpperCase() })
    metaRows.push({ label: _('library.sortBy.size'), value: formatBytes(selected.size), hint: `${groupDigits(selected.size)} B` })
    if (selected.wordCount != null) {
      metaRows.push({
        label: _('library.wordCount'),
        value: formatWordCount(selected.wordCount, i18n.language, _),
        hint: _('library.tocRuleWords', { count: groupDigits(selected.wordCount) }),
      })
    }
    metaRows.push({ label: _('library.addedAt'), value: formatDate(selected.createdAt), hint: formatDateTime(selected.createdAt) })
    if (selected.updatedAt !== selected.createdAt) {
      metaRows.push({ label: _('library.updatedAt'), value: formatDate(selected.updatedAt), hint: formatDateTime(selected.updatedAt) })
    }
  }
  if (bookmeta?.subjects?.length) {
    metaRows.push({ label: _('library.subjects'), value: bookmeta.subjects.join('、'), expandable: true })
  }
  if (selected?.effective.fileName) {
    metaRows.push({ label: _('library.originalFile'), value: selected.effective.fileName, copyable: true, expandable: true, hint: _('library.copyFullFileName') })
  }

  if (!selected) return null

  // Cover and palette follow the visible version, the same rule the work row
  // uses for artwork: a stored cover or an EPUB that can carry an embedded one.
  const selectedMayHaveArtwork = Boolean(work.coverKey) || selected.format === 'epub'
  const selectedRow = {
    ...row,
    title: selected.effective.title,
    format: selected.format,
    coverSrc: selectedMayHaveArtwork ? `/api/v1/books/${selected.bookVersionId}/cover?size=thumb` : null,
    coverPaletteKey: selected.effective.coverPaletteKey ?? selected.bookVersionId,
    size: selected.size,
  }

  return (
    <div>
      <DetailHeader
        cover={<BookCover book={rowCover(selectedRow)} coverSrc={selectedRow.coverSrc} />}
        hasCoverImage={hasCoverImage}
        copyingCover={copyingCover}
        onCopyCover={() => void handleCopyCover()}
        onDownloadCover={() => void handleDownloadCover()}
        title={selected.effective.title}
        authors={selected.effective.authors ?? []}
        author={selected.effective.author}
        onAuthorClick={(name) => goToFilter({ author: name })}
        chips={work.tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {work.tags.map((tag) => (
              <FilterChip key={tag.id} prefix="#" label={tag.name} onClick={() => goToFilter({ tag: tag.id })} />
            ))}
          </div>
        )}
        actions={(
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!readable}
              title={!readable ? _('library.catalogUnlistedReadHint') : undefined}
              onClick={readSelected}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              {_('library.startReading')}
            </Button>
            <div className="flex flex-1 items-center gap-1.5">
              {/* Action order mirrors BookDetailView: flow, edit, download, maintain, hide, delete. */}
              {canCollect && (
                <ActionIcon
                  secondary
                  label={alreadyJoined ? _('library.collected') : _('library.collect')}
                  disabled={alreadyJoined || collect.isPending}
                  onClick={alreadyJoined ? undefined : collectSelected}
                >
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  {alreadyJoined ? (
                    <polyline points="9 11 11 13 15 9" />
                  ) : (
                    <>
                      <line x1="12" y1="7" x2="12" y2="13" />
                      <line x1="9" y1="10" x2="15" y2="10" />
                    </>
                  )}
                </ActionIcon>
              )}
              {canManage && (
                <ActionIcon
                  secondary
                  label={_('library.editWork')}
                  onClick={() => setEditOpen(true)}
                >
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </ActionIcon>
              )}
              {canDownload && (
                <DownloadMenu
                  bookId={selected.bookVersionId}
                  title={selected.effective.title}
                  format={selected.format}
                  versionLabel={versionTabLabel(selected.name, _('library.versionFallback', { n: versionOrdinal(work.versions, selected.id) }))}
                />
              )}
              {(canManage || canContribute) && (
                <ActionIcon
                  secondary
                  label={_('library.uploadNewVersion')}
                  onClick={() => setUploadOpen(true)}
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <line x1="9" y1="15" x2="15" y2="15" />
                </ActionIcon>
              )}
              {canManage && (
                hiddenCause ? (
                  // The hide came from a hidden category or tag, so there is no
                  // work-level action to take. Keep the same eye icon, just
                  // inert, and let the tooltip say why.
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
                ) : selectedHidden ? (
                  <ActionIcon
                    secondary
                    label={_('library.versionHiddenAction')}
                    disabled={updateVersion.isPending || updateWork.isPending}
                    onClick={togglePublish}
                  >
                    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                    <line x1="2" x2="22" y1="2" y2="22" />
                  </ActionIcon>
                ) : (
                  <ActionIcon
                    secondary
                    label={_('library.versionVisibleAction')}
                    disabled={updateVersion.isPending || updateWork.isPending}
                    onClick={togglePublish}
                  >
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </ActionIcon>
                )
              )}
              {moreActions && moreActions.length > 0 && (
                <MoreActionsMenu items={moreActions} />
              )}
              {(canManage || selected.maintainable) && (
                <div className="ml-auto">
                  <ActionIcon label={_('library.delete')} danger onClick={() => setDeleteOpen(true)}>
                    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                  </ActionIcon>
                </div>
              )}
            </div>
          </div>
        )}
        footer={work.versions.length > 1 && (
          <div className="mt-3.5">
            <VersionTabs versions={work.versions} selectedId={selected.id} onSelect={onSelectVersion} />
          </div>
        )}
      />

      {selected.effective.description && (
        <section className="mt-5">
          <GroupLabel>{_('library.descriptionSection')}</GroupLabel>
          <p className="max-h-40 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] pr-1 whitespace-pre-wrap text-sm leading-relaxed text-stone-600 dark:text-stone-300">
            {selected.effective.description}
          </p>
        </section>
      )}

      <MetaGrid rows={metaRows} />

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
      {editOpen && (
        <WorkEditDialog
          work={work}
          libraryId={library.id}
          version={selected}
          versionIndex={work.versions.indexOf(selected)}
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

