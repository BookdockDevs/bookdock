import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { BookListItem, CatalogBook, Library } from '@bookdock/shared'

import { apiDelete, apiPatch, apiPut, apiUpload } from '@/api/client'
import { useBookChapters } from '@/api/hooks/useBookChapters'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import type { ToastMessage } from '@/stores/toast.store'

import { useBook, useBookMembership, useBookMetadataSource, useShelves, useTags, useVersionTocState } from '../hooks'

import AppendContentModal from './AppendContentModal'
import BookClassificationEditor from './book-detail/BookClassificationEditor'
import BookCoverEditor from './book-detail/BookCoverEditor'
import BookDetailView from './book-detail/BookDetailView'
import BookMetaForm from './book-detail/BookMetaForm'
import type { DraftTextField } from './book-detail/metadata-source'
import { applySourceAllToDraft, applySourceFieldToDraft, PRIVATE_ALL_TEXT_FIELDS, PRIVATE_B_TEXT_FIELDS } from './book-detail/metadata-source'
import type { MoreActionsMenuItem } from './book-detail/MoreActionsMenu'
import { draftFrom, draftToBookmetaPreserving, parseAuthorList, type MetaDraft } from './book-detail/types'
import TocRulePicker from './TocRulePicker'
import WorkDetailBody from './WorkDetailBody'

interface BookDetailDialogProps {
  book: BookListItem | null
  /**
   * A work in a shared library, shown in this same dialog. The design puts a
   * library's versions in its detail (library-design-v1.md §6), so the detail is
   * where a reader picks one to read - not a panel folded into the list row.
   * Only one of `book` and `work` is ever set.
   */
  work?: { work: CatalogBook; library: Library; canManage: boolean; canCollect: boolean; canContribute?: boolean } | null
  readOnly?: boolean
  onClose: () => void
  onDelete: (book: BookListItem) => void
  onPublish?: (book: BookListItem) => void
}

