import { z } from 'zod'
import { Hono } from 'hono'
import {
  tagCreateSchema,
  tagReorderSchema,
  tagUpdateSchema,
  type TagListItem,
} from '@bookdock/shared'

import {
  listTags,
  createTag,
  updateTag,
  reorderTags,
  deleteTag,
  addBooksToTag,
  removeBooksFromTag,
} from './tags.service'

const bookIdsSchema = z.object({ bookIds: z.array(z.string().min(1)) })

const tagsRoutes = new Hono()

tagsRoutes.get('/', async (c) => {
  const user = c.get('user')
  const items = await listTags(user.id)
  return c.json({ data: items } satisfies { data: TagListItem[] })
})

tagsRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const parsed = tagCreateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const tag = await createTag(user.id, parsed.data.name)
  return c.json({ data: tag }, 201)
})

// Registered before '/:id' so 'order' never matches as a tag id.
tagsRoutes.put('/order', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const parsed = tagReorderSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  await reorderTags(user.id, parsed.data.tagIds)
  return c.json({ data: null })
})

tagsRoutes.put('/:id', async (c) => {
  const user = c.get('user')
  const tagId = c.req.param('id')
  const body = await c.req.json()
  const parsed = tagUpdateSchema.safeParse(body)
  if (!parsed.success || (parsed.data.name === undefined && parsed.data.pinned === undefined)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.success ? 'name or pinned is required' : parsed.error.flatten() } }, 400)
  }
  const tag = await updateTag(user.id, tagId, parsed.data)
  return c.json({ data: tag })
})

tagsRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const tagId = c.req.param('id')
  await deleteTag(user.id, tagId)
  return c.json({ data: null })
})

tagsRoutes.post('/:id/books', async (c) => {
  const user = c.get('user')
  const tagId = c.req.param('id')
  const body = await c.req.json()
  const parsed = bookIdsSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  await addBooksToTag(user.id, tagId, parsed.data.bookIds)
  return c.json({ data: null })
})

tagsRoutes.delete('/:id/books', async (c) => {
  const user = c.get('user')
  const tagId = c.req.param('id')
  const body = await c.req.json()
  const parsed = bookIdsSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  await removeBooksFromTag(user.id, tagId, parsed.data.bookIds)
  return c.json({ data: null })
})

export default tagsRoutes
