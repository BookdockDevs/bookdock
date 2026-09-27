import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface BookGridProps {
  /** Re-mounting the container on page change replays the fade-in. */
  pageKey: number | string
  view: 'grid' | 'list'
  columns: number
  children: ReactNode
}

/**
 * The one container a book list is rendered into. Both libraries use it (0.4.0):
 * a private list puts book cards in, a shared library puts catalog rows in, and
 * the column maths, the gutter and the page transition cannot drift apart
 * because there is only one of them.
 *
 * Rows are plain elements, exactly as the private library's were - the wrapper
 * adds no semantics the rows do not already have, and keeps the private list's
 * markup byte-identical to what it was before.
 */
export default function BookGrid({ pageKey, view, columns, children }: BookGridProps) {
  return (
    <div
      key={pageKey}
      className={cn(
        'py-2 transition-opacity duration-150 animate-in fade-in',
        view === 'grid' ? 'grid gap-4' : 'flex flex-col gap-2',
      )}
      style={view === 'grid' ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {children}
    </div>
  )
}
