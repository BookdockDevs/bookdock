import { createRoute, lazyRouteComponent } from '@tanstack/react-router'
import { rootRoute } from './__root'

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: lazyRouteComponent(() => import('@/features/auth/Login')),
})
