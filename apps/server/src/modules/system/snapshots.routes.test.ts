import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { Hono } from 'hono'
import { rm } from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BOOKDOCK_BUILD_INFO } from '@bookdock/shared'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { config } from '../../config'
import { errorHandler } from '../../middleware/error'
import systemRoutes from './system.routes'

vi.mock('../../config', async () => {
  const os = await import('node:os')
  const nodePath = await import('node:path')
  return { config: { dataDir: nodePath.join(os.tmpdir(), `bookdock-snapshot-routes-test-${process.pid}`), jwtSecret: 'test-jwt-secret' } }
})

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations')
const CURRENT_VERSION = BOOKDOCK_BUILD_INFO.version

function createApp(role: 'owner' | 'member', guest = false) {
  const app = new Hono()
  app.onError(errorHandler)
  app.use('*', async (c, next) => {
    c.set('user', { id: 'user-1', username: 'tester', role, avatarKey: null })
    if (guest) c.set('guest', true)
    return next()
  })
  app.route('/api/v1/system', systemRoutes)
  return app
}

const owner = createApp('owner')

beforeEach(async () => {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder })
  vi.spyOn(client, 'getDb').mockReturnValue(db)
  await rm(path.join(config.dataDir, 'snapshots'), { recursive: true, force: true })
})

describe('snapshot routes', () => {
  it('creates, lists and deletes snapshots for the owner', async () => {
    const created = await owner.request('/api/v1/system/snapshots', { method: 'POST' })
    expect(created.status).toBe(201)
    const { data: snapshot } = await created.json()
    expect(snapshot).toMatchObject({ appVersion: CURRENT_VERSION, sizeBytes: expect.any(Number) })

    const listed = await owner.request('/api/v1/system/snapshots')
    expect(listed.status).toBe(200)
    expect(await listed.json()).toEqual({ data: { snapshots: [snapshot] } })

    const deleted = await owner.request(`/api/v1/system/snapshots/${snapshot.id}`, { method: 'DELETE' })
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({ data: null })
    expect((await (await owner.request('/api/v1/system/snapshots')).json()).data.snapshots).toEqual([])
  })

  it('answers 404 for an unknown snapshot id', async () => {
    const response = await owner.request('/api/v1/system/snapshots/0.3.2-9999999999999', { method: 'DELETE' })

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'SNAPSHOT_NOT_FOUND', message: 'Snapshot not found' } })
  })

  it('refuses snapshot access to members and guests', async () => {
    for (const app of [createApp('member'), createApp('owner', true)]) {
      const list = await app.request('/api/v1/system/snapshots')
      const create = await app.request('/api/v1/system/snapshots', { method: 'POST' })

      expect(list.status).toBe(403)
      expect(create.status).toBe(403)
      expect(await list.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'Owner only' } })
    }
  })
})
