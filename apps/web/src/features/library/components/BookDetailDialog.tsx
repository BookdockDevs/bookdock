import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { useAuthStore } from '@/stores/auth.store'

import type { BookListItem, CatalogBook, Library, Review, UndoReceipt } from '@bookdock/shared'

import { apiDelete, apiPatch, apiPut, apiUpload } from '@/api/client'
import { useBookChapters } from '@/api/hooks/useBookChapters'
import { READING_RECORDS_KEY } from '@/api/hooks/reading-records'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import type { ToastMessage } from '@/stores/toast.store'

import { useCatalogBookDetail, useBook, useBookMembership, useBookMetadataSource, useTags, useVersionTocState, useLibraryCategories, useLibraries } from '../hooks'

import AppendContentModal from './AppendContentModal'
import BookClassificationEditor from './book-detail/BookClassificationEditor'
import { categoryPath } from '../taxonomy'
import BookCoverEditor from './book-detail/BookCoverEditor'
import BookDetailView from './book-detail/BookDetailView'
import BookMetaForm from './book-detail/BookMetaForm'
import type { DraftTextField } from './book-detail/metadata-source'
import { applySourceAllToDraft, applySourceFieldToDraft, PRIVATE_ALL_TEXT_FIELDS, PRIVATE_B_TEXT_FIELDS } from './book-detail/metadata-source'
import type { MoreActionsMenuItem } from './book-detail/MoreActionsMenu'
import { draftFrom, draftToBookmetaPreserving, parseAuthorList, type MetaDraft } from './book-detail/types'
import TocRulePicker from './TocRulePicker'
import WorkDetailBody from './WorkDetailBody'
import AllReviewsView from '@/features/reviews/components/AllReviewsView'
import ReviewDetailHeaderActions, { ReviewDetailModalTitle } from '@/features/reviews/components/ReviewDetailHeaderActions'
import { getReviewTotalCount } from '@/features/reviews/lib/review-count'
import ReviewDetailView from '@/features/reviews/components/ReviewDetailView'
import ReviewEditor from '@/features/reviews/components/ReviewEditor'
import { useReviewBookContext, useReviewWorkContext } from '@/features/reviews/hooks/useReviews'
import { visibleReviews } from '@/features/reviews/lib/review-select'

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

