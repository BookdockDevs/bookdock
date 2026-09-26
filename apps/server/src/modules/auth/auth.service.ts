import { and, eq, lt } from 'drizzle-orm'

import { normalizeUsername } from '@bookdock/shared'

import type { AccountRes, InstanceInfoRes, UpdateInstanceReq } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { instance, libraries, sessions, users } from '../../db/schema'
import { config } from '../../config'
import { AppError } from '../../middleware/error'
import { invalidateUserCache } from '../../middleware/auth.guard'
import { createId } from '../../lib/id'
import { hashPassword, verifyPassword } from '../../lib/password'
import { generateSessionToken, hashSessionToken } from '../../lib/token'

/** Single-row id of the deployment record; also used by the Phase 2 seed. */
export const INSTANCE_ID = 'instance'

/** Server-side login sessions: 30-day sliding expiry, refreshed inside 7 days of expiry. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SESSION_REFRESH_WITHIN_MS = 7 * 24 * 60 * 60 * 1000
/** Cookie lifetime mirrors the session lifetime. */
export const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60

const INSTANCE_CACHE_TTL = 5_000

export interface InstanceSettings {
  allowRegistration: boolean
  allowGuestAccess: boolean
  /** Owner-set upload cap override; undefined = follow the UPLOAD_MAX_BYTES env default */
  uploadMaxBytes?: number
}

export interface SessionIdentity {
  userId: string
  sessionId: string
  expiresAt: number
}

let instanceCache: { value: InstanceSettings; at: number } | null = null

function isUsernameUniqueConstraint(err: unknown) {
  return err instanceof Error
    && 'code' in err
    && (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
    && (err.message.includes('users.username') || err.message.includes('users.username_normalized'))
}

// Uniqueness is enforced on the normalized form (case-insensitive, NFKC),
// not raw bytes, so `Admin`/`admin`/`Ａdmin` cannot coexist as spoofing
// handles. New rows persist usernameNormalized (backfilled for old rows in
// Phase 2); the scan below stays as the pre-insert check and the UNIQUE
// constraints as the race backstop.
function findUsernameCollision(db: ReturnType<typeof getDb>, username: string, exceptId?: string) {
  const norm = normalizeUsername(username)
  return db
    .select({ id: users.id, username: users.username })
    .from(users)
    .all()
    .find((r) => r.id !== exceptId && normalizeUsername(r.username) === norm)
}

export function resetInstanceCache() {
  instanceCache = null
}

export function getInstanceSettings(): InstanceSettings {
  if (instanceCache && Date.now() - instanceCache.at < INSTANCE_CACHE_TTL) {
    return instanceCache.value
  }
  const db = getDb()
  const row = db.select().from(instance).where(eq(instance.id, INSTANCE_ID)).get()
  const value: InstanceSettings = {
    allowRegistration: row?.allowRegistration === true,
    allowGuestAccess: row?.allowGuestAccess === true,
    uploadMaxBytes: typeof row?.uploadMaxBytes === 'number' && row.uploadMaxBytes > 0 ? row.uploadMaxBytes : undefined,
  }
  instanceCache = { value, at: Date.now() }
  return value
}

export function effectiveUploadMaxBytes(): number {
  return getInstanceSettings().uploadMaxBytes ?? config.uploadMaxBytes
}

export function getInstanceInfo(): InstanceInfoRes {
  const db = getDb()
  const initialized = Boolean(db.select({ id: instance.id }).from(instance).where(eq(instance.id, INSTANCE_ID)).get())
  return { ...getInstanceSettings(), initialized, uploadMaxBytes: effectiveUploadMaxBytes() }
}

export function updateInstanceSettings(patch: UpdateInstanceReq): InstanceInfoRes {
  const db = getDb()
  const row = db.select({ id: instance.id }).from(instance).where(eq(instance.id, INSTANCE_ID)).get()
  if (!row) throw new AppError('FORBIDDEN', 'Instance is not initialized')
  const updates: Partial<typeof instance.$inferInsert> = { updatedAt: Date.now() }
  if (patch.allowRegistration !== undefined) updates.allowRegistration = patch.allowRegistration
  if (patch.allowGuestAccess !== undefined) updates.allowGuestAccess = patch.allowGuestAccess
  if (patch.uploadMaxBytes !== undefined) updates.uploadMaxBytes = patch.uploadMaxBytes
  db.update(instance).set(updates).where(eq(instance.id, INSTANCE_ID)).run()
  resetInstanceCache()
  return getInstanceInfo()
}

export function isSetupRequired(): boolean {
  const db = getDb()
  return !db.select({ id: instance.id }).from(instance).where(eq(instance.id, INSTANCE_ID)).get()
}

export function createSession(userId: string): { token: string; sessionId: string; expiresAt: number } {
  const db = getDb()
  const now = Date.now()
  db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, now))).run()
  const token = generateSessionToken()
  const row = {
    id: createId('session'),
    userId,
    tokenHash: hashSessionToken(token),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  }
  db.insert(sessions).values(row).run()
  return { token, sessionId: row.id, expiresAt: row.expiresAt }
}

