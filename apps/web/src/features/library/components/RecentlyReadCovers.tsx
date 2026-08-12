import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'

import type { BookListItem } from '@bookdock/shared'

import BookCover from './BookCover'

interface RecentlyReadCoversProps {
  books: BookListItem[]
}

export default function RecentlyReadCovers({ books }: RecentlyReadCoversProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  function updateScrollState() {
    const el = scrollerRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
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
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-stone-50 to-transparent dark:from-stone-950" />
      )}
      {canScrollRight && (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-stone-50 to-transparent dark:from-stone-950" />
      )}
      <div
        ref={scrollerRef}
        onScroll={updateScrollState}
        className="flex gap-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {books.map((book) => (
          <Link
            key={book.id}
            to="/books/$id"
            params={{ id: book.id }}
            className="group/item w-24 shrink-0"
          >
            <div className="transition-transform duration-200 group-hover/item:-translate-y-0.5">
              <BookCover book={book} />
            </div>
            <h3 className="mt-1.5 truncate text-xs font-medium text-stone-800 dark:text-stone-200">
              {book.title}
            </h3>
            {book.progress != null && book.progress > 0 && (
              <p className="mt-0.5 text-[11px] tabular-nums text-stone-400 dark:text-stone-500">
                {Math.round(book.progress)}%
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
