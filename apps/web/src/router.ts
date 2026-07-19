import { createRouter } from '@tanstack/react-router'
import { rootRoute } from './routes/__root'
import { indexRoute } from './routes/index'
import { loginRoute } from './routes/login'
import { setupRoute } from './routes/setup'
import { readerRoute } from './routes/books.$id'
import { settingsRoute } from './routes/settings'

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  setupRoute,
  readerRoute,
  settingsRoute,
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
