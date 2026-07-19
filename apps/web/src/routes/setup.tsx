import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './__root'
import Setup from '@/features/auth/Setup'

export const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  component: Setup,
})
