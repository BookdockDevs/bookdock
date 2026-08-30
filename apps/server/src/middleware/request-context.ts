import type { MiddlewareHandler } from 'hono'

import { createId } from '../lib/id'
import { log } from '../lib/logger'

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string
    actorRole: 'public' | 'owner' | 'member' | 'guest'
  }
}

const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/
const HEALTH_PATH = '/api/v1/health'

function requestIdFrom(c: Parameters<MiddlewareHandler>[0]) {
  const supplied = c.req.header('X-Request-ID')
  return supplied && REQUEST_ID_RE.test(supplied) ? supplied : `req_${createId()}`
}

export function requestContext(): MiddlewareHandler {
  return async (c, next) => {
    const requestId = requestIdFrom(c)
    const startedAt = Date.now()
    c.set('requestId', requestId)
    c.set('actorRole', 'public')
    c.header('X-Request-ID', requestId)
    try {
      await next()
    } finally {
      const status = c.res.status
      if (!(c.req.path === HEALTH_PATH && status >= 200 && status < 400)) {
        const level = status >= 500 ? 'error' : status === 429 ? 'warn' : 'info'
        log(level, 'http.request.completed', {
          requestId,
          method: c.req.method,
          path: c.req.path,
          status,
          durationMs: Date.now() - startedAt,
          actorRole: c.get('actorRole'),
        })
      }
    }
  }
}
