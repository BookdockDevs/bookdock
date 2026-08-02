import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './__root'
import Library from '@/features/library/Library'

export interface LibrarySearch {
  view?: 'grid' | 'list'
  q?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
  shelf?: string
  tag?: string
  format?: 'epub' | 'txt'
  status?: 'wishlist' | 'reading' | 'idle' | 'finished' | 'abandoned'
  trash?: boolean
}

const VALID_VIEWS = new Set(['grid', 'list'])
const VALID_ORDERS = new Set(['asc', 'desc'])
const VALID_FORMATS = new Set(['epub', 'txt'])
const VALID_STATUSES = new Set(['wishlist', 'reading', 'idle', 'finished', 'abandoned'])

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (input: Record<string, unknown>): LibrarySearch => ({
    view: typeof input.view === 'string' && VALID_VIEWS.has(input.view) ? (input.view as 'grid' | 'list') : undefined,
    q: typeof input.q === 'string' && input.q.length > 0 ? input.q : undefined,
    sortBy: typeof input.sortBy === 'string' && input.sortBy.length > 0 ? input.sortBy : undefined,
    sortOrder: VALID_ORDERS.has(input.sortOrder as string) ? (input.sortOrder as 'asc' | 'desc') : undefined,
    shelf: typeof input.shelf === 'string' && input.shelf.length > 0 ? input.shelf : undefined,
    tag: typeof input.tag === 'string' && input.tag.length > 0 ? input.tag : undefined,
    format: VALID_FORMATS.has(input.format as string) ? (input.format as 'epub' | 'txt') : undefined,
    status: VALID_STATUSES.has(input.status as string) ? (input.status as LibrarySearch['status']) : undefined,
    trash: input.trash === true ? true : undefined,
  }),
  component: Library,
})
