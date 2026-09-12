import { createRoute, lazyRouteComponent } from '@tanstack/react-router'
import { rootRoute } from './__root'

export const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: lazyRouteComponent(() => import('@/features/auth/Register')),
})
