import { Hono } from 'hono'

import { updateUserSchema } from '@bookdock/shared'

import { requireOwner } from '../../middleware/auth.guard'

import { listUsers, updateUser } from './users.service'

const usersRoutes = new Hono()

usersRoutes.use('*', requireOwner())

usersRoutes.get('/', (c) => {
  return c.json({ data: listUsers() })
})

usersRoutes.patch('/:id', async (c) => {
  const body = await c.req.json()
  const parsed = updateUserSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const actor = c.get('user')
  const updated = await updateUser(actor.id, c.req.param('id'), parsed.data)
  return c.json({ data: updated })
})

export default usersRoutes
