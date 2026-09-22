import { Hono } from 'hono'

import { replacementCreateSchema, replacementOverrideSchema, replacementUpdateSchema } from '@bookdock/shared'

import { createReplacement, deleteReplacement, listReplacements, setReplacementOverride, updateReplacement } from './replacements.service'

const replacementRoutes = new Hono()

replacementRoutes.get('/', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') return c.json({ data: [] })
  const bookId = c.req.query('bookId')
  const items = await listReplacements(user.id, bookId)
  return c.json({ data: items })
})

replacementRoutes.post('/', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') return c.json({ error: { code: 'FORBIDDEN', message: 'Guest sessions cannot manage text replacements' } }, 403)
  const body = await c.req.json()
  const parsed = replacementCreateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const replacement = await createReplacement(user.id, parsed.data)
  return c.json({ data: replacement }, 201)
})

replacementRoutes.put('/:replacementId', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') return c.json({ error: { code: 'FORBIDDEN', message: 'Guest sessions cannot manage text replacements' } }, 403)
  const replacementId = c.req.param('replacementId')
  const body = await c.req.json()
  const parsed = replacementUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const replacement = await updateReplacement(user.id, replacementId, parsed.data)
  return c.json({ data: replacement })
})

replacementRoutes.put('/:replacementId/override', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') return c.json({ error: { code: 'FORBIDDEN', message: 'Guest sessions cannot manage text replacements' } }, 403)
  const replacementId = c.req.param('replacementId')
  const body = await c.req.json()
  const parsed = replacementOverrideSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const replacement = await setReplacementOverride(user.id, replacementId, parsed.data)
  return c.json({ data: replacement })
})

replacementRoutes.delete('/:replacementId', async (c) => {
  const user = c.get('user')
  if (c.get('guest') || user.role === 'guest') return c.json({ error: { code: 'FORBIDDEN', message: 'Guest sessions cannot manage text replacements' } }, 403)
  const replacementId = c.req.param('replacementId')
  await deleteReplacement(user.id, replacementId)
  return c.json({ data: null })
})

export default replacementRoutes
