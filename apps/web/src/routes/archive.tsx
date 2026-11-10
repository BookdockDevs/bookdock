import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import type { ArchiveBooksQuery } from '@bookdock/shared'
import { calendarDateSchema, readingTimezoneSchema } from '@bookdock/shared'

import type { ArchiveScopeSearch } from '@/features/archive/archive-scope'
import ArchivePending from '@/features/archive/components/ArchivePending'

import { rootRoute } from './__root'
import { parseArchiveBookSearch, type ArchiveBookSearch } from './archive-book-search'

export interface ArchiveSearch extends ArchiveScopeSearch, ArchiveBookSearch {
  view?: 'overview'
  bookId?: string
  q?: string
  type?: string
  sort?: ArchiveBooksQuery['sort']
  readStatus?: string
  tag?: string
}

export function parseArchiveSearch(search: Record<string, unknown>): ArchiveSearch {
  const type = typeof search.type === 'string' && search.type.trim()
    ? search.type.trim()
    : undefined
  const sortRaw = typeof search.sort === 'string' ? search.sort : undefined
  // Legacy URLs used 'records'/'title' before the six-way sort landed.
  const sort = sortRaw === 'records' ? 'most' as const
    : sortRaw === 'title' ? 'title-asc' as const
    : sortRaw === 'recent' || sortRaw === 'reading-time' || sortRaw === 'reading-time-asc' || sortRaw === 'earliest' || sortRaw === 'most' || sortRaw === 'fewest' || sortRaw === 'title-asc' || sortRaw === 'title-desc'
      ? sortRaw
      : undefined
  const readStatus = typeof search.readStatus === 'string' && search.readStatus.trim()
    ? search.readStatus.trim()
    : undefined
  const tag = typeof search.tag === 'string' && search.tag.trim() ? search.tag.trim() : undefined
  return {
    period: search.period === 'week' || search.period === 'month' || search.period === 'year' || search.period === 'all' ? search.period : undefined,
    anchor: calendarDateSchema.safeParse(search.anchor).success ? String(search.anchor) : undefined,
    date: calendarDateSchema.safeParse(search.date).success ? String(search.date) : undefined,
    timezone: readingTimezoneSchema.safeParse(search.timezone).success ? String(search.timezone) : undefined,
    view: search.view === 'overview' ? 'overview' : undefined,
    bookId: typeof search.bookId === 'string' ? search.bookId : undefined,
    ...parseArchiveBookSearch(search),
    q: typeof search.q === 'string' ? search.q : undefined,
    type,
    sort,
    readStatus,
    tag,
  }
}

export const archiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/archive',
  validateSearch: parseArchiveSearch,
  component: lazyRouteComponent(() => import('@/features/archive/Archive')),
  pendingComponent: ArchivePending,
})
