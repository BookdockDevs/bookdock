import { createRouter } from '@tanstack/react-router'
import { rootRoute } from './routes/__root'
import { indexRoute } from './routes/index'
import { loginRoute } from './routes/login'
import { profileRoute } from './routes/profile'
import { registerRoute } from './routes/register'
import { setupRoute } from './routes/setup'
import { readerRoute } from './routes/books.$id'
import { settingsRoute } from './routes/settings'
import { statsRoute } from './routes/stats'

const routeTree = rootRoute.addChildren([
  indexRoute,
  profileRoute,
  loginRoute,
  registerRoute,
  setupRoute,
  readerRoute,
  settingsRoute,
  statsRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
