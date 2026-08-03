import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { errorHandler } from './middleware/error'
import { authGuard } from './middleware/auth.guard'
import { registerParser } from './formats/registry'
import { EpubParser } from './formats/epub'
import { TxtParser } from './formats/txt'
import authRoutes from './modules/auth/auth.routes'
import usersRoutes from './modules/users/users.routes'
import booksRoutes from './modules/books/books.routes'
import progressRoutes from './modules/progress/progress.routes'
import readingRecordsRoutes from './modules/reading-records/reading-records.routes'
import settingsRoutes from './modules/settings/settings.routes'
import annotationRoutes from './modules/annotations/annotations.routes'
import shelvesRoutes from './modules/shelves/shelves.routes'
import tagsRoutes from './modules/tags/tags.routes'

registerParser(new EpubParser())
registerParser(new TxtParser())

const app = new Hono()

app.onError(errorHandler)

app.get('/api/v1/health', (c) => c.json({ data: { ok: true } }))

app.use('/api/v1/*', authGuard())

app.route('/api/v1/auth', authRoutes)
app.route('/api/v1/users', usersRoutes)
app.route('/api/v1/books', booksRoutes)
app.route('/api/v1/progress', progressRoutes)
app.route('/api/v1/reading-records', readingRecordsRoutes)
app.route('/api/v1/settings', settingsRoutes)
app.route('/api/v1/annotations', annotationRoutes)
app.route('/api/v1/shelves', shelvesRoutes)
app.route('/api/v1/tags', tagsRoutes)

// Serve the built web client (apps/web/dist) in production. Skipped in dev,
// where the dist directory may not exist and Vite serves the client instead.
// Resolves to the same relative location from both src/ (tsx) and dist/ (node).
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url))
if (existsSync(webDist)) {
  app.use('/*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next()
    return serveStatic({ root: webDist })(c, next)
  })
  // SPA fallback: client-side routes (/setup, /books/:id, ...) get index.html;
  // unmatched /api/* keeps Hono's default 404.
  app.get('*', async (c, next) => {
    if (c.req.path.startsWith('/api/')) return next()
    c.header('Cache-Control', 'no-cache')
    return c.html(await readFile(new URL('../../web/dist/index.html', import.meta.url), 'utf8'))
  })
}

export default app
