import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import ProfilePending from '@/features/profile/components/ProfilePending'

import { rootRoute } from './__root'

export const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  validateSearch: (search: Record<string, unknown>): { userId?: string; activity?: 'all' | 'idea' | 'review' } => ({
    userId: typeof search.userId === 'string' ? search.userId : undefined,
    activity: search.activity === 'idea' || search.activity === 'review' ? search.activity : undefined,
  }),
  component: lazyRouteComponent(() => import('@/features/profile/Profile')),
  pendingComponent: ProfilePending,
})
