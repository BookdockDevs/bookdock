import { z } from 'zod'
import { Hono } from 'hono'
import {
  shelfCreateSchema,
  shelfUpdateSchema,
  shelfReorderSchema,
  type ShelfListItem,
} from '@bookdock/shared'

import {
  listShelves,
  createShelf,
  updateShelf,
  deleteShelf,
  reorderShelves,
  moveBooksToShelf,
  removeBooksFromShelf,
} from './shelves.service'

const bookIdsSchema = z.object({ bookIds: z.array(z.string().min(1)) })

const shelvesRoutes = new Hono()

shelvesRoutes.get('/', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  // Guests never reveal the vault, even with the query flag.
  const showHidden = c.get('guest') !== true && c.req.query('showHidden') === '1'
  const items = await listShelves(user.id, showHidden)
  return c.json({ data: items } satisfies { data: ShelfListItem[] })
})

shelvesRoutes.post('/', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const body = await c.req.json()
  const parsed = shelfCreateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const shelf = await createShelf(user.id, parsed.data.name)
  return c.json({ data: shelf }, 201)
})

// Registered before '/:id' so 'order' never matches as a shelf id.
shelvesRoutes.put('/order', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const body = await c.req.json()
  const parsed = shelfReorderSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  await reorderShelves(user.id, parsed.data.shelfIds)
  return c.json({ data: null })
})

shelvesRoutes.put('/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const shelfId = c.req.param('id')
  const body = await c.req.json()
  const parsed = shelfUpdateSchema.safeParse(body)
  if (!parsed.success || (parsed.data.name === undefined && parsed.data.pinned === undefined && parsed.data.hidden === undefined)) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.success ? 'name, pinned or hidden is required' : parsed.error.flatten() } }, 400)
  }
  const shelf = await updateShelf(user.id, shelfId, parsed.data)
  return c.json({ data: shelf })
})

shelvesRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const shelfId = c.req.param('id')
  await deleteShelf(user.id, shelfId)
  return c.json({ data: null })
})

shelvesRoutes.post('/:id/books', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const shelfId = c.req.param('id')
  const body = await c.req.json()
  const parsed = bookIdsSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  await moveBooksToShelf(user.id, shelfId, parsed.data.bookIds)
  return c.json({ data: null })
})

shelvesRoutes.delete('/:id/books', async (c) => {
  const user = c.get('user')
  if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const shelfId = c.req.param('id')
  const body = await c.req.json()
  const parsed = bookIdsSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  await removeBooksFromShelf(user.id, shelfId, parsed.data.bookIds)
  return c.json({ data: null })
})

export default shelvesRoutes
