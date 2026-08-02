import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './__root'
import Register from '@/features/auth/Register'

export const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: Register,
})