export function resolveSession(token: string): SessionIdentity | null {
  const db = getDb()
  const row = db.select().from(sessions).where(eq(sessions.tokenHash, hashSessionToken(token))).get()
  if (!row) return null
  if (row.expiresAt <= Date.now()) {
    db.delete(sessions).where(eq(sessions.id, row.id)).run()
    return null
  }
  return { userId: row.userId, sessionId: row.id, expiresAt: row.expiresAt }
}

/** Extend sessions inside the refresh window; true means the cookie must be re-issued. */
export function refreshSessionIfNeeded(sessionId: string, expiresAt: number): boolean {
  if (expiresAt - Date.now() > SESSION_REFRESH_WITHIN_MS) return false
  getDb().update(sessions).set({ expiresAt: Date.now() + SESSION_TTL_MS }).where(eq(sessions.id, sessionId)).run()
  return true
}

export function revokeSession(token: string): void {
  getDb().delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token))).run()
}

export function revokeUserSessions(userId: string): void {
  getDb().delete(sessions).where(eq(sessions.userId, userId)).run()
  invalidateUserCache(userId)
}

function toAuthPayload(user: { id: string; username: string; role: string }) {
  return { id: user.id, username: user.username, role: user.role }
}

function createPrivateLibrary(tx: Pick<ReturnType<typeof getDb>, 'insert'>, userId: string, username: string) {
  const now = Date.now()
  tx.insert(libraries).values({
    id: createId('lib'), userId, type: 'private', name: username,
    description: '', visibility: null, createdAt: now, updatedAt: now,
  }).run()
}

export async function login(username: string, password: string) {
  const db = getDb()
  const user = db.select().from(users).where(eq(users.username, username)).get()
  if (!user || !user.passwordHash) {
    throw new AppError('UNAUTHORIZED', 'Invalid credentials')
  }
  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    throw new AppError('UNAUTHORIZED', 'Invalid credentials')
  }
  if (user.disabled === 1) {
    throw new AppError('ACCOUNT_DISABLED', 'Account is disabled')
  }
  const { token } = createSession(user.id)
  return { token, user: toAuthPayload(user) }
}

export async function register(username: string, password: string) {
  if (!getInstanceSettings().allowRegistration) {
    throw new AppError('REGISTRATION_DISABLED', 'Registration is disabled')
  }
  const db = getDb()
  if (findUsernameCollision(db, username)) {
    throw new AppError('USERNAME_TAKEN', 'Username is already taken')
  }
  const id = createId('user')
  const now = Date.now()
  const hash = await hashPassword(password)
  db.transaction((tx) => {
    try {
      tx.insert(users).values({
        id,
        username,
        usernameNormalized: normalizeUsername(username),
        passwordHash: hash,
        role: 'member',
        createdAt: now,
        updatedAt: now,
      }).run()
    } catch (err) {
      if (isUsernameUniqueConstraint(err)) throw new AppError('USERNAME_TAKEN', 'Username is already taken')
      throw err
    }
    createPrivateLibrary(tx, id, username)
  })
  const user = db.select().from(users).where(eq(users.id, id)).get()
  if (!user) throw new AppError('INTERNAL_ERROR', 'Failed to create user')
  const { token } = createSession(user.id)
  return { token, user: toAuthPayload(user) }
}

