import { useEffect, useState } from 'react'
import type { BookListItem } from '@bookdock/shared'

import { useUiStore } from '@/stores/ui.store'
import { cn } from '@/lib/utils'

import { getCoverPalette } from './cover-palettes'

interface BookCoverProps {
  book: BookListItem
  size?: 'sm' | 'md'
  coverSrc?: string | null
  coverPaletteId?: string | null
}

const EXT_RE = /\.(epub|txt|pdf|mobi|azw3?|fb2)$/i

// Titles of parsed txt files can still look like raw file names.
function displayTitle(title: string): string {
  const trimmed = title.trim()
  return trimmed.replace(EXT_RE, '') || trimmed
}

export default function BookCover({ book, size = 'md', coverSrc, coverPaletteId }: BookCoverProps) {
  const [error, setError] = useState(false)
  const coverFit = useUiStore((s) => s.coverFit)
  const paletteKey = book.title?.trim() || book.id
  const palette = getCoverPalette(paletteKey, coverPaletteId)
  const isSm = size === 'sm'
  const source = coverSrc === undefined
    ? (book.coverKey || book.format === 'epub'
      ? `/api/v1/books/${book.id}/cover?v=${encodeURIComponent(book.coverKey ?? 'auto')}`
      : null)
    : coverSrc
  const hasCover = Boolean(source) && !error

  useEffect(() => {
    setError(false)
  }, [source])

  if (hasCover) {
    return (
      <div
        className={cn(
          'relative overflow-hidden rounded-xl border border-stone-200/80 shadow-xs dark:border-stone-800/70',
          isSm ? 'h-16 w-12 shrink-0' : 'aspect-[2/3] w-full',
        )}
      >
        <img
          src={source ?? undefined}
          alt={book.title}
          className={cn(
            'block h-full w-full',
            coverFit === 'full'
              ? 'bg-stone-100 object-contain p-1 dark:bg-stone-800'
              : 'object-cover',
          )}
          onError={() => setError(true)}
          loading="lazy"
        />
        {/* Subtle spine shadow overlay on real covers */}
        <span className={cn('pointer-events-none absolute inset-y-0 left-0 bg-gradient-to-r from-black/25 via-black/5 to-transparent', isSm ? 'w-1.5' : 'w-3')} />
        <span className={cn('pointer-events-none absolute inset-y-0 w-px bg-white/20', isSm ? 'left-1.5' : 'left-2.5')} />
      </div>
    )
  }

  const title = displayTitle(book.title)
  const initial = title.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?'

  if (isSm) {
    return (
      <div
        className={cn(
          'relative flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-stone-200/80 shadow-xs dark:border-stone-800/70',
          palette.className,
        )}
      >
        <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-r from-black/15 to-transparent dark:from-black/30" />
        <span className="pointer-events-none absolute inset-y-0 left-1.5 w-px bg-white/25 dark:bg-white/10" />
        <span className="select-none font-serif text-lg font-medium">{initial}</span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative flex aspect-[2/3] w-full select-none flex-col overflow-hidden rounded-xl border border-stone-200/80 shadow-xs dark:border-stone-800/70',
        palette.className,
      )}
    >
      {/* Spine lighting & crease */}
      <span className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-black/10 dark:bg-black/25" />
      <span className="pointer-events-none absolute inset-y-0 left-2 w-px bg-black/5 dark:bg-black/15" />
      <span className="pointer-events-none absolute inset-y-0 left-0 w-3.5 bg-gradient-to-r from-black/15 via-black/5 to-transparent dark:from-black/30" />
      {/* Right edge curvature */}
      <span className="pointer-events-none absolute inset-y-0 right-0 w-1.5 bg-gradient-to-l from-black/5 to-transparent dark:from-black/15" />

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-4 pl-5">
        <span className="line-clamp-4 text-center font-serif text-[13px] font-medium leading-snug tracking-wide">
          {title}
        </span>
      </div>
      <span className="pb-2 text-center font-mono text-[9px] font-medium uppercase tracking-widest opacity-40">
        {book.format}
      </span>
    </div>
  )
}
