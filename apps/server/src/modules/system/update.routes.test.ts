import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrateBeforeBookRetirement as migrate } from '../../db/migration-stage'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { UpdateStartReq } from '@bookdock/shared'

import { AppError, errorHandler } from '../../middleware/error'
import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import systemRoutes from './system.routes'
import { cancelUpdate, startUpdate } from './update.service'

vi.mock('./update.service', () => ({
  getUpdateStatus: vi.fn(async () => ({ phase: 'idle', currentVersion: '0.3.2' })),
  startUpdate: vi.fn(async () => ({ phase: 'snapshot', currentVersion: '0.3.2', targetVersion: '0.4.0' })),
  cancelUpdate: vi.fn(async () => ({ phase: 'cancelled', outcome: 'cancelled', currentVersion: '0.3.2' })),
}))

function createApp(role: 'owner' | 'member', guest = false, id = 'user-1') {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('user', guest ? null : { id, username: 'tester', role, avatarKey: null })
    if (guest) c.set('guest', true)
    return next()
  })
  app.route('/api/v1/system', systemRoutes)
  return app
}

const owner = createApp('owner')
const body: UpdateStartReq = { targetVersion: '0.4.0', progressId: 'progress-1' }

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// requireOwner reads the Instance row, not the context role: the harness
// seeds a real owner instead of role-playing one.
beforeEach(() => {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  vi.spyOn(client, 'getDb').mockReturnValue(db)
  const now = Date.now()
  db.insert(schema.users).values({ id: 'user-1', username: 'tester', role: 'owner', createdAt: now }).run()
  db.insert(schema.instance).values({
    id: 'instance', ownerUserId: 'user-1', allowRegistration: false,
    allowGuestAccess: false, uploadMaxBytes: null, createdAt: now, updatedAt: now,
  }).run()
})

describe('update routes', () => {
  it('reports status without an in-flight update', async () => {
    const response = await owner.request('/api/v1/system/update/status')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { phase: 'idle', currentVersion: '0.3.2' } })
  })

  it('accepts an update request and returns the first phase', async () => {
    const response = await owner.request('/api/v1/system/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ data: { phase: 'snapshot', currentVersion: '0.3.2', targetVersion: '0.4.0' } })
    expect(startUpdate).toHaveBeenCalledWith(body)
  })

  it('accepts owner cancellation for the matching progress id', async () => {
    const response = await owner.request('/api/v1/system/update/progress-1', { method: 'DELETE' })
    expect(response.status).toBe(202)
    expect(await response.json()).toMatchObject({ data: { phase: 'cancelled', outcome: 'cancelled' } })
    expect(cancelUpdate).toHaveBeenCalledWith('progress-1')
  })

  it('rejects a malformed or traversal-shaped target before the service runs', async () => {
    for (const payload of [{}, { targetVersion: '0.4.0' }, { targetVersion: '../0.4.0', progressId: 'p' }, 'not json']) {
      const response = await owner.request('/api/v1/system/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })

      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('VALIDATION_ERROR')
    }
    expect(startUpdate).toHaveBeenCalledTimes(1)
  })

  it('maps state conflicts from the service', async () => {
    vi.mocked(startUpdate).mockRejectedValueOnce(new AppError('UPDATE_NOT_LAUNCHED', 'needs the launcher'))

    const response = await owner.request('/api/v1/system/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: { code: 'UPDATE_NOT_LAUNCHED', message: 'needs the launcher', details: undefined } })
  })

  it('refuses update access to members and guests', async () => {
    for (const app of [createApp('member', false, 'user-2'), createApp('owner', true)]) {
      const status = await app.request('/api/v1/system/update/status')
      const start = await app.request('/api/v1/system/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const cancel = await app.request('/api/v1/system/update/progress-1', { method: 'DELETE' })

      expect(status.status).toBe(403)
      expect(start.status).toBe(403)
      expect(cancel.status).toBe(403)
    }
  })
})
