import { Hono } from 'hono'

import { createUserSchema, ownershipTransferSchema, updateUserSchema } from '@bookdock/shared'

import { requireOwner } from '../../middleware/auth.guard'

import { createUser, deleteUser, listUsers, transferInstanceOwnership, updateUser } from './users.service'

const usersRoutes = new Hono()

usersRoutes.use('*', requireOwner())

usersRoutes.get('/', (c) => {
  return c.json({ data: listUsers() })
})

usersRoutes.post('/', async (c) => {
  const body = await c.req.json()
  const parsed = createUserSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const created = await createUser(parsed.data.username, parsed.data.password)
  return c.json({ data: created })
})

usersRoutes.patch('/:id', async (c) => {
  const body = await c.req.json()
  const parsed = updateUserSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const actor = c.get('user')
  if (!actor) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const updated = await updateUser(actor.id, c.req.param('id'), parsed.data)
  return c.json({ data: updated })
})

usersRoutes.delete('/:id', async (c) => {
  const actor = c.get('user')
  if (!actor) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const result = await deleteUser(actor.id, c.req.param('id'))
  return c.json({ data: result })
})

usersRoutes.post('/instance-owner', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = ownershipTransferSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: parsed.error.flatten() } }, 400)
  }
  const actor = c.get('user')
  if (!actor) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Login required' } }, 401)
  const result = await transferInstanceOwnership(actor.id, parsed.data.userId)
  return c.json({ data: result })
})

export default usersRoutes
