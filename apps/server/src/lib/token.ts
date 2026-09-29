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

/**
 * Browser login sessions (Phase 3). Same rules as access tokens: 32 random
 * bytes, only the sha256 hash reaches the database, the plaintext travels
 * once in the login response cookie. No prefix: sessions never share a
 * transport with bd_ operation tokens (cookie vs Authorization header).
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * Library invitation codes are read aloud, retyped and shortened by hand far
 * more often than an API token, so they use Crockford base32 (I/L/O/U dropped)
 * and stay at 16 characters — 80 bits, which is ample for a credential that
 * only travels to people the owner hands it to. The invitation link carries
 * the code in its own path segment, `/library/<code>`, so the URL states what
 * it joins.
 */
export function generateLibraryInviteToken(): string {
  const bytes = crypto.randomBytes(16)
  let token = ''
  for (let i = 0; i < 16; i++) {
    token += CROCKFORD_BASE32[bytes[i]! & 31]
  }
  return token
}

export function isLibraryInviteToken(token: string): boolean {
  return /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{16}$/.test(token)
}

/** Expiry counted from `from`: creation on create, the moment of the edit on PATCH. */
export function accessTokenExpiresAt(duration: AccessTokenDuration, from: number): number | null {
  if (duration === '90d') return from + NINETY_DAYS_MS
  if (duration === '1y') return from + ONE_YEAR_MS
  return null
}

export { TOKEN_PREFIX }
