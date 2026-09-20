import type { MiddlewareHandler } from 'hono'

import { TOKEN_PREFIX } from '../lib/token'

const ALLOWED_METHODS = 'GET,POST,PATCH,DELETE,HEAD,OPTIONS'
const ALLOWED_HEADERS = 'Authorization,Content-Type,Range'
const EXPOSED_HEADERS = 'Accept-Ranges,Content-Length,Content-Range,Content-Disposition'
const MAX_AGE_SECONDS = '600'

function requestsAuthorizationHeader(c: Parameters<MiddlewareHandler>[0]): boolean {
  return (c.req.header('Access-Control-Request-Headers') ?? '')
    .toLowerCase()
    .split(',')
    .some((header) => header.trim() === 'authorization')
}

/**
 * CORS for access-token clients only (ADR-24).
 *
 * Same-origin requests carry no `Origin`, so the Web client never enters this
 * path and gains no new cross-origin surface. Requests from another origin only
 * get headers back when they actually present a `bd_` token, which is what
 * keeps response bodies unreadable without a valid credential.
 *
 * A CORS preflight can never carry `Authorization`, so gating on the token
 * alone would leave the browser unable to send the real request at all. A
 * preflight that explicitly declares `authorization` as a request header is
 * therefore answered too; it carries no credential and reveals nothing beyond
 * the header allowlist that the real request already has to satisfy.
 *
 * `Access-Control-Allow-Credentials` is deliberately absent: tokens travel in a
 * header, never in a cookie.
 */
export function tokenCors(): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header('Origin')
    if (!origin) return next()

    const isPreflight = c.req.method === 'OPTIONS' && c.req.header('Access-Control-Request-Method') !== undefined
    const tokenRequest = c.req.header('Authorization')?.startsWith(`Bearer ${TOKEN_PREFIX}`) === true
    if (!tokenRequest && !(isPreflight && requestsAuthorizationHeader(c))) return next()

    c.header('Access-Control-Allow-Origin', origin)
    c.header('Vary', 'Origin')
    c.header('Access-Control-Allow-Methods', ALLOWED_METHODS)
    c.header('Access-Control-Allow-Headers', ALLOWED_HEADERS)
    c.header('Access-Control-Expose-Headers', EXPOSED_HEADERS)
    c.header('Access-Control-Max-Age', MAX_AGE_SECONDS)

    if (isPreflight) return c.body(null, 204)
    return next()
  }
}
