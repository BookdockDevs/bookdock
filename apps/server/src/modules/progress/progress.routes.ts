import { Hono } from 'hono'
import { readingProgressUpdateSchema } from '@bookdock/shared'
import { getProgress, upsertProgress } from './progress.service'
import { AppError } from '../../middleware/error'

const progressRoutes = new Hono()

progressRoutes.get('/:bookId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const expectedUserId = c.req.query('expectedUserId')
  if (expectedUserId && expectedUserId !== user.id) throw new AppError('FORBIDDEN', 'Progress belongs to another account')
  const bookId = c.req.param('bookId')
  const progress = await getProgress(user.id, bookId, c.req.query('showHidden') === '1')
  return c.json({ data: progress })
})

progressRoutes.put('/:bookId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const bookId = c.req.param('bookId')
  const body = await c.req.json()
  const parsed = readingProgressUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  if (parsed.data.expectedUserId && parsed.data.expectedUserId !== user.id) {
    throw new AppError('FORBIDDEN', 'Progress belongs to another account')
  }
  const progress = await upsertProgress(user.id, bookId, parsed.data, c.req.query('showHidden') === '1')
  return c.json({ data: progress })
})

export default progressRoutes
