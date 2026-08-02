import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import type { BookListItem, BookMetadata } from '@bookdock/shared'

import { apiPatch, apiPut } from '@/api/client'
import { useBookReadingRecords } from '@/api/hooks/reading-records'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'
import { formatBytes, formatDate } from '@/lib/utils'
import { useToastStore } from '@/stores/toast.store'
import { Button } from '@/components/ui/Button'

import {
  useBook,
  useBookMembership,
  useCreateTag,
  useRemoveCover,
  useResetMetadata,
  useShelves,
  useTags,
  useUploadCover,
} from '../hooks'
import { downloadBook } from '../download'

import BookCover from './BookCover'

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
  identifier: string
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
    identifier: bookmeta?.identifier ?? '',
    language: bookmeta?.language ?? '',
    subjects: (bookmeta?.subjects ?? []).join(', '),
    series: bookmeta?.series ?? '',
    seriesIndex: bookmeta?.seriesIndex != null ? String(bookmeta.seriesIndex) : '',
    description: bookmeta?.description ?? '',
  }
}

function draftToBookmeta(draft: MetaDraft): BookMetadata {
  const bookmeta: BookMetadata = {}
  if (draft.publisher.trim()) bookmeta.publisher = draft.publisher.trim()
  if (draft.published.trim()) bookmeta.published = draft.published.trim()
  if (draft.isbn.trim()) bookmeta.isbn = draft.isbn.trim()
  if (draft.identifier.trim()) bookmeta.identifier = draft.identifier.trim()
  if (draft.language.trim()) bookmeta.language = draft.language.trim()
  const subjects = draft.subjects.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
  if (subjects.length > 0) bookmeta.subjects = subjects
  if (draft.description.trim()) bookmeta.description = draft.description.trim()
  if (draft.series.trim()) bookmeta.series = draft.series.trim()
  const seriesIndex = parseFloat(draft.seriesIndex)
  if (!Number.isNaN(seriesIndex)) bookmeta.seriesIndex = seriesIndex
  return bookmeta
}

