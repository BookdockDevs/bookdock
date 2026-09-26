import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import { SESSION_COOKIE_MAX_AGE } from './auth.service'

export const SESSION_COOKIE = 'bd_token'

function isSecureRequest(c: Context): boolean {
  try {
    return new URL(c.req.url).protocol === 'https:'
  } catch {
    return false
  }
}

/** Session tokens travel by HttpOnly cookie only, never in response bodies. */
export function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE,
    ...(isSecureRequest(c) ? { secure: true } : {}),
  })
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export function readSessionToken(c: Context): string | null {
  const authHeader = c.req.header('Authorization')
  if (authHeader?.startsWith('Bearer ') && !authHeader.startsWith('Bearer bd_')) {
    return authHeader.slice(7)
  }
  return getCookie(c, SESSION_COOKIE) ?? null
}
