import { Hono } from 'hono'

import { transformCreateSchema, transformOverrideSchema, transformUpdateSchema } from '@bookdock/shared'

import { createTransform, deleteTransform, listTransforms, setTransformOverride, updateTransform } from './transforms.service'

const transformRoutes = new Hono()

transformRoutes.get('/', async (c) => {
  const user = c.get('user')
  const bookId = c.req.query('bookId')
  const items = await listTransforms(user.id, bookId)
  return c.json({ data: items })
})

transformRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const parsed = transformCreateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const transform = await createTransform(user.id, parsed.data)
  return c.json({ data: transform }, 201)
})

transformRoutes.put('/:transformId', async (c) => {
  const user = c.get('user')
  const transformId = c.req.param('transformId')
  const body = await c.req.json()
  const parsed = transformUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const transform = await updateTransform(user.id, transformId, parsed.data)
  return c.json({ data: transform })
})

transformRoutes.put('/:transformId/override', async (c) => {
  const user = c.get('user')
  const transformId = c.req.param('transformId')
  const body = await c.req.json()
  const parsed = transformOverrideSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const transform = await setTransformOverride(user.id, transformId, parsed.data)
  return c.json({ data: transform })
})

transformRoutes.delete('/:transformId', async (c) => {
  const user = c.get('user')
  const transformId = c.req.param('transformId')
  await deleteTransform(user.id, transformId)
  return c.json({ data: null })
})

export default transformRoutes
