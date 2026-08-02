import { eq } from 'drizzle-orm'
import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { jwtVerify } from 'jose'

import { getDb } from '../db/client'
import { users } from '../db/schema'
import { config } from '../config'
import { getDefaultUser, getInstanceSettings, resetInstanceCache } from '../modules/auth/auth.service'

export interface AuthUser {
  id: string
  username: string
  role: string
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
    /** true when the request was allowed via allowGuestAccess without a token */
    guest: boolean
  }
}

const TOKEN_COOKIE = 'bd_token'

const PUBLIC_ROUTES = new Set([
  'GET /api/v1/auth/instance',
  'GET /api/v1/auth/setup-required',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/setup',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/logout',
])

const USER_CACHE_TTL = 30_000

interface CachedUser extends AuthUser {
  disabled: boolean
}

const userCache = new Map<string, { user: CachedUser; at: number }>()
let cachedDefaultUserId: string | null = null

export function invalidateUserCache(userId?: string) {
  if (userId) {
    userCache.delete(userId)
  } else {
    userCache.clear()
  }
}

/** Test helper: drop all auth-related caches (user, default user, instance settings). */
export function resetAuthCaches() {
  userCache.clear()
  cachedDefaultUserId = null
  resetInstanceCache()
}

function getFreshUser(userId: string): CachedUser | null {
  const hit = userCache.get(userId)
  if (hit && Date.now() - hit.at < USER_CACHE_TTL) {
    return hit.user
  }
  const db = getDb()
  const row = db
    .select({ id: users.id, username: users.username, role: users.role, disabled: users.disabled })
    .from(users)
    .where(eq(users.id, userId))
    .get()
  if (!row) {
    userCache.delete(userId)
    return null
  }
  const user: CachedUser = { id: row.id, username: row.username, role: row.role, disabled: row.disabled === 1 }
  userCache.set(userId, { user, at: Date.now() })
  return user
}

function extractToken(authHeader: string | undefined, cookieToken: string | undefined): string | null {
  if (cookieToken) return cookieToken
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7)
  return null
}

/**
 * Owner-only gate. Single checkpoint so a future permission/group system
 * replaces the role comparison here instead of across routes.
 */
export function requireOwner(): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get('user')
    if (!user || c.get('guest') || user.role !== 'owner') {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Owner only' } }, 403)
    }
    return next()
  }
}

export function authGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (PUBLIC_ROUTES.has(`${c.req.method} ${c.req.path}`)) {
      return next()
    }

    const token = extractToken(c.req.header('Authorization'), getCookie(c, TOKEN_COOKIE))
    if (token) {
      let userId: string
      try {
        const { payload } = await jwtVerify(token, new TextEncoder().encode(config.jwtSecret))
        userId = payload.userId as string
      } catch {
        return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401)
      }
      const user = getFreshUser(userId)
      if (!user) {
        return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401)
      }
      if (user.disabled) {
        return c.json({ error: { code: 'ACCOUNT_DISABLED', message: 'Account is disabled' } }, 403)
      }
      c.set('user', { id: user.id, username: user.username, role: user.role })
      return next()
    }

    if (getInstanceSettings().allowGuestAccess) {
      if (!cachedDefaultUserId) {
        const defaultUser = await getDefaultUser()
        cachedDefaultUserId = defaultUser.id
      }
      const user = getFreshUser(cachedDefaultUserId)
      if (user && !user.disabled) {
        c.set('user', { id: user.id, username: user.username, role: user.role })
        c.set('guest', true)
        return next()
      }
    }

    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401)
  }
}
