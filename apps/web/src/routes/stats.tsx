import { createRoute, lazyRouteComponent, redirect } from '@tanstack/react-router'
import { rootRoute } from './__root'

export const statsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stats',
  beforeLoad: () => {
    throw redirect({ to: '/archive', search: { tab: 'stats' } })
  },
  component: lazyRouteComponent(() => import('@/features/archive/Archive')),
})
