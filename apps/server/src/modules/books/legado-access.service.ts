import crypto from 'node:crypto'

import { and, eq, isNull, or, gt } from 'drizzle-orm'

import type { LegadoAccessKeyDuration, LegadoAccessKeyInfo } from '@bookdock/shared'

import { config } from '../../config'
import { getDb } from '../../db/client'
import { legadoAccessKeys } from '../../db/schema'
import { createId } from '../../lib/id'

const ACCESS_KEY_PREFIX = 'bd_src_'
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000

function hashAccessKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function encryptionKey() {
  return crypto.createHash('sha256').update(config.jwtSecret).digest()
}

function encryptToken(token: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
}

function decryptToken(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const [ivEncoded, tagEncoded, ciphertextEncoded] = value.split('.')
    if (!ivEncoded || !tagEncoded || !ciphertextEncoded) return null
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivEncoded, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'))
    const plain = Buffer.concat([
      decipher.update(Buffer.from(ciphertextEncoded, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
    return plain
  } catch {
    return null
  }
}

function expiresAtFor(duration: LegadoAccessKeyDuration, createdAt: number): number | null {
  if (duration === '90d') return createdAt + NINETY_DAYS_MS
  if (duration === '1y') return createdAt + ONE_YEAR_MS
  return null
}

export interface LegadoAccessKeyRecord {
  id: string
  userId: string
  createdAt: number
  expiresAt: number | null
}

export function getLegadoAccessKeyInfo(userId: string): LegadoAccessKeyInfo {
  const row = getDb()
    .select({ createdAt: legadoAccessKeys.createdAt, expiresAt: legadoAccessKeys.expiresAt, revokedAt: legadoAccessKeys.revokedAt })
    .from(legadoAccessKeys)
    .where(eq(legadoAccessKeys.userId, userId))
    .get()
  if (!row || row.revokedAt !== null || (row.expiresAt !== null && row.expiresAt <= Date.now())) {
    return { active: false, createdAt: row?.createdAt ?? null, expiresAt: row?.expiresAt ?? null }
  }
  return { active: true, createdAt: row.createdAt, expiresAt: row.expiresAt }
}

export function issueLegadoAccessKey(userId: string, duration: LegadoAccessKeyDuration = 'permanent') {
  const db = getDb()
  const createdAt = Date.now()
  const expiresAt = expiresAtFor(duration, createdAt)
  const token = `${ACCESS_KEY_PREFIX}${crypto.randomBytes(32).toString('base64url')}`
  const tokenHash = hashAccessKey(token)
  const encryptedToken = encryptToken(token)
  const existing = db
    .select({ id: legadoAccessKeys.id })
    .from(legadoAccessKeys)
    .where(eq(legadoAccessKeys.userId, userId))
    .get()

  if (existing) {
    db.update(legadoAccessKeys)
      .set({ tokenHash, encryptedToken, createdAt, expiresAt, revokedAt: null })
      .where(eq(legadoAccessKeys.id, existing.id))
      .run()
    return { id: existing.id, token, createdAt, expiresAt }
  }

  const id = createId('legado-key')
  db.insert(legadoAccessKeys).values({ id, userId, tokenHash, encryptedToken, createdAt, expiresAt, revokedAt: null }).run()
  return { id, token, createdAt, expiresAt }
}

export function getOrCreateLegadoAccessKey(userId: string) {
  const row = getDb()
    .select({
      id: legadoAccessKeys.id,
      encryptedToken: legadoAccessKeys.encryptedToken,
      createdAt: legadoAccessKeys.createdAt,
      expiresAt: legadoAccessKeys.expiresAt,
      revokedAt: legadoAccessKeys.revokedAt,
    })
    .from(legadoAccessKeys)
    .where(eq(legadoAccessKeys.userId, userId))
    .get()

  if (row && row.revokedAt === null && (row.expiresAt === null || row.expiresAt > Date.now())) {
    const token = decryptToken(row.encryptedToken)
    if (token) {
      return { id: row.id, token, createdAt: row.createdAt, expiresAt: row.expiresAt }
    }
  }

  return issueLegadoAccessKey(userId, 'permanent')
}

export function rotateLegadoAccessKey(userId: string, duration: LegadoAccessKeyDuration = 'permanent') {
  return issueLegadoAccessKey(userId, duration)
}

export function resolveLegadoAccessKey(token: string): LegadoAccessKeyRecord | null {
  if (!token.startsWith(ACCESS_KEY_PREFIX)) return null
  const now = Date.now()
  const row = getDb()
    .select({ id: legadoAccessKeys.id, userId: legadoAccessKeys.userId, createdAt: legadoAccessKeys.createdAt, expiresAt: legadoAccessKeys.expiresAt })
    .from(legadoAccessKeys)
    .where(and(
      eq(legadoAccessKeys.tokenHash, hashAccessKey(token)),
      isNull(legadoAccessKeys.revokedAt),
      or(isNull(legadoAccessKeys.expiresAt), gt(legadoAccessKeys.expiresAt, now)),
    ))
    .get()
  return row ?? null
}

export function revokeLegadoAccessKey(userId: string): void {
  getDb()
    .update(legadoAccessKeys)
    .set({ revokedAt: Date.now() })
    .where(and(eq(legadoAccessKeys.userId, userId), isNull(legadoAccessKeys.revokedAt)))
    .run()
}

export { ACCESS_KEY_PREFIX }
