import { Hono } from 'hono'

import type { SnapshotListRes } from '@bookdock/shared'

import { requireOwner } from '../../middleware/auth.guard'
import { createSnapshot, deleteSnapshot, listSnapshots } from './snapshots.service'

const snapshotsRoutes = new Hono()

snapshotsRoutes.use('*', requireOwner())

snapshotsRoutes.get('/', async (c) => {
  const data: SnapshotListRes = { snapshots: await listSnapshots() }
  return c.json({ data })
})

snapshotsRoutes.post('/', async (c) => {
  return c.json({ data: await createSnapshot() }, 201)
})

snapshotsRoutes.delete('/:id', async (c) => {
  await deleteSnapshot(c.req.param('id'))
  return c.json({ data: null })
})

export default snapshotsRoutes
