import { createRoute, lazyRouteComponent } from '@tanstack/react-router'
import { rootRoute } from './__root'

export const statsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stats',
  component: lazyRouteComponent(() => import('@/features/stats/Stats')),
})
