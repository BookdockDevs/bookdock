import { Hono } from 'hono'

import { archiveBooksQuerySchema } from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { getBookDetail, getOverview, listBooks } from './archive.service'

const archiveRoutes = new Hono()

archiveRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return next()
})

archiveRoutes.get('/overview', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: await getOverview(user.id) })
})

archiveRoutes.get('/books', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = archiveBooksQuerySchema.safeParse(c.req.query())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: await listBooks(user.id, parsed.data) })
})

archiveRoutes.get('/books/:bookVersionId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  return c.json({ data: await getBookDetail(user.id, c.req.param('bookVersionId')) })
})

export default archiveRoutes
