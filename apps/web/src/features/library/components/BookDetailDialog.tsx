import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import type { BookListItem, BookMetadata } from '@bookdock/shared'

import { apiDelete, apiPatch, apiPut, apiUpload } from '@/api/client'
import { useBookTransforms } from '@/api/hooks/useTransforms'
import { Button } from '@/components/ui/Button'
import MenuFlyout from '@/components/ui/MenuFlyout'
import Modal from '@/components/ui/Modal'
import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { formatBytes, formatDate } from '@/lib/utils'
import { computeFromAnchor, PADDING, type SmartPosition } from '@/lib/position'
import { notify } from '@/lib/notifications'

import {
  useBook,
  useBookMembership,
  useCreateShelf,
  useCreateTag,
  useResetMetadata,
  useShelves,
  useTags,
  useUpdateBook,
} from '../hooks'
import { downloadBook, downloadEditedTxt, downloadEpub, downloadOriginalTxt } from '../download'

import BookCover from './BookCover'
import TocRulePicker from './TocRulePicker'
import { READ_STATUS_OPTIONS, STATUS_DOT, statusLabelKey } from './read-status'

interface BookDetailDialogProps {
  book: BookListItem | null
  onClose: () => void
  onDelete: (book: BookListItem) => void
}

interface MetaDraft {
  title: string
  author: string
  publisher: string
  published: string
  isbn: string
  language: string
  subjects: string
  series: string
  seriesIndex: string
  description: string
}

function draftFrom(book: BookListItem, bookmeta?: BookMetadata): MetaDraft {
  return {
    title: book.title,
    author: book.author,
    publisher: bookmeta?.publisher ?? '',
    published: bookmeta?.published ?? '',
    isbn: bookmeta?.isbn ?? '',
    language: bookmeta?.language ?? '',
    subjects: (bookmeta?.subjects ?? []).join(', '),
    series: bookmeta?.series ?? '',
    seriesIndex: bookmeta?.seriesIndex != null ? String(bookmeta.seriesIndex) : '',
    description: bookmeta?.description ?? '',
  }
}

// identifier is intentionally not part of the draft: it stays read-only and
// is never written back on save.
function draftToBookmeta(draft: MetaDraft): BookMetadata {
  const bookmeta: BookMetadata = {}
  if (draft.publisher.trim()) bookmeta.publisher = draft.publisher.trim()
  if (draft.published.trim()) bookmeta.published = draft.published.trim()
  if (draft.isbn.trim()) bookmeta.isbn = draft.isbn.trim()
  if (draft.language.trim()) bookmeta.language = draft.language.trim()
  const subjects = draft.subjects.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
  if (subjects.length > 0) bookmeta.subjects = subjects
  if (draft.description.trim()) bookmeta.description = draft.description
  if (draft.series.trim()) bookmeta.series = draft.series.trim()
  const seriesIndex = parseFloat(draft.seriesIndex)
  if (!Number.isNaN(seriesIndex)) bookmeta.seriesIndex = seriesIndex
  return bookmeta
}

