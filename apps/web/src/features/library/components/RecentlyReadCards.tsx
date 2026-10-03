import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'

import type { BookListItem } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { formatRelativeTime } from '@/features/reader/components/format-relative-time'

import BookCover from './BookCover'

interface RecentlyReadCardsProps {
  books: BookListItem[]
}

export default function RecentlyReadCards({ books }: RecentlyReadCardsProps) {
  const _ = useTranslation()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  function updateScrollState() {
    const el = scrollerRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }

  function scrollBy(direction: -1 | 1) {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  useEffect(() => {
    updateScrollState()
    const el = scrollerRef.current
    if (!el) return
    const observer = new ResizeObserver(updateScrollState)
    observer.observe(el)
    return () => observer.disconnect()
  }, [books.length])

  return (
    <div className="relative group/cards">
      {canScrollLeft && (
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-stone-50 to-transparent dark:from-stone-950" />
      )}
      {canScrollRight && (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-stone-50 to-transparent dark:from-stone-950" />
      )}
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          className="absolute -left-2.5 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-stone-200/80 bg-white/95 text-stone-600 shadow-md backdrop-blur-sm transition-all duration-200 hover:scale-105 hover:border-stone-300 hover:text-stone-900 focus-visible:opacity-100 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-hover/cards:opacity-100 group-hover/cards:pointer-events-auto dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-300 dark:ring-1 dark:ring-white/10 dark:hover:border-stone-600 dark:hover:text-stone-100"
          aria-label={_('library.scrollLeft')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
      )}
      {canScrollRight && (
        <button
          type="button"
          onClick={() => scrollBy(1)}
          className="absolute -right-2.5 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-stone-200/80 bg-white/95 text-stone-600 shadow-md backdrop-blur-sm transition-all duration-200 hover:scale-105 hover:border-stone-300 hover:text-stone-900 focus-visible:opacity-100 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-hover/cards:opacity-100 group-hover/cards:pointer-events-auto dark:border-stone-700 dark:bg-stone-900/95 dark:text-stone-300 dark:ring-1 dark:ring-white/10 dark:hover:border-stone-600 dark:hover:text-stone-100"
          aria-label={_('library.scrollRight')}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
      <div
        ref={scrollerRef}
        onScroll={updateScrollState}
        className="flex gap-3.5 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {books.map((book) => (
          <Link
            key={book.id}
            to="/books/$id"
            params={{ id: book.id }}
            className="group/item w-[250px] shrink-0"
          >
            <div className="flex h-full items-center gap-3 rounded-xl bg-white p-3 shadow-sm ring-1 ring-stone-200/70 transition-all duration-200 group-hover/item:-translate-y-0.5 group-hover/item:shadow-md dark:bg-stone-900/90 dark:ring-1 dark:ring-white/10 dark:group-hover/item:ring-white/20 dark:group-hover/item:shadow-black/50">
              <BookCover book={book} size="card" />
              <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 py-0.5">
                <h3
                  className="line-clamp-2 font-serif text-[13px] font-semibold leading-snug text-stone-900 transition-colors group-hover/item:text-stone-800 dark:text-stone-100/90 dark:group-hover/item:text-white"
                  title={book.title}
                >
                  {book.title}
                </h3>
                {book.lastReadAt != null && (
                  <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                    {formatRelativeTime(_, book.lastReadAt)}
                  </p>
                )}
                {book.progress != null && book.progress > 0 && (
                  <div className="flex items-center gap-2.5">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200/80 dark:bg-stone-700/60">
                      <div
                        className="h-full rounded-full bg-stone-600 transition-all dark:bg-stone-300"
                        style={{ width: `${Math.min(100, Math.max(2, Math.round(book.progress)))}%` }}
                      />
                    </div>
                    <span className="shrink-0 font-mono text-[11px] font-medium tabular-nums text-stone-400 dark:text-stone-400">
                      {Math.round(book.progress)}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
