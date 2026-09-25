import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { BOOKDOCK_BUILD_INFO } from '@bookdock/shared'

import systemRoutes from './system.routes'
import { clearUpdateCheckCache } from './system.service'

const CURRENT_VERSION = BOOKDOCK_BUILD_INFO.version
const AVAILABLE_VERSION = '0.4.0'
const AVAILABLE_TAG = `v${AVAILABLE_VERSION}`

beforeEach(() => {
  clearUpdateCheckCache()
  vi.unstubAllGlobals()
})

describe('System routes', () => {
  it('returns build information', async () => {
    const app = new Hono()
    app.route('/api/v1/system', systemRoutes)

    const response = await app.request('http://test/api/v1/system/info')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: BOOKDOCK_BUILD_INFO })
  })

  it('reports an available stable release', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tag_name: AVAILABLE_TAG,
      published_at: '2026-09-22T10:00:00Z',
      html_url: `https://github.com/BookdockDevs/bookdock/releases/tag/${AVAILABLE_TAG}`,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const app = new Hono()
    app.route('/api/v1/system', systemRoutes)

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
    const app = new Hono()
    app.route('/api/v1/system', systemRoutes)

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
    const app = new Hono()
    app.route('/api/v1/system', systemRoutes)

    const response = await app.request('http://test/api/v1/system/update-check')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: { status: 'unavailable', currentVersion: CURRENT_VERSION, failureReason: 'GitHub release check: request failed before an HTTP response. Check container DNS, outbound HTTPS, proxy, and certificate settings.' },
    })
  })

  it('preserves a safe network error class without exposing the failed host', async () => {
    const cause = Object.assign(new Error('lookup secret.internal failed'), { code: 'ENOTFOUND' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause })))
    const app = new Hono()
    app.route('/api/v1/system', systemRoutes)

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
    const app = new Hono()
    app.route('/api/v1/system', systemRoutes)

    const response = await app.request('http://test/api/v1/system/update-check')

    expect((await response.json()).data).toMatchObject({ status: 'update-available', latestVersion: '0.4.0-beta.1', latestTag: 'v0.4.0-beta.1' })
  })

  it('reports unavailable for a tag that names no release version', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tag_name: 'nightly-2026-09-22',
      html_url: 'https://github.com/BookdockDevs/bookdock/releases/tag/nightly-2026-09-22',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
    const app = new Hono()
    app.route('/api/v1/system', systemRoutes)

    const response = await app.request('http://test/api/v1/system/update-check')

    expect(await response.json()).toEqual({
      data: { status: 'unavailable', currentVersion: CURRENT_VERSION, failureReason: 'GitHub returned release metadata that Bookdock could not interpret.' },
    })
  })
})
