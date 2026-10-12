import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import ProfilePending from '@/features/profile/components/ProfilePending'

import { rootRoute } from './__root'

export const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  validateSearch: (search: Record<string, unknown>): { userId?: string } => ({
    userId: typeof search.userId === 'string' ? search.userId : undefined,
  }),
  component: lazyRouteComponent(() => import('@/features/profile/Profile')),
  pendingComponent: ProfilePending,
})
