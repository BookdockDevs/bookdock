import type { ReactNode } from 'react'

import { useTranslation } from '@/hooks/useTranslation'

import { autoGrow, copyText, middleTruncate, type MetaDraft } from './types'
import { Field, GroupLabel, inputClass, textareaClass } from './ui'

interface BookMetaFormProps {
  draft: MetaDraft
  onChange: (draft: MetaDraft) => void
  identifier?: string
  coverSlot?: ReactNode
}

export default function BookMetaForm({ draft, onChange, identifier, coverSlot }: BookMetaFormProps) {
  const _ = useTranslation()

  const update = (field: keyof MetaDraft, value: string) => {
    onChange({ ...draft, [field]: value })
  }

  return (
    <div>
      <section>
        <GroupLabel>{_('library.editGroupBasic')}</GroupLabel>
        <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
          {coverSlot}
          <div className="min-w-0 flex-1 space-y-3">
            <Field label={_('library.sortBy.title')} required>
              <input
                type="text"
                value={draft.title}
                onChange={(e) => update('title', e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label={_('library.sortBy.author')}>
              <input
                type="text"
                value={draft.author}
                onChange={(e) => update('author', e.target.value)}
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
                update('description', e.target.value)
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
            <input
              type="text"
              value={draft.publisher}
              onChange={(e) => update('publisher', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={_('library.published')}>
            <input
              type="text"
              value={draft.published}
              onChange={(e) => update('published', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={_('library.language')}>
            <input
              type="text"
              value={draft.language}
              onChange={(e) => update('language', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="ISBN">
            <input
              type="text"
              value={draft.isbn}
              onChange={(e) => update('isbn', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={_('library.subjects')}>
            <input
              type="text"
              value={draft.subjects}
              onChange={(e) => update('subjects', e.target.value)}
              className={inputClass}
            />
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
            <input
              type="text"
              value={draft.series}
              onChange={(e) => update('series', e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label={_('library.seriesIndex')}>
            <input
              type="text"
              inputMode="decimal"
              value={draft.seriesIndex}
              onChange={(e) => update('seriesIndex', e.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      </section>
    </div>
  )
}
