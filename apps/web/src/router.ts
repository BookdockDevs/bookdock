import { createRouter } from '@tanstack/react-router'
import { rootRoute } from './routes/__root'
import { indexRoute } from './routes/index'
import { libraryInviteRoute } from './routes/library.$token'
import { loginRoute } from './routes/login'
import { profileRoute } from './routes/profile'
import { notificationsRoute } from './routes/notifications'
import { registerRoute } from './routes/register'
import { setupRoute } from './routes/setup'
import { readerRoute } from './routes/books.$id'
import { settingsRoute } from './routes/settings'
import { archiveRoute } from './routes/archive'
import { updatePreviewRoute } from './routes/update-preview'
import DefaultPending from '@/components/layout/DefaultPending'

const routeTree = rootRoute.addChildren([
  indexRoute,
  libraryInviteRoute,
  profileRoute,
  notificationsRoute,
  loginRoute,
  registerRoute,
  setupRoute,
  readerRoute,
  settingsRoute,
  archiveRoute,
  ...(import.meta.env.DEV ? [updatePreviewRoute] : []),
])

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPendingMs: 0,
  defaultPendingMinMs: 0,
  defaultPendingComponent: DefaultPending,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
