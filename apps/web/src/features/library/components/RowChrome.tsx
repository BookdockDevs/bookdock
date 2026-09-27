import { cn } from '@/lib/utils'

/**
 * The select marker, in the two sizes rows use. A book card, a list row, a trash
 * row and a shared library's row all draw the same circle, and they were three
 * separate copies of these two class strings. One definition is what keeps a new
 * row from becoming a fourth.
 */

export function SelectionCheck({ selected, className }: { selected: boolean; className?: string }) {
  return (
    <div
      className={cn(
        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
        selected
          ? 'border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
          : 'border-stone-300 dark:border-stone-600',
        className,
      )}
    >
      {selected && (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-stone-900">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </div>
  )
}

/**
 * The same marker floating over artwork: larger, translucent until the row is
 * hovered, and drawn only while selection is on.
 */
export function SelectionCheckOverlay({ selected }: { selected: boolean }) {
  return (
    <div
      className={cn(
        'absolute left-2.5 top-2.5 z-20 flex h-6 w-6 items-center justify-center rounded-full shadow-md transition-all',
        selected
          ? 'border-2 border-stone-900 bg-stone-900 text-white dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
          : 'border-2 border-white/80 bg-black/30 backdrop-blur-xs group-hover:scale-105 group-hover:border-white group-hover:bg-black/50',
      )}
    >
      {selected && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 11 12 14 22 4" />
        </svg>
      )}
    </div>
  )
}

/** The artwork ring every cover in a list wears, so rows do not each re-declare it. */
export function CoverRing() {
  return <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-stone-900/10 dark:ring-white/10" />
}

/** The selected row's inner ring. */
export function SelectedRing() {
  return <div className="pointer-events-none absolute inset-0 z-10 rounded-xl ring-2 ring-inset ring-stone-900 dark:ring-stone-100" />
}
