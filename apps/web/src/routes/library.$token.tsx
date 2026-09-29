import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from './__root'

export const libraryInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library/$token',
  component: lazyRouteComponent(() => import('@/features/library/LibraryInvite')),
})
