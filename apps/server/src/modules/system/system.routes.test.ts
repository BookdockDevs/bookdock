import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BOOKDOCK_BUILD_INFO } from '@bookdock/shared'

import * as client from '../../db/client'
import * as schema from '../../db/legacy-test-schema'
import { migrateTestBaseWithStorage as migrate } from '../../db/migration-stage'
import systemRoutes from './system.routes'
import { clearUpdateCheckCache } from './system.service'

vi.mock('@bookdock/shared', async (importOriginal) => {
  const shared = await importOriginal<typeof import('@bookdock/shared')>()
  return { ...shared, BOOKDOCK_BUILD_INFO: { ...shared.BOOKDOCK_BUILD_INFO, version: '0.3.0' } }
})

const CURRENT_VERSION = BOOKDOCK_BUILD_INFO.version
const AVAILABLE_VERSION = '0.4.0'
const AVAILABLE_TAG = `v${AVAILABLE_VERSION}`

function createApp(userId: string | null = 'user-1') {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('user', userId ? { id: userId, username: 'tester', role: 'member', avatarKey: null } : null)
    return next()
  })
  app.route('/api/v1/system', systemRoutes)
  return app
}

let sqlite: Database.Database

beforeEach(() => {
  sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations') })
  vi.spyOn(client, 'getDb').mockReturnValue(db)
  const now = Date.now()
  db.insert(schema.users).values({ id: 'user-1', username: 'tester', role: 'owner', createdAt: now }).run()
  db.insert(schema.instance).values({
    id: 'instance', ownerUserId: 'user-1', allowRegistration: false,
    allowGuestAccess: false, uploadMaxBytes: null, createdAt: now, updatedAt: now,
  }).run()
  clearUpdateCheckCache()
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.restoreAllMocks()
  sqlite.close()
})

describe('System routes', () => {
  it('returns build information', async () => {
    const app = createApp()

    const response = await app.request('http://test/api/v1/system/info')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: BOOKDOCK_BUILD_INFO })
  })

  it.each(['user-2', null])('rejects update checks for non-owners (%s) before contacting GitHub', async (userId) => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const response = await createApp(userId).request('/api/v1/system/update-check')

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'Owner only' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps build information available to members', async () => {
    const response = await createApp('user-2').request('/api/v1/system/info')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: BOOKDOCK_BUILD_INFO })
  })

  it('reports an available stable release', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tag_name: AVAILABLE_TAG,
      published_at: '2026-09-22T10:00:00Z',
      html_url: `https://github.com/BookdockDevs/bookdock/releases/tag/${AVAILABLE_TAG}`,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const app = createApp()

    const response = await app.request('http://test/api/v1/system/update-check')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        status: 'update-available',
        currentVersion: CURRENT_VERSION,
        latestVersion: AVAILABLE_VERSION,
        latestTag: AVAILABLE_TAG,
        publishedAt: '2026-09-22T10:00:00Z',
        releaseUrl: `https://github.com/BookdockDevs/bookdock/releases/tag/${AVAILABLE_TAG}`,
      },
    })
  })

  it('reports when the current version is up to date', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tag_name: `v${CURRENT_VERSION}`,
      published_at: '2026-09-22T10:00:00Z',
      html_url: `https://github.com/BookdockDevs/bookdock/releases/tag/v${CURRENT_VERSION}`,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const app = createApp()

    const response = await app.request('http://test/api/v1/system/update-check')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        status: 'up-to-date',
        currentVersion: CURRENT_VERSION,
        latestVersion: CURRENT_VERSION,
        latestTag: `v${CURRENT_VERSION}`,
        publishedAt: '2026-09-22T10:00:00Z',
        releaseUrl: `https://github.com/BookdockDevs/bookdock/releases/tag/v${CURRENT_VERSION}`,
      },
    })
  })

  it('fails softly when the release service is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')))
    const app = createApp()

    const response = await app.request('http://test/api/v1/system/update-check')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { status: 'unavailable', currentVersion: CURRENT_VERSION, failureReason: 'GitHub release check: request failed before an HTTP response. Check container DNS, outbound HTTPS, proxy, and certificate settings.' },
    })
  })

  it('preserves a safe network error class without exposing the failed host', async () => {
    const cause = Object.assign(new Error('lookup secret.internal failed'), { code: 'ENOTFOUND' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause })))
    const app = createApp()

    const response = await app.request('http://test/api/v1/system/update-check')

    expect(await response.json()).toEqual({
      data: { status: 'unavailable', currentVersion: CURRENT_VERSION, failureReason: 'GitHub release check: DNS lookup failed (ENOTFOUND). Check container DNS, outbound HTTPS, proxy, and certificate settings.' },
    })
  })

  it('keeps the release tag verbatim so a prerelease stays downloadable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tag_name: 'v0.4.0-beta.1',
      published_at: '2026-09-22T10:00:00Z',
      html_url: 'https://github.com/BookdockDevs/bookdock/releases/tag/v0.4.0-beta.1',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const app = createApp()

    const response = await app.request('http://test/api/v1/system/update-check')

    expect((await response.json()).data).toMatchObject({ status: 'update-available', latestVersion: '0.4.0-beta.1', latestTag: 'v0.4.0-beta.1' })
  })

  it('reports unavailable for a tag that names no release version', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tag_name: 'nightly-2026-09-22',
      html_url: 'https://github.com/BookdockDevs/bookdock/releases/tag/nightly-2026-09-22',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const app = createApp()

    const response = await app.request('http://test/api/v1/system/update-check')

    expect(await response.json()).toEqual({
      data: { status: 'unavailable', currentVersion: CURRENT_VERSION, failureReason: 'GitHub returned release metadata that Bookdock could not interpret.' },
    })
  })
})
