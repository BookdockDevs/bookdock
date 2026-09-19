import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import ProfilePending from '@/features/profile/components/ProfilePending'

import { rootRoute } from './__root'

export const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: lazyRouteComponent(() => import('@/features/profile/Profile')),
  pendingComponent: ProfilePending,
})
