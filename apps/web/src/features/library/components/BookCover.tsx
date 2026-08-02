import { useState } from 'react'
import type { BookListItem } from '@bookdock/shared'

import { useUiStore } from '@/stores/ui.store'
import { cn } from '@/lib/utils'

interface BookCoverProps {
  book: BookListItem
  size?: 'sm' | 'md'
}

const STONE_PALETTES = [
  'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
  'bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300',
  'bg-amber-50 text-stone-600 dark:bg-amber-950 dark:text-amber-300',
  'bg-orange-50 text-stone-600 dark:bg-orange-950 dark:text-orange-300',
  'bg-yellow-50 text-stone-500 dark:bg-yellow-950 dark:text-yellow-300',
  'bg-neutral-100 text-stone-600 dark:bg-neutral-800 dark:text-neutral-400',
  'bg-stone-50 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
  'bg-zinc-100 text-stone-600 dark:bg-zinc-800 dark:text-zinc-400',
]

const EXT_RE = /\.(epub|txt|pdf|mobi|azw3?|fb2)$/i

function hashHue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0
  }
  return h
}

// Titles of parsed txt files can still look like raw file names.
function displayTitle(title: string): string {
  const trimmed = title.trim()
  return trimmed.replace(EXT_RE, '') || trimmed
}

export default function BookCover({ book, size = 'md' }: BookCoverProps) {
  const [error, setError] = useState(false)
  const coverFit = useUiStore((s) => s.coverFit)
  const palette = STONE_PALETTES[hashHue(book.id) % STONE_PALETTES.length]
  const isSm = size === 'sm'
  const hasCover = Boolean(book.coverKey) && !error

  if (hasCover) {
    return (
      <img
        src={`/api/v1/books/${book.id}/cover?v=${encodeURIComponent(book.coverKey ?? '')}`}
        alt={book.title}
        className={cn(
          'block overflow-hidden rounded-xl border border-stone-200/70 dark:border-stone-800/60',
          coverFit
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
          palette,
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
        'relative flex aspect-[2/3] w-full flex-col overflow-hidden rounded-xl border border-stone-200/70 dark:border-stone-800/60',
        palette,
      )}
    >
      <span className="absolute inset-y-0 left-0 w-1 bg-black/8 dark:bg-black/25" />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-3.5">
        <span className="line-clamp-4 text-center font-serif text-[13px] font-medium leading-snug">
          {title}
        </span>
      </div>
      <span className="pb-2 text-center text-[9px] font-medium uppercase tracking-widest opacity-40">
        {book.format}
      </span>
    </div>
  )
}
