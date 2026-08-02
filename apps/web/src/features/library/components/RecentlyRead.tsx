import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'

import { useTranslation } from '@/hooks/useTranslation'

import BookCover from './BookCover'
import { useBooks } from '../hooks'

const MAX_RECENT = 12
const INITIAL_FETCH = 30

export default function RecentlyRead() {
  const _ = useTranslation()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)

  const { data, isLoading } = useBooks({
    page: 1,
    pageSize: INITIAL_FETCH,
    search: '',
    sortBy: 'lastReadAt',
    sortOrder: 'desc',
    shelfId: null,
    tagId: null,
    format: null,
    readStatus: null,
    trash: false,
  })

  const books = (data?.data ?? [])
    .filter(
      (b) =>
        b.progress != null &&
        b.readStatus !== 'finished' &&
        b.readStatus !== 'wishlist' &&
        b.readStatus !== 'idle' &&
        b.readStatus !== 'abandoned',
    )
    .slice(0, MAX_RECENT)

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

  if (isLoading || books.length === 0) return null

  return (
    <section className="group mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
        {_('library.recentlyRead')}
      </h2>
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
          className="flex gap-3.5 overflow-x-auto pb-1"
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
                  {book.author && (
                    <p className="mt-0.5 truncate text-[11px] text-stone-500 dark:text-stone-400">
                      {book.author}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-stone-200/80 dark:bg-stone-700">
                      <div
                        className="h-full rounded-full bg-stone-700 dark:bg-stone-400"
                        style={{ width: `${book.progress}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[10px] tabular-nums text-stone-400 dark:text-stone-500">
                      {Math.round(book.progress ?? 0)}%
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  )
}
