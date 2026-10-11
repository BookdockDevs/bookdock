import { Hono } from 'hono'

import { archiveQuerySchema, notificationReadSchema } from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { listNotifications, markAllNotificationsRead, markNotificationRead, notificationTarget, unreadNotificationCount } from './notifications.service'

const notificationRoutes = new Hono()

notificationRoutes.use('*', async (c, next) => {
  if (!c.get('user')) throw new AppError('UNAUTHORIZED')
  await next()
})
notificationRoutes.get('/', async (c) => {
  const query = archiveQuerySchema.safeParse(c.req.query())
  if (!query.success) throw new AppError('VALIDATION_ERROR')
  return c.json({ data: await listNotifications(c.get('user')!.id, query.data) })
})
notificationRoutes.get('/unread', async (c) => c.json({ data: await unreadNotificationCount(c.get('user')!.id) }))
notificationRoutes.put('/read-all', async (c) => {
  await markAllNotificationsRead(c.get('user')!.id)
  return c.json({ data: null })
})
notificationRoutes.get('/:id/target', async (c) => c.json({ data: await notificationTarget(c.get('user')!.id, c.req.param('id')) }))
notificationRoutes.put('/:id/read', async (c) => {
  const parsed = notificationReadSchema.safeParse(await c.req.json())
  if (!parsed.success) throw new AppError('VALIDATION_ERROR')
  markNotificationRead(c.get('user')!.id, c.req.param('id'), parsed.data.read)
  return c.json({ data: null })
})

export default notificationRoutes
