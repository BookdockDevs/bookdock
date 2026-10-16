import { useEffect, useState } from 'react'

import type { ArchiveBooksQuery, ArchiveRecordType } from '@bookdock/shared'

import QueryErrorState from '@/components/ui/QueryErrorState'
import ArchivePager from '@/features/profile/components/ArchivePager'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import type { ArchiveSearch } from '@/routes/archive'

import { useArchiveBooks } from './hooks'
import ArchiveBookRow from './components/ArchiveBookRow'
import SortMenu from './components/SortMenu'

const TYPES: Array<ArchiveRecordType | 'all'> = ['all', 'highlight', 'bookmark', 'idea', 'review']

const SORTS: Array<{ value: ArchiveBooksQuery['sort']; labelKey: string }> = [
  { value: 'recent', labelKey: 'archive.sortRecent' },
  { value: 'earliest', labelKey: 'archive.sortEarliest' },
  { value: 'most', labelKey: 'archive.sortMost' },
  { value: 'fewest', labelKey: 'archive.sortFewest' },
  { value: 'title-asc', labelKey: 'archive.sortTitleAsc' },
  { value: 'title-desc', labelKey: 'archive.sortTitleDesc' },
]

export interface AllRecordsParams {
  q: string
  type: ArchiveRecordType | 'all'
  sort: ArchiveBooksQuery['sort']
  page: number
}

export default function AllRecordsView({ params, baseSearch, onChange, onOpenBook, onBack }: {
  params: AllRecordsParams
  baseSearch: ArchiveSearch
  onChange: (patch: Partial<AllRecordsParams>) => void
  onOpenBook: () => void
  onBack: () => void
}) {
  const _ = useTranslation()
  const [draft, setDraft] = useState(params.q)
  const sortOptions = SORTS.map((option) => ({ value: option.value, label: _(option.labelKey) }))
  useEffect(() => setDraft(params.q), [params.q])
  useEffect(() => {
    if (draft === params.q) return
    const timer = setTimeout(() => onChange({ q: draft, page: 1 }), 300)
    return () => clearTimeout(timer)
  }, [draft, params.q, onChange])

  const books = useArchiveBooks({
    search: params.q || undefined,
    type: params.type === 'all' ? undefined : params.type,
    sort: params.sort,
    page: params.page,
    pageSize: 20,
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={onBack}
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          aria-label={_('archive.back')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-stone-900 dark:text-stone-50">{_('archive.allRecords')}</h2>
          <p className="mt-0.5 text-sm text-stone-500 dark:text-stone-400">{_('archive.allRecordsHint')}</p>
        </div>
      </div>
      <div>
        <input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={_('archive.searchBooks')}
          aria-label={_('archive.searchBooks')}
          className="w-full rounded-full border border-stone-200 bg-white px-5 py-2.5 text-[15px] text-stone-900 outline-none placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:focus:border-stone-500"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div role="tablist" aria-label={_('archive.filterByType')} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-1 px-1">
          {TYPES.map((type) => {
            const active = params.type === type
            return (
              <button
                key={type}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChange({ type, page: 1 })}
                className={cn(
                  'whitespace-nowrap pb-1 text-[15px] transition-colors',
                  active ? 'font-semibold text-stone-900 dark:text-stone-50' : 'text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300',
                )}
              >
                {_(`archive.type${type[0].toUpperCase()}${type.slice(1)}`)}
              </button>
            )
          })}
        </div>
        <SortMenu
          value={params.sort}
          options={sortOptions}
          onChange={(sort) => onChange({ sort, page: 1 })}
          label={_('archive.sortBy')}
        />
      </div>

      {books.isPending ? (
        <div role="status" className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-stone-500/10" />)}
        </div>
      ) : books.isError ? (
        <QueryErrorState isRetrying={books.isFetching} onRetry={() => void books.refetch()} />
      ) : books.data.data.entries.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-500 dark:text-stone-400">
          {params.q || params.type !== 'all' ? _('archive.noBooks') : _('archive.noRecords')}
        </p>
      ) : (
        <div className="divide-y divide-stone-200/70 dark:divide-stone-800/70">
          {books.data.data.entries.map((book) => (
            <ArchiveBookRow key={book.bookVersionId} book={book} onOpen={onOpenBook} to={{ to: '/archive', search: { ...baseSearch, view: 'book', bookId: book.bookVersionId, from: 'all', bookType: params.type } }} />
          ))}
        </div>
      )}
      {!books.isPending && !books.isError && books.data.data.entries.length > 0 && (
        <ArchivePager page={params.page} hasMore={books.data.data.hasMore} disabled={books.isFetching} onChange={(page) => onChange({ page })} />
      )}
    </div>
  )
}
