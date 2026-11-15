import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import type { CatalogBook, CatalogBookUpdateReq, CatalogVersion, CatalogVersionUpdateReq, MetadataProviderId, UndoReceipt } from '@bookdock/shared'

import { apiSave } from '@/api/client'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { invalidateActivityQueries } from '@/features/activity/hooks'
import { formatAuthorList } from '@/lib/utils'

import { versionOrdinal } from '../book-row'
import { categoryTemplatePath, matchCategoryTemplateKey } from '@bookdock/shared'
import {
  useCatalogVersionMetadataSource,
  useLibraryTags,
} from '../hooks'
import BookClassificationEditor from './book-detail/BookClassificationEditor'
import BookCoverEditor from './book-detail/BookCoverEditor'
import BookMetaForm from './book-detail/BookMetaForm'
import MetadataEditorFooter from './book-detail/MetadataEditorFooter'
import { isMachineIdentifier, parseAuthorList, type MetaFormValues } from './book-detail/types'
import MetadataLookupDialog from './book-detail/MetadataLookupDialog'
import MetadataLookupDropdown from './book-detail/MetadataLookupDropdown'
import { hasRestorableField, sourceTextForField, type DraftTextField } from './book-detail/metadata-source'
import VersionSelect from './VersionSelect'

interface WorkEditDialogProps {
  work: CatalogBook
  libraryId: string
  version: CatalogVersion
  onClose: () => void
}

interface VersionDraft extends MetaFormValues {
  name: string
  expanded: boolean
  pendingCoverFile: File | null
  coverPreviewUrl: string | null
  coverRemovalPending: boolean
}

type MetaFields = Pick<MetaFormValues, 'publisher' | 'published' | 'language' | 'isbn' | 'subjects' | 'series' | 'seriesIndex'>

/** The seven publication fields the editor owns; everything else in a version's
 * raw meta rides along untouched so a save never drops keys it cannot show. */
const KNOWN_META_KEYS = ['publisher', 'published', 'language', 'isbn', 'subjects', 'series', 'seriesIndex'] as const

const LOOKUP_FIELDS: DraftTextField[] = [
  'title', 'authors', 'description', 'publisher', 'published', 'isbn', 'language', 'subjects', 'series', 'seriesIndex',
]

