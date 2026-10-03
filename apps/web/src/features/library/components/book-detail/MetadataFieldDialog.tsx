import { useId, useState } from 'react'

import { bookUpdateSchema, catalogVersionUpdateSchema, type BookListItem, type BookMetadata, type CatalogVersion } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { getUserErrorMessage, getUserErrorNotification } from '@/lib/error-message'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'

import { useBookMetadataSource, useCatalogVersionMetadataSource, useUpdateBook, useUpdateCatalogVersion } from '../../hooks'
import { catalogMetadataFieldPatch, metadataFieldPatch, type EditableMetadataField } from './metadata-field'
import MetadataFieldAction from './MetadataFieldAction'
import { draftFieldDiffers, canRestoreField, sourceProvenanceLabel, sourceTextForField } from './metadata-source'
import { autoGrow, draftFrom } from './types'
import { inputClass, textareaClass } from './ui'

interface MetadataFieldDialogProps {
  book: Pick<BookListItem, 'id' | 'title' | 'author' | 'authors' | 'coverPaletteId'>
  catalog?: { libraryId: string; libraryBookId: string; version: CatalogVersion }
  bookmeta?: BookMetadata
  field: EditableMetadataField
  label: string
  onClose: () => void
}

export default function MetadataFieldDialog({ book, bookmeta, field, label, catalog, onClose }: MetadataFieldDialogProps) {
  const _ = useTranslation()
  const formId = useId()
  const updateBook = useUpdateBook()
  const updateVersion = useUpdateCatalogVersion()
  const [inherit, setInherit] = useState(false)
  const pending = catalog ? updateVersion.isPending : updateBook.isPending
  const [initial] = useState(() => draftFrom(book, bookmeta))
  const [value, setValue] = useState(initial[field])
  const [seriesIndex, setSeriesIndex] = useState(initial.seriesIndex)
  const privateSource = useBookMetadataSource(book.id, !catalog)
  const catalogSource = useCatalogVersionMetadataSource(catalog?.libraryId ?? null, catalog?.libraryBookId ?? null, catalog?.version.id ?? null, Boolean(catalog))
  const sourceQuery = catalog ? catalogSource : privateSource
  const source = !sourceQuery.isFetching && !sourceQuery.isError ? (sourceQuery.data?.data ?? null) : null
  const patch = bookUpdateSchema.safeParse(metadataFieldPatch(book, bookmeta, field, value, seriesIndex))
  const catalogPatch = catalog ? catalogVersionUpdateSchema.safeParse(catalogMetadataFieldPatch(catalog.version, field, value, seriesIndex, inherit)) : null
  const changed = inherit || value !== initial[field] || (field === 'series' && seriesIndex !== initial.seriesIndex)
  const invalid = catalog ? !catalogPatch?.success || (!inherit && !patch.success) : !patch.success
  const restoreLabel = source?.kind === 'shared' ? _('library.restoreFieldShared') : _('library.restoreFieldFile')
  const provenanceFor = (f: 'title' | 'authors' | 'description' | 'publisher' | 'published' | 'language' | 'isbn' | 'subjects' | 'series' | 'seriesIndex'): string => {
    const p = sourceProvenanceLabel(source, f)
    if (p === 'filename') return _('library.sourceProvenanceFilename') as string
    if (p === 'shared') return _('library.sourceProvenanceShared') as string
    return _('library.sourceProvenanceFile') as string
  }

  const inherited = catalog?.version.inherited
  const inheritedValues = inherited ? { ...inherited.bookmeta, title: inherited.title, authors: inherited.authors, description: inherited.description } : null
  function fieldActions(target: typeof field | 'seriesIndex', raw: string) {
    const current = inherit && inheritedValues ? sourceTextForField(target, inheritedValues) : raw
    const restore = source && canRestoreField(target, current, source)
    const follow = inheritedValues && !inherit && draftFieldDiffers(target, current, inheritedValues)
    if (!restore && !follow) return null
    return <span className={`absolute right-2 flex gap-1 ${target === 'description' ? 'top-2' : 'top-1/2 -translate-y-1/2'}`}>
      {restore && <MetadataFieldAction label={restoreLabel} provenance={provenanceFor(target)} preview={sourceTextForField(target, source.values)} disabled={pending} onApply={() => {
        setInherit(false)
        if (target === 'seriesIndex') setSeriesIndex(sourceTextForField(target, source.values))
        else setValue(sourceTextForField(target, source.values))
      }} />}
      {follow && <MetadataFieldAction label={_('library.restoreFollow')} provenance={_('library.followWork')} preview={sourceTextForField(target, inheritedValues)} kind="inherit" disabled={pending} onApply={() => {
        setInherit(true)
        setValue(sourceTextForField(field, inheritedValues))
        if (field === 'series') setSeriesIndex(sourceTextForField('seriesIndex', inheritedValues))
      }} />}
    </span>
  }

  async function save() {
    if (pending || !changed || invalid) return
    try {
      if (catalog && catalogPatch?.success) {
        await updateVersion.mutateAsync({ libraryId: catalog.libraryId, libraryBookId: catalog.libraryBookId, versionLinkId: catalog.version.id, patch: catalogPatch.data })
        notify.success({ key: 'toast.bookUpdated' })
      } else if (patch.success) await updateBook.mutateAsync({ bookId: book.id, ...patch.data })
      onClose()
    } catch (error) {
      if (catalog) notify.error(getUserErrorNotification(error, 'toast.updateBookFailed'))
      // The mutation reports failures; keep the draft available for retry.
    }
  }

  return (
    <Modal
      title={_('library.editMetadataField', { field: label })}
      onClose={() => { if (!pending) onClose() }}
      closeLabel={_('library.cancel')}
      size="sm"
      footer={<div className="ml-auto flex gap-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>{_('library.cancel')}</Button>
        <Button type="submit" form={formId} disabled={pending || !changed || invalid}>{pending ? `${_('library.save')}...` : _('library.save')}</Button>
      </div>}
    >
      <form id={formId} onSubmit={(event) => { event.preventDefault(); void save() }} className="space-y-3">
        {sourceQuery.isError && (
          <p role="alert" className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
            <span>{_('library.sourceLoadFailed')} {getUserErrorMessage(sourceQuery.error, _)}</span>
            <button type="button" onClick={() => void sourceQuery.refetch()} className="font-medium hover:underline">
              {_('library.sourceRetry')}
            </button>
          </p>
        )}

        <div className="relative">
          {field === 'description' ? (
            <textarea ref={autoGrow} autoFocus aria-label={label} rows={5} value={value} disabled={pending} onChange={(event) => { setInherit(false); setValue(event.target.value); autoGrow(event.target) }} className={`${textareaClass} max-h-64 overflow-y-auto! overscroll-contain pr-20`} />
          ) : (
            <input autoFocus type="text" aria-label={label} required={field === 'title'} value={value} disabled={pending} onChange={(event) => { setInherit(false); setValue(event.target.value) }} placeholder={field === 'authors' ? _('library.authorListHint') : undefined} className={`${inputClass} pr-20`} />
          )}
          {fieldActions(field, value)}
        </div>
        {field === 'series' && (
          <div>
            <span className="mb-1 block text-xs font-medium text-stone-500">{_('library.seriesIndex')}</span>
            <div className="relative">
              <input aria-label={_('library.seriesIndex')} type="text" inputMode="decimal" value={seriesIndex} disabled={pending} onChange={(event) => { setInherit(false); setSeriesIndex(event.target.value) }} className={`${inputClass} pr-20`} />
              {fieldActions('seriesIndex', seriesIndex)}
            </div>
          </div>
        )}
        {changed && invalid && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{_('errors.invalidInput')}</p>}
      </form>
    </Modal>
  )
}
