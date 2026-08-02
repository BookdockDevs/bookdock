import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './__root'
import Stats from '@/features/stats/Stats'

export const statsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stats',
  component: Stats,
})
