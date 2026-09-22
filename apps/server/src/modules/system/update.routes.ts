import { Hono } from 'hono'

import type { UpdateStatusRes } from '@bookdock/shared'
import { systemUpdateStartSchema } from '@bookdock/shared'

import { requireOwner } from '../../middleware/auth.guard'
import { getUpdateStatus, startUpdate } from './update.service'

const updateRoutes = new Hono()

updateRoutes.use('*', requireOwner())

updateRoutes.get('/status', async (c) => {
  const data: UpdateStatusRes = await getUpdateStatus()
  return c.json({ data })
})

updateRoutes.post('/', async (c) => {
  const parsed = systemUpdateStartSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'targetVersion and progressId are required' } }, 400)
  }
  return c.json({ data: await startUpdate(parsed.data) }, 202)
})

export default updateRoutes
