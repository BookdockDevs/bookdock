import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './__root'
import Reader from '@/features/reader/Reader'

export const readerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/books/$id',
  component: Reader,
})
