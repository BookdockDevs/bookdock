import { useState, type ReactNode } from 'react'

import type { BookMetadataSourceRes } from '@bookdock/shared'

import { getUserErrorMessage } from '@/lib/error-message'
import { useTranslation } from '@/hooks/useTranslation'

import MetadataFieldAction from './MetadataFieldAction'
import { canRestoreField, sourceProvenanceLabel, sourceTextForField, type DraftTextField } from './metadata-source'
import { autoGrow, copyValueOnClick, middleTruncate, type MetaDraft } from './types'
import { GroupLabel, inputClass, textareaClass } from './ui'

interface BookMetaFormProps {
  draft: MetaDraft
  onChange: (draft: MetaDraft) => void
  identifier?: string
  coverSlot?: ReactNode
  limited?: boolean
  source?: BookMetadataSourceRes | null
  sourceLoading?: boolean
  sourceError?: unknown
  onRetrySource?: () => void
  onRestoreField?: (field: DraftTextField) => void
}

export default function BookMetaForm({ draft, onChange, identifier, coverSlot, limited = false, source = null, sourceLoading = false, sourceError = null, onRetrySource, onRestoreField }: BookMetaFormProps) {
  const _ = useTranslation()

  const restoreLabel = (source?.kind === 'shared' ? _('library.restoreFieldShared') : _('library.restoreFieldFile')) as string
  const provenanceText = (field: DraftTextField): string => {
    const p = sourceProvenanceLabel(source, field)
    if (p === 'filename') return _('library.sourceProvenanceFilename') as string
    if (p === 'shared') return _('library.sourceProvenanceShared') as string
    return _('library.sourceProvenanceFile') as string
  }
  const restoreFor = (field: DraftTextField) => {
    if (!source || !onRestoreField) return null
    if (!canRestoreField(field, draft[field], source)) return null
    return (
      <span className={`absolute right-2 ${field === 'description' ? 'top-2' : 'top-1/2 -translate-y-1/2'}`}>
        <MetadataFieldAction label={restoreLabel} provenance={provenanceText(field)} preview={sourceTextForField(field, source.values)} onApply={() => onRestoreField(field)} />
      </span>
    )
  }
  const fieldHead = (label: string) => (
    <span className="mb-1.5 flex items-center justify-between gap-2 text-xs font-medium text-stone-500 dark:text-stone-400">
      <span>{label}</span>
    </span>
  )

  const hasExtendedMeta = Boolean(
    draft.publisher?.trim() ||
    draft.published?.trim() ||
    draft.language?.trim() ||
    draft.isbn?.trim() ||
    draft.subjects?.trim() ||
    draft.series?.trim() ||
    draft.seriesIndex?.trim() ||
    identifier,
  )
  const [expanded, setExpanded] = useState(hasExtendedMeta)

  const update = (field: keyof MetaDraft, value: string) => {
    onChange({ ...draft, [field]: value })
  }

  return (
    <div>
      <section>
        <GroupLabel>{_('library.editGroupBasic')}</GroupLabel>
        {Boolean(sourceError) && (
          <p role="alert" className="mb-2 flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
            <span>{_('library.sourceLoadFailed')} {getUserErrorMessage(sourceError, _)}</span>
            {onRetrySource && (
              <button type="button" onClick={onRetrySource} className="font-medium hover:underline">
                {_('library.sourceRetry')}
              </button>
            )}
          </p>
        )}
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
          {coverSlot}
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              {fieldHead(_('library.sortBy.title') as string)}
              <div className="relative"><input
                type="text"
                aria-label={_('library.sortBy.title') as string}
                value={draft.title}
                onChange={(e) => update('title', e.target.value)}
                className={`${inputClass} w-full pr-12`}
              />{restoreFor('title')}</div>
              {!draft.title.trim() && (
                <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{_('library.titleRequiredHint')}</p>
              )}
            </div>
            <div>
              {fieldHead(_('library.sortBy.author') as string)}
              <div className="relative"><input
                type="text"
                aria-label={_('library.sortBy.author') as string}
                value={draft.authors}
                onChange={(e) => update('authors', e.target.value)}
                placeholder={_('library.authorListHint')}
                className={`${inputClass} w-full pr-12`}
              />{restoreFor('authors')}</div>
            </div>
          </div>
        </div>
        {!limited && (
          <div className="mt-3">
            <div>
              {fieldHead(_('library.descriptionSection') as string)}
              <div className="relative"><textarea
                ref={autoGrow}
                rows={3}
                aria-label={_('library.descriptionSection') as string}
                value={draft.description}
                onChange={(e) => {
                  update('description', e.target.value)
                  autoGrow(e.target)
                }}
                className={`${textareaClass} w-full pr-12`}
              />{restoreFor('description')}</div>
            </div>
          </div>
        )}
      </section>

      {!limited && (
        <>
          <div className="mt-5 border-t border-stone-100 pt-3 dark:border-stone-800">
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="inline-flex items-center gap-1.5 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span>{expanded ? _('library.lessMetadata') : _('library.moreMetadata')}</span>
            </button>
          </div>

          {expanded && (
            <div className="mt-3 space-y-5 rounded-xl border border-stone-100 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-800/30">
              <section>
                <GroupLabel>{_('library.editGroupPublishing')}</GroupLabel>
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <div>
                    {fieldHead(_('library.publisher') as string)}
                    <div className="relative"><input
                      type="text"
                      aria-label={_('library.publisher') as string}
                      value={draft.publisher}
                      onChange={(e) => update('publisher', e.target.value)}
                      className={`${inputClass} w-full pr-12`}
                    />{restoreFor('publisher')}</div>
                  </div>
                  <div>
                    {fieldHead(_('library.published') as string)}
                    <div className="relative"><input
                      type="text"
                      aria-label={_('library.published') as string}
                      value={draft.published}
                      onChange={(e) => update('published', e.target.value)}
                      className={`${inputClass} w-full pr-12`}
                    />{restoreFor('published')}</div>
                  </div>
                  <div>
                    {fieldHead(_('library.language') as string)}
                    <div className="relative"><input
                      type="text"
                      aria-label={_('library.language') as string}
                      value={draft.language}
                      onChange={(e) => update('language', e.target.value)}
                      className={`${inputClass} w-full pr-12`}
                    />{restoreFor('language')}</div>
                  </div>
                  <div>
                    {fieldHead('ISBN')}
                    <div className="relative"><input
                      type="text"
                      aria-label="ISBN"
                      value={draft.isbn}
                      onChange={(e) => update('isbn', e.target.value)}
                      className={`${inputClass} w-full pr-12`}
                    />{restoreFor('isbn')}</div>
                  </div>
                  <div className="sm:col-span-2">
                    {fieldHead(_('library.subjects') as string)}
                    <div className="relative"><input
                      type="text"
                      aria-label={_('library.subjects') as string}
                      value={draft.subjects}
                      onChange={(e) => update('subjects', e.target.value)}
                      className={`${inputClass} w-full pr-12`}
                    />{restoreFor('subjects')}</div>
                  </div>
                </div>
                {identifier && (
                  <div className="mt-3">
                    <span className="mb-1 block text-xs text-stone-400 dark:text-stone-500">{_('library.identifier')}</span>
                    <button
                      type="button"
                      title={_('library.copyValue')}
                      onClick={() => copyValueOnClick(identifier)}
                      className="cursor-pointer font-mono text-sm text-stone-600 transition-colors hover:text-stone-900 hover:underline dark:text-stone-300 dark:hover:text-stone-100"
                    >
                      {middleTruncate(identifier)}
                    </button>
                  </div>
                )}
              </section>

              <section>
                <GroupLabel>{_('library.seriesSection')}</GroupLabel>
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  <div>
                    {fieldHead(_('library.seriesSection') as string)}
                    <div className="relative"><input
                      type="text"
                      aria-label={_('library.seriesSection') as string}
                      value={draft.series}
                      onChange={(e) => update('series', e.target.value)}
                      className={`${inputClass} w-full pr-12`}
                    />{restoreFor('series')}</div>
                  </div>
                  <div>
                    {fieldHead(_('library.seriesIndex') as string)}
                    <div className="relative"><input
                      type="text"
                      aria-label={_('library.seriesIndex') as string}
                      inputMode="decimal"
                      value={draft.seriesIndex}
                      onChange={(e) => update('seriesIndex', e.target.value)}
                      className={`${inputClass} w-full pr-12`}
                    />{restoreFor('seriesIndex')}</div>
                  </div>
                </div>
              </section>
            </div>
          )}
        </>
      )}
      {sourceLoading && (
        <p className="mt-2 text-xs text-stone-400">{_('library.sourceRetry')}…</p>
      )}
    </div>
  )
}
