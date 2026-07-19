import { Hono } from 'hono'
import { readingProgressUpdateSchema } from '@bookdock/shared'
import { getProgress, upsertProgress } from './progress.service'

const progressRoutes = new Hono()

progressRoutes.get('/:bookId', async (c) => {
  const user = c.get('user')
  const bookId = c.req.param('bookId')
  const progress = await getProgress(user.id, bookId)
  return c.json({ data: progress })
})

progressRoutes.put('/:bookId', async (c) => {
  const user = c.get('user')
  const bookId = c.req.param('bookId')
  const body = await c.req.json()
  const parsed = readingProgressUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const progress = await upsertProgress(user.id, bookId, parsed.data)
  return c.json({ data: progress })
})

export default progressRoutes
