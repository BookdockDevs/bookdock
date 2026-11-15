import type { Dispatch, SetStateAction } from 'react'

import type { ClientCategoryView } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'

import { useLibraryCategories } from '../../hooks'
import CategorySelectPopover from '../CategorySelectPopover'
import TagSelectPopover from '../TagSelectPopover'
import { toggleSetItem } from './types'

interface BookClassificationEditorProps {
  libraryId: string | null
  categories?: ClientCategoryView[]
  categoryPath: string[] | null
  tags: Set<string>
  onCategoryChange: (value: string[] | null) => void
  onTagsChange: Dispatch<SetStateAction<Set<string>>>
  tagValues: { name: string }[]
  allowTemplates?: boolean
  className?: string
}

export default function BookClassificationEditor({ libraryId, categories, categoryPath, tags, onCategoryChange, onTagsChange, tagValues, allowTemplates = true, className = 'border-t border-stone-100 pt-3.5 dark:border-stone-800' }: BookClassificationEditorProps) {
  const _ = useTranslation()
  const { data: categoriesData } = useLibraryCategories(libraryId, { enabled: !categories })
  return <section className={className}>
    <div className="mb-2"><p className="text-xs font-semibold text-stone-500 dark:text-stone-400">{_('library.categories')}</p></div>
    <CategorySelectPopover categories={categories ?? categoriesData?.data ?? []} categoryPath={categoryPath} allowTemplates={allowTemplates} onChange={(value) => onCategoryChange(value.categoryPath)} />
    <div className="mb-2 mt-4"><p className="text-xs font-semibold text-stone-500 dark:text-stone-400">{_('library.tags')}</p></div>
    <div className="flex max-h-36 flex-wrap items-center gap-1.5 overflow-y-auto custom-scrollbar p-0.5">
      {[...tags].map((name) => (
        <span key={name} className="inline-flex min-h-[28px] items-center gap-1 rounded-full border border-stone-200 bg-stone-100/90 py-0.5 pl-2.5 pr-1 text-xs font-medium text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 select-none">
          <span>{name}</span>
          <button type="button" aria-label={`${_('reader.delete')} ${name}`} title={`${_('reader.delete')} ${name}`} onClick={() => onTagsChange((current) => toggleSetItem(current, name))} className="flex h-4 w-4 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </span>
      ))}
      <TagSelectPopover tags={tagValues} selectedTags={tags} onToggleTag={(name) => onTagsChange((current) => toggleSetItem(current, name))} onAddTag={(name) => onTagsChange((current) => new Set(current).add(name))} />
    </div>
  </section>
}
