import { createRoute, lazyRouteComponent } from '@tanstack/react-router'
import { rootRoute } from './__root'

export const readerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/books/$id',
  // Reader pulls in the whole foliate rendering stack — keep it out of the
  // library bundle
  component: lazyRouteComponent(() => import('@/features/reader/Reader')),
})
