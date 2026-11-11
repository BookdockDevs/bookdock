import { Link } from '@tanstack/react-router'
import type { ReadingRange } from '@bookdock/shared'

import BookCover from '@/features/library/components/BookCover'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'
import { cn } from '@/lib/utils'
import type { ArchiveSearch } from '@/routes/archive'

import type { DayRange, StatsPeriod } from '@/features/stats/date-utils'
import { useArchiveBooksInfinite } from '../hooks'

export interface PeriodBooksSectionProps {
  query?: ReadingRange
  period?: StatsPeriod
  range?: DayRange
  selectedDate?: string | null
  baseSearch: ArchiveSearch
  onSelectBook?: (bookId: string) => void
}

export default function PeriodBooksSection({
  query,
  period,
  selectedDate,
  baseSearch,
  onSelectBook,
}: PeriodBooksSectionProps) {
  const _ = useTranslation()
  const archivePath = '/archive' as const

  const booksQuery = useArchiveBooksInfinite({
    range: query,
    pageSize: 20,
    sort: 'reading-time',
  })

  const books = booksQuery.data?.pages.flatMap((page) => page.data.entries) ?? []
  const isLoading = booksQuery.isLoading && !booksQuery.data

  let title = _('periodBooks.defaultTitle') || '读过的书'
  if (selectedDate) {
    const parts = selectedDate.split('-')
    const dateLabel = parts.length === 3 ? `${Number(parts[1])}月${Number(parts[2])}日` : selectedDate
    title = _('periodBooks.dateTitle', { date: dateLabel, defaultValue: `${dateLabel}读过的书` })
  } else if (period === 'week') {
    title = _('periodBooks.weekTitle') || '本周读过的书'
  } else if (period === 'month') {
    title = _('periodBooks.monthTitle') || '本月读过的书'
  } else if (period === 'year') {
    title = _('periodBooks.yearTitle') || '今年读过的书'
  } else if (period === 'all') {
    title = _('periodBooks.allTitle') || '全部读过的书'
  }

  let emptyText = _('periodBooks.defaultEmpty') || '暂无阅读记录'
  if (selectedDate) {
    emptyText = _('periodBooks.dateEmpty') || '当天还没有阅读记录'
  } else if (period === 'week') {
    emptyText = _('periodBooks.weekEmpty') || '本周还没有阅读记录'
  } else if (period === 'month') {
    emptyText = _('periodBooks.monthEmpty') || '本月还没有阅读记录'
  } else if (period === 'year') {
    emptyText = _('periodBooks.yearEmpty') || '今年还没有阅读记录'
  }

  return (
    <section className="rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs sm:p-6 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-semibold text-stone-900 dark:text-stone-100">
          <span>{title}</span>
          {!isLoading && books.length > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium tabular-nums text-stone-600 dark:bg-stone-800 dark:text-stone-300">
              {books.length}
            </span>
          )}
        </h3>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3.5 p-2">
              <div className="h-14 w-10 animate-pulse rounded-md bg-stone-200/70 dark:bg-stone-800 motion-reduce:animate-none" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800 motion-reduce:animate-none" />
                <div className="h-3 w-1/4 animate-pulse rounded bg-stone-200/50 dark:bg-stone-800/80 motion-reduce:animate-none" />
              </div>
            </div>
          ))}
        </div>
      ) : books.length === 0 ? (
        <p className="py-6 text-center text-xs text-stone-400 dark:text-stone-500">
          {emptyText}
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-stone-100 dark:divide-stone-800/60">
          {books.map((book) => {
            const durationSeconds = book.durationSeconds ?? 0
            const readingDays = book.readingDays ?? 0

            const metrics: React.ReactNode[] = []
            if (durationSeconds > 0) {
              metrics.push(
                <span key="duration" className="font-medium text-stone-700 dark:text-stone-200 tabular-nums">
                  {formatDuration(durationSeconds, _)}
                </span>,
              )
            }
            if (readingDays > 0) {
              metrics.push(
                <span key="days" className="tabular-nums">
                  {_('periodBooks.daysRead', { days: readingDays, defaultValue: `读了 ${readingDays} 天` })}
                </span>,
              )
            }
            if (metrics.length === 0) {
              metrics.push(
                <span key="empty" className="tabular-nums">
                  {formatDuration(0, _)}
                </span>,
              )
            }

            return (
              <Link
                key={book.id}
                to={archivePath}
                search={{ ...baseSearch, bookId: book.id, view: undefined }}
                replace
                state={(previous) => ({ ...previous })}
                onClick={() => onSelectBook?.(book.id)}
                className="group -mx-2 flex items-center justify-between rounded-xl px-2 py-3 transition-colors hover:bg-stone-50/80 sm:px-3 dark:hover:bg-stone-800/50"
              >
                <div className="flex min-w-0 items-center gap-3.5">
                  <div className="shrink-0" aria-hidden="true">
                    <BookCover
                      book={{
                        ref: book.ref, id: book.id,
                        title: book.title ?? '',
                        format: book.format ?? undefined,
                        coverKey: book.coverKey,
                        coverPaletteId: book.coverPaletteId,
                        coverPaletteKey: book.coverPaletteKey,
                      }}
                      size="sm"
                      coverSrc={
                        !book.ref && book.coverKey
                          ? `/api/v1/archive/books/${encodeURIComponent(book.id)}/cover?v=${encodeURIComponent(book.coverKey)}`
                          : book.coverUrl ?? undefined
                      }
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-sm font-semibold tracking-tight text-stone-900 transition-colors group-hover:text-stone-950 dark:text-stone-100 dark:group-hover:text-stone-50">
                      {book.title ?? _('review.sourceGoneTitle')}
                    </h4>
                    <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                      {book.author || _('common.unknownAuthor')}
                    </p>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                      {metrics.map((item, i) => (
                        <span key={i} className="flex items-center gap-1.5">
                          {i > 0 && <span className="text-stone-300 dark:text-stone-600">·</span>}
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="shrink-0 pl-2 text-stone-300 transition-transform group-hover:translate-x-0.5 group-hover:text-stone-500 dark:text-stone-600 dark:group-hover:text-stone-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                </div>
              </Link>
            )
          })}

          {booksQuery.hasNextPage && (
            <div className="pt-3 text-center">
              <button
                type="button"
                onClick={() => void booksQuery.fetchNextPage()}
                disabled={booksQuery.isFetchingNextPage}
                className={cn(
                  'text-xs font-medium text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200 cursor-pointer',
                  booksQuery.isFetchingNextPage && 'opacity-60 cursor-not-allowed',
                )}
              >
                {booksQuery.isFetchingNextPage ? '…' : _('periodBooks.loadMore') || '查看更多'}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
