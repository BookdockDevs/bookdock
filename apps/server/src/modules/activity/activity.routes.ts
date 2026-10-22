import { Hono } from 'hono'

import { activityQuerySchema } from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { listActivity } from './activity.service'

const activityRoutes = new Hono()

activityRoutes.get('/', async (c) => {
  const user = c.get('user')
  if (!user) throw new AppError('UNAUTHORIZED')
  const parsed = activityQuerySchema.safeParse(c.req.query())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: await listActivity(user.id, parsed.data) })
})

export default activityRoutes
