import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import AuthPending from '@/features/auth/AuthPending'

import { rootRoute } from './__root'

export const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  pendingComponent: AuthPending,
  component: lazyRouteComponent(() => import('@/features/auth/Setup')),
})
