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
    ? (book.coverKey ? `/api/v1/books/${book.id}/cover?v=${encodeURIComponent(book.coverKey)}` : null)
    : coverSrc
  const hasCover = Boolean(source) && !error

  useEffect(() => {
    setError(false)
  }, [source])

  if (hasCover) {
    return (
      <img
        src={source ?? undefined}
        alt={book.title}
        className={cn(
          'block overflow-hidden rounded-xl border border-stone-200/70 dark:border-stone-800/60',
          coverFit === 'full'
            ? 'bg-stone-100 object-contain p-1 dark:bg-stone-800'
            : 'object-cover',
          isSm ? 'h-16 w-12' : 'aspect-[2/3] w-full',
        )}
        onError={() => setError(true)}
        loading="lazy"
      />
    )
  }

  const title = displayTitle(book.title)
  const initial = title.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?'

  if (isSm) {
    return (
      <div
        className={cn(
          'relative flex h-16 w-12 items-center justify-center overflow-hidden rounded-xl border border-stone-200/70 dark:border-stone-800/60',
          palette.className,
        )}
      >
        <span className="absolute inset-y-0 left-0 w-0.5 bg-black/8 dark:bg-black/25" />
        <span className="select-none font-serif text-lg font-medium">{initial}</span>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative flex aspect-[2/3] w-full select-none flex-col overflow-hidden rounded-xl border border-stone-200/70 shadow-xs dark:border-stone-800/60',
        palette.className,
      )}
    >
      <span className="absolute inset-y-0 left-0 w-1 bg-black/8 dark:bg-black/25" />
      <span className="absolute inset-y-0 left-2 w-px bg-black/4 dark:bg-black/15" />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-3.5 pl-4">
        <span className="line-clamp-4 text-center font-serif text-[13px] font-medium leading-snug tracking-wide">
          {title}
        </span>
      </div>
      <span className="pb-2 text-center text-[9px] font-medium uppercase tracking-widest opacity-40">
        {book.format}
      </span>
    </div>
  )
}
