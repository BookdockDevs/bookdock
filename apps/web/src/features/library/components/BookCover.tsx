import { useState } from 'react'
import type { BookListItem } from '@bookdock/shared'

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

function hashHue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0
  }
  return h
}

export default function BookCover({ book, size = 'md' }: BookCoverProps) {
  const [error, setError] = useState(false)
  const palette = STONE_PALETTES[hashHue(book.id) % STONE_PALETTES.length]
  const isSm = size === 'sm'
  const hasCover = Boolean(book.coverKey) && !error

  if (hasCover) {
    return (
      <img
        src={`/api/v1/books/${book.id}/cover`}
        alt={book.title}
        className={cn(
          'block overflow-hidden rounded-lg border border-stone-200/70 object-cover dark:border-stone-800/60',
          isSm ? 'h-16 w-12' : 'aspect-[2/3] w-full',
        )}
        onError={() => setError(true)}
        loading="lazy"
      />
    )
  }

  return (
    <div
      className={cn(
        'relative flex flex-col items-center justify-center overflow-hidden rounded-lg border border-stone-200/70 dark:border-stone-800/60',
        palette,
        isSm ? 'h-16 w-12' : 'aspect-[2/3] w-full',
      )}
    >
      <span className={cn('select-none', isSm ? 'text-base' : 'text-xl sm:text-2xl lg:text-3xl')}>
        {book.format === 'epub' ? '📖' : '📄'}
      </span>
      {!isSm && (
        <span className="absolute bottom-1.5 left-1.5 right-1.5 truncate text-center text-[10px] text-stone-500">
          {book.title}
        </span>
      )}
    </div>
  )
}