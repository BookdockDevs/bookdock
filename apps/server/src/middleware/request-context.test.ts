import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { errorHandler } from './error'
import { requestContext } from './request-context'
import { setLogLevel } from '../lib/logger'

function testApp() {
  const app = new Hono()
  app.use('*', requestContext())
  app.onError(errorHandler)
  app.get('/api/v1/health', (c) => c.json({ data: { ok: true } }))
  app.get('/api/v1/private', (c) => {
    c.set('actorRole', 'member')
    return c.json({ data: { ok: true } })
  })
  app.get('/api/v1/fail', () => {
    throw new Error('boom')
  })
  return app
}

describe('request context middleware', () => {
  afterEach(() => {
    setLogLevel('info')
    vi.restoreAllMocks()
  })

  it('accepts a safe request id, echoes it, and records the actor role', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const response = await testApp().request('/api/v1/private', {
      headers: { 'X-Request-ID': 'client:req-1' },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('X-Request-ID')).toBe('client:req-1')
    const record = JSON.parse(output.mock.calls[0][0] as string)
    expect(record).toMatchObject({
      event: 'http.request.completed',
      requestId: 'client:req-1',
      method: 'GET',
      path: '/api/v1/private',
      status: 200,
      actorRole: 'member',
    })
  })

  it('generates a request id for invalid input and stays quiet for healthy probes', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const app = testApp()

    const invalid = await app.request('/api/v1/private', {
      headers: { 'X-Request-ID': 'contains spaces' },
    })
    expect(invalid.headers.get('X-Request-ID')).toMatch(/^req_[A-Za-z0-9_-]+$/)

    output.mockClear()
    const health = await app.request('/api/v1/health')
    expect(health.status).toBe(200)
    expect(output).not.toHaveBeenCalled()
  })

  it('records unhandled failures without replacing the structured error response', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await testApp().request('/api/v1/fail')

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
    expect(stderr).toHaveBeenCalledTimes(2)
    const records = stderr.mock.calls.map(([line]) => JSON.parse(line as string))
    expect(records.map((record) => record.event)).toEqual([
      'app.unhandled_error',
      'http.request.completed',
    ])
    expect(records[1]).toMatchObject({ status: 500 })
    expect(output).not.toHaveBeenCalled()
  })
})
