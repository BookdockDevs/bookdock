import type { MouseEvent } from 'react'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'

import type { ProfileReadingBook } from '@bookdock/shared'

import BookCover from '@/features/library/components/BookCover'
import { useTranslation } from '@/hooks/useTranslation'
import type { ReaderReturn } from '@/features/reader/reader-return'

interface ProfileReadingShowcaseProps {
  books?: ProfileReadingBook[]
  readerReturn: ReaderReturn
  showBrowseLink?: boolean
}

export default function ProfileReadingShowcase({ books, readerReturn, showBrowseLink = true }: ProfileReadingShowcaseProps) {
  const _ = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()

  const openBook = (event: MouseEvent<HTMLAnchorElement>, bookId: string) => {
    if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return
    event.preventDefault()
    void navigate({
      to: '/books/$id',
      params: { id: bookId },
      state: (previous) => ({
        ...previous,
        readerReturn: location.state.__TSR_index === undefined
          ? readerReturn
          : { ...readerReturn, sourceHistoryIndex: location.state.__TSR_index },
      }),
    })
  }

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold tracking-tight text-stone-900 sm:text-base dark:text-stone-100">{_('profile.currentlyReading')}</h2>
        {showBrowseLink && books && books.length > 0 && <Link to="/" className="group inline-flex items-center gap-1 text-xs font-medium text-stone-500 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200"><span>{_('profile.browseLibrary')}</span><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg></Link>}
      </div>

      {!books ? (
        <div className="grid gap-3 sm:grid-cols-2" aria-busy="true">
          {[1, 2].map((item) => (
            <div key={item} className="flex h-24 animate-pulse items-center gap-4 rounded-xl bg-white p-3.5 shadow-2xs ring-1 ring-stone-900/5 dark:bg-stone-900/70 dark:ring-white/10">
              <div className="h-16 w-12 rounded-lg bg-stone-200/70 dark:bg-stone-800" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 rounded bg-stone-200/70 dark:bg-stone-800" />
                <div className="h-3 w-1/2 rounded bg-stone-200/70 dark:bg-stone-800" />
              </div>
            </div>
          ))}
        </div>
      ) : books.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {books.map((book) => (
            <Link
              key={book.id}
              to="/books/$id"
              params={{ id: book.id }}
              onClick={(event) => openBook(event, book.id)}
              className="group flex items-center gap-3.5 rounded-xl bg-white p-3 shadow-2xs ring-1 ring-stone-900/5 transition-all duration-200 hover:shadow-xs hover:ring-stone-900/10 sm:p-4 dark:bg-stone-900/70 dark:ring-white/10 dark:hover:ring-white/15"
            >
              <div className="shrink-0 transition-transform duration-200 group-hover:scale-105">
                <BookCover book={book} size="card" showFormat={false} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="line-clamp-2 font-serif text-[13px] font-semibold leading-snug text-stone-900 transition-colors group-hover:text-stone-800 dark:text-stone-100 dark:group-hover:text-white">
                  {book.title}
                </h3>
                <p className="mt-1 truncate text-xs text-stone-500 dark:text-stone-400">{book.author}</p>
                <div className="mt-2.5 flex items-center gap-2.5">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-stone-200/80 dark:bg-stone-700/60">
                    <div
                      className="h-full rounded-full bg-stone-600 transition-all duration-300 dark:bg-stone-300"
                      style={{ width: `${Math.min(100, Math.max(0, Math.round(book.progress)))}%` }}
                    />
                  </div>
                  <span className="shrink-0 font-mono text-[11px] font-medium tabular-nums text-stone-400 dark:text-stone-400">
                    {Math.round(book.progress)}%
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-200 bg-stone-50/50 px-4 py-8 text-center dark:border-stone-800 dark:bg-stone-900/30"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3 3h7z" /></svg></div><p className="mt-3 text-sm font-medium text-stone-700 dark:text-stone-300">{_('profile.noReadingBooks')}</p>{showBrowseLink && <Link to="/" className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-stone-200/80 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 shadow-xs transition-colors hover:bg-stone-50 hover:text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700">{_('profile.browseLibrary')}</Link>}</div>
      )}
    </section>
  )
}
