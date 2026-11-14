import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'

import { AppError, errorHandler } from './error'

function appThrowing(code: string) {
  const app = new Hono()
  app.onError(errorHandler)
  app.get('/boom', () => { throw new AppError(code as never, code) })
  return app
}

describe('app error status mapping', () => {
  it('answers AI selection errors with a client status instead of a server error', async () => {
    for (const [code, status] of [
      ['AI_CONNECTION_NOT_FOUND', 404],
      ['AI_MODEL_NOT_FOUND', 404],
      ['AI_MODEL_UNAVAILABLE', 409],
      ['AI_NOT_ALLOWED', 403],
      ['AI_NOT_CONFIGURED', 503],
    ] as const) {
      const response = await appThrowing(code).request('/boom')
      expect(response.status).toBe(status)
      expect(await response.json()).toMatchObject({ error: { code } })
    }
  })
})
