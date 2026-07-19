import { z } from 'zod'
import { Hono } from 'hono'
import {
  shelfCreateSchema,
  shelfUpdateSchema,
  type ShelfListItem,
} from '@bookdock/shared'

import {
  listShelves,
  createShelf,
  updateShelf,
  deleteShelf,
  addBooksToShelf,
  removeBooksFromShelf,
} from './shelves.service'

const bookIdsSchema = z.object({ bookIds: z.array(z.string().min(1)) })

const shelvesRoutes = new Hono()

shelvesRoutes.get('/', async (c) => {
  const user = c.get('user')
  const items = await listShelves(user.id)
  return c.json({ data: items } satisfies { data: ShelfListItem[] })
})

shelvesRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = await c.req.json()
  const parsed = shelfCreateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const shelf = await createShelf(user.id, parsed.data.name)
  return c.json({ data: shelf }, 201)
})

shelvesRoutes.put('/:id', async (c) => {
  const user = c.get('user')
  const shelfId = c.req.param('id')
  const body = await c.req.json()
  const parsed = shelfUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const shelf = await updateShelf(user.id, shelfId, parsed.data.name)
  return c.json({ data: shelf })
})

shelvesRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const shelfId = c.req.param('id')
  await deleteShelf(user.id, shelfId)
  return c.json({ data: null })
})

shelvesRoutes.post('/:id/books', async (c) => {
  const user = c.get('user')
  const shelfId = c.req.param('id')
  const body = await c.req.json()
  const parsed = bookIdsSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  await addBooksToShelf(user.id, shelfId, parsed.data.bookIds)
  return c.json({ data: null })
})

shelvesRoutes.delete('/:id/books', async (c) => {
  const user = c.get('user')
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
