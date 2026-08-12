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
    <div className="relative">
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => scrollBy(-1)}
          className="absolute -left-2.5 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-stone-200/80 bg-white/95 text-stone-500 shadow-md backdrop-blur-sm transition-colors hover:text-stone-900 group-hover:flex dark:border-stone-700 dark:bg-stone-900/95 dark:hover:text-stone-100"
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
          className="absolute -right-2.5 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-stone-200/80 bg-white/95 text-stone-500 shadow-md backdrop-blur-sm transition-colors hover:text-stone-900 group-hover:flex dark:border-stone-700 dark:bg-stone-900/95 dark:hover:text-stone-100"
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
        className="flex gap-3.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {books.map((book) => (
          <Link
            key={book.id}
            to="/books/$id"
            params={{ id: book.id }}
            className="group/item w-64 shrink-0"
          >
            <div className="flex h-full items-center gap-3.5 rounded-xl bg-white p-3 shadow-sm ring-1 ring-stone-200/70 transition-all duration-200 group-hover/item:-translate-y-0.5 group-hover/item:shadow-md dark:bg-stone-900 dark:ring-stone-800">
              <BookCover book={book} size="sm" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-serif text-[13px] font-medium leading-snug text-stone-900 dark:text-stone-100">
                  {book.title}
                </h3>
                {book.lastReadAt != null && (
                  <p className="mt-0.5 truncate text-[11px] text-stone-500 dark:text-stone-400">
                    {formatRelativeTime(_, book.lastReadAt)}
                  </p>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
