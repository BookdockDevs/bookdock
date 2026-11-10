import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './__root'
import Library from '@/features/library/Library'
import { parseLibraryRouteSearch } from './library-route-search'

export type { LibrarySearch } from './library-route-search'

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: parseLibraryRouteSearch,
  component: Library,
})
