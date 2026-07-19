import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './__root'
import Library from '@/features/library/Library'

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Library,
})
