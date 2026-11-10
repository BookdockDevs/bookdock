import { createRoute } from '@tanstack/react-router'

import { BookEditorDispatch } from '@/features/reading-data/BookSourceDispatch'

import { rootRoute } from './__root'

export interface ContentEditorSearch { libraryId?: string; libraryBookId?: string; versionLinkId?: string }

export const contentEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/books/$id/editor',
  validateSearch: (search: Record<string, unknown>): ContentEditorSearch => ({
    libraryId: typeof search.libraryId === 'string' ? search.libraryId : undefined,
    libraryBookId: typeof search.libraryBookId === 'string' ? search.libraryBookId : undefined,
    versionLinkId: typeof search.versionLinkId === 'string' ? search.versionLinkId : undefined,
  }),
  component: BookEditorDispatch,
})
