import { Link } from '@tanstack/react-router'

import BookCover from '@/features/library/components/BookCover'
import { useBooks } from '@/features/library/hooks'
import { useTranslation } from '@/hooks/useTranslation'

export default function ProfileReadingShowcase() {
  const _ = useTranslation()
  const { data, isLoading } = useBooks({
    page: 1,
    pageSize: 4,
    search: '',
    sortBy: 'lastReadAt',
    sortOrder: 'desc',
    shelfId: null,
    tagId: null,
    format: null,
    readStatus: 'reading',
    trash: false,
  })

  const books = data?.data ?? []

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold tracking-tight text-stone-900 sm:text-base dark:text-stone-100">
          {_('profile.currentlyReading')}
        </h2>
        {books.length > 0 && (
          <Link
            to="/"
            className="group inline-flex items-center gap-1 text-xs font-medium text-stone-500 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200"
          >
            <span>{_('profile.browseLibrary')}</span>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="transition-transform group-hover:translate-x-0.5"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex h-24 animate-pulse items-center gap-4 rounded-2xl border border-stone-200/80 bg-white p-3.5 dark:border-stone-800 dark:bg-stone-900">
            <div className="h-16 w-12 rounded-lg bg-stone-200/70 dark:bg-stone-800" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-stone-200/70 dark:bg-stone-800" />
              <div className="h-3 w-1/2 rounded bg-stone-200/70 dark:bg-stone-800" />
            </div>
          </div>
          <div className="flex h-24 animate-pulse items-center gap-4 rounded-2xl border border-stone-200/80 bg-white p-3.5 dark:border-stone-800 dark:bg-stone-900">
            <div className="h-16 w-12 rounded-lg bg-stone-200/70 dark:bg-stone-800" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-stone-200/70 dark:bg-stone-800" />
              <div className="h-3 w-1/2 rounded bg-stone-200/70 dark:bg-stone-800" />
            </div>
          </div>
        </div>
      ) : books.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {books.map((book) => {
            const pct = Math.min(100, Math.max(0, book.progress ?? 0))
            return (
              <Link
                key={book.id}
                to="/books/$id"
                params={{ id: book.id }}
                className="group flex items-center gap-3.5 rounded-2xl border border-stone-200/80 bg-white p-3 shadow-xs transition-all hover:border-stone-300 hover:shadow-sm sm:p-4 dark:border-stone-800 dark:bg-stone-900 dark:hover:border-stone-700"
              >
                <div className="shrink-0 transition-transform duration-200 group-hover:scale-105">
                  <BookCover book={book} size="sm" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium text-stone-900 transition-colors group-hover:text-amber-700 dark:text-stone-100 dark:group-hover:text-amber-400">
                    {book.title}
                  </h3>
                  <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
                    {book.author ? `${book.author} · ` : ''}{book.format.toUpperCase()}
                  </p>
                  <div className="mt-2.5 flex items-center gap-2.5">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
                      <div
                        className="h-full rounded-full bg-stone-700 transition-all duration-300 dark:bg-stone-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="shrink-0 text-[11px] font-medium tabular-nums text-stone-500 dark:text-stone-400">
                      {pct}%
                    </span>
                  </div>
                </div>
                <div className="shrink-0 pl-1 text-stone-300 transition-transform group-hover:translate-x-0.5 group-hover:text-stone-600 dark:text-stone-700 dark:group-hover:text-stone-300">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-white/60 px-4 py-8 text-center dark:border-stone-800 dark:bg-stone-900/60">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          </div>
          <p className="mt-3 text-sm font-medium text-stone-700 dark:text-stone-300">
            {_('profile.noReadingBooks')}
          </p>
          <Link
            to="/"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-stone-200/80 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 shadow-xs transition-colors hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
          >
            <span>{_('profile.browseLibrary')}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
          </Link>
        </div>
      )}
    </section>
  )
}