export default function BookDetailDialog({ book, work: workContext = null, readOnly = false, onClose, onDelete, onPublish }: BookDetailDialogProps) {
  const _ = useTranslation()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const workQuery = useCatalogBookDetail(workContext?.library.id ?? null, workContext?.work.id ?? null)
  const work = workContext ? { ...workContext, work: workQuery.data?.data ?? workContext.work } : null


  const { data: detailData, isLoading: detailLoading } = useBook(book?.id ?? null)
  const detail = detailData?.data
  const displayBook: BookListItem = detail ?? book!
  const bookmeta = detail?.meta?.bookmeta

  const { tags: memTags } = useBookMembership(book?.id ?? null, { tags: !detail?.tagIds })
  const { data: librariesData } = useLibraries()
  const privateLibraryId = librariesData?.data.find((library) => library.type === 'private')?.id ?? null
  const categoriesData = useLibraryCategories(privateLibraryId)
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
  const [categorySel, setCategorySel] = useState<{ categoryId?: string | null; categoryTemplateKey?: string }>({ categoryId: null })
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

  const [reviewSubView, setReviewSubView] = useState<'detail' | 'reviews' | 'review-detail'>('detail')
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null)
  // Where the detail back button returns: the list, or straight back to the
  // book detail when the preview entry skipped the list.
  const [reviewDetailReturn, setReviewDetailReturn] = useState<'detail' | 'reviews'>('reviews')
  const [dialogReviewEditorOpen, setDialogReviewEditorOpen] = useState(false)
  const [dialogEditingReview, setDialogEditingReview] = useState<Review | null>(null)

  const reviewWorkQuery = useReviewWorkContext(workContext?.library.id ?? null, workContext?.work.id ?? null, Boolean(workContext))
  const workReviewContext = reviewWorkQuery.data?.data
  const workReviewComposer = workReviewContext?.composer
  const workCanReview = Boolean(workReviewComposer?.eligible && workReviewComposer.bookVersionId)
  const workOwnReview = workReviewContext?.own ?? null

  const reviewBookQuery = useReviewBookContext(!workContext && book ? book.id : null, Boolean(!workContext && book))
  const bookReviewContext = reviewBookQuery.data?.data
  const bookReviewComposer = bookReviewContext?.composer
  const bookCanReview = Boolean(!readOnly && bookReviewComposer?.eligible && bookReviewComposer.bookVersionId)
  const bookOwnReview = bookReviewContext?.own ?? null

  // The review detail pane opens whatever the surfaces below it show, so the
  // lookup runs against the same union the list and the preview use.
  const workReviewList = useMemo(() => visibleReviews(workOwnReview, workReviewContext?.reviews), [workOwnReview, workReviewContext])
  const activeWorkReview = useMemo(
    () => (activeReviewId ? workReviewList.find((r) => r.id === activeReviewId) ?? null : null),
    [activeReviewId, workReviewList],
  )

  const bookReviewList = useMemo(() => visibleReviews(bookOwnReview, bookReviewContext?.reviews), [bookOwnReview, bookReviewContext])
  const activeBookReview = useMemo(
    () => (activeReviewId ? bookReviewList.find((r) => r.id === activeReviewId) ?? null : null),
    [activeReviewId, bookReviewList],
  )

  function renderModalTitle(subView: 'detail' | 'reviews' | 'review-detail', defaultTitle: React.ReactNode, reviewTotal?: number) {
    if (subView === 'reviews') {
      return (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setReviewSubView('detail')}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label={_('common.back')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <span>{_('review.reviewsTitle')}</span>
          {reviewTotal != null && reviewTotal > 0 && (
            <span className="rounded-full bg-stone-200/40 px-1.5 py-0.5 text-[11px] font-medium leading-none tabular-nums text-stone-500 dark:bg-stone-800/70 dark:text-stone-400">
              {reviewTotal}
            </span>
          )}
        </div>
      )
    }
    if (subView === 'review-detail') {
      return <ReviewDetailModalTitle onBack={() => setReviewSubView(reviewDetailReturn)} />
    }
    return defaultTitle
  }

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
    setReviewSubView('detail')
    setActiveReviewId(null)
    setDialogReviewEditorOpen(false)
    setDialogEditingReview(null)
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
    setReviewSubView('detail')
    setActiveReviewId(null)
    setDialogReviewEditorOpen(false)
    setDialogEditingReview(null)
  }, [book?.id, workContext?.work.id])

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
    setCategorySel({ categoryId: displayBook.categoryId ?? null })
    setTagSel(
      new Set(
        detail?.tagIds ??
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
      const requests: Promise<{ undo?: UndoReceipt }>[] = [
        apiPatch<{ undo?: UndoReceipt }>(`/books/${book.id}`, patch),
        apiPut<{ undo?: UndoReceipt }>(`/books/${book.id}/organization`, {
          ...(categorySel.categoryTemplateKey
            ? { categoryTemplateKey: categorySel.categoryTemplateKey }
            : { categoryId: categorySel.categoryId }),
          tagIds: [...tagSel],
        }),
      ]
      if (coverRemovalPending) {
        requests.push(apiDelete<{ undo?: UndoReceipt }>(`/books/${book.id}/cover`))
      } else if (pendingCoverFile) {
        requests.push(apiUpload<{ undo?: UndoReceipt }>(`/books/${book.id}/cover`, pendingCoverFile, 'PUT'))
      }
      const results = await Promise.allSettled(requests)
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['book', book.id] })
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      queryClient.invalidateQueries({ queryKey: ['libraries', privateLibraryId, 'categories'] })
      queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
      const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failed.length > 0) {
        const reason = getUserErrorNotification(failed[0]!.reason, 'toast.updateBookFailed')
        setSaveError(failed.length < results.length
          ? { key: 'library.bookUpdatePartial', params: { succeeded: results.length - failed.length, failed: failed.length, reason: _(reason.key) } }
          : reason)
      } else {
        const organizationResult = results[1]
        notify.success({ key: 'toast.bookUpdated' }, { undo: organizationResult?.status === 'fulfilled' ? organizationResult.value.undo : undefined })
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
    // The reading data lives in the action row, not in the overflow: it is a
    // drill-in, not a maintenance task. The archive reads the book version,
    // so the selected version's content id is what it needs.
    const openWorkReadingData = user && workVersion?.bookVersionId
      ? () => {
          onClose()
          void navigate({ to: '/archive', search: { bookId: workVersion.bookVersionId, bookView: 'data' } })
        }
      : undefined
    return (
      <>
        <Modal
          title={renderModalTitle(reviewSubView, _('library.bookDetails'), getReviewTotalCount(workReviewContext))}
          onClose={closeDialog}
          closeLabel={_('library.close')}
          hideClose={reviewSubView !== 'detail'}
          size="xl"
          actions={reviewSubView === 'review-detail' && activeWorkReview ? (
            <ReviewDetailHeaderActions
              review={activeWorkReview}
              onEdit={(r) => {
                setDialogEditingReview(r)
                setDialogReviewEditorOpen(true)
              }}
              onDeleted={() => {
                void reviewWorkQuery.refetch()
                setReviewSubView(reviewDetailReturn)
                setActiveReviewId(null)
              }}
            />
          ) : undefined}
        >
          {reviewSubView === 'detail' ? (
            workQuery.isError ? <QueryErrorState isRetrying={workQuery.isFetching} onRetry={() => void workQuery.refetch()} /> : <WorkDetailBody
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
              onOpenReadingData={openWorkReadingData}
              onOpenAllReviews={() => setReviewSubView('reviews')}
              onOpenReviewDetail={(r) => {
                setActiveReviewId(r.id)
                setReviewDetailReturn('detail')
                setReviewSubView('review-detail')
              }}
              onClose={closeDialog}
            />
          ) : (
            <>
              <div hidden={reviewSubView !== 'reviews'} aria-hidden={reviewSubView !== 'reviews'} className={reviewSubView === 'reviews' ? 'block' : 'hidden'}>
                <AllReviewsView
                  context={workReviewContext}
                  canReview={workCanReview}
                  onOpenCompose={() => {
                    setDialogEditingReview(null)
                    setDialogReviewEditorOpen(true)
                  }}
                  onOpenEdit={(r) => {
                    setDialogEditingReview(r)
                    setDialogReviewEditorOpen(true)
                  }}
                  onOpenReviewDetail={(r) => {
                    setActiveReviewId(r.id)
                    setReviewDetailReturn('reviews')
                    setReviewSubView('review-detail')
                  }}
                />
              </div>

              {reviewSubView === 'review-detail' && activeWorkReview && (
                <ReviewDetailView
                  review={activeWorkReview}
                />
              )}
            </>
          )}

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

        {dialogReviewEditorOpen && workReviewComposer?.bookVersionId && (
          <ReviewEditor
            bookVersionId={workReviewComposer.bookVersionId}
            existing={dialogEditingReview ?? workOwnReview}
            composer={workReviewComposer}
            onClose={() => {
              setDialogReviewEditorOpen(false)
              setDialogEditingReview(null)
            }}
            onSaved={() => {
              void reviewWorkQuery.refetch()
            }}
          />
        )}
      </>
    )
  }

  if (!book) return null

  const tagIds = detail?.tagIds ? new Set(detail.tagIds) : (memTags.data?.data ? new Set(memTags.data.data) : null)
  // 7.x: a collected B keeps its own metadata editable, but its content belongs
  // to the library — appending, re-chaptering and resetting derived metadata
  // would rewrite the shared revision, so the server refuses them too. `source`
  // is the right test for that: it is set for a B and for a library read, and
  // absent for A/C.
  const isLibraryOwned = Boolean(displayBook.source)
  const currentCategoryName = displayBook.categoryId === null
    ? categoriesData.data ? _('library.uncategorized') : undefined
    : displayBook.categoryId
      ? categoriesData.data?.data.some((category) => category.id === displayBook.categoryId)
        ? categoryPath(categoriesData.data.data, displayBook.categoryId).map((category) => category.name).join(' / ')
        : displayBook.categoryName ?? undefined
      : displayBook.categoryName ?? undefined
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

  const openPrivateReadingData = user
    ? () => {
        onClose()
        void navigate({ to: '/archive', search: { bookId: displayBook.id, bookView: 'data' } })
      }
    : undefined

  return (
    <>
      <Modal
        title={editing ? _('library.editBook') : renderModalTitle(reviewSubView, _('library.bookDetails'), getReviewTotalCount(bookReviewContext))}
        onClose={closeDialog}
        closeLabel={_('library.close')}
        hideClose={!editing && reviewSubView !== 'detail'}
        size="xl"
        actions={reviewSubView === 'review-detail' && activeBookReview ? (
          <ReviewDetailHeaderActions
            review={activeBookReview}
            onEdit={(r) => {
              setDialogEditingReview(r)
              setDialogReviewEditorOpen(true)
            }}
            onDeleted={() => {
              void reviewBookQuery.refetch()
              setReviewSubView(reviewDetailReturn)
              setActiveReviewId(null)
            }}
          />
        ) : undefined}
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
        {reviewSubView === 'detail' ? (
          editing && draft ? (
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
                libraryId={privateLibraryId ?? ''}
                categoryId={categorySel.categoryId ?? null}
                categoryTemplateKey={categorySel.categoryTemplateKey}
                tagIds={tagSel}
                onCategoryChange={(value) => setCategorySel(value)}
                onTagChange={setTagSel}
              />
            </div>
          ) : (
            <BookDetailView
              book={displayBook}
              // Archive links can open readable shared versions without a
              // private card; their personal-library actions must stay hidden.
              readOnly={readOnly || displayBook.collected === false}
              detail={detail}
              categoryName={currentCategoryName}
              memberTags={memberTags}
              isLoading={detailLoading || !detail}
              moreActions={privateMenuItems}
              onOpenReadingData={openPrivateReadingData}
              onEdit={enterEdit}
              onDelete={onDelete}
              onOpenAllReviews={() => setReviewSubView('reviews')}
              onOpenReviewDetail={(r) => {
                setActiveReviewId(r.id)
                setReviewDetailReturn('detail')
                setReviewSubView('review-detail')
              }}
              onClose={onClose}
              onPublish={onPublish}
            />
          )
        ) : (
          <>
            <div hidden={reviewSubView !== 'reviews'} aria-hidden={reviewSubView !== 'reviews'} className={reviewSubView === 'reviews' ? 'block' : 'hidden'}>
              <AllReviewsView
                context={bookReviewContext}
                canReview={bookCanReview}
                onOpenCompose={() => {
                  setDialogEditingReview(null)
                  setDialogReviewEditorOpen(true)
                }}
                onOpenEdit={(r) => {
                  setDialogEditingReview(r)
                  setDialogReviewEditorOpen(true)
                }}
                onOpenReviewDetail={(r) => {
                  setActiveReviewId(r.id)
                  setReviewDetailReturn('reviews')
                  setReviewSubView('review-detail')
                }}
              />
            </div>

            {reviewSubView === 'review-detail' && activeBookReview && (
              <ReviewDetailView
                review={activeBookReview}
              />
            )}
          </>
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

      {dialogReviewEditorOpen && bookReviewComposer?.bookVersionId && (
        <ReviewEditor
          bookVersionId={bookReviewComposer.bookVersionId}
          existing={dialogEditingReview ?? bookOwnReview}
          composer={bookReviewComposer}
          onClose={() => {
            setDialogReviewEditorOpen(false)
            setDialogEditingReview(null)
          }}
          onSaved={() => {
            void reviewBookQuery.refetch()
          }}
        />
      )}

      {!readOnly && !isLibraryOwned && displayBook.format === 'txt' && appendContentOpen && <AppendContentModal target={{ bookId: book.id }} onClose={() => setAppendContentOpen(false)} />}
    </>
  )
}
