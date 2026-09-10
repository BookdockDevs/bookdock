import { getConnInfo } from '@hono/node-server/conninfo'
import type { Context } from 'hono'

import { config } from '../../config'
import { AppError } from '../../middleware/error'

const LOGIN_RATE_LIMIT_WINDOW_MS = 60_000

const recentLoginFailures = new Map<string, number[]>()
let lastCleanupAt = 0

function cleanupExpiredFailures(now: number) {
  if (now - lastCleanupAt < LOGIN_RATE_LIMIT_WINDOW_MS) return
  lastCleanupAt = now
  const windowStart = now - LOGIN_RATE_LIMIT_WINDOW_MS
  for (const [key, timestamps] of recentLoginFailures) {
    if (!timestamps.some((timestamp) => timestamp > windowStart)) recentLoginFailures.delete(key)
  }
}

function getClientAddress(c: Context) {
  try {
    const address = getConnInfo(c).remote.address
    if (address) return address
  } catch {
    // Unit tests and non-Node adapters may not expose socket connection info.
  }
  return 'unknown'
}

export function createLoginRateLimitKey(c: Context, username: string) {
  return `${getClientAddress(c)}\u0000${username}`
}

export function assertLoginAllowed(key: string) {
  const now = Date.now()
  cleanupExpiredFailures(now)
  const windowStart = now - LOGIN_RATE_LIMIT_WINDOW_MS
  const recent = (recentLoginFailures.get(key) ?? []).filter((timestamp) => timestamp > windowStart)

  if (recent.length >= config.authRpm) {
    const retryAfterSeconds = Math.max(1, Math.ceil(((recent[0] ?? now) + LOGIN_RATE_LIMIT_WINDOW_MS - now) / 1000))
    recentLoginFailures.set(key, recent)
    throw new AppError('AUTH_RATE_LIMITED', `Too many login attempts; retry in ${retryAfterSeconds} seconds`, { retryAfterSeconds })
  }

  if (recent.length > 0) recentLoginFailures.set(key, recent)
  else recentLoginFailures.delete(key)
}

export function recordLoginFailure(key: string) {
  const now = Date.now()
  cleanupExpiredFailures(now)
  const windowStart = now - LOGIN_RATE_LIMIT_WINDOW_MS
  const recent = (recentLoginFailures.get(key) ?? []).filter((timestamp) => timestamp > windowStart)
  recent.push(now)
  recentLoginFailures.set(key, recent)
}

export function clearLoginFailures(key: string) {
  recentLoginFailures.delete(key)
}

export function resetLoginRateLimit() {
  recentLoginFailures.clear()
  lastCleanupAt = 0
}
