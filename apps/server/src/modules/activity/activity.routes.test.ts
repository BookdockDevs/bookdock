import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import { errorHandler } from '../../middleware/error'
import activityRoutes from './activity.routes'

describe('activity routes', () => {
  it('requires a logged-in user', async () => {
    const app = new Hono()
    app.onError(errorHandler)
    app.route('/api/v1/activity', activityRoutes)
    const response = await app.request('/api/v1/activity?scope=personal')
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
  })
})
