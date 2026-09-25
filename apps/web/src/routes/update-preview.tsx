import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import { rootRoute } from './__root'

export const updatePreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/update-preview',
  component: lazyRouteComponent(() => import('@/features/settings/UpdatePreview')),
})
