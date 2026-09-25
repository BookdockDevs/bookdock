import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import type { UpdateStartReq } from '@bookdock/shared'

import { AppError, errorHandler } from '../../middleware/error'
import systemRoutes from './system.routes'
import { cancelUpdate, startUpdate } from './update.service'

vi.mock('./update.service', () => ({
  getUpdateStatus: vi.fn(async () => ({ phase: 'idle', currentVersion: '0.3.2' })),
  startUpdate: vi.fn(async () => ({ phase: 'snapshot', currentVersion: '0.3.2', targetVersion: '0.4.0' })),
  cancelUpdate: vi.fn(async () => ({ phase: 'cancelled', outcome: 'cancelled', currentVersion: '0.3.2' })),
}))

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
const body: UpdateStartReq = { targetVersion: '0.4.0', progressId: 'progress-1' }

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
    for (const app of [createApp('member'), createApp('owner', true)]) {
      const status = await app.request('/api/v1/system/update/status')
      const start = await app.request('/api/v1/system/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const cancel = await app.request('/api/v1/system/update/progress-1', { method: 'DELETE' })

      expect(status.status).toBe(403)
      expect(start.status).toBe(403)
      expect(cancel.status).toBe(403)
    }
  })
})
