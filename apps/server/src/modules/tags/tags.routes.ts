import { Hono } from 'hono'

import { tagValueClearSchema, tagValueOrderSchema, tagValuePatchSchema } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { ensurePrivateLibrary } from '../libraries/library-access'
import { clearTagValue, listTagValues, reorderTagValues, updateTagValue } from '../classification/classification.service'

/**
 * The signed-in owner's private-library tag values.
 *
 * Tags have no entity to create or delete: these endpoints read the values the
 * owner's books carry and write their hidden/pinned/order preferences. The
 * generic `/libraries/:id/tags` routes serve the same values for any library
 * the caller may manage; this module only saves the client from resolving its
 * private library id first.
 */
const tagsRoutes = new Hono()

function privateLibraryId(userId: string): string {
  return ensurePrivateLibrary(getDb(), userId)
}

tagsRoutes.get('/', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  // Guests never reveal the vault, even with the query flag.
  const showHidden = c.get('guest') !== true && c.req.query('showHidden') === '1'
  const items = await listTagValues(user.id, privateLibraryId(user.id), { showHidden })
  return c.json({ data: items })
})

tagsRoutes.put('/order', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = tagValueOrderSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  await reorderTagValues(user.id, privateLibraryId(user.id), parsed.data.names)
  return c.json({ data: null })
})

tagsRoutes.patch('/', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = tagValuePatchSchema.safeParse(await c.req.json())
  if (!parsed.success || (parsed.data.renamedTo === undefined && parsed.data.pinned === undefined && parsed.data.hidden === undefined)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.success ? 'renamedTo, pinned or hidden is required' : parsed.error.flatten() } }, 400)
  }
  const items = await updateTagValue(user.id, privateLibraryId(user.id), parsed.data)
  return c.json({ data: items })
})

tagsRoutes.post('/clear', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const parsed = tagValueClearSchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const items = await clearTagValue(user.id, privateLibraryId(user.id), parsed.data.name)
  return c.json({ data: items })
})

export default tagsRoutes
