import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './__root'
import Login from '@/features/auth/Login'

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
})