function middleTruncate(value: string, max = 28): string {
  if (value.length <= max) return value
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

export default function BookDetailDialog({ book, onClose, onDelete }: BookDetailDialogProps) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: detailData } = useBook(book?.id ?? null)
  const detail = detailData?.data
  const displayBook: BookListItem = detail ?? book!
  const bookmeta = detail?.meta?.bookmeta

  const { shelves: memShelves, tags: memTags } = useBookMembership(book?.id ?? null)
  const { data: shelvesData } = useShelves()
  const { data: tagsData } = useTags()

  const resetMetadata = useResetMetadata()
  const createShelf = useCreateShelf()
  const createTag = useCreateTag()

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [draft, setDraft] = useState<MetaDraft | null>(null)
  const [pendingCoverFile, setPendingCoverFile] = useState<File | null>(null)
  const [coverRemovalPending, setCoverRemovalPending] = useState(false)
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null)
  const [shelfSel, setShelfSel] = useState<string | null>(null)
  const [tagSel, setTagSel] = useState<Set<string>>(new Set())
  const [newShelf, setNewShelf] = useState('')
  const [newShelfOpen, setNewShelfOpen] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [newTagOpen, setNewTagOpen] = useState(false)
  const newShelfEditorRef = useRef<HTMLSpanElement>(null)
  const newTagEditorRef = useRef<HTMLSpanElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)

  // P4 2×2: the 校订版 branch only shows when the book has effective rules.
  const { data: transformsData } = useBookTransforms(book?.id)
  const hasEffectiveRules = useMemo(
    () => (transformsData?.data ?? []).some((r) => (r.effectiveEnabled ?? r.enabled)),
    [transformsData],
  )
  const [downloadMenu, setDownloadMenu] = useState<SmartPosition | null>(null)
  const downloadAnchorRef = useRef<HTMLDivElement>(null)
  const downloadMenuRef = useRef<HTMLDivElement>(null)
  const [moreMenu, setMoreMenu] = useState<SmartPosition | null>(null)
  const moreAnchorRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const [tocRuleOpen, setTocRuleOpen] = useState(false)

  useEffect(() => {
    if (!pendingCoverFile) {
      setCoverPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(pendingCoverFile)
    setCoverPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingCoverFile])

  function toggleDownloadMenu() {
    const el = downloadAnchorRef.current
    if (!el) return
    if (downloadMenu) {
      setDownloadMenu(null)
      return
    }
    const rect = el.getBoundingClientRect()
    setDownloadMenu(computeFromAnchor(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      176,
      96,
    ))
  }

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
    // The button sits at the dialog's right edge. Keep this menu attached to
    // that edge instead of opening into the page just because the viewport
    // itself has spare space.
    setMoreMenu({
      ...position,
      left: Math.max(PADDING, Math.min(rect.right - menuW, window.innerWidth - menuW - PADDING)),
    })
  }

  async function onExport(format: 'epub' | 'txt', plain: boolean) {
    setDownloadMenu(null)
    try {
      if (format === 'epub') {
        await downloadEpub(book!.id, book!.title, { plain })
      } else if (plain) {
        await downloadOriginalTxt(book!.id, book!.title)
      } else {
        await downloadEditedTxt(book!.id, book!.title)
      }
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'errors.downloadFailed'))
    }
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
    onClose()
  }, [discardEdit, onClose])

  useEffect(() => {
    if (!book) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDialog()
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
    setNewShelf('')
    setNewShelfOpen(false)
    setNewTag('')
    setNewTagOpen(false)
    setTocRuleOpen(false)
  }, [book?.id])

  useEffect(() => {
    if (!newShelfOpen && !newTagOpen) return
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (newShelfEditorRef.current?.contains(target) || newTagEditorRef.current?.contains(target)) return
      setNewShelf('')
      setNewShelfOpen(false)
      setNewTag('')
      setNewTagOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [newShelfOpen, newTagOpen])

  function enterEdit() {
    if (!book) return
    setDraft(draftFrom(displayBook, bookmeta))
    setPendingCoverFile(null)
    setCoverRemovalPending(false)
    setShelfSel(memShelves.data?.data ?? null)
    setTagSel(new Set(memTags.data?.data ?? []))
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

  async function handleCreateTag() {
    const name = newTag.trim()
    if (!name) return
    try {
      const res = await createTag.mutateAsync(name)
      setTagSel((prev) => new Set(prev).add(res.data.id))
      setNewTag('')
      setNewTagOpen(false)
    } catch {
      // toast handled by the hook
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      notify.success({ key: 'library.copied' })
    } catch {
      notify.error({ key: 'library.copyFailed' })
    }
  }

  if (!book) return null

  const currentShelfId = memShelves.data?.data ?? null
  const tagIds = new Set(memTags.data?.data ?? [])
  const shelfName = currentShelfId
    ? (shelvesData?.data ?? []).find((s) => s.id === currentShelfId)?.name
    : undefined
  const memberTags = (tagsData?.data ?? []).filter((t) => tagIds.has(t.id))

  const hasProgress = displayBook.progress != null && displayBook.progress > 0
  // The 校订版 branch only exists when the book has effective rules; the 原文
  // branch is always available for TXT books. EPUB books keep the single
  // stored-file download (no menu).
  const canExportEdited = displayBook.format === 'txt' && hasEffectiveRules
  const identifier = bookmeta?.isbn || bookmeta?.identifier || ''

  function goToFilter(search: { shelf?: string; tag?: string; author?: string; series?: string }) {
    onClose()
    void navigate({ to: '/', search })
  }

  async function handleCreateShelf() {
    const name = newShelf.trim()
    if (!name) return
    try {
      const res = await createShelf.mutateAsync(name)
      setShelfSel(res.data.id)
      setNewShelf('')
      setNewShelfOpen(false)
    } catch {
      // toast handled by the hook
    }
  }

  const metaRows: { label: string; value: string; copyable?: boolean; onClick?: () => void }[] = []
  if (bookmeta?.publisher) metaRows.push({ label: _('library.publisher'), value: bookmeta.publisher })
  if (bookmeta?.published) metaRows.push({ label: _('library.published'), value: bookmeta.published })
  metaRows.push({ label: _('library.updatedAt'), value: formatDate(displayBook.updatedAt) })
  metaRows.push({ label: _('library.addedAt'), value: formatDate(displayBook.createdAt) })
  if (bookmeta?.language) metaRows.push({ label: _('library.language'), value: bookmeta.language })
  if (bookmeta?.subjects?.length) metaRows.push({ label: _('library.subjects'), value: bookmeta.subjects.join('、') })
  metaRows.push({ label: _('library.format'), value: displayBook.format.toUpperCase() })
  metaRows.push({ label: _('library.sortBy.size'), value: formatBytes(displayBook.size) })
  if (identifier) metaRows.push({ label: bookmeta?.isbn ? 'ISBN' : _('library.identifier'), value: identifier, copyable: true })
  if (bookmeta?.series) {
    metaRows.push({
      label: _('library.seriesSection'),
      value: bookmeta.seriesIndex != null ? `${bookmeta.series} #${bookmeta.seriesIndex}` : bookmeta.series,
      onClick: () => goToFilter({ series: bookmeta.series }),
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 pb-[env(safe-area-inset-bottom)] sm:items-center sm:p-4"
      onClick={closeDialog}
    >
      <div
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-h-[85vh] sm:rounded-2xl dark:bg-stone-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-stone-100 px-4 py-3 sm:px-5 dark:border-stone-800">
          <h2 className="font-serif text-base font-semibold text-stone-900 dark:text-stone-100">
            {editing ? _('library.edit') : _('library.details')}
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
                  </SmartMenu>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={closeDialog}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              aria-label={_('library.cancel')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:px-5">
          {editing && draft ? (
            <div>
              <section>
                <GroupLabel>{_('library.editGroupBasic')}</GroupLabel>
                <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
                  <div className="w-28 shrink-0 self-center sm:self-auto">
                    <div
                      className="group relative cursor-pointer"
                      onClick={() => coverInputRef.current?.click()}
                    >
                      <BookCover
                        book={displayBook}
                        coverSrc={coverRemovalPending ? null : pendingCoverFile ? coverPreviewUrl : undefined}
                      />
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-black/55 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                        <span className="rounded-md bg-white/90 px-2.5 py-1 text-xs font-medium text-stone-800">
                          {_('library.changeCover')}
                        </span>
                        {(displayBook.coverKey || pendingCoverFile) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (!saving) {
                                setPendingCoverFile(null)
                                setCoverRemovalPending(Boolean(displayBook.coverKey))
                              }
                            }}
                            disabled={saving}
                            className="rounded-md bg-black/40 px-2.5 py-1 text-xs text-white/90 transition-colors hover:bg-black/60"
                          >
                            {_('library.removeCover')}
                          </button>
                        )}
                      </div>
                      <input
                        ref={coverInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        disabled={saving}
                        onChange={(e) => {
                          void handleCoverFile(e.target.files?.[0])
                          e.target.value = ''
                        }}
                      />
                    </div>
                  </div>
                  <div className="min-w-0 flex-1 space-y-3">
                    <Field label={_('library.sortBy.title')} required>
                      <input
                        type="text"
                        value={draft.title}
                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                    <Field label={_('library.sortBy.author')}>
                      <input
                        type="text"
                        value={draft.author}
                        onChange={(e) => setDraft({ ...draft, author: e.target.value })}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                </div>
                <div className="mt-3">
                  <Field label={_('library.descriptionSection')}>
                    <textarea
                      ref={autoGrow}
                      rows={3}
                      value={draft.description}
                      onChange={(e) => {
                        setDraft({ ...draft, description: e.target.value })
                        autoGrow(e.target)
                      }}
                      className={textareaClass}
                    />
                  </Field>
                </div>
              </section>

              <section className="mt-6">
                <GroupLabel>{_('library.editGroupPublishing')}</GroupLabel>
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <Field label={_('library.publisher')}>
                    <input type="text" value={draft.publisher} onChange={(e) => setDraft({ ...draft, publisher: e.target.value })} className={inputClass} />
                  </Field>
                  <Field label={_('library.published')}>
                    <input type="text" value={draft.published} onChange={(e) => setDraft({ ...draft, published: e.target.value })} className={inputClass} />
                  </Field>
                  <Field label={_('library.language')}>
                    <input type="text" value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })} className={inputClass} />
                  </Field>
                  <Field label="ISBN">
                    <input type="text" value={draft.isbn} onChange={(e) => setDraft({ ...draft, isbn: e.target.value })} className={inputClass} />
                  </Field>
                  <Field label={_('library.subjects')}>
                    <input type="text" value={draft.subjects} onChange={(e) => setDraft({ ...draft, subjects: e.target.value })} className={inputClass} />
                  </Field>
                </div>
                {identifier && (
                  <div className="mt-3">
                    <span className="mb-1 block text-xs text-stone-400 dark:text-stone-500">{_('library.identifier')}</span>
                    <button
                      type="button"
                      title={identifier}
                      onClick={() => void copyText(identifier)}
                      className="font-mono text-sm text-stone-600 transition-colors hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
                    >
                      {middleTruncate(identifier)}
                    </button>
                  </div>
                )}
              </section>

              <section className="mt-6">
                <GroupLabel>{_('library.seriesSection')}</GroupLabel>
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <Field label={_('library.seriesSection')}>
                    <input type="text" value={draft.series} onChange={(e) => setDraft({ ...draft, series: e.target.value })} className={inputClass} />
                  </Field>
                  <Field label={_('library.seriesIndex')}>
                    <input type="text" inputMode="decimal" value={draft.seriesIndex} onChange={(e) => setDraft({ ...draft, seriesIndex: e.target.value })} className={inputClass} />
                  </Field>
                </div>
              </section>

              <section className="mt-6">
                <GroupLabel>{_('library.membershipSection')}</GroupLabel>
                <p className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">{_('library.shelves')}</p>
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  <Chip
                    label={_('library.uncategorized')}
                    selected={shelfSel === null}
                    onClick={() => setShelfSel(null)}
                  />
                  {(shelvesData?.data ?? []).map((shelf) => (
                    <Chip
                      key={shelf.id}
                      label={shelf.name}
                      selected={shelfSel === shelf.id}
                      onClick={() => setShelfSel(shelf.id)}
                    />
                  ))}
                  {newShelfOpen ? (
                    <span ref={newShelfEditorRef} className="flex items-center gap-1">
                      <input
                        type="text"
                        value={newShelf}
                        autoFocus
                        onChange={(e) => setNewShelf(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void handleCreateShelf()
                          } else if (e.key === 'Escape') {
                            e.stopPropagation()
                            setNewShelf('')
                            setNewShelfOpen(false)
                          }
                        }}
                        placeholder={_('library.newShelfPlaceholder')}
                        className="h-8 w-28 rounded-full border border-stone-200 bg-white px-3 text-xs text-stone-700 outline-none placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCreateShelf()}
                        disabled={!newShelf.trim() || createShelf.isPending}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-800 disabled:opacity-40 dark:border-stone-700 dark:hover:text-stone-200"
                        aria-label={_('library.newShelf')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m5 13 4 4 10-10" />
                        </svg>
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setNewShelfOpen(true)}
                      className="rounded-full border border-dashed border-stone-300 px-3 py-1.5 text-xs text-stone-400 transition-colors hover:border-stone-400 hover:text-stone-600 dark:border-stone-600 dark:hover:border-stone-500 dark:hover:text-stone-300"
                    >
                      + {_('library.newShelf')}
                    </button>
                  )}
                </div>

                <p className="mb-2 mt-4 text-xs font-medium text-stone-500 dark:text-stone-400">{_('library.tags')}</p>
                <div className="flex max-h-28 flex-wrap items-center gap-1.5 overflow-y-auto">
                  {(tagsData?.data ?? []).map((tag) => (
                    <Chip
                      key={tag.id}
                      label={tag.name}
                      selected={tagSel.has(tag.id)}
                      onClick={() => setTagSel((prev) => toggle(prev, tag.id))}
                    />
                  ))}
                  {newTagOpen ? (
                    <span ref={newTagEditorRef} className="flex items-center gap-1">
                      <input
                        type="text"
                        value={newTag}
                        autoFocus
                        onChange={(e) => setNewTag(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            void handleCreateTag()
                          } else if (e.key === 'Escape') {
                            e.stopPropagation()
                            setNewTag('')
                            setNewTagOpen(false)
                          }
                        }}
                        placeholder={_('library.newTagPlaceholder')}
                        className="h-8 w-28 rounded-full border border-stone-200 bg-white px-3 text-xs text-stone-700 outline-none placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCreateTag()}
                        disabled={!newTag.trim() || createTag.isPending}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-800 disabled:opacity-40 dark:border-stone-700 dark:hover:text-stone-200"
                        aria-label={_('library.newTag')}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m5 13 4 4 10-10" />
                        </svg>
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setNewTagOpen(true)}
                      className="rounded-full border border-dashed border-stone-300 px-3 py-1.5 text-xs text-stone-400 transition-colors hover:border-stone-400 hover:text-stone-600 dark:border-stone-600 dark:hover:border-stone-500 dark:hover:text-stone-300"
                    >
                      + {_('library.newTag')}
                    </button>
                  )}
                </div>
              </section>
            </div>
          ) : (
            <div>
              <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
                <div className="w-32 shrink-0 self-center sm:self-auto">
                  <BookCover book={displayBook} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-serif text-xl font-semibold leading-snug text-stone-900 dark:text-stone-100">
                    {displayBook.title}
                  </h3>
                  {displayBook.author ? (
                    <button
                      type="button"
                      onClick={() => goToFilter({ author: displayBook.author })}
                      className="mt-1 text-left text-sm text-stone-500 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 dark:text-stone-400 dark:decoration-stone-600 dark:hover:text-stone-100"
                    >
                      {displayBook.author}
                    </button>
                  ) : (
                    <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                      {_('library.unknown')}
                    </p>
                  )}

                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <ReadStatusChip book={displayBook} />
                    <span className="rounded-md bg-stone-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white dark:bg-stone-100 dark:text-stone-900">
                      {displayBook.format}
                    </span>
                    {shelfName && currentShelfId ? (
                      <FilterChip label={shelfName} onClick={() => goToFilter({ shelf: currentShelfId })} />
                    ) : null}
                    {memberTags.map((tag) => (
                      <FilterChip key={tag.id} label={tag.name} onClick={() => goToFilter({ tag: tag.id })} />
                    ))}
                  </div>

                  {hasProgress && (
                    <div className="mt-3 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                        <div
                          className="h-full rounded-full bg-stone-700 dark:bg-stone-400"
                          style={{ width: `${displayBook.progress}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-stone-500">{Math.round(displayBook.progress ?? 0)}%</span>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center gap-2">
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
                    <div className="flex items-center gap-1">
                      <ActionIcon label={_('library.edit')} onClick={enterEdit}>
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </ActionIcon>
                      <div ref={downloadAnchorRef} className="relative">
                        <ActionIcon
                          label={_('library.download')}
                          onClick={displayBook.format === 'txt'
                            ? toggleDownloadMenu
                            : () => void Promise.resolve(downloadBook(book!.id, book!.title)).catch((err) => notify.error(getUserErrorNotification(err, 'errors.downloadFailed')))}
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </ActionIcon>
                        {downloadMenu && (
                          <SmartMenu
                            innerRef={downloadMenuRef}
                            position={downloadMenu}
                            onClose={() => setDownloadMenu(null)}
                          >
                            {canExportEdited && (
                              <MenuFlyout
                                panelWidth={96}
                                row={({ open, flip, toggle }) => (
                                  <button
                                    type="button"
                                    onClick={toggle}
                                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-stone-500/10 ${open ? 'bg-stone-500/10' : ''}`}
                                  >
                                    <span className="flex-1">{_('library.edited')}</span>
                                    <FlyoutChevron flip={flip} />
                                  </button>
                                )}
                              >
                                {(close) => (
                                  <ExportFormats
                                    onPick={(format) => { close(); void onExport(format, false) }}
                                  />
                                )}
                              </MenuFlyout>
                            )}
                            <MenuFlyout
                              panelWidth={96}
                              row={({ open, flip, toggle }) => (
                                <button
                                  type="button"
                                  onClick={toggle}
                                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-stone-500/10 ${open ? 'bg-stone-500/10' : ''}`}
                                >
                                  <span className="flex-1">{_('library.original')}</span>
                                  <FlyoutChevron flip={flip} />
                                </button>
                              )}
                            >
                              {(close) => (
                                <ExportFormats
                                  onPick={(format) => { close(); void onExport(format, true) }}
                                />
                              )}
                            </MenuFlyout>
                          </SmartMenu>
                        )}
                      </div>
                      <ActionIcon label={_('library.delete')} danger onClick={() => onDelete(book)}>
                        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                      </ActionIcon>
                    </div>
                  </div>
                </div>
              </div>

              {bookmeta?.description && (
                <section className="mt-6">
                  <GroupLabel>{_('library.descriptionSection')}</GroupLabel>
                  <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-stone-600 dark:text-stone-300">
                    {bookmeta.description}
                  </p>
                </section>
              )}

              <section className="mt-6">
                <GroupLabel>{_('library.metaSection')}</GroupLabel>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                  {metaRows.map((row) => (
                    <div key={row.label} className="min-w-0">
                      <dt className="text-xs text-stone-400 dark:text-stone-500">{row.label}</dt>
                      {row.copyable ? (
                        <dd className="mt-0.5">
                          <button
                            type="button"
                            title={row.value}
                            onClick={() => void copyText(row.value)}
                            className="break-all font-mono text-sm text-stone-700 transition-colors hover:text-stone-900 dark:text-stone-200 dark:hover:text-stone-100"
                          >
                            {middleTruncate(row.value)}
                          </button>
                        </dd>
                      ) : row.onClick ? (
                        <dd className="mt-0.5">
                          <button
                            type="button"
                            title={row.value}
                            onClick={row.onClick}
                            className="break-words text-left text-sm text-stone-700 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 dark:text-stone-200 dark:decoration-stone-600 dark:hover:text-stone-100"
                          >
                            {row.value}
                          </button>
                        </dd>
                      ) : (
                        <dd className="mt-0.5 break-words text-sm text-stone-700 dark:text-stone-200">{row.value}</dd>
                      )}
                    </div>
                  ))}
                </dl>
              </section>
            </div>
          )}

          {displayBook.format === 'txt' && tocRuleOpen && (
            <Modal title={_('library.tocRuleSection')} onClose={() => setTocRuleOpen(false)}>
              <TocRulePicker
                bookId={book.id}
                currentRuleId={detail?.meta?.tocRuleId}
                autoScored={detail?.meta?.tocRuleAuto}
              />
            </Modal>
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
                className="text-xs text-stone-400 transition-colors hover:text-stone-700 dark:hover:text-stone-200"
              >
                {_('library.resetMetadata')}
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
  )
}

const inputClass = 'h-9 w-full rounded-lg border border-stone-200 bg-white px-2.5 text-sm text-stone-700 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500'

const textareaClass = 'w-full resize-none overflow-hidden rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-sm leading-relaxed text-stone-700 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500'

function toggle(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
      {children}
    </p>
  )
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs text-stone-400 dark:text-stone-500">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </span>
      {children}
    </label>
  )
}

function ReadStatusChip({ book }: { book: BookListItem }) {
  const _ = useTranslation()
  const updateBook = useUpdateBook()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-900 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[book.readStatus]}`} />
        {_(statusLabelKey(book.readStatus))}
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-10 w-36 rounded-xl border border-stone-200/80 bg-white/95 p-1 shadow-xl shadow-stone-900/8 backdrop-blur-md dark:border-stone-700 dark:bg-stone-900/95">
          {READ_STATUS_OPTIONS.map((action) => (
            <button
              key={action.value}
              type="button"
              onClick={() => {
                setOpen(false)
                updateBook.mutate({ bookId: book.id, readStatus: action.value })
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-200 dark:hover:bg-stone-800"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${action.iconClass}`}>
                {action.icon}
              </svg>
              <span className="flex-1">{_(action.labelKey)}</span>
              {book.readStatus === action.value && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-500 dark:text-stone-300">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function FlyoutChevron({ flip }: { flip: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-stone-400 transition-transform ${flip ? 'rotate-180' : ''}`}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

const exportItemClass = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-stone-500/10'

// The second level of the download menu: the concrete format per 原文/校订版.
function ExportFormats({ onPick }: { onPick: (format: 'epub' | 'txt') => void }) {
  return (
    <>
      <button type="button" onClick={() => onPick('epub')} className={exportItemClass}>EPUB</button>
      <button type="button" onClick={() => onPick('txt')} className={exportItemClass}>TXT</button>
    </>
  )
}

function FilterChip({ label, muted = false, onClick }: { label: string; muted?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2 py-0.5 text-xs transition-colors ${
        muted
          ? 'border border-dashed border-stone-300 text-stone-400 hover:border-stone-400 hover:text-stone-600 dark:border-stone-600 dark:hover:border-stone-500 dark:hover:text-stone-300'
          : 'bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100'
      }`}
    >
      {label}
    </button>
  )
}

function Chip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        selected
          ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
          : 'border border-stone-200 text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-stone-700 dark:text-stone-300 dark:hover:border-stone-600 dark:hover:text-stone-100'
      }`}
    >
      {label}
    </button>
  )
}

function ActionIcon({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
        danger
          ? 'text-stone-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400'
          : 'text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200'
      }`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  )
}
