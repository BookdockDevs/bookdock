import { createRoute, lazyRouteComponent } from '@tanstack/react-router'
import { rootRoute } from './__root'

export interface RegisterSearch {
  invite?: string
}

export const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  validateSearch: (input: Record<string, unknown>): RegisterSearch => ({
    invite: typeof input.invite === 'string' && input.invite.trim().length > 0 ? input.invite.trim() : undefined,
  }),
  component: lazyRouteComponent(() => import('@/features/auth/Register')),
})
