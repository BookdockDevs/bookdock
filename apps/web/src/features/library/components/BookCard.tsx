import type { BookListItem } from '@bookdock/shared'

import { formatBytes, formatDate } from '@/lib/utils'

import BookCover from './BookCover'

interface BookCardProps {
  book: BookListItem
  onDelete?: (book: BookListItem) => void
  onEditMembership?: (book: BookListItem) => void
  onRestore?: (book: BookListItem) => void
  onPermanentDelete?: (book: BookListItem) => void
}

export default function BookCard({ book, onDelete, onEditMembership, onRestore, onPermanentDelete }: BookCardProps) {
  return (
    <article className="group flex min-w-0 flex-col gap-2">
      <div className="relative">
        <BookCover book={book} />
        <div className="absolute -bottom-1 right-0 flex opacity-0 transition-opacity group-hover:opacity-100">
          {onRestore && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onRestore(book)
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              aria-label="恢复"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </button>
          )}
          {onPermanentDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onPermanentDelete(book)
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-stone-800"
              aria-label="彻底删除"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                <path d="M10 11v6M14 11v6" />
              </svg>
            </button>
          )}
          {onEditMembership && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onEditMembership(book)
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              aria-label="编辑归类"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onDelete(book)
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              aria-label="删除"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="min-w-0">
        <h3 className="truncate font-serif text-sm font-medium text-stone-900 dark:text-stone-100">
          {book.title}
        </h3>
        {book.author && (
          <p className="truncate text-xs text-stone-500">{book.author}</p>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] uppercase text-stone-400">
        <span>{book.format}</span>
        <span>·</span>
        <span>{formatBytes(book.size)}</span>
        <span>·</span>
        <span>{formatDate(book.createdAt)}</span>
      </div>
    </article>
  )
}
