import { Hono } from 'hono'

import { BOOKDOCK_BUILD_INFO } from '@bookdock/shared'

import { checkForUpdates } from './system.service'

const systemRoutes = new Hono()

systemRoutes.get('/info', (c) => c.json({ data: BOOKDOCK_BUILD_INFO }))
systemRoutes.get('/update-check', async (c) => c.json({ data: await checkForUpdates() }))

export default systemRoutes
