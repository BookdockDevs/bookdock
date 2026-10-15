import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'

import type { ArchiveBooksQuery, ArchiveRecordType } from '@bookdock/shared'

import QueryErrorState from '@/components/ui/QueryErrorState'
import { useReadingSummary } from '@/api/hooks/reading-records'
import { isAccessRevocationError } from '@/lib/error-message'
import { formatDuration } from '@/lib/format-duration'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import type { ArchiveSearch } from '@/routes/archive'

import { useArchiveBooksInfinite, useArchiveOverview } from '../hooks'
import ArchiveBookRow from './ArchiveBookRow'
import SortMenu from './SortMenu'

const TYPES: Array<ArchiveRecordType | 'all'> = ['all', 'highlight', 'bookmark', 'idea', 'review']

const SORTS: Array<{ value: ArchiveBooksQuery['sort']; labelKey: string }> = [
  { value: 'recent', labelKey: 'archive.sortRecent' },
  { value: 'earliest', labelKey: 'archive.sortEarliest' },
  { value: 'most', labelKey: 'archive.sortMost' },
  { value: 'fewest', labelKey: 'archive.sortFewest' },
  { value: 'title-asc', labelKey: 'archive.sortTitleAsc' },
  { value: 'title-desc', labelKey: 'archive.sortTitleDesc' },
]

export interface ArchiveSidebarParams {
  q: string
  type: ArchiveRecordType | 'all'
  sort: ArchiveBooksQuery['sort']
}

interface ArchiveSidebarProps {
  selectedBookId?: string
  params: ArchiveSidebarParams
  baseSearch: ArchiveSearch
  onChange: (patch: Partial<ArchiveSidebarParams>) => void
  onSelectOverview: () => void
  onSelectBook: (bookId: string) => void
}

