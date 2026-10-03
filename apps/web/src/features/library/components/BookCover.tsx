import { useEffect, useState } from 'react'
import type { CoverPaletteId } from '@bookdock/shared'

import { useUiStore } from '@/stores/ui.store'
import { cn } from '@/lib/utils'

import { getCoverPalette } from './cover-palettes'

/**
 * The only cover fields this component reads. Narrowing the prop to exactly
 * these is what lets a shared library's version reuse the same cover as a
 * private book - the two carry their artwork under different row types, but the
 * cover itself is one component with one set of rules (fit, lazy load, error
 * fallback, palette placeholder).
 */
export interface CoverSource {
  id: string
  title: string
  format: string
  coverKey?: string | null
  /** Stable content identity used for the automatic placeholder palette. */
  coverPaletteKey?: string | null
  coverPaletteId?: CoverPaletteId | null
}

interface BookCoverProps {
  book: CoverSource
  size?: 'sm' | 'md' | 'card'
  coverSrc?: string | null
  coverPaletteId?: CoverPaletteId | null
}

const EXT_RE = /\.(epub|txt|pdf|mobi|azw3?|fb2)$/i

// Titles of parsed txt files can still look like raw file names.
function displayTitle(title: string): string {
  const trimmed = title.trim()
  return trimmed.replace(EXT_RE, '') || trimmed
}

export default function BookCover({ book, size = 'md', coverSrc, coverPaletteId }: BookCoverProps) {
  const [error, setError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const coverFit = useUiStore((s) => s.coverFit)
  // Hash by stable content identity, not a library work/card id or title:
  // moving a version between libraries and renaming it must not repaint it.
  const palette = getCoverPalette(book.coverPaletteKey ?? book.id, coverPaletteId ?? book.coverPaletteId)
  const isSm = size === 'sm'
  const isCard = size === 'card'
  const source = coverSrc === undefined
    ? (book.coverKey || book.format === 'epub'
      ? `/api/v1/books/${book.id}/cover?v=${encodeURIComponent(book.coverKey ?? 'auto')}`
      : null)
    : coverSrc
  const hasCover = Boolean(source) && !error

  useEffect(() => {
    setError(false)
    setLoaded(false)
  }, [source])

  const title = displayTitle(book.title)
  const initial = title.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?'

  return (
    <div
      className={cn(
        'relative overflow-hidden border border-stone-200/80 shadow-xs dark:border-stone-700/60 dark:ring-1 dark:ring-inset dark:ring-white/10',
        isSm || isCard ? 'rounded-lg' : 'rounded-xl',
        isSm
          ? 'flex h-16 w-12 shrink-0 items-center justify-center'
          : isCard
            ? 'flex h-20 w-14 shrink-0 select-none flex-col'
            : 'flex aspect-[2/3] w-full select-none flex-col',
        palette.className,
      )}
    >
      {isSm ? (
        <>
          <span className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-r from-black/15 to-transparent dark:from-black/30" />
          <span className="pointer-events-none absolute inset-y-0 left-1.5 w-px bg-white/25 dark:bg-white/10" />
          <span className="select-none font-serif text-lg font-medium">{initial}</span>
        </>
      ) : isCard ? (
        <>
          {/* Surface matte sheen */}
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/10 dark:from-white/5 dark:via-transparent dark:to-black/25" />

          {/* Spine lighting & crease */}
          <span className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-black/10 dark:bg-black/25" />
          <span className="pointer-events-none absolute inset-y-0 left-1.5 w-px bg-black/5 dark:bg-white/10" />
          <span className="pointer-events-none absolute inset-y-0 left-0 w-2.5 bg-gradient-to-r from-black/15 via-black/5 to-transparent dark:from-black/30" />
          {/* Right edge curvature */}
          <span className="pointer-events-none absolute inset-y-0 right-0 w-1 bg-gradient-to-l from-black/5 to-transparent dark:from-white/5 dark:to-transparent" />

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-0.5 px-1.5 pl-2.5">
            <span className="line-clamp-3 text-center font-serif text-[10px] font-medium leading-tight tracking-wide">
              {title}
            </span>
          </div>
          <span className="pb-1 text-center font-mono text-[8px] font-medium uppercase tracking-widest opacity-40">
            {book.format}
          </span>
        </>
      ) : (
        <>
          {/* Surface matte sheen */}
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/10 via-transparent to-black/10 dark:from-white/5 dark:via-transparent dark:to-black/25" />

          {/* Spine lighting & crease */}
          <span className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-black/10 dark:bg-black/25" />
          <span className="pointer-events-none absolute inset-y-0 left-2 w-px bg-black/5 dark:bg-white/10" />
          <span className="pointer-events-none absolute inset-y-0 left-0 w-3.5 bg-gradient-to-r from-black/15 via-black/5 to-transparent dark:from-black/30" />
          {/* Right edge curvature */}
          <span className="pointer-events-none absolute inset-y-0 right-0 w-1.5 bg-gradient-to-l from-black/5 to-transparent dark:from-white/5 dark:to-transparent" />

          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 px-4 pl-5">
            <span className="line-clamp-4 text-center font-serif text-[13px] font-medium leading-snug tracking-wide">
              {title}
            </span>
          </div>
          <span className="pb-2 text-center font-mono text-[9px] font-medium uppercase tracking-widest opacity-40">
            {book.format}
          </span>
        </>
      )}

      {/* Artwork is an overlay on the placeholder, not a replacement for it, so
          a cover that is absent - or still in flight, as for every EPUB whose
          artwork only the server can find - never blanks out the title. */}
      {hasCover && (
        <img
          ref={(img) => {
            if (img?.complete && img?.naturalWidth > 0 && !loaded) {
              setLoaded(true)
            }
          }}
          src={source ?? undefined}
          alt={book.title}
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={cn(
            'absolute inset-0 block h-full w-full transition-opacity duration-300',
            loaded ? 'opacity-100' : 'opacity-0',
            coverFit === 'full'
              ? 'bg-stone-100 object-contain p-1 dark:bg-stone-800'
              : 'object-cover',
          )}
          onError={() => setError(true)}
          loading="lazy"
        />
      )}

      {/* Subtle spine shadow overlay on real covers */}
      {hasCover && !isSm && (
        <>
          <span className="pointer-events-none absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-black/25 via-black/5 to-transparent" />
          <span className="pointer-events-none absolute inset-y-0 left-2.5 w-px bg-white/20" />
        </>
      )}
    </div>
  )
}
