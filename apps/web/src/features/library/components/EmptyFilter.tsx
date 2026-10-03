import { useTranslation } from '@/hooks/useTranslation'

interface EmptyFilterProps {
  /** Clears every narrowing dimension, landing on the unfiltered list. */
  onClear: () => void
}

/**
 * An empty list under an active filter, kept separate from `EmptyLibrary`.
 *
 * The two states look identical on screen but mean opposite things: an empty
 * library is fixed by adding books, an empty result is fixed by widening the
 * view. Offering the upload invitation to someone who filtered down to nothing
 * sends them off to do the wrong thing, and the header above still shows the
 * filter's own name and count of zero.
 */
export default function EmptyFilter({ onClear }: EmptyFilterProps) {
  const _ = useTranslation()
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <div className="mb-1 flex h-16 w-16 items-center justify-center rounded-2xl border border-stone-200/80 bg-white shadow-xs dark:border-stone-800 dark:bg-stone-900">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400 dark:text-stone-500">
          <circle cx="11" cy="11" r="7" />
          <line x1="16.5" y1="16.5" x2="21" y2="21" />
        </svg>
      </div>
      <p className="font-serif text-lg font-medium text-stone-700 dark:text-stone-200">{_('library.emptyFilter')}</p>
      <p className="text-sm text-stone-400 dark:text-stone-500">{_('library.emptyFilterHint')}</p>
      <button
        type="button"
        onClick={onClear}
        className="rounded-lg border border-stone-200 bg-white px-3.5 py-2 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
      >
        {_('library.clearFilters')}
      </button>
    </div>
  )
}
