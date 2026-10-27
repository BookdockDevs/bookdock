import { createRoute, lazyRouteComponent } from '@tanstack/react-router'

import ContentEditorPending from '@/features/content-editor/components/ContentEditorPending'

import { rootRoute } from './__root'

export const contentEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/books/$id/editor',
  validateSearch: (search: Record<string, unknown>): { libraryId?: string; libraryBookId?: string; versionLinkId?: string } => ({
    libraryId: typeof search.libraryId === 'string' ? search.libraryId : undefined,
    libraryBookId: typeof search.libraryBookId === 'string' ? search.libraryBookId : undefined,
    versionLinkId: typeof search.versionLinkId === 'string' ? search.versionLinkId : undefined,
  }),
  component: lazyRouteComponent(() => import('@/features/content-editor/ContentEditorPage')),
  pendingComponent: ContentEditorPending,
})
