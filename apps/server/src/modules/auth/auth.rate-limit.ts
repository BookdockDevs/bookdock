import { getConnInfo } from '@hono/node-server/conninfo'
import type net from 'node:net'
import type { Context } from 'hono'

import { config } from '../../config'
import { parseTrustedProxies, resolveClientIp } from '../../lib/trusted-proxy'
import { AppError } from '../../middleware/error'

const RATE_LIMIT_WINDOW_MS = 60_000

interface InviteEntry {
  id: string
  at: number
}

export interface InviteRateLimitReservation {
  key: string
  id: string
}

const recentLoginFailures = new Map<string, number[]>()
const recentInviteFailures = new Map<string, InviteEntry[]>()
let lastCleanupAt = 0
let reservationSeq = 0

let cachedProxySpec: string | null = null
let cachedProxyBlockList: net.BlockList | null = null

function getTrustedProxyBlockList(): net.BlockList | null {
  if (cachedProxySpec !== config.trustedProxies) {
    cachedProxySpec = config.trustedProxies
    cachedProxyBlockList = parseTrustedProxies(config.trustedProxies)
  }
  return cachedProxyBlockList
}

function cleanupExpiredFailures(now: number) {
  if (now - lastCleanupAt < RATE_LIMIT_WINDOW_MS) return
  lastCleanupAt = now
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  for (const [key, timestamps] of recentLoginFailures) {
    if (!timestamps.some((timestamp) => timestamp > windowStart)) recentLoginFailures.delete(key)
  }
  for (const [key, entries] of recentInviteFailures) {
    if (!entries.some((entry) => entry.at > windowStart)) recentInviteFailures.delete(key)
  }
}

function getSocketAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address
  } catch {
    // Unit tests and non-Node adapters may not expose socket connection info.
    return undefined
  }
}

function getClientAddress(c: Context): string {
  return resolveClientIp(
    getSocketAddress(c),
    c.req.header('x-forwarded-for'),
    c.req.header('x-real-ip'),
    getTrustedProxyBlockList(),
  )
}

export function createLoginRateLimitKey(c: Context, username: string) {
  return `${getClientAddress(c)}\u0000${username}`
}

export function assertLoginAllowed(key: string) {
  const now = Date.now()
  cleanupExpiredFailures(now)
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const recent = (recentLoginFailures.get(key) ?? []).filter((timestamp) => timestamp > windowStart)

  if (recent.length >= config.authRpm) {
    const retryAfterSeconds = Math.max(1, Math.ceil(((recent[0] ?? now) + RATE_LIMIT_WINDOW_MS - now) / 1000))
    recentLoginFailures.set(key, recent)
    throw new AppError('AUTH_RATE_LIMITED', `Too many login attempts; retry in ${retryAfterSeconds} seconds`, { retryAfterSeconds })
  }

  if (recent.length > 0) recentLoginFailures.set(key, recent)
  else recentLoginFailures.delete(key)
}

export function recordLoginFailure(key: string) {
  const now = Date.now()
  cleanupExpiredFailures(now)
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const recent = (recentLoginFailures.get(key) ?? []).filter((timestamp) => timestamp > windowStart)
  recent.push(now)
  recentLoginFailures.set(key, recent)
}

export function clearLoginFailures(key: string) {
  recentLoginFailures.delete(key)
}

/** Keyed solely by resolved client address so changing username or invite code cannot bypass throttling. */
export function createInviteRateLimitKey(c: Context) {
  return getClientAddress(c)
}

/**
 * Synchronously occupy one invite-attempt slot before any async work (e.g. scrypt)
 * so concurrent requests cannot race past the threshold. Call `releaseInviteAttempt`
 * if the request resolves without an invalid-invite guess.
 */
export function reserveInviteAttempt(c: Context): InviteRateLimitReservation {
  const key = createInviteRateLimitKey(c)
  const now = Date.now()
  cleanupExpiredFailures(now)
  const windowStart = now - RATE_LIMIT_WINDOW_MS
  const recent = (recentInviteFailures.get(key) ?? []).filter((entry) => entry.at > windowStart)

  if (recent.length >= config.authRpm) {
    const retryAfterSeconds = Math.max(1, Math.ceil(((recent[0]?.at ?? now) + RATE_LIMIT_WINDOW_MS - now) / 1000))
    recentInviteFailures.set(key, recent)
    throw new AppError('AUTH_RATE_LIMITED', `Too many invite attempts; retry in ${retryAfterSeconds} seconds`, { retryAfterSeconds })
  }

  const id = `${now}:${++reservationSeq}`
  recent.push({ id, at: now })
  recentInviteFailures.set(key, recent)
  return { key, id }
}

export function releaseInviteAttempt(reservation: InviteRateLimitReservation) {
  const entries = recentInviteFailures.get(reservation.key)
  if (!entries) return
  const next = entries.filter((entry) => entry.id !== reservation.id)
  if (next.length > 0) recentInviteFailures.set(reservation.key, next)
  else recentInviteFailures.delete(reservation.key)
}

export function resetLoginRateLimit() {
  recentLoginFailures.clear()
  recentInviteFailures.clear()
  lastCleanupAt = 0
}