export default function ArchiveSidebar({
  selectedBookId,
  params,
  baseSearch,
  onChange,
  onSelectOverview,
  onSelectBook,
}: ArchiveSidebarProps) {
  const _ = useTranslation()
  const [draft, setDraft] = useState(params.q)
  const sortOptions = SORTS.map((option) => ({ value: option.value, label: _(option.labelKey) }))

  const overview = useArchiveOverview()
  const summary = useReadingSummary()
  const loadMoreRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => setDraft(params.q), [params.q])
  useEffect(() => {
    if (draft === params.q) return
    const timer = setTimeout(() => onChange({ q: draft }), 300)
    return () => clearTimeout(timer)
  }, [draft, params.q, onChange])

  const booksQuery = useArchiveBooksInfinite({
    search: params.q || undefined,
    type: params.type === 'all' ? undefined : params.type,
    sort: params.sort,
    pageSize: 20,
  })

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = booksQuery

  // 触底自动无限加载
  useEffect(() => {
    const el = loadMoreRef.current
    if (!el || !hasNextPage || isFetchingNextPage) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage()
        }
      },
      { rootMargin: '100px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const isSummaryPending = summary.isLoading && !summary.data
  const totalTimeSeconds = summary.data?.data.totalSeconds
  const durationText = isSummaryPending
    ? '--'
    : summary.isError && totalTimeSeconds === undefined
      ? '--'
      : totalTimeSeconds !== undefined && totalTimeSeconds > 0
        ? formatDuration(totalTimeSeconds, _)
        : _('stats.durationSeconds', { s: 0 })

  const isOverviewPending = overview.isLoading && !overview.data
  const counts = overview.data?.data.counts
  const totalNotes = counts
    ? counts.highlights + counts.bookmarks + counts.ideas + counts.reviews
    : null
  const booksCount = overview.data?.data.recent.length ?? null

  const overviewCountsText = isOverviewPending || (overview.isError && (totalNotes === null || booksCount === null))
    ? '--'
    : _('archive.overviewCounts', {
        books: booksCount ?? 0,
        notes: totalNotes ?? 0,
        defaultValue: `${booksCount ?? 0} 本书 · ${totalNotes ?? 0} 条记录`,
      })

  const isOverviewActive = !selectedBookId
  const allBooks = booksQuery.data?.pages.flatMap((page) => page.data.entries) ?? []

  return (
    <aside aria-label={_('archive.allRecords')} className="flex flex-col gap-3 pb-6">
      {/* 顶部置顶核心项：【全景档案总览】 */}
      <Link
        to="/archive"
        search={{ ...baseSearch, bookId: undefined }}
        // Keep the recorded archive exit source across this in-feature move.
        state={(previous) => ({ ...previous })}
        onClick={onSelectOverview}
        className={cn(
          'group relative flex items-center justify-between rounded-xl border p-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/60',
          isOverviewActive
            ? 'border-stone-300/90 bg-stone-200/70 text-stone-950 shadow-2xs ring-1 ring-stone-900/5 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-50 dark:ring-white/5'
            : 'border-stone-200/70 bg-white text-stone-800 hover:border-stone-300 hover:bg-stone-50/80 dark:border-stone-800/70 dark:bg-stone-900/60 dark:text-stone-200 dark:hover:border-stone-700 dark:hover:bg-stone-900',
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors',
              isOverviewActive
                ? 'bg-stone-900 text-stone-50 dark:bg-stone-100 dark:text-stone-900'
                : 'bg-stone-100 text-stone-600 group-hover:bg-stone-200/80 dark:bg-stone-800 dark:text-stone-300',
            )}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect width="7" height="9" x="3" y="3" rx="1" />
              <rect width="7" height="5" x="14" y="3" rx="1" />
              <rect width="7" height="9" x="14" y="12" rx="1" />
              <rect width="7" height="5" x="3" y="16" rx="1" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold tracking-tight">
              {_('archive.allOverview', { defaultValue: '总览' })}
            </h2>
            <p className="truncate text-[11px] text-stone-500 dark:text-stone-400">
              {overviewCountsText}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums',
            isOverviewActive
              ? 'bg-stone-900/10 text-stone-900 dark:bg-white/10 dark:text-stone-100'
              : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400',
          )}
        >
          {durationText}
        </span>
      </Link>

      {/* 搜索框与排序合流 */}
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            type="search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={_('archive.searchBooks')}
            aria-label={_('archive.searchBooks')}
            className="h-9 w-full rounded-xl border border-stone-200/90 bg-white pr-3 pl-8 text-xs text-stone-900 outline-none placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700/80 dark:bg-stone-900/80 dark:text-stone-100 dark:focus:border-stone-500"
          />
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="pointer-events-none absolute top-2.5 left-2.5 text-stone-400"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <SortMenu
          value={params.sort}
          options={sortOptions}
          onChange={(sort) => onChange({ sort })}
          label={_('archive.sortBy')}
          menuWidth={130}
          triggerClassName="h-9 shrink-0 gap-1 rounded-xl border border-stone-200/90 bg-white px-2.5 text-xs text-stone-600 hover:border-stone-300 hover:text-stone-900 dark:border-stone-700/80 dark:bg-stone-900/80 dark:text-stone-300 dark:hover:text-stone-100"
        />
      </div>

      {/* 类型过滤胶囊条 */}
      <div
        role="tablist"
        aria-label={_('archive.filterByType')}
        className="grid grid-cols-5 gap-1 rounded-xl bg-stone-100/80 p-1 dark:bg-stone-800/60"
      >
        {TYPES.map((type) => {
          const active = params.type === type
          return (
            <button
              key={type}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange({ type })}
              className={cn(
                'rounded-lg py-1 text-center text-xs transition-all',
                active
                  ? 'bg-white font-medium text-stone-900 shadow-2xs dark:bg-stone-900 dark:text-stone-50'
                  : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200',
              )}
            >
              {_(`archive.type${type[0].toUpperCase()}${type.slice(1)}`)}
            </button>
          )
        })}
      </div>

      {/* 书籍列表流（无限滚动） */}
      <div className="flex flex-col gap-1">
        {booksQuery.isPending ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-500/10 motion-reduce:animate-none" />
            ))}
          </div>
        ) : booksQuery.isError && (allBooks.length === 0 || isAccessRevocationError(booksQuery.error)) ? (
          <QueryErrorState isRetrying={booksQuery.isFetching} onRetry={() => void booksQuery.refetch()} />
        ) : allBooks.length === 0 ? (
          <p className="py-8 text-center text-xs text-stone-500 dark:text-stone-400">
            {params.q || params.type !== 'all' ? _('archive.noBooks') : _('archive.noRecords')}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {booksQuery.isError && !isAccessRevocationError(booksQuery.error) && (
              <div className="mb-2 flex items-center justify-between rounded-xl border border-amber-200/80 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:border-amber-800/80 dark:bg-amber-500/20 dark:text-amber-300">
                <span>{_('archive.revalidateFailed') || '书籍刷新失败，正在显示缓存'}</span>
                <button
                  type="button"
                  onClick={() => void booksQuery.refetch()}
                  disabled={booksQuery.isFetching}
                  className="font-medium underline hover:no-underline cursor-pointer"
                >
                  {_('common.retry') || '重试'}
                </button>
              </div>
            )}
            {allBooks.map((book) => (
              <ArchiveBookRow
                key={book.bookVersionId}
                book={book}
                selected={selectedBookId === book.bookVersionId}
                onOpen={() => onSelectBook(book.bookVersionId)}
                to={{
                  to: '/archive',
                  search: {
                    ...baseSearch,
                    bookId: book.bookVersionId,
                    type: params.type,
                  },
                }}
              />
            ))}
          </div>
        )}

        {/* 无限滚动触底哨兵 */}
        <div ref={loadMoreRef} className="py-2 text-center text-xs text-stone-400">
          {isFetchingNextPage ? (
            <span className="inline-flex items-center gap-1.5 animate-pulse">
              <span className="h-1.5 w-1.5 rounded-full bg-stone-400" />
              {_('archive.loadingMoreBooks', { defaultValue: '正在加载更多书籍…' })}
            </span>
          ) : !hasNextPage && allBooks.length > 0 ? (
            <span className="text-[11px] text-stone-400/80">
              {_('archive.loadedAllBooks', { defaultValue: '已加载全部书籍' })}
            </span>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
