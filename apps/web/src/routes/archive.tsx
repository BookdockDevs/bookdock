import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import type { ArchiveRecordType, ArchiveBooksQuery } from '@bookdock/shared'

import { rootRoute } from './__root'

export interface ArchiveSearch {
  tab?: 'records' | 'stats'
  view?: 'all' | 'book'
  bookId?: string
  /** Which records view opened the book, so back returns to where you came from. */
  from?: 'home' | 'all'
  bookType?: ArchiveRecordType | 'all'
  bookSort?: 'chapter' | 'chapter-desc' | 'time-desc' | 'time-asc' | 'recent'
  q?: string
  type?: ArchiveRecordType | 'all'
  sort?: ArchiveBooksQuery['sort']
  page?: number
}

const RECORD_TYPES: Array<ArchiveRecordType | 'all'> = ['all', 'highlight', 'bookmark', 'idea', 'review']
const BOOK_SORTS = ['chapter', 'chapter-desc', 'time-desc', 'time-asc', 'recent'] as const

export const archiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/archive',
  validateSearch: (search: Record<string, unknown>): ArchiveSearch => {
    const type = typeof search.type === 'string' && (RECORD_TYPES as string[]).includes(search.type)
      ? (search.type as ArchiveRecordType | 'all')
      : undefined
    const sortRaw = typeof search.sort === 'string' ? search.sort : undefined
    // Legacy URLs used 'records'/'title' before the six-way sort landed.
    const sort = sortRaw === 'records' ? 'most' as const
      : sortRaw === 'title' ? 'title-asc' as const
      : sortRaw === 'recent' || sortRaw === 'earliest' || sortRaw === 'most' || sortRaw === 'fewest' || sortRaw === 'title-asc' || sortRaw === 'title-desc'
        ? sortRaw
        : undefined
    const bookSort = typeof search.bookSort === 'string' && (BOOK_SORTS as readonly string[]).includes(search.bookSort)
      ? (search.bookSort as (typeof BOOK_SORTS)[number])
      : undefined
    return {
      tab: search.tab === 'stats' ? 'stats' : undefined,
      view: search.view === 'all' || search.view === 'book' ? search.view : undefined,
      bookId: typeof search.bookId === 'string' ? search.bookId : undefined,
      from: search.from === 'home' || search.from === 'all' ? search.from : undefined,
      bookType: typeof search.bookType === 'string' && (RECORD_TYPES as string[]).includes(search.bookType)
        ? (search.bookType as ArchiveRecordType | 'all')
        : undefined,
      bookSort,
      q: typeof search.q === 'string' ? search.q : undefined,
      type,
      sort,
      page: search.page != null ? Math.max(1, Number(search.page) || 1) : undefined,
    }
  },
  component: lazyRouteComponent(() => import('@/features/archive/Archive')),
})