export default function BookDetailDialog({ book, work = null, readOnly = false, onClose, onDelete, onPublish }: BookDetailDialogProps) {
  const _ = useTranslation()
  const queryClient = useQueryClient()

  const { data: detailData, isLoading: detailLoading } = useBook(book?.id ?? null)
  const detail = detailData?.data
  const displayBook: BookListItem = detail ?? book!
  const bookmeta = detail?.meta?.bookmeta

  const { shelves: memShelves, tags: memTags } = useBookMembership(book?.id ?? null)
  const { data: shelvesData } = useShelves()
  const { data: tagsData } = useTags()

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<ToastMessage | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [draft, setDraft] = useState<MetaDraft | null>(null)
  const [draftEpoch, setDraftEpoch] = useState(0)

  const [pendingCoverFile, setPendingCoverFile] = useState<File | null>(null)
  const [coverRemovalPending, setCoverRemovalPending] = useState(false)
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null)
  const [shelfSel, setShelfSel] = useState<string | null>(null)
  const [tagSel, setTagSel] = useState<Set<string>>(new Set())

  const [tocRuleOpen, setTocRuleOpen] = useState(false)
  const [appendContentOpen, setAppendContentOpen] = useState(false)

  // A work's visible version is owned here, not inside its body, because the
  // header overflow menu offers the content-maintenance actions for whichever
  // version is on screen - the same two the private book offers for itself.
  const [workVersionId, setWorkVersionId] = useState<string | null>(null)
  const [workTocOpen, setWorkTocOpen] = useState(false)
  const [workAppendOpen, setWorkAppendOpen] = useState(false)
  const pendingWorkVersionRef = useRef<string[]>([])
  const workVersion =
    work?.work.versions.find((v) => v.id === workVersionId) ?? work?.work.versions[0]
  // The server resolves maintainability per version with the same predicate the
  // write endpoints gate on, so the payload - not the library-level flag - is
  // what says whether this version can be appended to or re-chaptered.
  const workCanEditContent = Boolean(
    workVersion?.maintainable ?? (Boolean(work?.canManage) || Boolean(work?.canContribute)),
  )
  const workTocState = useVersionTocState(
    work && workTocOpen ? work.library.id : null,
    work && workTocOpen ? work.work.id : null,
    work && workTocOpen && workVersion ? workVersion.id : null,
  )

  // A deleted or moved-away selection falls back instead of pointing nowhere;
  // versions uploaded from this dialog report their link ids before the catalog
  // refetch lands, so hold them aside rather than letting the fallback eat the
  // fresh selection.
  useEffect(() => {
    const versions = work?.work.versions
    if (!versions) return
    if (pendingWorkVersionRef.current.length > 0) {
      const arrived = pendingWorkVersionRef.current.find((id) => versions.some((v) => v.id === id))
      if (arrived) {
        setWorkVersionId(arrived)
        pendingWorkVersionRef.current = []
      }
      return
    }
    if (versions.length > 0 && !versions.some((v) => v.id === workVersionId)) {
      setWorkVersionId(versions[0]?.id ?? null)
    }
  }, [work?.work.versions, workVersionId])

  const { data: chaptersData } = useBookChapters(book?.id ?? '', tocRuleOpen && displayBook.format === 'txt')

  useEffect(() => {
    if (!pendingCoverFile) {
      setCoverPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(pendingCoverFile)
    setCoverPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingCoverFile])

  const discardEdit = useCallback(() => {
    setSaveError(null)
    setEditing(false)
    setConfirmReset(false)
    setDraft(null)
    setPendingCoverFile(null)
    setCoverRemovalPending(false)
  }, [])

  const closeDialog = useCallback(() => {
    discardEdit()
    setAppendContentOpen(false)
    onClose()
  }, [discardEdit, onClose])

  useEffect(() => {
    if (!book) return
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[data-smart-menu="true"]')) return
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]')
      if (e.key === 'Escape' && !e.defaultPrevented && dialogs.length <= 1) closeDialog()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [book, closeDialog])

  // Reset transient state when switching books
  useEffect(() => {
    setEditing(false)
    setConfirmReset(false)
    setDraft(null)
    setPendingCoverFile(null)
    setCoverRemovalPending(false)
    setTocRuleOpen(false)
    setAppendContentOpen(false)
  }, [book?.id])

  const isEditLibraryOwned = Boolean(displayBook?.source)
  const editAllowedFields: DraftTextField[] = isEditLibraryOwned ? PRIVATE_B_TEXT_FIELDS : PRIVATE_ALL_TEXT_FIELDS
  const metadataSource = useBookMetadataSource(book?.id ?? null, editing && Boolean(book))
  const sourceData = !metadataSource.isFetching && !metadataSource.isError ? (metadataSource.data?.data ?? null) : null

  function enterEdit() {
    if (!book) return
    setSaveError(null)
    setDraft({
      ...draftFrom(displayBook, bookmeta),
      coverPaletteId: detail?.meta?.coverPaletteId ?? displayBook.coverPaletteId ?? null,
    })
    setPendingCoverFile(null)
    setCoverRemovalPending(false)
    setShelfSel(memShelves.data?.data !== undefined ? memShelves.data.data : (book.shelfId ?? null))
    setTagSel(
      new Set(
        memTags.data?.data ??
          (tagsData?.data ?? [])
            .filter((t) => (book.tags ?? []).includes(t.name))
            .map((t) => t.id),
      ),
    )
    setConfirmReset(false)
    setDraftEpoch((n) => n + 1)
    void queryClient.removeQueries({ queryKey: ['books', book.id, 'metadata-source'] })
    setEditing(true)
  }

  function handleRestoreField(field: DraftTextField) {
    if (!draft || !sourceData) return
    setDraft(applySourceFieldToDraft(draft, field, sourceData))
  }

  function handleRestoreAll() {
    if (!draft || !sourceData) return
    setDraft(applySourceAllToDraft(draft, sourceData, editAllowedFields))
    setConfirmReset(false)
  }

  async function handleSave() {
    if (!book || !draft) return
    const title = draft.title.trim()
    if (!title) return
    setSaveError(null)
    setSaving(true)
    try {
      const authors = parseAuthorList(draft.authors)
      const patch: Record<string, unknown> = {
        title,
        author: authors[0] ?? '',
        authors,
      }
      if (!isEditLibraryOwned) {
        patch.bookmeta = draftToBookmetaPreserving(bookmeta, draft)
        patch.coverPaletteId = draft.coverPaletteId
      }
      const requests: Promise<unknown>[] = [
        apiPatch(`/books/${book.id}`, patch),
        apiPut(`/books/${book.id}/shelves`, { shelfId: shelfSel }),
        apiPut(`/books/${book.id}/tags`, { tagIds: [...tagSel] }),
      ]
      if (coverRemovalPending) {
        requests.push(apiDelete(`/books/${book.id}/cover`))
      } else if (pendingCoverFile) {
        requests.push(apiUpload(`/books/${book.id}/cover`, pendingCoverFile, 'PUT'))
      }
      const results = await Promise.allSettled(requests)
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['book', book.id] })
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failed.length > 0) {
        const reason = getUserErrorNotification(failed[0]!.reason, 'toast.updateBookFailed')
        setSaveError(failed.length < results.length
          ? { key: 'library.bookUpdatePartial', params: { succeeded: results.length - failed.length, failed: failed.length, reason: _(reason.key) } }
          : reason)
      } else {
        notify.success({ key: 'toast.bookUpdated' })
        discardEdit()
      }
    } catch (err) {
      setSaveError(getUserErrorNotification(err, 'toast.updateBookFailed'))
    } finally {
      setSaving(false)
    }
  }

  function handleCoverFile(file: File | undefined) {
    if (!book || !file || saving) return
    setPendingCoverFile(file)
    setCoverRemovalPending(false)
  }

  if (work) {
    // Content maintenance lives in the header overflow on both sides of the
    // library boundary, so the affordance never depends on which library a book
    // came from.
    const workMenuItems: MoreActionsMenuItem[] =
      workVersion?.format === 'txt' && workCanEditContent
        ? [
          {
            key: 'toc',
            label: _('library.changeTocRule'),
            icon: (
              <>
                <line x1="8" y1="6" x2="21" y2="6" />
                <line x1="8" y1="12" x2="21" y2="12" />
                <line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" />
                <line x1="3" y1="12" x2="3.01" y2="12" />
                <line x1="3" y1="18" x2="3.01" y2="18" />
              </>
            ),
            onSelect: () => setWorkTocOpen(true),
          },
          {
            key: 'append',
            label: _('library.appendContent'),
            icon: <path d="M12 5v14M5 12h14" />,
            onSelect: () => setWorkAppendOpen(true),
          },
        ]
        : []
    return (
      <Modal
        title={_('library.bookDetails')}
        onClose={closeDialog}
        closeLabel={_('library.close')}
        size="xl"
      >
        <WorkDetailBody
          work={work.work}
          library={work.library}
          canManage={work.canManage}
          canCollect={work.canCollect}
          canContribute={work.canContribute}
          selectedVersionId={workVersion?.id ?? null}
          onSelectVersion={setWorkVersionId}
          onVersionsUploaded={(ids) => {
            if (ids.length > 0) pendingWorkVersionRef.current = ids
          }}
          moreActions={workMenuItems}
          onClose={closeDialog}
        />
        {workAppendOpen && workVersion && workCanEditContent && (
          <AppendContentModal
            target={{ libraryId: work.library.id, libraryBookId: work.work.id, versionLinkId: workVersion.id }}
            onClose={() => setWorkAppendOpen(false)}
          />
        )}
        {workTocOpen && workVersion && workCanEditContent && (
          workTocState.isError
            ? <QueryErrorState isRetrying={workTocState.isFetching} onRetry={() => void workTocState.refetch()} />
            : workTocState.data && (
              <TocRulePicker
                target={{ libraryId: work.library.id, libraryBookId: work.work.id, versionLinkId: workVersion.id }}
                currentRuleId={workTocState.data.data.tocRuleId ?? undefined}
                autoScored={workTocState.data.data.tocRuleAuto}
                customPatterns={workTocState.data.data.customPatterns}
                excludedChapterIds={workTocState.data.data.excludedChapterIds}
                currentChapters={workTocState.data.data.chapters}
                onClose={() => setWorkTocOpen(false)}
              />
            )
        )}
      </Modal>
    )
  }

  if (!book) return null

  const currentShelfId =
    memShelves.data?.data !== undefined ? memShelves.data.data : (displayBook.shelfId ?? null)
  const tagIds = memTags.data?.data ? new Set(memTags.data.data) : null
  // 7.x: a collected B keeps its own metadata editable, but its content belongs
  // to the library — appending, re-chaptering and resetting derived metadata
  // would rewrite the shared revision, so the server refuses them too. `source`
  // is the right test for that: it is set for a B and for a library read, and
  // absent for A/C.
  // 0.4.0: a library version read *without* collecting it has no private card,
  // so every private-library affordance (edit, delete, shelf, tags) is hidden
  // and the view offers the collect action instead.
  const isLibraryOwned = Boolean(displayBook.source)
  const isLibraryRead = displayBook.collected === false
  const shelfName = currentShelfId
    ? (shelvesData?.data ?? []).find((s) => s.id === currentShelfId)?.name ?? book.shelfName ?? undefined
    : undefined
  const memberTags = tagIds
    ? (tagsData?.data ?? []).filter((t) => tagIds.has(t.id))
    : (book.tags ?? []).map((name) => {
        const found = (tagsData?.data ?? []).find((t) => t.name === name)
        return { id: found ? found.id : name, name }
      })
  const isMachineId = (id: string) =>
    /^urn:uuid:/i.test(id.trim()) ||
    /^uuid:/i.test(id.trim()) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim())
  const rawId = bookmeta?.isbn || bookmeta?.identifier || ''
  const identifier = rawId && (bookmeta?.isbn || !isMachineId(rawId)) ? rawId : ''

  const privateMenuItems: MoreActionsMenuItem[] =
    !readOnly && !isLibraryOwned && displayBook.format === 'txt'
      ? [
        {
          key: 'toc',
          label: _('library.changeTocRule'),
          icon: (
            <>
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </>
          ),
          onSelect: () => setTocRuleOpen(true),
        },
        {
          key: 'append',
          label: _('library.appendContent'),
          icon: <path d="M12 5v14M5 12h14" />,
          onSelect: () => setAppendContentOpen(true),
        },
      ]
      : []

  return (
    <>
      <Modal
        title={editing ? _('library.editBook') : _('library.bookDetails')}
        onClose={closeDialog}
        closeLabel={_('library.close')}
        size="xl"
        footer={
          editing ? (
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
              {confirmReset ? (
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-xs text-stone-500 dark:text-stone-400">{_('library.restoreSourceConfirm')}</span>
                  <button
                    type="button"
                    onClick={handleRestoreAll}
                    disabled={!sourceData || metadataSource.isFetching}
                    className="shrink-0 text-xs font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                  >
                    {_('library.restoreSourceValues')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmReset(false)}
                    className="shrink-0 text-xs text-stone-400 hover:underline"
                  >
                    {_('library.cancel')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  disabled={!sourceData || metadataSource.isFetching}
                  className="inline-flex items-center gap-1.5 text-xs text-stone-400 transition-colors hover:text-stone-700 disabled:opacity-50 dark:hover:text-stone-200"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  <span>{_('library.restoreSourceValues')}</span>
                </button>
              )}
              <div className={`flex shrink-0 items-center gap-2 ${confirmReset ? '' : ''}`}>
                <Button variant="secondary" onClick={discardEdit} disabled={saving}>
                  {_('library.cancel')}
                </Button>
                <Button onClick={() => void handleSave()} disabled={saving || !draft?.title.trim()}>
                  {saving ? `${_('library.save')}...` : _('library.save')}
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
          {editing && draft ? (
            <div key={draftEpoch}>
              {saveError && <p role="alert" className={`mb-4 text-sm ${saveError.key === 'library.bookUpdatePartial' ? 'text-amber-700 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                {_(saveError.key, saveError.params)}
              </p>}
              <BookMetaForm
                draft={draft}
                onChange={setDraft}
                identifier={identifier}
                limited={isEditLibraryOwned}
                source={sourceData}
                sourceLoading={metadataSource.isFetching}
                sourceError={metadataSource.isError ? metadataSource.error : null}
                onRetrySource={() => void metadataSource.refetch()}
                onRestoreField={handleRestoreField}
                coverSlot={
                  <BookCoverEditor
                    book={displayBook}
                    coverRemovalPending={coverRemovalPending}
                    pendingCoverFile={pendingCoverFile}
                    coverPreviewUrl={coverPreviewUrl}
                    saving={saving}
                    coverPaletteId={draft.coverPaletteId}
                    allowPalette={!isEditLibraryOwned}
                    onCoverFile={handleCoverFile}
                    onPaletteChange={(id) => setDraft((d) => (d ? { ...d, coverPaletteId: id } : d))}
                    onRemoveCover={() => {
                      if (!saving) {
                        setPendingCoverFile(null)
                        setCoverRemovalPending(Boolean(displayBook.coverKey))
                      }
                    }}
                  />
                }
              />
              <BookClassificationEditor
                shelfId={shelfSel}
                tagIds={tagSel}
                onShelfChange={setShelfSel}
                onTagChange={setTagSel}
              />
            </div>
          ) : (
            <BookDetailView
              book={displayBook}
              // A library read has no private card, so everything private-only
              // (edit, delete, shelf, tags) is read-only until it is collected.
              readOnly={readOnly || isLibraryRead}
              detail={detail}
              shelfName={shelfName}
              currentShelfId={currentShelfId}
              shelfMembershipReady={memShelves.data !== undefined && !memShelves.isError}
              memberTags={memberTags}
              isLoading={detailLoading || !detail}
              moreActions={privateMenuItems}
              onEdit={enterEdit}
              onDelete={onDelete}
              onClose={onClose}
              onPublish={onPublish}
            />
          )}

          {!readOnly && !isLibraryOwned && displayBook.format === 'txt' && tocRuleOpen && (
            <TocRulePicker
              target={{ bookId: book.id }}
              currentRuleId={detail?.meta?.tocRuleId}
              autoScored={detail?.meta?.tocRuleAuto}
              customPatterns={detail?.meta?.customTocPatterns}
              excludedChapterIds={detail?.meta?.tocExcludedChapterIds}
              currentChapters={chaptersData?.data}
              onClose={() => setTocRuleOpen(false)}
            />
        )}
      </Modal>
      {!readOnly && !isLibraryOwned && displayBook.format === 'txt' && appendContentOpen && <AppendContentModal target={{ bookId: book.id }} onClose={() => setAppendContentOpen(false)} />}
    </>
  )
}
