import { useEffect, useRef, useState } from 'react'

import type { CatalogBook, CatalogBookUpdateReq, CatalogVersion, CatalogVersionUpdateReq } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn, formatAuthorList } from '@/lib/utils'

import { versionOrdinal, versionTabLabel } from '../book-row'
import {
  useLibraryCategories,
  useLibraryTags,
  useRemoveCatalogBookCover,
  useRemoveCatalogVersionCover,
  useResetCatalogVersionMetadata,
  useUpdateCatalogBook,
  useUpdateCatalogVersion,
  useUploadCatalogBookCover,
  useUploadCatalogVersionCover,
} from '../hooks'
import BookCover from './BookCover'
import { autoGrow, copyText, middleTruncate, parseAuthorList } from './book-detail/types'
import { Chip } from './book-detail/ui'

interface WorkEditDialogProps {
  work: CatalogBook
  libraryId: string
  version: CatalogVersion
  versionIndex: number
  onClose: () => void
}

interface VersionDraft {
  name: string
  pendingCoverFile: File | null
  coverPreviewUrl: string | null
  coverRemovalPending: boolean
  publisher: string
  published: string
  language: string
  isbn: string
  subjects: string
  series: string
  seriesIndex: string
  expanded: boolean
  overrideTitle: string
  overrideAuthorsText: string
  overrideDescription: string
}

const inputClass = 'rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-stone-200 dark:focus:ring-stone-200'
const labelClass = 'font-medium text-xs text-stone-500 dark:text-stone-400'

/** The seven publication fields the editor owns; everything else in a version's
 * raw meta rides along untouched so a save never drops keys it cannot show. */
const KNOWN_META_KEYS = ['publisher', 'published', 'language', 'isbn', 'subjects', 'series', 'seriesIndex'] as const

function metaTextFields(meta: Record<string, unknown>): {
  publisher: string
  published: string
  language: string
  isbn: string
  subjects: string
  series: string
  seriesIndex: string
} {
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  return {
    publisher: text(meta.publisher),
    published: text(meta.published),
    language: text(meta.language),
    isbn: text(meta.isbn),
    subjects: Array.isArray(meta.subjects)
      ? meta.subjects.filter((s): s is string => typeof s === 'string').join(', ')
      : '',
    series: text(meta.series),
    seriesIndex: meta.seriesIndex != null && (typeof meta.seriesIndex === 'number' || typeof meta.seriesIndex === 'string')
      ? String(meta.seriesIndex)
      : '',
  }
}

function buildMetaRecord(draft: {
  publisher: string
  published: string
  isbn: string
  language: string
  subjects: string
  series: string
  seriesIndex: string
}): Record<string, unknown> {
  const meta: Record<string, unknown> = {}
  if (draft.publisher.trim()) meta.publisher = draft.publisher.trim()
  if (draft.published.trim()) meta.published = draft.published.trim()
  if (draft.isbn.trim()) meta.isbn = draft.isbn.trim()
  if (draft.language.trim()) meta.language = draft.language.trim()
  const subjects = draft.subjects.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
  if (subjects.length > 0) meta.subjects = subjects
  if (draft.series.trim()) meta.series = draft.series.trim()
  const seriesIndex = parseFloat(draft.seriesIndex)
  if (!Number.isNaN(seriesIndex)) meta.seriesIndex = seriesIndex
  return meta
}

function initDraft(v: CatalogVersion): VersionDraft {
  // Editable fields read the version's own override layer (empty = inherit,
  // the same rule the title/author/description overrides follow) — never the
  // merged effective view, which would materialize inherited values into
  // overrides on save. The expanded cue keeps the display-only identifier.
  const fields = metaTextFields(v.meta ?? {})
  const display = v.effective.bookmeta ?? {}
  const hasExtendedMeta = Boolean(
    fields.publisher ||
    fields.published ||
    fields.language ||
    fields.isbn ||
    fields.subjects ||
    fields.series ||
    fields.seriesIndex ||
    display.identifier,
  )
  return {
    name: v.name,
    pendingCoverFile: null,
    coverPreviewUrl: null,
    coverRemovalPending: false,
    ...fields,
    expanded: hasExtendedMeta,
    overrideTitle: v.title ?? '',
    overrideAuthorsText: v.authors ? formatAuthorList(v.authors, v.author ?? '') : '',
    overrideDescription: v.description ?? '',
  }
}

