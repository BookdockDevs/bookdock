import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { BookListItem } from '@bookdock/shared'

import { apiDelete, apiPatch, apiPut, apiUpload } from '@/api/client'
import { useBookChapters } from '@/api/hooks/useBookChapters'
import { Button } from '@/components/ui/Button'
import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { computeFromAnchor, PADDING, type SmartPosition } from '@/lib/position'

import { useBook, useBookMembership, useResetMetadata, useShelves, useTags } from '../hooks'

import AppendContentModal from './AppendContentModal'
import BookClassificationEditor from './book-detail/BookClassificationEditor'
import BookCoverEditor from './book-detail/BookCoverEditor'
import BookDetailView from './book-detail/BookDetailView'
import BookMetaForm from './book-detail/BookMetaForm'
import { draftFrom, draftToBookmeta, type MetaDraft } from './book-detail/types'
import TocRulePicker from './TocRulePicker'

interface BookDetailDialogProps {
  book: BookListItem | null
  onClose: () => void
  onDelete: (book: BookListItem) => void
}

export default function BookDetailDialog({ book, onClose, onDelete }: BookDetailDialogProps) {
  const _ = useTranslation()
  const queryClient = useQueryClient()

  const { data: detailData, isLoading: detailLoading } = useBook(book?.id ?? null)
  const detail = detailData?.data
  const displayBook: BookListItem = detail ?? book!
  const bookmeta = detail?.meta?.bookmeta

  const { shelves: memShelves, tags: memTags } = useBookMembership(book?.id ?? null)
  const { data: shelvesData } = useShelves()
  const { data: tagsData } = useTags()

  const resetMetadata = useResetMetadata()

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [draft, setDraft] = useState<MetaDraft | null>(null)

  const [pendingCoverFile, setPendingCoverFile] = useState<File | null>(null)
  const [coverRemovalPending, setCoverRemovalPending] = useState(false)
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null)
  const [shelfSel, setShelfSel] = useState<string | null>(null)
  const [tagSel, setTagSel] = useState<Set<string>>(new Set())

  const [moreMenu, setMoreMenu] = useState<SmartPosition | null>(null)
  const moreAnchorRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const [tocRuleOpen, setTocRuleOpen] = useState(false)
  const [appendContentOpen, setAppendContentOpen] = useState(false)
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

  function toggleMoreMenu() {
    const el = moreAnchorRef.current
    if (!el) return
    if (moreMenu) {
      setMoreMenu(null)
      return
    }
    const rect = el.getBoundingClientRect()
    const menuW = 176
    const position = computeFromAnchor(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      menuW,
      88,
    )
    setMoreMenu({
      ...position,
      left: Math.max(PADDING, Math.min(rect.right - menuW, window.innerWidth - menuW - PADDING)),
    })
  }

  const discardEdit = useCallback(() => {
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
      if (e.key === 'Escape' && !e.defaultPrevented) closeDialog()
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

  function enterEdit() {
    if (!book) return
    setDraft(draftFrom(displayBook, bookmeta))
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
    setEditing(true)
  }

  async function handleSave() {
    if (!book || !draft) return
    const title = draft.title.trim()
    if (!title) return
    setSaving(true)
    try {
      const requests: Promise<unknown>[] = [
        apiPatch(`/books/${book.id}`, {
          title,
          author: draft.author.trim(),
          bookmeta: draftToBookmeta(draft),
        }),
        apiPut(`/books/${book.id}/shelves`, { shelfId: shelfSel }),
        apiPut(`/books/${book.id}/tags`, { tagIds: [...tagSel] }),
      ]
      if (coverRemovalPending) {
        requests.push(apiDelete(`/books/${book.id}/cover`))
      } else if (pendingCoverFile) {
        requests.push(apiUpload(`/books/${book.id}/cover`, pendingCoverFile, 'PUT'))
      }
      await Promise.all(requests)
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      notify.success({ key: 'toast.bookUpdated' })
      discardEdit()
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'errors.updateFailed'))
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    if (!book) return
    try {
      await resetMetadata.mutateAsync(book.id)
      discardEdit()
    } catch {
      // toast handled by the hook
    }
  }

  function handleCoverFile(file: File | undefined) {
    if (!book || !file || saving) return
    setPendingCoverFile(file)
    setCoverRemovalPending(false)
  }

  if (!book) return null

  const currentShelfId =
    memShelves.data?.data !== undefined ? memShelves.data.data : (book.shelfId ?? null)
  const tagIds = memTags.data?.data ? new Set(memTags.data.data) : null
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

  return (
    <>
      <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 pb-[env(safe-area-inset-bottom)] sm:items-center sm:p-4"
      onClick={closeDialog}
    >
      <div
        className="flex min-h-[340px] max-h-[calc(100dvh-1rem)] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:min-h-[380px] sm:max-h-[85vh] sm:rounded-2xl dark:bg-stone-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-stone-100 px-4 py-3 sm:px-5 dark:border-stone-800">
          <h2 className="font-serif text-base font-semibold text-stone-900 dark:text-stone-100">
            {editing ? _('library.editBook') : _('library.bookDetails')}
          </h2>
          <div className="flex items-center gap-1">
            {displayBook.format === 'txt' && (
              <div ref={moreAnchorRef} className="relative">
                <button
                  type="button"
                  onClick={toggleMoreMenu}
                  aria-label={_('library.moreActions')}
                  title={_('library.moreActions')}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="1" />
                    <circle cx="19" cy="12" r="1" />
                    <circle cx="5" cy="12" r="1" />
                  </svg>
                </button>
                {moreMenu && (
                  <SmartMenu innerRef={moreMenuRef} position={moreMenu} onClose={() => setMoreMenu(null)}>
                    <button
                      type="button"
                      onClick={() => {
                        setMoreMenu(null)
                        setTocRuleOpen(true)
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 transition-colors hover:bg-stone-500/10 dark:text-stone-200"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                        <line x1="8" y1="6" x2="21" y2="6" />
                        <line x1="8" y1="12" x2="21" y2="12" />
                        <line x1="8" y1="18" x2="21" y2="18" />
                        <line x1="3" y1="6" x2="3.01" y2="6" />
                        <line x1="3" y1="12" x2="3.01" y2="12" />
                        <line x1="3" y1="18" x2="3.01" y2="18" />
                      </svg>
                      <span className="flex-1">{_('library.changeTocRule')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMoreMenu(null)
                        setAppendContentOpen(true)
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 transition-colors hover:bg-stone-500/10 dark:text-stone-200"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                      <span className="flex-1">{_('library.appendContent')}</span>
                    </button>
                  </SmartMenu>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={closeDialog}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              aria-label={_('library.close')}
              title={_('library.close')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:px-5">
          {editing && draft ? (
            <div>
              <BookMetaForm
                draft={draft}
                onChange={setDraft}
                identifier={identifier}
                coverSlot={
                  <BookCoverEditor
                    book={displayBook}
                    coverRemovalPending={coverRemovalPending}
                    pendingCoverFile={pendingCoverFile}
                    coverPreviewUrl={coverPreviewUrl}
                    saving={saving}
                    onCoverFile={handleCoverFile}
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
              detail={detail}
              shelfName={shelfName}
              currentShelfId={currentShelfId}
              memberTags={memberTags}
              isLoading={detailLoading || !detail}
              onEdit={enterEdit}
              onDelete={onDelete}
              onClose={onClose}
            />
          )}

          {displayBook.format === 'txt' && tocRuleOpen && (
            <TocRulePicker
              bookId={book.id}
              currentRuleId={detail?.meta?.tocRuleId}
              autoScored={detail?.meta?.tocRuleAuto}
              customPatterns={detail?.meta?.customTocPatterns}
              excludedChapterIds={detail?.meta?.tocExcludedChapterIds}
              currentChapters={chaptersData?.data}
              onClose={() => setTocRuleOpen(false)}
            />
          )}
        </div>

        {editing && (
          <div className="flex shrink-0 flex-col gap-3 border-t border-stone-100 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2 sm:px-5 dark:border-stone-800">
            {confirmReset ? (
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-xs text-stone-500 dark:text-stone-400">{_('library.resetMetadataConfirm')}</span>
                <button
                  type="button"
                  onClick={() => void handleReset()}
                  disabled={resetMetadata.isPending}
                  className="shrink-0 text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                >
                  {_('library.resetMetadata')}
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
                className="inline-flex items-center gap-1.5 text-xs text-stone-400 transition-colors hover:text-stone-700 dark:hover:text-stone-200"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
                <span>{_('library.resetMetadata')}</span>
              </button>
            )}
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" onClick={discardEdit} disabled={saving}>
                {_('library.cancel')}
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving || !draft?.title.trim()}>
                {saving ? `${_('library.save')}...` : _('library.save')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
      {appendContentOpen && <AppendContentModal bookId={book.id} onClose={() => setAppendContentOpen(false)} />}
    </>
  )
}
