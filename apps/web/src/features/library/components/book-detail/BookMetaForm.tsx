import { useId, useState, type ReactNode } from 'react'

import type { BookMetadataSourceRes } from '@bookdock/shared'

import { getUserErrorMessage } from '@/lib/error-message'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import MetadataFieldAction from './MetadataFieldAction'
import { canRestoreField, sourceProvenanceLabel, sourceTextForField, type DraftTextField } from './metadata-source'
import { copyValueOnClick, middleTruncate, type MetaFormValues } from './types'
import { GroupLabel, actionInset, metaInputClass as inputClass } from './ui'

/** One visual skin for both metadata editors: the private library detail and
 * the shared catalog version dialog render the same ten fields, so they must
 * not drift into two input treatments. The string itself lives in `ui.tsx`
 * because the single-field dialog edits the same fields. */
const textareaClass = cn(inputClass, 'min-h-[9.75rem] resize-y! overflow-y-auto! overscroll-contain leading-relaxed sm:min-h-[12.5rem]')

const labelClass = 'mb-1.5 flex items-center justify-between gap-2 text-xs font-medium text-stone-500 dark:text-stone-400'

interface BookMetaFormProps {
  values: MetaFormValues
  /** Patched, not replaced: each caller keeps its own draft shape. */
  onChange: (patch: Partial<MetaFormValues>) => void
  coverSlot?: ReactNode
  /** Pinned above the title inside the text column: the catalog dialog puts
   * the version name and the default-version badge here. */
  headerSlot?: ReactNode
  identifier?: string
  /** Hides the description and the extended groups (library-owned books). */
  limited?: boolean
  source?: BookMetadataSourceRes | null
  sourceError?: unknown
  onRetrySource?: () => void
  onRestoreField?: (field: DraftTextField) => void
  /** Disables the restore actions while a save is in flight. */
  actionsDisabled?: boolean
  /** Controlled collapse state. Omitted, the form keeps its own, which is what
   * the private dialog wants: it remounts per draft and must not carry the
   * state across versions the way the catalog dialog does. */
  expanded?: boolean
  onExpandedChange?: (next: boolean) => void
}

function hasExtendedMeta(values: MetaFormValues, identifier?: string): boolean {
  return Boolean(
    values.publisher.trim()
    || values.published.trim()
    || values.language.trim()
    || values.isbn.trim()
    || values.subjects.trim()
    || values.series.trim()
    || values.seriesIndex.trim()
    || identifier,
  )
}

