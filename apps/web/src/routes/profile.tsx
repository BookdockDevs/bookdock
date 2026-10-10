import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import ProfilePending from '@/features/profile/components/ProfilePending'

import { rootRoute } from './__root'

export const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  validateSearch: (search: Record<string, unknown>): { userId?: string; notesPage?: number; reviewsPage?: number; bookId?: string } => ({
    userId: typeof search.userId === 'string' ? search.userId : undefined,
    notesPage: Math.max(1, Number(search.notesPage) || 1),
    reviewsPage: Math.max(1, Number(search.reviewsPage) || 1),
    bookId: typeof search.bookId === 'string' ? search.bookId : undefined,
  }),
  component: lazyRouteComponent(() => import('@/features/profile/Profile')),
  pendingComponent: ProfilePending,
})