function metaTextFields(meta: Record<string, unknown>): MetaFields {
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

function buildMetaRecord(draft: MetaFields): Record<string, unknown> {
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

/** An empty owned field is an explicit null mask, not a request to inherit the
 * work row or the parsed file. Every version therefore carries its own values. */
function metaRecord(draft: MetaFields): Record<string, unknown> {
  const meta = buildMetaRecord(draft)
  for (const key of KNOWN_META_KEYS) {
    if (!(key in meta)) meta[key] = null
  }
  return meta
}

/** Shared catalogs have no editable work-level metadata: the form starts from
 * the version's resolved values, so saving never materializes a second layer. */
function initDraft(v: CatalogVersion): VersionDraft {
  const fields = metaTextFields((v.effective.bookmeta ?? {}) as Record<string, unknown>)
  const display = v.effective.bookmeta ?? {}
  const hasExtendedMeta = Boolean(
    fields.publisher || fields.published || fields.language || fields.isbn
    || fields.subjects || fields.series || fields.seriesIndex || display.identifier,
  )
  return {
    name: v.name,
    title: v.effective.title,
    authors: formatAuthorList(v.effective.authors, v.effective.author),
    description: v.effective.description,
    ...fields,
    expanded: hasExtendedMeta,
    pendingCoverFile: null,
    coverPreviewUrl: null,
    coverRemovalPending: false,
  }
}

function buildInitialDrafts(versions: CatalogVersion[]): Record<string, VersionDraft> {
  const map: Record<string, VersionDraft> = {}
  for (const v of versions) map[v.id] = initDraft(v)
  return map
}

export default function WorkEditDialog({ work, libraryId, version, onClose }: WorkEditDialogProps) {
  const _ = useTranslation()
  const queryClient = useQueryClient()

  const { data: tagsData } = useLibraryTags(libraryId)

  const [initialDrafts] = useState<Record<string, VersionDraft>>(() => buildInitialDrafts(work.versions))
  const [drafts, setDrafts] = useState<Record<string, VersionDraft>>(() => ({ ...initialDrafts }))
  const [activeTab, setActiveTab] = useState<string>(
    () => (work.versions.some((v) => v.id === version.id) ? version.id : (work.versions[0]?.id ?? '')),
  )
  const [metadataLookup, setMetadataLookup] = useState<{ open: boolean; provider?: MetadataProviderId; autoSearch?: boolean }>({ open: false })

  // Classification is work-level: one set of categories and tags per work,
  // shared by every version of it.
  const [categoryPath, setCategoryPath] = useState<string[] | null>(work.categoryPath)
  const [tagNames, setTagNames] = useState<Set<string>>(() => new Set(work.tags))
  const [defaultVersionLinkId, setDefaultVersionLinkId] = useState<string | null>(
    work.defaultVersionLinkId || work.versions[0]?.id || null,
  )

  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  useEffect(() => {
    return () => {
      for (const d of Object.values(draftsRef.current)) {
        if (d.coverPreviewUrl) URL.revokeObjectURL(d.coverPreviewUrl)
      }
    }
  }, [])

  const activeVersion = work.versions.find((v) => v.id === activeTab) ?? work.versions[0]!
  const activeFallback = _('library.versionFallback', { n: versionOrdinal(work.versions, activeVersion.id) }) as string
  const activeDraft = drafts[activeVersion.id] ?? initialDrafts[activeVersion.id]

  const versionSource = useCatalogVersionMetadataSource(libraryId, work.id, activeVersion.id, true)
  const activeSource = !versionSource.isFetching && !versionSource.isError ? (versionSource.data?.data ?? null) : null
  const sourceValues = activeSource?.values ?? {}

  function sourceText(field: DraftTextField): string {
    return sourceTextForField(field, sourceValues)
  }

  function draftText(field: DraftTextField): string {
    return activeDraft[field]
  }

  // Nothing to restore once the draft matches the file, or when the file carried
  // no embedded metadata (a text file only ever yields file-name guesses).
  const canRestoreAll = hasRestorableField(activeSource, LOOKUP_FIELDS, draftText)

  function updateDraft(id: string, patch: Partial<VersionDraft>) {
    setDrafts((prev) => {
      const current = prev[id]
      if (!current) return prev
      return { ...prev, [id]: { ...current, ...patch } }
    })
  }

  function restoreVersionField(id: string, field: DraftTextField) {
    if (!activeSource) return
    updateDraft(id, { [field]: sourceText(field) } as Partial<MetaFormValues>)
  }

  function restoreVersionAll(target: CatalogVersion) {
    if (!activeSource) return
    updateDraft(target.id, {
      title: sourceText('title'),
      authors: sourceText('authors'),
      description: sourceText('description'),
      publisher: sourceText('publisher'),
      published: sourceText('published'),
      language: sourceText('language'),
      isbn: sourceText('isbn'),
      subjects: sourceText('subjects'),
      series: sourceText('series'),
      seriesIndex: sourceText('seriesIndex'),
    })
  }

  const [savingSave, setSaving] = useState(false)
  const saving = savingSave

  const invalidVersion = work.versions.find((v) => drafts[v.id] && !drafts[v.id].title.trim())

  const displayCoverKey = activeDraft.coverRemovalPending
    ? null
    : (activeDraft.pendingCoverFile ? null : (activeVersion.effective.coverKey ?? null))
  const activeMayHaveArtwork = Boolean(activeVersion.coverKey || activeVersion.effective.coverKey || activeDraft.pendingCoverFile)
    || activeVersion.format === 'epub'
  // Removal targets the version's own cover only. The shared catalog stores
  // per-version covers (the work row is a projection of the default version),
  // so a version showing an inherited image has nothing of its own to delete.
  const hasRemovableCover = !activeDraft.coverRemovalPending
    && Boolean(activeDraft.pendingCoverFile || activeVersion.coverKey)

  function handleCoverFilePicked(file: File) {
    if (activeDraft.coverPreviewUrl) URL.revokeObjectURL(activeDraft.coverPreviewUrl)
    updateDraft(activeVersion.id, {
      pendingCoverFile: file,
      coverPreviewUrl: URL.createObjectURL(file),
      coverRemovalPending: false,
    })
  }

  function handleRemoveCover() {
    if (saving) return
    if (activeDraft.coverPreviewUrl) URL.revokeObjectURL(activeDraft.coverPreviewUrl)
    updateDraft(activeVersion.id, {
      pendingCoverFile: null,
      coverPreviewUrl: null,
      coverRemovalPending: Boolean(activeDraft.pendingCoverFile || activeVersion.coverKey),
    })
  }

  async function handleSave() {
    if (invalidVersion) {
      setActiveTab(invalidVersion.id)
      notify.warning({ key: 'library.titleRequiredHint' })
      return
    }
    const oversizedVersion = work.versions.find((v) => drafts[v.id] && drafts[v.id].description.length > 4000)
    if (oversizedVersion) {
      setActiveTab(oversizedVersion.id)
      notify.warning({ key: 'library.catalogDescriptionTooLong' })
      return
    }

    const bookPatch: CatalogBookUpdateReq = {}
    if (JSON.stringify(categoryPath) !== JSON.stringify(work.categoryPath)) bookPatch.categoryPath = categoryPath
    const initialTags = work.tags
    const nextTags = [...tagNames]
    if (nextTags.length !== initialTags.length || nextTags.some((name) => !initialTags.includes(name))) bookPatch.tags = nextTags
    if (work.versions.length > 1 && defaultVersionLinkId !== work.defaultVersionLinkId) {
      bookPatch.defaultVersionLinkId = defaultVersionLinkId
    }

    type VersionSave = { id: string; patch?: CatalogVersionUpdateReq; cover?: 'replace' | 'remove' }
    const versionSaves: VersionSave[] = []
    const coverFiles: Record<string, File> = {}
    for (const v of work.versions) {
      const d = drafts[v.id]
      const initial = initialDrafts[v.id]
      if (!d || !initial) continue
      const save: VersionSave = { id: v.id }
      if (d.coverRemovalPending) save.cover = 'remove'
      else if (d.pendingCoverFile) {
        save.cover = 'replace'
        coverFiles[`cover:${v.id}`] = d.pendingCoverFile
      }

      const versionPatch: CatalogVersionUpdateReq = {}
      const name = d.name.trim()
      if (name !== initial.name.trim()) versionPatch.name = name
      const title = d.title.trim()
      if (title !== initial.title) versionPatch.title = title
      const authors = parseAuthorList(d.authors)
      if (authors.join('\n') !== parseAuthorList(initial.authors).join('\n')) versionPatch.authors = authors
      if (d.description !== initial.description) versionPatch.description = d.description

      // Unknown keys ride along: the patch replaces the whole override
      // object, so rebuilding from the seven owned fields alone would drop
      // anything the editor cannot show.
      const rawMeta = v.meta ?? {}
      const untouched = Object.fromEntries(
        Object.entries(rawMeta).filter(([key]) => !(KNOWN_META_KEYS as readonly string[]).includes(key)),
      )
      const nextMeta = { ...untouched, ...metaRecord(d) }
      if (JSON.stringify(nextMeta) !== JSON.stringify({ ...untouched, ...metaRecord(initial) })) {
        versionPatch.meta = nextMeta
      }

      if (Object.keys(versionPatch).length > 0) save.patch = versionPatch
      if (save.patch || save.cover) versionSaves.push(save)
    }

    if (Object.keys(bookPatch).length === 0 && versionSaves.length === 0) {
      notify.info({ key: 'library.catalogNoChanges' })
      onClose()
      return
    }

    setSaving(true)
    try {
      // One request, one transaction, one undo receipt: the dialog used to fire
      // a patch per row plus one upload per cover, none of which undo could
      // describe as a single action.
      const saved = await apiSave<{ data: unknown; undo?: UndoReceipt }>(
        `/libraries/${libraryId}/books/${work.id}/save`,
        {
          ...(Object.keys(bookPatch).length > 0 ? { work: bookPatch } : {}),
          ...(versionSaves.length > 0 ? { versions: versionSaves } : {}),
        },
        coverFiles,
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'categories'] }),
        queryClient.invalidateQueries({ queryKey: ['libraries', libraryId, 'tags'] }),
        queryClient.invalidateQueries({ queryKey: ['batch-selection'] }),
        queryClient.invalidateQueries({ queryKey: ['books'] }),
        queryClient.invalidateQueries({ queryKey: ['book'] }),
        invalidateActivityQueries(queryClient, libraryId),
      ])
      if (saved.undo) notify.success(_('library.catalogWorkSaved'), { undo: saved.undo })
      else notify.success(_('library.catalogWorkSaved'))
      onClose()
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'library.catalogWorkSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const isActiveDefault = defaultVersionLinkId === activeVersion.id

  return (
    <>
      <Modal
        title={_('library.editBook')}
        titleExtra={(
          <VersionSelect
            versions={work.versions}
            selectedId={activeVersion.id}
            onSelect={setActiveTab}
            defaultVersionId={defaultVersionLinkId}
          />
        )}
        onClose={onClose}
        closeLabel={_('library.close')}
        size="xl"
        actions={
          <MetadataLookupDropdown
            disabled={saving}
            onSelect={(provider) => setMetadataLookup({ open: true, provider, autoSearch: true })}
          />
        }
        footer={(
          <MetadataEditorFooter
            canRestoreAll={canRestoreAll}
            onRestoreAll={() => restoreVersionAll(activeVersion)}
            onCancel={onClose}
            onSave={() => void handleSave()}
            saving={saving}
            saveDisabled={Boolean(invalidVersion)}
          />
        )}
      >
        <div className="flex flex-col gap-4">
          <BookMetaForm
            values={activeDraft}
            onChange={(patch) => updateDraft(activeVersion.id, patch)}
            coverSlot={(
              <BookCoverEditor
                book={{
                  id: activeVersion.bookVersionId,
                  title: activeDraft.title,
                  format: activeVersion.format,
                  coverKey: displayCoverKey,
                  coverPaletteKey: activeVersion.effective.coverPaletteKey ?? activeVersion.bookVersionId,
                }}
                coverSrc={activeMayHaveArtwork ? `/api/v1/books/${activeVersion.bookVersionId}/cover?size=thumb` : null}
                coverRemovalPending={activeDraft.coverRemovalPending}
                pendingCoverFile={activeDraft.pendingCoverFile}
                coverPreviewUrl={activeDraft.coverPreviewUrl}
                saving={saving}
                canRemove={hasRemovableCover}
                onCoverFile={(file) => {
                  if (file) handleCoverFilePicked(file)
                }}
                onRemoveCover={handleRemoveCover}
                allowPalette={false}
                inputTestId="version-cover-input"
              />
            )}
            headerSlot={work.versions.length > 1 ? (
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
                    aria-label={_('library.versionName')}
                    className="h-8 min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-2.5 text-xs text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-stone-900 focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-stone-200 dark:focus:ring-stone-200"
                  />
                </div>
                {isActiveDefault ? (
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
                )}
              </div>
            ) : undefined}
            identifier={
              activeVersion.effective.bookmeta?.identifier && !isMachineIdentifier(activeVersion.effective.bookmeta.identifier)
                ? activeVersion.effective.bookmeta.identifier
                : undefined
            }
            source={activeSource}
            sourceError={versionSource.isError ? versionSource.error : null}
            onRetrySource={() => void versionSource.refetch()}
            onRestoreField={(field) => restoreVersionField(activeVersion.id, field)}
            actionsDisabled={saving}
            expanded={activeDraft.expanded}
            onExpandedChange={(next) => updateDraft(activeVersion.id, { expanded: next })}
          />

          <BookClassificationEditor
            libraryId={libraryId}
            categoryPath={categoryPath}
            tags={tagNames}
            onCategoryChange={setCategoryPath}
            onTagsChange={setTagNames}
            tagValues={tagsData?.data ?? []}
          />
        </div>
      </Modal>

      {metadataLookup.open && (
        <MetadataLookupDialog
          draft={{
            title: activeDraft.title,
            authors: activeDraft.authors,
            description: activeDraft.description,
            publisher: activeDraft.publisher,
            published: activeDraft.published,
            isbn: activeDraft.isbn,
            language: activeDraft.language,
            subjects: activeDraft.subjects,
            series: activeDraft.series,
            seriesIndex: activeDraft.seriesIndex,
            coverPaletteId: null,
          }}
          limited={false}
          hasCover={activeMayHaveArtwork}
          initialProvider={metadataLookup.provider}
          autoSearch={metadataLookup.autoSearch}
          onClose={() => setMetadataLookup({ open: false })}
          onApply={(next, cover, classification) => {
            const current: Record<DraftTextField, string> = {
              title: activeDraft.title,
              authors: activeDraft.authors,
              description: activeDraft.description,
              publisher: activeDraft.publisher,
              published: activeDraft.published,
              isbn: activeDraft.isbn,
              language: activeDraft.language,
              subjects: activeDraft.subjects,
              series: activeDraft.series,
              seriesIndex: activeDraft.seriesIndex,
            }
            const patch: Partial<MetaFormValues> = {}
            for (const field of LOOKUP_FIELDS) {
              if (next[field] !== current[field]) patch[field] = next[field]
            }
            if (Object.keys(patch).length > 0) updateDraft(activeVersion.id, patch)
            if (cover) handleCoverFilePicked(cover)
            if (classification) {
              if (classification.category?.trim()) {
                const rawCat = classification.category.trim()
                const template = matchCategoryTemplateKey(rawCat)
                setCategoryPath(template ? categoryTemplatePath(template) ?? [rawCat] : [rawCat])
              }
              if (classification.tags?.length) {
                setTagNames((prev) => new Set([...prev, ...classification.tags!.map((name) => name.trim()).filter(Boolean)]))
              }
            }
            setMetadataLookup({ open: false })
          }}
        />
      )}
    </>
  )
}
