import type { MiddlewareHandler } from 'hono'
import { jwtVerify } from 'jose'

import { getDb } from '../db/client'
import { config } from '../config'
import { users } from '../db/schema'
import { eq } from 'drizzle-orm'

export interface AuthUser {
  id: string
  username: string
  role: string
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
  }
}

const PUBLIC_AUTH_PATHS = ['/api/v1/auth/login', '/api/v1/auth/setup', '/api/v1/auth/setup-required']

export function authGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (PUBLIC_AUTH_PATHS.includes(c.req.path)) {
      return next()
    }

    if (config.authMode === 'off') {
      const db = getDb()
      const defaultUser = db.select().from(users).where(eq(users.username, config.defaultUsername)).get()
      if (defaultUser) {
        c.set('user', { id: defaultUser.id, username: defaultUser.username, role: defaultUser.role })
      }
      await next()
      return
    }

    const authHeader = c.req.header('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid token' } }, 401)
    }

    const token = authHeader.slice(7)
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(config.jwtSecret))
      c.set('user', {
        id: payload.userId as string,
        username: payload.username as string,
        role: payload.role as string,
      })
      await next()
    } catch {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401)
    }
  }
}
