import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import type { ArchiveRecordType, ArchiveBooksQuery } from '@bookdock/shared'
import { calendarDateSchema, readingTimezoneSchema } from '@bookdock/shared'

import type { ArchiveScopeSearch } from '@/features/archive/archive-scope'

import { rootRoute } from './__root'

export interface ArchiveSearch extends ArchiveScopeSearch {
  tab?: 'records' | 'stats'
  bookId?: string
  bookView?: 'data' | 'notes'
  bookType?: ArchiveRecordType | 'all'
  bookSort?: 'chapter' | 'chapter-desc' | 'time-desc' | 'time-asc' | 'recent'
  q?: string
  type?: string
  sort?: ArchiveBooksQuery['sort']
  readStatus?: string
  tag?: string
}

const RECORD_TYPES: Array<ArchiveRecordType | 'all'> = ['all', 'highlight', 'bookmark', 'idea', 'review']
const BOOK_SORTS = ['chapter', 'chapter-desc', 'time-desc', 'time-asc', 'recent'] as const

export const archiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/archive',
  validateSearch: (search: Record<string, unknown>): ArchiveSearch => {
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
    const bookSort = typeof search.bookSort === 'string' && (BOOK_SORTS as readonly string[]).includes(search.bookSort)
      ? (search.bookSort as (typeof BOOK_SORTS)[number])
      : undefined
    return {
      period: search.period === 'week' || search.period === 'month' || search.period === 'year' || search.period === 'all' ? search.period : undefined,
      anchor: calendarDateSchema.safeParse(search.anchor).success ? String(search.anchor) : undefined,
      date: calendarDateSchema.safeParse(search.date).success ? String(search.date) : undefined,
      timezone: readingTimezoneSchema.safeParse(search.timezone).success ? String(search.timezone) : undefined,
      tab: search.tab === 'stats' ? 'stats' : undefined,
      bookId: typeof search.bookId === 'string' ? search.bookId : undefined,
      bookType: typeof search.bookType === 'string' && (RECORD_TYPES as string[]).includes(search.bookType)
        ? (search.bookType as ArchiveRecordType | 'all')
        : undefined,
      bookView: search.bookView === 'data' || search.bookView === 'notes' ? search.bookView : undefined,
      bookSort,
      q: typeof search.q === 'string' ? search.q : undefined,
      type,
      sort,
      readStatus,
      tag,
    }
  },
  component: lazyRouteComponent(() => import('@/features/archive/Archive')),
})
