import { and, desc, eq } from 'drizzle-orm'

import type { AccessToken, AccessTokenCreateReq, AccessTokenCreateRes, AccessTokenPermission, AccessTokenUpdateReq } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { accessTokens } from '../../db/schema'
import { createId } from '../../lib/id'
import { accessTokenExpiresAt, accessTokenLast4, generateAccessToken, hashAccessToken, TOKEN_PREFIX } from '../../lib/token'
import { AppError } from '../../middleware/error'

type AccessTokenRow = typeof accessTokens.$inferSelect

export interface ResolvedAccessToken {
  id: string
  userId: string
  permissions: AccessTokenPermission[]
}

export type AccessTokenLookup =
  | { status: 'active'; token: ResolvedAccessToken }
  /** The row exists but was switched off, so a client can report that specifically. */
  | { status: 'disabled' }
  /** Unknown hash or expired, deliberately indistinguishable from each other. */
  | { status: 'invalid' }

function toAccessToken(row: AccessTokenRow): AccessToken {
  return {
    id: row.id,
    name: row.name,
    permissions: row.permissions,
    tokenLast4: row.tokenLast4,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    disabled: row.disabledAt !== null,
  }
}

/** Ownership-scoped lookup; every token mutation goes through this so one user can never touch another's row. */
function findOwned(userId: string, id: string): AccessTokenRow {
  const row = getDb()
    .select()
    .from(accessTokens)
    .where(and(eq(accessTokens.id, id), eq(accessTokens.userId, userId)))
    .get()
  if (!row) throw new AppError('TOKEN_NOT_FOUND', 'Access token not found')
  return row
}

/**
 * Resolve a presented plaintext token. Only the hash is compared, so the
 * plaintext never has to be stored, and an unknown token is rejected before any
 * per-user work happens.
 */
export function resolveAccessToken(token: string): AccessTokenLookup {
  if (!token.startsWith(TOKEN_PREFIX)) return { status: 'invalid' }
  const row = getDb()
    .select({
      id: accessTokens.id,
      userId: accessTokens.userId,
      permissions: accessTokens.permissions,
      expiresAt: accessTokens.expiresAt,
      disabledAt: accessTokens.disabledAt,
    })
    .from(accessTokens)
    .where(eq(accessTokens.tokenHash, hashAccessToken(token)))
    .get()
  if (!row) return { status: 'invalid' }
  if (row.disabledAt !== null) return { status: 'disabled' }
  if (row.expiresAt !== null && row.expiresAt <= Date.now()) return { status: 'invalid' }
  return { status: 'active', token: { id: row.id, userId: row.userId, permissions: row.permissions } }
}

export function listAccessTokens(userId: string): AccessToken[] {
  return getDb()
    .select()
    .from(accessTokens)
    .where(eq(accessTokens.userId, userId))
    .orderBy(desc(accessTokens.createdAt))
    .all()
    .map(toAccessToken)
}

/** The plaintext is returned here and nowhere else, ever. */
export function createAccessToken(userId: string, input: AccessTokenCreateReq): AccessTokenCreateRes {
  const createdAt = Date.now()
  const plaintext = generateAccessToken()
  const expiresAt = accessTokenExpiresAt(input.expiresIn ?? '90d', createdAt)
  const token: AccessToken = {
    id: createId('token'),
    name: input.name?.trim() || '',
    permissions: input.permissions,
    tokenLast4: accessTokenLast4(plaintext),
    createdAt,
    expiresAt,
    disabled: false,
  }
  getDb()
    .insert(accessTokens)
    .values({
      id: token.id,
      userId,
      name: token.name,
      permissions: token.permissions,
      tokenHash: hashAccessToken(plaintext),
      tokenLast4: token.tokenLast4,
      createdAt,
      expiresAt,
      disabledAt: null,
    })
    .run()
  return { token, plaintext }
}

export function updateAccessToken(userId: string, id: string, patch: AccessTokenUpdateReq): AccessToken {
  findOwned(userId, id)
  const changes: Partial<typeof accessTokens.$inferInsert> = {}
  if (patch.name !== undefined) changes.name = patch.name
  if (patch.permissions !== undefined) changes.permissions = patch.permissions
  // Editing the expiry restarts it from now, never from the original creation.
  if (patch.expiresIn !== undefined) changes.expiresAt = accessTokenExpiresAt(patch.expiresIn, Date.now())
  const db = getDb()
  if (Object.keys(changes).length > 0) {
    db.update(accessTokens).set(changes).where(eq(accessTokens.id, id)).run()
  }
  return toAccessToken(findOwned(userId, id))
}

/** Disabling keeps the row so a suspected leak can be switched off and back on without re-pairing clients. */
export function setAccessTokenDisabled(userId: string, id: string, disabled: boolean): AccessToken {
  findOwned(userId, id)
  getDb()
    .update(accessTokens)
    .set({ disabledAt: disabled ? Date.now() : null })
    .where(eq(accessTokens.id, id))
    .run()
  return toAccessToken(findOwned(userId, id))
}

/** Deleting is the only terminal state — there is no revoked-but-present tombstone. */
export function deleteAccessToken(userId: string, id: string): void {
  const result = getDb()
    .delete(accessTokens)
    .where(and(eq(accessTokens.id, id), eq(accessTokens.userId, userId)))
    .run()
  if (result.changes === 0) throw new AppError('TOKEN_NOT_FOUND', 'Access token not found')
}
