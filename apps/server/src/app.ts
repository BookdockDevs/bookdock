import { Hono } from 'hono'
import { errorHandler } from './middleware/error'
import { authGuard } from './middleware/auth.guard'
import { registerParser } from './formats/registry'
import { EpubParser } from './formats/epub'
import { TxtParser } from './formats/txt'
import authRoutes from './modules/auth/auth.routes'
import booksRoutes from './modules/books/books.routes'
import progressRoutes from './modules/progress/progress.routes'
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
app.route('/api/v1/books', booksRoutes)
app.route('/api/v1/progress', progressRoutes)
app.route('/api/v1/settings', settingsRoutes)
app.route('/api/v1/annotations', annotationRoutes)
app.route('/api/v1/shelves', shelvesRoutes)
app.route('/api/v1/tags', tagsRoutes)

export default app