export default function BookDetailDialog({ book, onClose, onDelete }: BookDetailDialogProps) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  const { data: detailData } = useBook(book?.id ?? null)
  const detail = detailData?.data
  const displayBook: BookListItem = detail ?? book!
  const bookmeta = detail?.meta?.bookmeta

  const { shelves: memShelves, tags: memTags } = useBookMembership(book?.id ?? null)
  const { data: shelvesData } = useShelves()
  const { data: tagsData } = useTags()

  const uploadCover = useUploadCover()
  const removeCover = useRemoveCover()
  const resetMetadata = useResetMetadata()
  const createTag = useCreateTag()

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [draft, setDraft] = useState<MetaDraft | null>(null)
  const [shelfSel, setShelfSel] = useState<Set<string>>(new Set())
  const [tagSel, setTagSel] = useState<Set<string>>(new Set())
  const [newTag, setNewTag] = useState('')
  const coverInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!book) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [book, onClose])

  // Reset transient state when switching books
  useEffect(() => {
    setEditing(false)
    setConfirmReset(false)
    setDraft(null)
    setNewTag('')
  }, [book?.id])

  function enterEdit() {
    if (!book) return
    setDraft(draftFrom(displayBook, bookmeta))
    setShelfSel(new Set(memShelves.data?.data ?? []))
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
      await Promise.all([
        apiPatch(`/books/${book.id}`, {
          title,
          author: draft.author.trim(),
          bookmeta: draftToBookmeta(draft),
        }),
        apiPut(`/books/${book.id}/shelves`, { shelfIds: [...shelfSel] }),
        apiPut(`/books/${book.id}/tags`, { tagIds: [...tagSel] }),
      ])
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      addToast(_('toast.bookUpdated'), 'success')
      setEditing(false)
    } catch {
      addToast(_('toast.updateBookFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    if (!book) return
    try {
      await resetMetadata.mutateAsync(book.id)
      setConfirmReset(false)
      setEditing(false)
    } catch {
      // toast handled by the hook
    }
  }

  async function handleCoverFile(file: File | undefined) {
    if (!book || !file) return
    try {
      await uploadCover.mutateAsync({ bookId: book.id, file })
    } catch {
      // toast handled by the hook
    }
  }

  async function handleCreateTag() {
    const name = newTag.trim()
    if (!name) return
    try {
      const res = await createTag.mutateAsync(name)
      setTagSel((prev) => new Set(prev).add(res.data.id))
      setNewTag('')
    } catch {
      // toast handled by the hook
    }
  }

  if (!book) return null

  const shelfIds = new Set(memShelves.data?.data ?? [])
  const tagIds = new Set(memTags.data?.data ?? [])
  const shelfNames = (shelvesData?.data ?? []).filter((s) => shelfIds.has(s.id)).map((s) => s.name)
  const tagNames = (tagsData?.data ?? []).filter((t) => tagIds.has(t.id)).map((t) => t.name)

  const metaRows: { label: string; value: string }[] = [
    { label: _('library.publisher'), value: bookmeta?.publisher || _('library.unknown') },
    { label: _('library.published'), value: bookmeta?.published || _('library.unknown') },
    { label: _('library.updatedAt'), value: formatDate(displayBook.updatedAt) },
    { label: _('library.addedAt'), value: formatDate(displayBook.createdAt) },
    { label: _('library.language'), value: bookmeta?.language || _('library.unknown') },
    { label: _('library.subjects'), value: bookmeta?.subjects?.join('、') || _('library.unknown') },
    { label: _('library.format'), value: displayBook.format.toUpperCase() },
    { label: _('library.sortBy.size'), value: formatBytes(displayBook.size) },
    { label: bookmeta?.isbn ? 'ISBN' : _('library.identifier'), value: bookmeta?.isbn || bookmeta?.identifier || _('library.unknown') },
  ]

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-stone-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-stone-100 px-5 py-3 dark:border-stone-800">
          <h2 className="font-serif text-base font-semibold text-stone-900 dark:text-stone-100">
            {editing ? _('library.edit') : _('library.details')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label={_('library.cancel')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {editing && draft ? (
            <div>
              <div className="flex gap-5">
                <div className="w-28 shrink-0">
                  <div className="group relative">
                    <BookCover book={displayBook} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 rounded-xl bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={() => coverInputRef.current?.click()}
                        className="rounded-md bg-white/90 px-2.5 py-1 text-xs font-medium text-stone-800 transition-colors hover:bg-white"
                      >
                        {_('library.changeCover')}
                      </button>
                      {displayBook.coverKey && (
                        <button
                          type="button"
                          onClick={() => removeCover.mutate(book.id)}
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
                    rows={5}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    className={textareaClass}
                  />
                </Field>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label={_('library.publisher')}>
                  <input type="text" value={draft.publisher} onChange={(e) => setDraft({ ...draft, publisher: e.target.value })} className={inputClass} />
                </Field>
                <Field label={_('library.published')}>
                  <input type="text" value={draft.published} onChange={(e) => setDraft({ ...draft, published: e.target.value })} className={inputClass} />
                </Field>
                <Field label="ISBN">
                  <input type="text" value={draft.isbn} onChange={(e) => setDraft({ ...draft, isbn: e.target.value })} className={inputClass} />
                </Field>
                <Field label={_('library.identifier')}>
                  <input type="text" value={draft.identifier} onChange={(e) => setDraft({ ...draft, identifier: e.target.value })} className={inputClass} />
                </Field>
                <Field label={_('library.language')}>
                  <input type="text" value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })} className={inputClass} />
                </Field>
                <Field label={_('library.subjects')}>
                  <input type="text" value={draft.subjects} onChange={(e) => setDraft({ ...draft, subjects: e.target.value })} className={inputClass} />
                </Field>
                <Field label={_('library.seriesSection')}>
                  <input type="text" value={draft.series} onChange={(e) => setDraft({ ...draft, series: e.target.value })} className={inputClass} />
                </Field>
                <Field label={_('library.seriesIndex')}>
                  <input type="text" inputMode="decimal" value={draft.seriesIndex} onChange={(e) => setDraft({ ...draft, seriesIndex: e.target.value })} className={inputClass} />
                </Field>
              </div>

              <div className="mt-5">
                <p className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">{_('library.shelves')}</p>
                <div className="max-h-28 space-y-0.5 overflow-y-auto">
                  {(shelvesData?.data ?? []).length === 0 && (
                    <p className="py-1 text-xs text-stone-400">{_('library.noShelves')}</p>
                  )}
                  {(shelvesData?.data ?? []).map((shelf) => (
                    <CheckItem
                      key={shelf.id}
                      label={shelf.name}
                      checked={shelfSel.has(shelf.id)}
                      onChange={() => setShelfSel((prev) => toggle(prev, shelf.id))}
                    />
                  ))}
                </div>

                <div className="mb-2 mt-4 flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-stone-500 dark:text-stone-400">{_('library.tags')}</p>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void handleCreateTag()
                        }
                      }}
                      placeholder={_('library.newTagPlaceholder')}
                      className="h-7 w-28 rounded-lg border border-stone-200 bg-white px-2 text-xs text-stone-700 outline-none placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500"
                    />
                    <button
                      type="button"
                      onClick={() => void handleCreateTag()}
                      disabled={!newTag.trim() || createTag.isPending}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-stone-200 text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-800 disabled:opacity-40 dark:border-stone-700 dark:hover:text-stone-200"
                      aria-label={_('library.newTag')}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </button>
                  </div>
                </div>
                <div className="max-h-28 space-y-0.5 overflow-y-auto">
                  {(tagsData?.data ?? []).length === 0 && (
                    <p className="py-1 text-xs text-stone-400">{_('library.noTags')}</p>
                  )}
                  {(tagsData?.data ?? []).map((tag) => (
                    <CheckItem
                      key={tag.id}
                      label={tag.name}
                      checked={tagSel.has(tag.id)}
                      onChange={() => setTagSel((prev) => toggle(prev, tag.id))}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex gap-5">
                <div className="w-28 shrink-0">
                  <BookCover book={displayBook} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-serif text-lg font-semibold leading-snug text-stone-900 dark:text-stone-100">
                    {displayBook.title}
                  </h3>
                  <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                    {displayBook.author || _('library.unknown')}
                  </p>

                  {displayBook.progress != null && displayBook.progress > 0 && (
                    <div className="mt-3 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-700">
                        <div
                          className="h-full rounded-full bg-stone-700 dark:bg-stone-400"
                          style={{ width: `${displayBook.progress}%` }}
                        />
                      </div>
                      <span className="shrink-0 text-xs tabular-nums text-stone-500">{Math.round(displayBook.progress)}%</span>
                    </div>
                  )}

                  <div className="mt-3 flex items-center gap-1">
                    <ActionIcon
                      label={_('library.open')}
                      onClick={() => {
                        onClose()
                        void navigate({ to: '/books/$id', params: { id: book.id } })
                      }}
                    >
                      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
                    </ActionIcon>
                    <ActionIcon label={_('library.edit')} onClick={enterEdit}>
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </ActionIcon>
                    <ActionIcon label={_('library.download')} onClick={() => void downloadBook(book.id, book.title)}>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </ActionIcon>
                    <ActionIcon label={_('library.delete')} danger onClick={() => onDelete(book)}>
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                    </ActionIcon>
                  </div>
                </div>
              </div>

              <Section title={_('library.metaSection')}>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                  {metaRows.map((row) => (
                    <div key={row.label} className="min-w-0">
                      <dt className="text-xs text-stone-400 dark:text-stone-500">{row.label}</dt>
                      <dd className="mt-0.5 break-words text-sm text-stone-700 dark:text-stone-200">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </Section>

              <BookReadingSection bookId={book.id} />

              <Section title={_('library.seriesSection')}>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                  <div className="min-w-0">
                    <dt className="text-xs text-stone-400 dark:text-stone-500">{_('library.seriesSection')}</dt>
                    <dd className="mt-0.5 text-sm text-stone-700 dark:text-stone-200">{bookmeta?.series || _('library.unknown')}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-stone-400 dark:text-stone-500">{_('library.seriesIndex')}</dt>
                    <dd className="mt-0.5 text-sm text-stone-700 dark:text-stone-200">
                      {bookmeta?.seriesIndex != null ? bookmeta.seriesIndex : _('library.unknown')}
                    </dd>
                  </div>
                </dl>
              </Section>

              <Section title={_('library.descriptionSection')}>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-600 dark:text-stone-300">
                  {bookmeta?.description || _('library.noDescription')}
                </p>
              </Section>

              <Section title={_('library.membershipSection')}>
                {shelfNames.length === 0 && tagNames.length === 0 ? (
                  <p className="text-sm text-stone-400">{_('library.unknown')}</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {shelfNames.map((name) => (
                      <span key={`shelf-${name}`} className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                        {name}
                      </span>
                    ))}
                    {tagNames.map((name) => (
                      <span key={`tag-${name}`} className="rounded-md border border-stone-200 px-2 py-0.5 text-xs text-stone-500 dark:border-stone-700 dark:text-stone-400">
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </Section>
            </div>
          )}
        </div>

        {editing && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-stone-100 px-5 py-3 dark:border-stone-800">
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
              <Button variant="secondary" onClick={() => setEditing(false)} disabled={saving}>
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

const textareaClass = 'w-full resize-y rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-sm leading-relaxed text-stone-700 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500'

function toggle(prev: Set<string>, id: string): Set<string> {
  const next = new Set(prev)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
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

function CheckItem({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-stone-700 transition-colors hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 shrink-0 accent-stone-700 dark:accent-stone-300"
      />
      <span className="truncate">{label}</span>
    </label>
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <section className="mt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between border-b border-stone-100 pb-2 dark:border-stone-800"
        aria-expanded={open}
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">{title}</span>
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-stone-400 transition-transform ${open ? '' : 'rotate-180'}`}
        >
          <path d="M18 15l-6-6-6 6" />
        </svg>
      </button>
      {open && <div className="pt-3">{children}</div>}
    </section>
  )
}

const MAX_RECORD_ROWS = 15

function BookReadingSection({ bookId }: { bookId: string }) {
  const _ = useTranslation()
  const { data } = useBookReadingRecords(bookId)
  const detail = data?.data
  if (!detail || detail.totalSeconds === 0) return null
  // records are sorted by date descending
  const firstDate = detail.records[detail.records.length - 1].date
  const lastDate = detail.records[0].date
  const bestDay = detail.records.reduce((a, b) => (b.durationSeconds > a.durationSeconds ? b : a))
  const fmtDay = (date: string) => `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`
  return (
    <Section title={_('stats.bookSection')}>
      <p className="text-sm text-stone-700 dark:text-stone-200">
        {_('stats.bookTotal', { time: formatDuration(detail.totalSeconds, _) })}
        <span className="text-stone-400 dark:text-stone-500"> · {_('stats.bookDays', { n: detail.records.length })}</span>
      </p>
      <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">
        {_('stats.bookSince', { date: fmtDay(firstDate) })}
        {' · '}
        {_('stats.bookBestDay', { time: formatDuration(bestDay.durationSeconds, _), date: fmtDay(bestDay.date) })}
        {' · '}
        {_('stats.bookLastRead', { date: fmtDay(lastDate) })}
      </p>
      <ul className="mt-2 space-y-1">
        {detail.records.slice(0, MAX_RECORD_ROWS).map((r) => (
          <li key={r.date} className="flex items-center justify-between text-sm">
            <span className="tabular-nums text-stone-500 dark:text-stone-400">{r.date}</span>
            <span className="tabular-nums text-stone-700 dark:text-stone-200">{formatDuration(r.durationSeconds, _)}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}