export async function changePassword(userId: string, oldPassword: string, newPassword: string) {
  const db = getDb()
  const user = db.select().from(users).where(eq(users.id, userId)).get()
  if (!user || !user.passwordHash) {
    throw new AppError('UNAUTHORIZED', 'Invalid credentials')
  }
  const valid = await verifyPassword(oldPassword, user.passwordHash)
  if (!valid) {
    throw new AppError('UNAUTHORIZED', 'Invalid credentials')
  }
  db.update(users)
    .set({ passwordHash: await hashPassword(newPassword), updatedAt: Date.now() })
    .where(eq(users.id, userId))
    .run()
  revokeUserSessions(userId)
}

export function changeUsername(userId: string, username: string): AccountRes {
  const db = getDb()
  if (findUsernameCollision(db, username, userId)) {
    throw new AppError('USERNAME_TAKEN', 'Username is already taken')
  }
  try {
    db.update(users)
      .set({ username, usernameNormalized: normalizeUsername(username), updatedAt: Date.now() })
      .where(eq(users.id, userId)).run()
  } catch (err) {
    if (isUsernameUniqueConstraint(err)) throw new AppError('USERNAME_TAKEN', 'Username is already taken')
    throw err
  }
  // The guard caches username/avatarKey for /me; drop the stale entry
  invalidateUserCache(userId)
  const row = db.select().from(users).where(eq(users.id, userId)).get()
  if (!row) throw new AppError('USER_NOT_FOUND')
  return { id: row.id, username: row.username, role: row.role, avatarKey: row.avatarKey }
}

export async function setupUser(username: string, password: string) {
  const db = getDb()
  if (!isSetupRequired()) {
    throw new AppError('FORBIDDEN', 'Setup already completed')
  }
  if (findUsernameCollision(db, username)) {
    throw new AppError('USERNAME_TAKEN', 'Username is already taken')
  }
  const hash = await hashPassword(password)
  const user = db.transaction((tx) => {
    // Recheck inside the transaction: setup state is the instance row now,
    // so concurrent setups create at most one owner, library and instance.
    if (tx.select({ id: instance.id }).from(instance).where(eq(instance.id, INSTANCE_ID)).get()) {
      throw new AppError('FORBIDDEN', 'Setup already completed')
    }
    // Never take over the guest row: the guard caches its id, and promoting
    // it would silently expose the owner's library to anonymous visitors.
    const id = createId('user')
    const now = Date.now()
    try {
      tx.insert(users).values({
        id, username, usernameNormalized: normalizeUsername(username),
        passwordHash: hash, role: 'owner', createdAt: now, updatedAt: now,
      }).run()
    } catch (err) {
      if (isUsernameUniqueConstraint(err)) throw new AppError('USERNAME_TAKEN', 'Username is already taken')
      throw err
    }
    createPrivateLibrary(tx, id, username)
    tx.insert(instance).values({
      id: INSTANCE_ID, ownerUserId: id,
      allowRegistration: false, allowGuestAccess: false, uploadMaxBytes: null,
      createdAt: now, updatedAt: now,
    }).run()
    const created = tx.select().from(users).where(eq(users.id, id)).get()
    if (!created) throw new AppError('INTERNAL_ERROR', 'Failed to create user')
    return created
  })
  const { token } = createSession(user.id)
  return { token, user: toAuthPayload(user) }
}

export async function getDefaultUser() {
  const db = getDb()
  // Identified by role, not username: legacy rows (e.g. the old 'admin'
  // default) keep working without an orphaned duplicate. The username is
  // the account's own id — the row never logs in and is hidden from user
  // management, so the name only has to be collision-proof.
  const user = db.select().from(users).where(eq(users.role, 'guest')).get()
  if (user) return user
  const id = createId('user')
  const newUser = {
    id,
    username: id,
    passwordHash: null,
    // The shared guest library account — never owner; owner-only routes
    // reject it via requireOwner, account endpoints via the guest flag.
    role: 'guest' as const,
    createdAt: Date.now(),
  }
  try {
    db.insert(users).values(newUser).run()
    return newUser
  } catch (err) {
    if (!isUsernameUniqueConstraint(err)) throw err
    const racedUser = db.select().from(users).where(eq(users.role, 'guest')).get()
    if (racedUser) return racedUser
    throw err
  }
}
