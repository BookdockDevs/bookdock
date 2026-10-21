import { type Dispatch, type SetStateAction } from 'react'

import { useTranslation } from '@/hooks/useTranslation'

import { useLibraryCategories, useTags } from '../../hooks'
import CategorySelectPopover from '../CategorySelectPopover'
import TagSelectPopover from '../TagSelectPopover'
import { toggleSetItem } from './types'

interface BookClassificationEditorProps {
  libraryId: string
  categoryId: string | null
  categoryTemplateKey?: string
  tagIds: Set<string>
  onCategoryChange: (value: { categoryId: string | null; categoryTemplateKey?: undefined } | { categoryId?: undefined; categoryTemplateKey: string }) => void
  onTagChange: Dispatch<SetStateAction<Set<string>>>
}

export default function BookClassificationEditor({
  libraryId,
  categoryId,
  categoryTemplateKey,
  tagIds,
  onCategoryChange,
  onTagChange,
}: BookClassificationEditorProps) {
  const _ = useTranslation()
  const { data: categoriesData } = useLibraryCategories(libraryId)
  const { data: tagsData } = useTags()

  const allTags = tagsData?.data ?? []
  const selectedTags = allTags.filter((tag) => tagIds.has(tag.id))

  return (
    <section className="mt-5 border-t border-stone-100 pt-4 dark:border-stone-800">
      {/* Category Section */}
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-stone-500 dark:text-stone-400">{_('library.categories')}</p>
      </div>
      <div>
        <CategorySelectPopover
          libraryId={libraryId}
          categories={categoriesData?.data ?? []}
          categoryId={categoryId}
          categoryTemplateKey={categoryTemplateKey}
          allowTemplates
          onChange={onCategoryChange}
        />
      </div>

      {/* Tags Section */}
      <div className="mb-2 mt-4 flex items-center justify-between">
        <p className="text-xs font-semibold text-stone-500 dark:text-stone-400">{_('library.tags')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/* Selected Tag Pills (with quick-remove X) */}
        {selectedTags.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex min-h-[28px] items-center gap-1 rounded-full border border-stone-200 bg-stone-100/90 py-0.5 pl-2.5 pr-1 text-xs font-medium text-stone-800 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 select-none"
          >
            <span>{tag.name}</span>
            <button
              type="button"
              aria-label={`${_('reader.delete')} ${tag.name}`}
              title={`${_('reader.delete')} ${tag.name}`}
              onClick={() => onTagChange((current) => toggleSetItem(current, tag.id))}
              className="flex h-4 w-4 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}

        {/* Add Tag Popover Trigger */}
        <TagSelectPopover
          tags={allTags}
          selectedTagIds={tagIds}
          onToggleTag={(id) => onTagChange((current) => toggleSetItem(current, id))}
          onAddTag={(id) => onTagChange((current) => new Set(current).add(id))}
        />
      </div>
    </section>
  )
}
