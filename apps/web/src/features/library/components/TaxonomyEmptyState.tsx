import { useTranslation } from '@/hooks/useTranslation'

import TaxonomyIcon from './TaxonomyIcon'

interface TaxonomyEmptyStateProps {
  type: 'shelves' | 'categories' | 'tags'
}

export default function TaxonomyEmptyState({ type }: TaxonomyEmptyStateProps) {
  const _ = useTranslation()
  const label = _({ shelves: 'library.noShelves', categories: 'library.noCategories', tags: 'library.noTags' }[type])

  return (
    <div className="flex flex-col items-center justify-center py-8 px-2 text-center select-none">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-stone-500/5 text-stone-400 dark:bg-stone-500/10 dark:text-stone-500">
        {type === 'tags' ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.42 0l8.58-8.58a1 1 0 0 0 0-1.42z" />
            <circle cx="7" cy="7" r="1" />
          </svg>
        ) : (
          <TaxonomyIcon kind={type === 'categories' ? 'category' : 'shelf'} size={15} />
        )}
      </div>
      <p className="text-xs font-medium text-stone-500 dark:text-stone-400">{label}</p>
    </div>
  )
}
