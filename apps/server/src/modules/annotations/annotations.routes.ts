import { Hono } from 'hono'
import { annotationCreateSchema, annotationUpdateSchema, archiveQuerySchema } from '@bookdock/shared'
import { AppError } from '../../middleware/error'
import { noteArchive } from './note-archive.service'
import {
  listAnnotations,
  createAnnotation,
  updateAnnotation,
  deleteAnnotation,
} from './annotations.service'

const annotationRoutes = new Hono()

annotationRoutes.get('/mine', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const query = archiveQuerySchema.safeParse(c.req.query())
  if (!query.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: await noteArchive(user.id, query.data) })
})

annotationRoutes.get('/book/:bookId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const bookId = c.req.param('bookId')
  const items = await listAnnotations(user.id, bookId)
  return c.json({ data: items })
})

annotationRoutes.post('/book/:bookId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const bookId = c.req.param('bookId')
  const body = await c.req.json()
  const parsed = annotationCreateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const annotation = await createAnnotation(user.id, bookId, parsed.data, c.req.query('showHidden') === '1')
  return c.json({ data: annotation }, 201)
})

annotationRoutes.put('/:annotationId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const annotationId = c.req.param('annotationId')
  const body = await c.req.json()
  const parsed = annotationUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const annotation = await updateAnnotation(user.id, annotationId, parsed.data)
  return c.json({ data: annotation })
})

annotationRoutes.delete('/:annotationId', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const annotationId = c.req.param('annotationId')
  await deleteAnnotation(user.id, annotationId)
  return c.json({ data: null })
})

export default annotationRoutes
