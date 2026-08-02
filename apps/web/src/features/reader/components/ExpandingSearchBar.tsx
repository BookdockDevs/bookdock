import { useEffect, useRef, type ReactNode } from 'react'

interface ExpandingSearchBarProps {
  expanded: boolean
  query: string
  placeholder: string
  onQueryChange: (query: string) => void
  /** Request to collapse the bar (Escape on an empty input) */
  onCollapse: () => void
  /** Search progress 0..1 — shows a thin progress bar while set and < 1 */
  progress?: number | null
  /** Trailing controls rendered at the right of the input (e.g. options button) */
  children?: ReactNode
}

/** Search bar that slides down from the top of its container and collapses away */
export function ExpandingSearchBar({ expanded, query, placeholder, onQueryChange, onCollapse, progress, children }: ExpandingSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (expanded) inputRef.current?.focus()
  }, [expanded])

  return (
    <div
      className={`overflow-hidden transition-[max-height,opacity,visibility] duration-200 ease-out ${
        expanded ? 'visible max-h-16 opacity-100' : 'invisible max-h-0 opacity-0'
      }`}
    >
      <div className="flex items-center gap-2 py-2">
        <div className="relative flex-1">
          <svg
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--bd-read-sub)]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return
              if (query) onQueryChange('')
              else onCollapse()
            }}
            placeholder={placeholder}
            className="w-full rounded-lg border border-stone-200/60 bg-transparent py-1.5 pl-8 pr-8 text-sm outline-none placeholder:text-[var(--bd-read-sub)] dark:border-stone-800/60"
          />
          {query && (
            <button
              onClick={() => {
                onQueryChange('')
                inputRef.current?.focus()
              }}
              className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current"
              aria-label="清除"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>
        {children}
      </div>
      {progress != null && progress < 1 && (
        <div className="pb-1.5">
          <div className="h-0.5 w-full overflow-hidden rounded-full bg-stone-500/15">
            <div
              data-testid="search-progress"
              className="h-full rounded-full bg-blue-500 transition-[width] duration-150"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
