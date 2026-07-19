import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './__root'
import Settings from '@/features/settings/Settings'

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: Settings,
})
