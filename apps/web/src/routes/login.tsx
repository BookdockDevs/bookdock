import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import AuthPending from '@/features/auth/AuthPending'

import { rootRoute } from './__root'

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  pendingComponent: AuthPending,
  component: lazyRouteComponent(() => import('@/features/auth/Login')),
})
