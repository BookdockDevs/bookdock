import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from './__root'

export const notificationsRoute = createRoute({
  getParentRoute: () => rootRoute, path: '/notifications',
  validateSearch: (search: Record<string, unknown>): { page?: number; id?: string } => ({
    page: Number.isInteger(Number(search.page)) && Number(search.page) > 0 && Number(search.page) <= 100000 ? Number(search.page) : 1,
    id: typeof search.id === 'string' ? search.id : undefined,
  }),
  component: lazyRouteComponent(() => import('@/features/notifications/NotificationCenter')),
})