export default function BookMetaForm({
  values,
  onChange,
  coverSlot,
  headerSlot,
  identifier,
  limited = false,
  source = null,
  sourceError = null,
  onRetrySource,
  onRestoreField,
  actionsDisabled = false,
  expanded,
  onExpandedChange,
}: BookMetaFormProps) {
  const _ = useTranslation()
  const idBase = useId()

  const [internalExpanded, setInternalExpanded] = useState(() => hasExtendedMeta(values, identifier))
  const open = expanded ?? internalExpanded
  const toggleExpanded = () => {
    const next = !open
    onExpandedChange?.(next)
    if (expanded === undefined) setInternalExpanded(next)
  }

  const setField = (field: DraftTextField, value: string) => onChange({ [field]: value } as Partial<MetaFormValues>)

  const restoreFor = (field: DraftTextField) => {
    if (!source || !onRestoreField) return null
    if (!canRestoreField(field, values[field], source)) return null
    const p = sourceProvenanceLabel(source, field)
    const provenance = p === 'filename'
      ? _('library.sourceProvenanceFilename')
      : p === 'shared'
        ? _('library.sourceProvenanceShared')
        : _('library.sourceProvenanceFile')
    return (
      <span className={cn('absolute right-2', field === 'description' ? 'top-2' : 'top-1/2 -translate-y-1/2')}>
        <MetadataFieldAction
          label={(source.kind === 'shared' ? _('library.restoreFieldShared') : _('library.restoreFieldFile')) as string}
          provenance={provenance as string}
          preview={sourceTextForField(field, source.values)}
          disabled={actionsDisabled}
          onApply={() => onRestoreField(field)}
        />
      </span>
    )
  }

  function field({
    name,
    label,
    maxLength,
    inputMode,
    placeholder,
    extra,
    span2 = false,
    below,
  }: {
    name: DraftTextField
    label: string
    maxLength?: number
    inputMode?: 'decimal'
    placeholder?: string
    extra?: ReactNode
    span2?: boolean
    below?: ReactNode
  }) {
    const id = `${idBase}-${name}`
    // The restore control is the only reason to indent text away from the right
    // edge, so the inset follows the control instead of being permanent.
    const restore = restoreFor(name)
    return (
      <div className={span2 ? 'sm:col-span-2' : undefined}>
        <label htmlFor={id} className={labelClass}>
          <span>{label}</span>
          {extra}
        </label>
        <div className="relative">
          <input
            id={id}
            type="text"
            aria-label={label}
            maxLength={maxLength}
            inputMode={inputMode}
            placeholder={placeholder}
            value={values[name]}
            onChange={(e) => setField(name, e.target.value)}
            className={cn(inputClass, restore && actionInset)}
          />
          {restore}
        </div>
        {below}
      </div>
    )
  }

  const descriptionRestore = restoreFor('description')

  return (
    <div className="flex flex-col gap-4">
      <section>
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
            {headerSlot}
            {field({
              name: 'title',
              label: _('library.sortBy.title') as string,
              maxLength: 300,
              below: !values.title.trim()
                ? <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{_('library.titleRequiredHint')}</p>
                : undefined,
            })}
            {field({
              name: 'authors',
              label: _('library.authorLabel') as string,
              maxLength: 500,
              placeholder: _('library.authorListHint') as string,
            })}
          </div>
        </div>
      </section>

      {!limited && (
        <>
          <div>
            <label htmlFor={`${idBase}-description`} className={labelClass}>
              <span>{_('library.descriptionSection')}</span>
              <span className="text-[11px] font-normal text-stone-400 dark:text-stone-500">{values.description.length} / 4000</span>
            </label>
            <div className="relative">
              <textarea
                id={`${idBase}-description`}
                rows={6}
                aria-label={_('library.descriptionSection') as string}
                maxLength={4000}
                value={values.description}
                onChange={(e) => setField('description', e.target.value)}
                className={cn(textareaClass, descriptionRestore && actionInset)}
              />
              {descriptionRestore}
            </div>
          </div>

          <div>
            <button
              type="button"
              onClick={toggleExpanded}
              aria-expanded={open}
              className="inline-flex items-center gap-1.5 py-1 text-xs font-medium text-stone-500 transition-colors hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
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
                className={cn('transition-transform duration-200', open && 'rotate-90')}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span>{open ? _('library.lessMetadata') : _('library.moreMetadata')}</span>
            </button>
          </div>

          {open && (
            <div className="space-y-4 rounded-xl border border-stone-100 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-800/30">
              <section className="flex flex-col gap-3">
                <GroupLabel className="mb-0">{_('library.editGroupPublishing')}</GroupLabel>
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  {field({ name: 'publisher', label: _('library.publisher') as string })}
                  {field({ name: 'published', label: _('library.published') as string })}
                  {field({ name: 'language', label: _('library.language') as string })}
                  {field({ name: 'isbn', label: 'ISBN' })}
                  {field({ name: 'subjects', label: _('library.subjects') as string, span2: !identifier })}
                  {/* The identifier is read-only, not a draft field, but it still
                      belongs in the grid: a lone full-width row above a bare text
                      line left the block lopsided. */}
                  {identifier && (
                    <div className="min-w-0">
                      <span className={labelClass}><span>{_('library.identifier')}</span></span>
                      <button
                        type="button"
                        title={_('library.copyValue') as string}
                        aria-label={identifier}
                        onClick={() => copyValueOnClick(identifier)}
                        className="flex h-9 w-full min-w-0 cursor-pointer items-center rounded-lg bg-stone-100/70 px-3 text-left font-mono text-sm text-stone-600 transition-colors hover:bg-stone-200/60 hover:text-stone-900 dark:bg-stone-800/60 dark:text-stone-300 dark:hover:bg-stone-700/60 dark:hover:text-stone-100"
                      >
                        <span className="truncate">{middleTruncate(identifier)}</span>
                      </button>
                    </div>
                  )}
                </div>
              </section>

              <section className="flex flex-col gap-3">
                <GroupLabel className="mb-0">{_('library.editGroupSeries')}</GroupLabel>
                <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                  {field({ name: 'series', label: _('library.seriesSection') as string })}
                  {field({ name: 'seriesIndex', label: _('library.seriesIndex') as string, inputMode: 'decimal' })}
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}
