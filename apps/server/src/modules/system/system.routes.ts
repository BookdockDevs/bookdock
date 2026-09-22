import { Hono } from 'hono'

import { BOOKDOCK_BUILD_INFO } from '@bookdock/shared'

import { checkForUpdates } from './system.service'
import snapshotsRoutes from './snapshots.routes'
import updateRoutes from './update.routes'

const systemRoutes = new Hono()

systemRoutes.get('/info', (c) => c.json({ data: BOOKDOCK_BUILD_INFO }))
systemRoutes.get('/update-check', async (c) => c.json({ data: await checkForUpdates() }))
systemRoutes.route('/snapshots', snapshotsRoutes)
systemRoutes.route('/update', updateRoutes)

export default systemRoutes
