import { eq } from 'drizzle-orm'
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'

import { requiredPermissionFor } from '@bookdock/shared'
import type { AccessTokenPermission } from '@bookdock/shared'

import { getDb } from '../db/client'
import { users } from '../db/schema'
import { getDefaultUser, getInstanceSettings, refreshSessionIfNeeded, resetInstanceCache, resolveSession, revokeSession } from '../modules/auth/auth.service'
import { resolveLegadoAccessKey } from '../modules/books/legado-access.service'
import { resolveAccessToken } from '../modules/tokens/tokens.service'
import { isLegadoAccessKeyEnabled } from '../modules/settings/settings.service'
import { SESSION_COOKIE, setSessionCookie } from '../modules/auth/session-cookie'

export interface AuthUser {
  id: string
  username: string
  role: string
  avatarKey: string | null
}

declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser
    /** true when the request was allowed via allowGuestAccess without a token */
    guest: boolean
    /** true when the request uses a scoped, read-only Legado access key */
    legadoAccessKey: boolean
    /** token string if authenticated via Legado access key */
    legadoToken?: string
    /**
     * Permissions carried by the access token authenticating this request.
     * Absent for cookie/JWT sessions and guest-injected requests, which are
     * never permission-checked.
     */
    tokenPermissions?: AccessTokenPermission[]
  }
}

const TOKEN_COOKIE = SESSION_COOKIE

const PUBLIC_ROUTES = new Set([
  'GET /api/v1/auth/instance',
  'GET /api/v1/auth/setup-required',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/setup',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/logout',
  'GET /api/v1/legado/source.json',
  'GET /api/v1/legado/login',
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
    .select({ id: users.id, username: users.username, role: users.role, disabled: users.disabled, avatarKey: users.avatarKey })
    .from(users)
    .where(eq(users.id, userId))
    .get()
  if (!row) {
    userCache.delete(userId)
    return null
  }
  const user: CachedUser = { id: row.id, username: row.username, role: row.role, disabled: row.disabled === 1, avatarKey: row.avatarKey }
  userCache.set(userId, { user, at: Date.now() })
  return user
}

function extractToken(authHeader: string | undefined, cookieToken: string | undefined): string | null {
  if (cookieToken) return cookieToken
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7)
  return null
}

function rejectGuestMutation(c: Context): Response | null {
  const user = c.get('user')
  const isGuest = c.get('guest') === true || user?.role === 'guest'
  if (isGuest && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    return c.json({ error: { code: 'FORBIDDEN', message: 'Guest sessions are read-only' } }, 403)
  }
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

    const authHeader = c.req.header('Authorization')
    const cookieToken = getCookie(c, TOKEN_COOKIE)
    const isLegadoRoute = c.req.path.startsWith('/api/v1/legado/')
    const bearerAccessKey = authHeader?.startsWith('Bearer bd_src_') ? authHeader.slice(7) : null
    const queryAccessKey = isLegadoRoute && c.req.query('key')?.startsWith('bd_src_') ? c.req.query('key') ?? null : null
    let token = bearerAccessKey ?? queryAccessKey ?? extractToken(authHeader, cookieToken)
    if (token) {
      if (isLegadoRoute && (authHeader?.startsWith('Bearer ') || token.startsWith('bd_src_'))) {
        const accessKey = resolveLegadoAccessKey(token)
        if (accessKey) {
          if (!isLegadoAccessKeyEnabled(accessKey.userId)) {
            return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or disabled Legado access key' } }, 401)
          }
          const user = getFreshUser(accessKey.userId)
          if (!user) return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired Legado access key' } }, 401)
          if (user.disabled) return c.json({ error: { code: 'ACCOUNT_DISABLED', message: 'Account is disabled' } }, 403)
          c.set('user', { id: user.id, username: user.username, role: user.role, avatarKey: user.avatarKey })
          c.set('legadoAccessKey', true)
          c.set('legadoToken', token)
          c.set('actorRole', user.role === 'owner' ? 'owner' : user.role === 'member' ? 'member' : 'guest')
          const blocked = rejectGuestMutation(c)
          if (blocked) return blocked
          return next()
        }
        if (token.startsWith('bd_src_')) {
          return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired Legado access key' } }, 401)
        }
      }
      // Operation-scoped access tokens (ADR-24). `bd_src_` was resolved above on
      // its own routes and falls through to the same 401 everywhere else, so the
      // only thing this branch adds is a second way to reach a user identity.
      if (token.startsWith('bd_')) {
        const lookup = resolveAccessToken(token)
        if (lookup.status === 'disabled') {
          return c.json({ error: { code: 'FORBIDDEN', message: 'Access token is disabled' } }, 403)
        }
        if (lookup.status === 'invalid') {
          return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired access token' } }, 401)
        }
        const access = lookup.token
        const user = getFreshUser(access.userId)
        if (!user) {
          return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired access token' } }, 401)
        }
        if (user.disabled) {
          return c.json({ error: { code: 'ACCOUNT_DISABLED', message: 'Account is disabled' } }, 403)
        }
        // Default deny: an endpoint missing from the registry is never reachable
        // with a token, which is also what keeps owner-only endpoints out of
        // reach. `null` marks the permission-free identity probe.
        const required = requiredPermissionFor(c.req.method, c.req.path)
        if (required === undefined || (required !== null && !access.permissions.includes(required))) {
          return c.json({ error: { code: 'FORBIDDEN', message: 'Access token is not allowed to perform this operation' } }, 403)
        }
        c.set('user', { id: user.id, username: user.username, role: user.role, avatarKey: user.avatarKey })
        c.set('legadoAccessKey', false)
        c.set('actorRole', user.role === 'owner' ? 'owner' : user.role === 'member' ? 'member' : 'guest')
        c.set('tokenPermissions', access.permissions)
        const blocked = rejectGuestMutation(c)
        if (blocked) return blocked
        return next()
      }
      // Server-side sessions (Phase 3): the cookie/Bearer value is a random
      // token whose sha256 hash is the database key. Old JWTs share the
      // transport but never resolve here, so they get a clean 401 and the
      // client re-authenticates under the new scheme.
      const session = resolveSession(token)
      if (!session) {
        return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401)
      }
      const user = getFreshUser(session.userId)
      if (!user) {
        revokeSession(token)
        return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } }, 401)
      }
      if (user.disabled) {
        return c.json({ error: { code: 'ACCOUNT_DISABLED', message: 'Account is disabled' } }, 403)
      }
      c.set('user', { id: user.id, username: user.username, role: user.role, avatarKey: user.avatarKey })
      c.set('legadoAccessKey', false)
      c.set('actorRole', user.role === 'owner' ? 'owner' : user.role === 'member' ? 'member' : 'guest')
      if (refreshSessionIfNeeded(session.sessionId, session.expiresAt)) {
        setSessionCookie(c, token)
      }
      const blocked = rejectGuestMutation(c)
      if (blocked) return blocked
      return next()
    }

    if (getInstanceSettings().allowGuestAccess) {
      if (!cachedDefaultUserId) {
        const defaultUser = await getDefaultUser()
        cachedDefaultUserId = defaultUser.id
      }
      const user = getFreshUser(cachedDefaultUserId)
      if (user && !user.disabled) {
        c.set('user', { id: user.id, username: user.username, role: user.role, avatarKey: user.avatarKey })
        c.set('guest', true)
        c.set('legadoAccessKey', false)
        c.set('actorRole', 'guest')
        const blocked = rejectGuestMutation(c)
        if (blocked) return blocked
        return next()
      }
    }

    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401)
  }
}
