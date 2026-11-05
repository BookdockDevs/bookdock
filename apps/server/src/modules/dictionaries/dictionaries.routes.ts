import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'

import {
  DICTIONARY_MAX_UPLOAD_BYTES,
  dictionaryLookupSchema,
  dictionaryOrderSchema,
  dictionaryUpdateSchema,
} from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import {
  deleteDictionary,
  dictionaryResource,
  importDictionary,
  listDictionaries,
  lookupDictionary,
  reorderDictionaries,
  updateDictionary,
} from './dictionaries.service'

const routes = new Hono()

routes.use('*', async (c, next) => {
  if (!c.get('user') || c.get('guest')) throw new AppError('UNAUTHORIZED', 'Login required')
  await next()
})

routes.get('/', (c) => c.json({ data: listDictionaries(c.get('user')!.id) }))

routes.post('/', bodyLimit({ maxSize: DICTIONARY_MAX_UPLOAD_BYTES + 64 * 1024, onError: () => { throw new AppError('UPLOAD_TOO_LARGE') } }), async (c) => {
  const body = await c.req.parseBody({ all: true })
  const files = Array.isArray(body.files) ? body.files : [body.files]
  if (files.some((file) => !(file instanceof File))) throw new AppError('DICTIONARY_INVALID', 'Dictionary files are required')
  return c.json({ data: await importDictionary(c.get('user')!.id, files as File[]) }, 201)
})

routes.put('/order', async (c) => {
  const parsed = dictionaryOrderSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: reorderDictionaries(c.get('user')!.id, parsed.data.ids) })
})

routes.patch('/:id', async (c) => {
  const user = c.get('user')!
  const parsed = dictionaryUpdateSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: updateDictionary(user.id, user.role, c.req.param('id'), parsed.data) })
})

routes.delete('/:id', async (c) => {
  const user = c.get('user')!
  await deleteDictionary(user.id, user.role, c.req.param('id'))
  return c.json({ data: null })
})

routes.get('/:id/lookup', async (c) => {
  const parsed = dictionaryLookupSchema.safeParse({ word: c.req.query('word') })
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  c.header('Cache-Control', 'private, no-store')
  return c.json({ data: await lookupDictionary(c.get('user')!.id, c.req.param('id'), parsed.data.word) })
})

routes.get('/:id/resource', async (c) => {
  const resource = await dictionaryResource(c.get('user')!.id, c.req.param('id'), c.req.query('key') ?? '')
  c.header('Content-Type', resource.type)
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Content-Security-Policy', "sandbox; default-src 'none'")
  c.header('Cache-Control', 'private, no-store')
  return new Response(new Uint8Array(resource.bytes), { headers: c.res.headers })
})

export default routes
