import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import type { ArchiveRecordType } from '@bookdock/shared'

import { rootRoute } from './__root'

export interface ArchiveSearch {
  tab?: 'records' | 'stats'
  view?: 'all' | 'book'
  bookId?: string
  /** Which records view opened the book, so back returns to where you came from. */
  from?: 'home' | 'all'
  bookType?: ArchiveRecordType | 'all'
  bookSort?: 'chapter' | 'recent'
  q?: string
  type?: ArchiveRecordType | 'all'
  sort?: 'recent' | 'records' | 'title'
  page?: number
}

const RECORD_TYPES: Array<ArchiveRecordType | 'all'> = ['all', 'highlight', 'bookmark', 'idea', 'review']

export const archiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/archive',
  validateSearch: (search: Record<string, unknown>): ArchiveSearch => {
    const type = typeof search.type === 'string' && (RECORD_TYPES as string[]).includes(search.type)
      ? (search.type as ArchiveRecordType | 'all')
      : undefined
    const sort = search.sort === 'records' || search.sort === 'title' ? search.sort : undefined
    return {
      tab: search.tab === 'stats' ? 'stats' : undefined,
      view: search.view === 'all' || search.view === 'book' ? search.view : undefined,
      bookId: typeof search.bookId === 'string' ? search.bookId : undefined,
      from: search.from === 'home' || search.from === 'all' ? search.from : undefined,
      bookType: typeof search.bookType === 'string' && (RECORD_TYPES as string[]).includes(search.bookType)
        ? (search.bookType as ArchiveRecordType | 'all')
        : undefined,
      bookSort: search.bookSort === 'recent' ? 'recent' : undefined,
      q: typeof search.q === 'string' ? search.q : undefined,
      type,
      sort,
      page: search.page != null ? Math.max(1, Number(search.page) || 1) : undefined,
    }
  },
  component: lazyRouteComponent(() => import('@/features/archive/Archive')),
})