export default function WorkEditDialog({ work, libraryId, version, versionIndex: _versionIndex, onClose }: WorkEditDialogProps) {
  const _ = useTranslation()
  const updateBook = useUpdateCatalogBook()
  const updateVersion = useUpdateCatalogVersion()
  const uploadWorkCover = useUploadCatalogBookCover()
  const removeWorkCover = useRemoveCatalogBookCover()
  const uploadVersionCover = useUploadCatalogVersionCover()
  const removeVersionCover = useRemoveCatalogVersionCover()
  const resetVersionMetadata = useResetCatalogVersionMetadata()

  const { data: categoriesData } = useLibraryCategories(libraryId)
  const { data: tagsData } = useLibraryTags(libraryId)

  const [activeTab, setActiveTab] = useState<'work' | string>(
    // Open where the caller pointed: jumping from a version's menu straight
    // into its tab instead of always landing on the work tab.
    () => (version && work.versions.some((v) => v.id === version.id) ? version.id : 'work'),
  )
  const [confirmResetVersion, setConfirmResetVersion] = useState<CatalogVersion | null>(null)

  // ------------------------------------------------------------- Tab 1: Work info
  const [title, setTitle] = useState(work.title)
  const [authorsText, setAuthorsText] = useState(formatAuthorList(work.authors, work.author))
  const [description, setDescription] = useState(work.description)
  const [categoryId, setCategoryId] = useState<string | null>(work.categoryId)
  const [tagIds, setTagIds] = useState<string[]>(work.tags.map((t) => t.id))

  // Default version
  const initialDefaultId = work.defaultVersionLinkId || work.versions[0]?.id || null
  const [defaultVersionLinkId, setDefaultVersionLinkId] = useState<string | null>(initialDefaultId)

  // Work cover editing (mirrors the per-version cover drafts below)
  const [workCoverFile, setWorkCoverFile] = useState<File | null>(null)
  const [workCoverPreviewUrl, setWorkCoverPreviewUrl] = useState<string | null>(null)
  const [workCoverRemovalPending, setWorkCoverRemovalPending] = useState(false)
  const workCoverInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!workCoverFile) {
      setWorkCoverPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(workCoverFile)
    setWorkCoverPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [workCoverFile])

  function handleWorkCoverFilePicked(file: File) {
    if (workCoverPreviewUrl) {
      URL.revokeObjectURL(workCoverPreviewUrl)
    }
    const preview = URL.createObjectURL(file)
    setWorkCoverFile(file)
    setWorkCoverPreviewUrl(preview)
    setWorkCoverRemovalPending(false)
  }

  function handleWorkRemoveCover() {
    if (workCoverPreviewUrl) {
      URL.revokeObjectURL(workCoverPreviewUrl)
    }
    setWorkCoverFile(null)
    setWorkCoverPreviewUrl(null)
    setWorkCoverRemovalPending(Boolean(work.coverKey))
  }

  // ------------------------------------------------------------- Per-version drafts
  const [drafts, setDrafts] = useState<Record<string, VersionDraft>>(() => {
    const map: Record<string, VersionDraft> = {}
    for (const v of work.versions) {
      map[v.id] = initDraft(v)
    }
    return map
  })

  // Cleanup object URLs on unmount
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  useEffect(() => {
    return () => {
      for (const d of Object.values(draftsRef.current)) {
        if (d.coverPreviewUrl) {
          URL.revokeObjectURL(d.coverPreviewUrl)
        }
      }
    }
  }, [])

  function updateDraft(id: string, patch: Partial<VersionDraft>) {
    setDrafts((prev) => {
      const current = prev[id]
      if (!current) return prev
      return { ...prev, [id]: { ...current, ...patch } }
    })
  }

  const coverInputRef = useRef<HTMLInputElement>(null)

  const activeVersion = work.versions.find((v) => v.id === activeTab) ?? work.versions.find((v) => v.id === version.id) ?? work.versions[0]!
  const activeFallback = _('library.versionFallback', { n: versionOrdinal(work.versions, activeVersion.id) }) as string
  const activeDraft = drafts[activeVersion.id] ?? initDraft(activeVersion)

  const saving =
    updateBook.isPending ||
    updateVersion.isPending ||
    uploadWorkCover.isPending ||
    removeWorkCover.isPending ||
    uploadVersionCover.isPending ||
    removeVersionCover.isPending ||
    resetVersionMetadata.isPending

  const activeMayHaveArtwork = Boolean(activeVersion.coverKey || work.coverKey) || activeVersion.format === 'epub'
  const hasActiveVisualCover = activeDraft.coverRemovalPending
    ? false
    : Boolean(activeDraft.pendingCoverFile || activeVersion.coverKey)

  function toggleTag(id: string) {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  function handleCoverFilePicked(file: File) {
    if (activeDraft.coverPreviewUrl) {
      URL.revokeObjectURL(activeDraft.coverPreviewUrl)
    }
    const preview = URL.createObjectURL(file)
    updateDraft(activeVersion.id, {
      pendingCoverFile: file,
      coverPreviewUrl: preview,
      coverRemovalPending: false,
    })
  }

  function handleRemoveCover() {
    if (saving) return
    if (activeDraft.coverPreviewUrl) {
      URL.revokeObjectURL(activeDraft.coverPreviewUrl)
    }
    updateDraft(activeVersion.id, {
      pendingCoverFile: null,
      coverPreviewUrl: null,
      coverRemovalPending: Boolean(activeVersion.coverKey),
    })
  }

  async function handleResetVersion() {
    if (!confirmResetVersion) return
    const target = confirmResetVersion
    setConfirmResetVersion(null)
    try {
      await resetVersionMetadata.mutateAsync({ libraryId, libraryBookId: work.id, versionLinkId: target.id })
      notify.success(_('library.catalogVersionResetSuccess'))
      onClose()
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'library.resetMetadataFailed'))
    }
  }

  async function handleSave() {
    const name = title.trim()
    if (!name) return

    // 1. Work patch
    const bookPatch: CatalogBookUpdateReq = {}
    if (name !== work.title) bookPatch.title = name
    const wantAuthors = parseAuthorList(authorsText)
    const initialAuthors = parseAuthorList(formatAuthorList(work.authors, work.author))
    if (wantAuthors.join('\n') !== initialAuthors.join('\n')) bookPatch.authors = wantAuthors
    if (description !== work.description) bookPatch.description = description
    if (categoryId !== work.categoryId) bookPatch.categoryId = categoryId
    const initialTagIds = work.tags.map((t) => t.id)
    if (tagIds.length !== initialTagIds.length || tagIds.some((id) => !initialTagIds.includes(id))) {
      bookPatch.tagIds = tagIds
    }
    if (work.versions.length > 1 && defaultVersionLinkId !== work.defaultVersionLinkId) {
      bookPatch.defaultVersionLinkId = defaultVersionLinkId
    }

    try {
      const requests: Promise<unknown>[] = []

      if (Object.keys(bookPatch).length > 0) {
        requests.push(updateBook.mutateAsync({ libraryId, libraryBookId: work.id, patch: bookPatch }))
      }

      // Work cover changes ride the same save: upload wins over removal, and
      // removal only fires against a stored cover.
      if (workCoverFile) {
        requests.push(uploadWorkCover.mutateAsync({ libraryId, libraryBookId: work.id, file: workCoverFile }))
      } else if (workCoverRemovalPending && work.coverKey) {
        requests.push(removeWorkCover.mutateAsync({ libraryId, libraryBookId: work.id }))
      }

      // 2. Version patches
      for (const v of work.versions) {
        const d = drafts[v.id]
        if (!d) continue

        // Cover changes
        if (d.coverRemovalPending && v.coverKey) {
          requests.push(removeVersionCover.mutateAsync({ libraryId, libraryBookId: work.id, versionLinkId: v.id }))
        } else if (d.pendingCoverFile) {
          requests.push(uploadVersionCover.mutateAsync({ libraryId, libraryBookId: work.id, versionLinkId: v.id, file: d.pendingCoverFile }))
        }

        // Field changes
        const versionPatch: CatalogVersionUpdateReq = {}
        if (d.name.trim() !== v.name) versionPatch.name = d.name.trim()

        // Placeholder inheritance logic: empty string = null (inherit), non-empty = custom
        const wantTitle = d.overrideTitle.trim() ? d.overrideTitle.trim() : null
        if (wantTitle !== (v.title ?? null)) versionPatch.title = wantTitle

        const wantAuthors = d.overrideAuthorsText.trim() ? parseAuthorList(d.overrideAuthorsText) : null
        const initialVAuthors = v.authors ?? null
        const changedAuthors = wantAuthors === null
          ? initialVAuthors !== null
          : initialVAuthors === null || wantAuthors.join('\n') !== initialVAuthors.join('\n')
        if (changedAuthors) versionPatch.authors = wantAuthors

        const wantDesc = d.overrideDescription.trim() ? d.overrideDescription : null
        if (wantDesc !== (v.description ?? null)) versionPatch.description = wantDesc

        const newMeta = buildMetaRecord({
          publisher: d.publisher,
          published: d.published,
          language: d.language,
          isbn: d.isbn,
          subjects: d.subjects,
          series: d.series,
          seriesIndex: d.seriesIndex,
        })
        // Unknown keys ride along: the patch replaces the whole override
        // object, so rebuilding from the seven owned fields alone would drop
        // anything the editor cannot show. Seed-compare against the same
        // construction so untouched versions stay patch-free.
        const rawMeta = v.meta ?? {}
        const untouched = Object.fromEntries(
          Object.entries(rawMeta).filter(([key]) => !(KNOWN_META_KEYS as readonly string[]).includes(key)),
        )
        const prevMeta = { ...untouched, ...buildMetaRecord(metaTextFields(rawMeta)) }
        if (JSON.stringify({ ...untouched, ...newMeta }) !== JSON.stringify(prevMeta)) {
          versionPatch.meta = { ...untouched, ...newMeta }
        }

        if (Object.keys(versionPatch).length > 0) {
          requests.push(updateVersion.mutateAsync({ libraryId, libraryBookId: work.id, versionLinkId: v.id, patch: versionPatch }))
        }
      }

      if (requests.length === 0) {
        onClose()
        return
      }
      await Promise.all(requests)
      notify.success(_('library.catalogWorkSaved'))
      onClose()
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'library.catalogWorkSaveFailed'))
    }
  }

  const isActiveDefault = defaultVersionLinkId === activeVersion.id

  return (
    <>
      <Modal
        title={_('library.editWork')}
        onClose={onClose}
        closeLabel={_('library.close')}
        size="xl"
        footer={(
          <div className="flex w-full items-center justify-between gap-2">
            <div>
              {activeTab !== 'work' && (
                <button
                  type="button"
                  onClick={() => setConfirmResetVersion(activeVersion)}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 text-xs text-stone-500 transition-colors hover:text-stone-800 disabled:opacity-50 dark:text-stone-400 dark:hover:text-stone-200"
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                    <path d="M16 21h5v-5" />
                  </svg>
                  <span>{_('library.resetMetadata')}</span>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={onClose} disabled={saving}>
                {_('library.cancel')}
              </Button>
              <Button disabled={title.trim().length === 0 || saving} onClick={() => void handleSave()}>
                {_('library.save')}
              </Button>
            </div>
          </div>
        )}
      >
        <div className="flex flex-col gap-4">
          {/* Sticky Tab Header: Work info + All Version tabs */}
          <div className="sticky -top-4 z-10 -mx-4 -mt-4 border-b border-stone-200/80 bg-white/95 px-4 pb-3 pt-4 backdrop-blur-sm sm:-mx-5 sm:px-5 dark:border-stone-800 dark:bg-stone-900/95">
            <div className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-stone-100 p-1 custom-scrollbar dark:bg-stone-800">
              <button
                type="button"
                onClick={() => setActiveTab('work')}
                className={cn(
                  'shrink-0 rounded-md px-3.5 py-1.5 text-xs font-medium transition-all',
                  activeTab === 'work'
                    ? 'bg-white font-semibold text-stone-900 shadow-2xs dark:bg-stone-900 dark:text-stone-100'
                    : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100',
                )}
              >
                {_('library.workInfo')}
              </button>
              {work.versions.map((v) => {
                const label = versionTabLabel(v.name, _('library.versionFallback', { n: versionOrdinal(work.versions, v.id) }))
                const isCurrent = activeTab === v.id
                const isDef = defaultVersionLinkId === v.id
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setActiveTab(v.id)}
                    className={cn(
                      'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                      isCurrent
                        ? 'bg-white font-semibold text-stone-900 shadow-2xs dark:bg-stone-900 dark:text-stone-100'
                        : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100',
                    )}
                  >
                    <span className="max-w-36 truncate">{label}</span>
                    {work.versions.length > 1 && isDef && (
                      <span className="rounded bg-stone-200/90 px-1 py-0.5 text-[10px] font-normal text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                        {_('library.defaultVersion')}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Tab 1: Work info (Abstract intellectual creation) */}
          <section className={cn('flex flex-col gap-4', activeTab !== 'work' && 'hidden')}>
            {/* Work cover: the row-level artwork every version inherits unless
                it carries its own. Same overlay pattern as the version slot. */}
            <div className="flex items-center gap-4">
              <div className="w-24 shrink-0">
                <div className="group relative">
                  <BookCover
                    book={{
                      id: work.versions[0]?.bookVersionId ?? work.id,
                      title: work.title,
                      format: work.versions[0]?.format ?? 'epub',
                      coverKey: workCoverRemovalPending
                        ? null
                        : (workCoverFile ? null : work.coverKey),
                      coverPaletteKey: work.versions[0]?.effective.coverPaletteKey
                        ?? work.versions[0]?.bookVersionId
                        ?? work.id,
                    }}
                    coverSrc={
                      workCoverRemovalPending
                        ? null
                        : workCoverFile
                          ? workCoverPreviewUrl
                          : ((work.coverKey || work.versions[0]?.format === 'epub') && work.versions[0]
                            ? `/api/v1/books/${work.versions[0].bookVersionId}/cover?size=thumb`
                            : null)
                    }
                  />
                  <div className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-xl bg-black/45 transition-opacity opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => !saving && workCoverInputRef.current?.click()}
                      disabled={saving}
                      title={_('library.changeCover')}
                      aria-label={_('library.changeCover')}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-white/90 transition-colors hover:bg-black/60 disabled:opacity-50"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="9" cy="9" r="2" />
                        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                      </svg>
                    </button>
                    {!workCoverRemovalPending && (workCoverFile || work.coverKey) && (
                      <button
                        type="button"
                        onClick={handleWorkRemoveCover}
                        disabled={saving}
                        title={_('library.removeCover')}
                        aria-label={_('library.removeCover')}
                        className="flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-white/90 transition-colors hover:bg-black/60 disabled:opacity-50"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" />
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <input
                    ref={workCoverInputRef}
                    data-testid="work-cover-input"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    className="hidden"
                    disabled={saving}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        handleWorkCoverFilePicked(file)
                      }
                      e.target.value = ''
                    }}
                  />
                </div>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-stone-500 dark:text-stone-400">{_('library.cover')}</p>
                <p className="mt-0.5 truncate text-sm text-stone-700 dark:text-stone-200">{work.title}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
                <span className={labelClass}>
                  {_('library.sortBy.title')}
                  <span className="text-red-500"> *</span>
                </span>
                <input
                  aria-label={_('library.sortBy.title')}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={300}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
                <span className={labelClass}>{_('library.authorLabel')}</span>
                <input
                  value={authorsText}
                  onChange={(e) => setAuthorsText(e.target.value)}
                  maxLength={500}
                  placeholder={_('library.authorListHint')}
                  className={inputClass}
                />
              </label>
            </div>

            <label className="flex flex-col gap-1.5 text-sm text-stone-700 dark:text-stone-300">
              <span className={labelClass}>{_('library.descriptionSection')}</span>
              <textarea
                ref={autoGrow}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value)
                  autoGrow(e.target)
                }}
                maxLength={4000}
                rows={3}
                className={cn(inputClass, 'resize-y leading-relaxed')}
              />
            </label>

            {/* Category */}
            <div className="flex flex-col gap-2">
              <span className={labelClass}>{_('library.categoryLabel')}</span>
              <div className="flex max-h-32 flex-wrap items-center gap-1.5 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] pr-1">
                <Chip
                  label={_('library.uncategorized')}
                  selected={categoryId === null}
                  onClick={() => setCategoryId(null)}
                />
                {(categoriesData?.data ?? []).map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    selected={categoryId === c.id}
                    onClick={() => setCategoryId(c.id)}
                  />
                ))}
              </div>
            </div>

            {/* Tags */}
            {(tagsData?.data ?? []).length > 0 && (
              <div className="flex flex-col gap-2">
                <span className={labelClass}>{_('library.tagLabel')}</span>
                <div className="flex max-h-32 flex-wrap items-center gap-1.5 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] pr-1">
                  {(tagsData?.data ?? []).map((tag) => (
                    <Chip
                      key={tag.id}
                      label={tag.name}
                      selected={tagIds.includes(tag.id)}
                      showCheck
                      onClick={() => toggleTag(tag.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Tab 2: Version settings & Publication metadata */}
          <section className={cn('flex flex-col gap-4', activeTab === 'work' && 'hidden')}>
            {/* Basic Info: Cover on left, Version Name + Title + Author on right */}
            <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
              {/* Version Cover slot */}
              <div className="w-28 shrink-0 self-center sm:self-auto">
                <div className="group relative">
                  <BookCover
                    book={{
                      id: activeVersion.bookVersionId,
                      title: activeDraft.overrideTitle || title || work.title,
                      format: activeVersion.format,
                      coverKey: activeDraft.coverRemovalPending ? null : (activeDraft.pendingCoverFile ? null : (activeVersion.coverKey ?? work.coverKey)),
                      coverPaletteKey: activeVersion.effective.coverPaletteKey ?? activeVersion.bookVersionId,
                    }}
                    coverSrc={
                      activeDraft.coverRemovalPending
                        ? null
                        : activeDraft.pendingCoverFile
                          ? activeDraft.coverPreviewUrl
                          : (activeMayHaveArtwork ? `/api/v1/books/${activeVersion.bookVersionId}/cover?size=thumb` : null)
                    }
                  />
                  <div className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-xl bg-black/45 transition-opacity opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => !saving && coverInputRef.current?.click()}
                      disabled={saving}
                      title={_('library.changeCover')}
                      aria-label={_('library.changeCover')}
                      className="flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-white/90 transition-colors hover:bg-black/60 disabled:opacity-50"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="9" cy="9" r="2" />
                        <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                      </svg>
                    </button>
                    {hasActiveVisualCover && (
                      <button
                        type="button"
                        onClick={handleRemoveCover}
                        disabled={saving}
                        title={_('library.removeCover')}
                        aria-label={_('library.removeCover')}
                        className="flex h-7 w-7 items-center justify-center rounded-md bg-black/40 text-white/90 transition-colors hover:bg-black/60 disabled:opacity-50"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" />
                          <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          <line x1="10" y1="11" x2="10" y2="17" />
                          <line x1="14" y1="11" x2="14" y2="17" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <input
                    ref={coverInputRef}
                    data-testid="version-cover-input"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    className="hidden"
                    disabled={saving}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) {
                        handleCoverFilePicked(file)
                      }
                      e.target.value = ''
                    }}
                  />
                </div>
              </div>

              {/* Right column: Version Name (compact row) + Title + Author */}
              <div className="min-w-0 flex-1 space-y-2.5">
                {/* Row 1: Version Name & Default Version status */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="shrink-0 text-xs font-medium text-stone-500 dark:text-stone-400">
                      {_('library.versionName')}
                    </span>
                    <input
                      value={activeDraft.name}
                      onChange={(e) => updateDraft(activeVersion.id, { name: e.target.value })}
                      maxLength={120}
                      placeholder={activeFallback}
                      className="h-8 min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-2.5 text-xs text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-stone-200 dark:focus:ring-stone-200"
                    />
                  </div>
                  {work.versions.length > 1 && (
                    isActiveDefault ? (
                      <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span>{_('library.defaultVersion')}</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDefaultVersionLinkId(activeVersion.id)}
                        className="shrink-0 inline-flex items-center gap-1 rounded-full border border-stone-200 px-2.5 py-0.5 text-[11px] font-medium text-stone-500 transition-colors hover:border-stone-400 hover:text-stone-800 dark:border-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
                      >
                        <span>{_('library.setDefaultVersion')}</span>
                      </button>
                    )
                  )}
                </div>

                {/* Row 2: Title */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className={labelClass}>{_('library.sortBy.title')}</span>
                    {activeDraft.overrideTitle.trim().length > 0 ? (
                      <button
                        type="button"
                        onClick={() => updateDraft(activeVersion.id, { overrideTitle: '' })}
                        className="text-[11px] text-stone-400 transition-colors hover:text-stone-700 dark:hover:text-stone-200"
                      >
                        {_('library.restoreFollow')}
                      </button>
                    ) : (
                      <span className="text-[11px] text-stone-400/80">{_('library.followWork')}</span>
                    )}
                  </div>
                  <input
                    value={activeDraft.overrideTitle}
                    onChange={(e) => updateDraft(activeVersion.id, { overrideTitle: e.target.value })}
                    maxLength={300}
                    placeholder={`${work.title} (${_('library.followWork')})`}
                    className={inputClass}
                  />
                </div>

                {/* Row 3: Author */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className={labelClass}>{_('library.authorLabel')}</span>
                    {activeDraft.overrideAuthorsText.trim().length > 0 ? (
                      <button
                        type="button"
                        onClick={() => updateDraft(activeVersion.id, { overrideAuthorsText: '' })}
                        className="text-[11px] text-stone-400 transition-colors hover:text-stone-700 dark:hover:text-stone-200"
                      >
                        {_('library.restoreFollow')}
                      </button>
                    ) : (
                      <span className="text-[11px] text-stone-400/80">{_('library.followWork')}</span>
                    )}
                  </div>
                  <input
                    value={activeDraft.overrideAuthorsText}
                    onChange={(e) => updateDraft(activeVersion.id, { overrideAuthorsText: e.target.value })}
                    maxLength={500}
                    placeholder={`${formatAuthorList(work.authors, work.author) || _('library.unknown')} (${_('library.followWork')})`}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className={labelClass}>{_('library.descriptionSection')}</span>
                {activeDraft.overrideDescription.trim().length > 0 ? (
                  <button
                    type="button"
                    onClick={() => updateDraft(activeVersion.id, { overrideDescription: '' })}
                    className="text-[11px] text-stone-400 transition-colors hover:text-stone-700 dark:hover:text-stone-200"
                  >
                    {_('library.restoreFollow')}
                  </button>
                ) : (
                  <span className="text-[11px] text-stone-400/80">{_('library.followWork')}</span>
                )}
              </div>
              <textarea
                value={activeDraft.overrideDescription}
                onChange={(e) => updateDraft(activeVersion.id, { overrideDescription: e.target.value })}
                maxLength={4000}
                rows={3}
                placeholder={`${work.description || _('library.noDescription')} (${_('library.followWork')})`}
                className={cn(inputClass, 'resize-y leading-relaxed')}
              />
            </div>

            {/* Single Collapsible Section: 更多信息 (Publication & metadata, matching BookMetaForm) */}
            <div className="border-t border-stone-100 pt-2 dark:border-stone-800">
              <button
                type="button"
                onClick={() => updateDraft(activeVersion.id, { expanded: !activeDraft.expanded })}
                className="inline-flex items-center gap-1.5 py-1 text-xs font-medium text-stone-500 transition-colors hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={cn('transition-transform duration-200', activeDraft.expanded && 'rotate-90')}
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span>{activeDraft.expanded ? _('library.lessMetadata') : _('library.moreMetadata')}</span>
              </button>
            </div>

            {activeDraft.expanded && (
              <div className="space-y-4 rounded-xl border border-stone-100 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-800/30">
                {/* Publishing section */}
                <section className="flex flex-col gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    {_('library.editGroupPublishing')}
                  </span>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-400">
                      <span className={labelClass}>{_('library.publisher')}</span>
                      <input
                        type="text"
                        value={activeDraft.publisher}
                        onChange={(e) => updateDraft(activeVersion.id, { publisher: e.target.value })}
                        placeholder={_('library.unknown')}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-400">
                      <span className={labelClass}>{_('library.published')}</span>
                      <input
                        type="text"
                        value={activeDraft.published}
                        onChange={(e) => updateDraft(activeVersion.id, { published: e.target.value })}
                        placeholder="YYYY-MM"
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-400">
                      <span className={labelClass}>{_('library.language')}</span>
                      <input
                        type="text"
                        value={activeDraft.language}
                        onChange={(e) => updateDraft(activeVersion.id, { language: e.target.value })}
                        placeholder={_('library.unknown')}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-400">
                      <span className={labelClass}>ISBN</span>
                      <input
                        type="text"
                        value={activeDraft.isbn}
                        onChange={(e) => updateDraft(activeVersion.id, { isbn: e.target.value })}
                        placeholder={_('library.unknown')}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-400 sm:col-span-2">
                      <span className={labelClass}>{_('library.subjects')}</span>
                      <input
                        type="text"
                        value={activeDraft.subjects}
                        onChange={(e) => updateDraft(activeVersion.id, { subjects: e.target.value })}
                        placeholder={_('library.unknown')}
                        className={inputClass}
                      />
                    </label>
                  </div>
                  {activeVersion.effective.bookmeta?.identifier && (
                    <div className="mt-1">
                      <span className="mb-0.5 block text-xs text-stone-400 dark:text-stone-500">{_('library.identifier')}</span>
                      <button
                        type="button"
                        title={activeVersion.effective.bookmeta.identifier}
                        onClick={() => void copyText(activeVersion.effective.bookmeta!.identifier!)}
                        className="font-mono text-xs text-stone-600 transition-colors hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
                      >
                        {middleTruncate(activeVersion.effective.bookmeta.identifier)}
                      </button>
                    </div>
                  )}
                </section>

                {/* Series section */}
                <section className="flex flex-col gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                    {_('library.seriesSection')}
                  </span>
                  <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-400">
                      <span className={labelClass}>{_('library.seriesSection')}</span>
                      <input
                        type="text"
                        value={activeDraft.series}
                        onChange={(e) => updateDraft(activeVersion.id, { series: e.target.value })}
                        placeholder={_('library.unknown')}
                        className={inputClass}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-stone-600 dark:text-stone-400">
                      <span className={labelClass}>{_('library.seriesIndex')}</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={activeDraft.seriesIndex}
                        onChange={(e) => updateDraft(activeVersion.id, { seriesIndex: e.target.value })}
                        placeholder="1"
                        className={inputClass}
                      />
                    </label>
                  </div>
                </section>
              </div>
            )}
          </section>
        </div>
      </Modal>

      {confirmResetVersion && (
        <ConfirmDialog
          title={_('library.resetMetadata')}
          message={_('library.catalogVersionResetConfirm', {
            name: versionTabLabel(confirmResetVersion.name, _('library.versionFallback', { n: versionOrdinal(work.versions, confirmResetVersion.id) })),
          })}
          confirmLabel={_('library.resetMetadata')}
          onClose={() => setConfirmResetVersion(null)}
          onConfirm={handleResetVersion}
        />
      )}
    </>
  )
}
