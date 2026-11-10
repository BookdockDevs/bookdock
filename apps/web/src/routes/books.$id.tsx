import { createRoute } from '@tanstack/react-router'

import { BookReaderDispatch } from '@/features/reading-data/BookSourceDispatch'

import { rootRoute } from './__root'

export const readerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/books/$id',
  // The dispatch resolves the id against the device vault and lazily loads
  // only the matching reader bundle, so neither stack lands in the other.
  component: BookReaderDispatch,
})
