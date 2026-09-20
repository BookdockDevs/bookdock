import crypto from 'node:crypto'

import type { AccessTokenDuration } from '@bookdock/shared'

/**
 * Access token primitives (ADR-24).
 *
 * The plaintext is only ever produced here and is returned to the caller once;
 * only its sha256 hash and last four characters reach the database. The `bd_`
 * prefix carries no meaning beyond "this is a credential" — the guard
 * dispatches on it, and `bd_src_` keeps its own branch.
 */
const TOKEN_PREFIX = 'bd_'
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

export function generateAccessToken(): string {
  return `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
}

export function hashAccessToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

/** Four characters cannot be reversed into the token, but they tell two tokens apart in the list. */
export function accessTokenLast4(token: string): string {
  return token.slice(-4)
}

/** Expiry counted from `from`: creation on create, the moment of the edit on PATCH. */
export function accessTokenExpiresAt(duration: AccessTokenDuration, from: number): number | null {
  if (duration === '90d') return from + NINETY_DAYS_MS
  if (duration === '1y') return from + ONE_YEAR_MS
  return null
}

export { TOKEN_PREFIX }
