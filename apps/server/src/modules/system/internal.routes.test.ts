import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { BOOKDOCK_BUILD_INFO } from '@bookdock/shared'

const { settings } = vi.hoisted(() => ({ settings: { launcherNonce: undefined as string | undefined } }))

vi.mock('../../config', () => ({ config: settings }))

import internalRoutes from './internal.routes'

// app.ts mounts this route above the auth guard; a bare Hono here matches the
// real prefix so the nonce behaviour is what is under test.
function request(nonce?: string) {
  const app = new Hono()
  app.route('/api/v1/internal', internalRoutes)
  return app.request('http://test/api/v1/internal/version', {
    headers: nonce === undefined ? {} : { 'x-bookdock-launcher-nonce': nonce },
  })
}

describe('Internal version route', () => {
  beforeEach(() => {
    settings.launcherNonce = 'boot-nonce-value'
  })

  it('reports the running version to the launching launcher', async () => {
    const response = await request('boot-nonce-value')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { version: BOOKDOCK_BUILD_INFO.version } })
  })

  it('is invisible without the nonce header', async () => {
    expect((await request()).status).toBe(404)
  })

  it('is invisible with the wrong nonce', async () => {
    expect((await request('someone-elses-nonce')).status).toBe(404)
  })

  it('stays closed when no nonce was configured, i.e. outside the launcher', async () => {
    settings.launcherNonce = undefined

    expect((await request('any-value')).status).toBe(404)
  })
})
