import { eq, isNotNull } from 'drizzle-orm'
import { SignJWT } from 'jose'

import { normalizeUsername } from '@bookdock/shared'

import type { AccountRes, InstanceInfoRes, UpdateInstanceReq } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { instanceSettings, users } from '../../db/schema'
import { config } from '../../config'
import { AppError } from '../../middleware/error'
import { invalidateUserCache } from '../../middleware/auth.guard'
import { createId } from '../../lib/id'
import { hashPassword, verifyPassword } from '../../lib/password'

const INSTANCE_CACHE_TTL = 5_000

export interface InstanceSettings {
  allowRegistration: boolean
  allowGuestAccess: boolean
  /** Owner-set upload cap override; undefined = follow the UPLOAD_MAX_BYTES env default */
  uploadMaxBytes?: number
}

let instanceCache: { value: InstanceSettings; at: number } | null = null

function isUsernameUniqueConstraint(err: unknown) {
  return err instanceof Error
    && 'code' in err
    && (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE'
    && err.message.includes('users.username')
}

// Uniqueness is enforced on the normalized form (case-insensitive, NFKC),
// not raw bytes, so `Admin`/`admin`/`Ａdmin` cannot coexist as spoofing
// handles. The users table is tiny (self-hosted), so a full scan is cheaper
// than a maintained normalization column; the byte-exact UNIQUE constraint
// stays as the race backstop.
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
  const rows = db.select().from(instanceSettings).all()
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const storedCap = Number(map.uploadMaxBytes)
  const value: InstanceSettings = {
    allowRegistration: map.allowRegistration === 'true',
    allowGuestAccess: map.allowGuestAccess === 'true',
    uploadMaxBytes: Number.isInteger(storedCap) && storedCap > 0 ? storedCap : undefined,
  }
  instanceCache = { value, at: Date.now() }
  return value
}

export function effectiveUploadMaxBytes(): number {
  return getInstanceSettings().uploadMaxBytes ?? config.uploadMaxBytes
}

export function getInstanceInfo(): InstanceInfoRes {
  return { ...getInstanceSettings(), initialized: hasPasswordUser(), uploadMaxBytes: effectiveUploadMaxBytes() }
}

export function updateInstanceSettings(patch: UpdateInstanceReq): InstanceInfoRes {
  const db = getDb()
  for (const [key, v] of Object.entries(patch)) {
    if (v === undefined) continue
    db.insert(instanceSettings)
      .values({ key, value: String(v) })
      .onConflictDoUpdate({ target: instanceSettings.key, set: { value: String(v) } })
      .run()
  }
  resetInstanceCache()
  return getInstanceInfo()
}

function hasPasswordUser(): boolean {
  const db = getDb()
  const passwordUser = db.select({ id: users.id }).from(users).where(isNotNull(users.passwordHash)).get()
  return Boolean(passwordUser)
}

export function isSetupRequired(): boolean {
  return !hasPasswordUser()
}

async function issueToken(user: { id: string; username: string; role: string }) {
  return new SignJWT({ userId: user.id, username: user.username, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(config.jwtSecret))
}

function toAuthPayload(user: { id: string; username: string; role: string }) {
  return { id: user.id, username: user.username, role: user.role }
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
  return { token: await issueToken(user), user: toAuthPayload(user) }
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
  try {
    db.insert(users).values({
      id,
      username,
      passwordHash: await hashPassword(password),
      role: 'member',
      createdAt: now,
      updatedAt: now,
    }).run()
  } catch (err) {
    if (isUsernameUniqueConstraint(err)) throw new AppError('USERNAME_TAKEN', 'Username is already taken')
    throw err
  }
  const user = db.select().from(users).where(eq(users.id, id)).get()
  if (!user) throw new AppError('INTERNAL_ERROR', 'Failed to create user')
  return { token: await issueToken(user), user: toAuthPayload(user) }
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
}

export function changeUsername(userId: string, username: string): AccountRes {
  const db = getDb()
  if (findUsernameCollision(db, username, userId)) {
    throw new AppError('USERNAME_TAKEN', 'Username is already taken')
  }
  try {
    db.update(users).set({ username, updatedAt: Date.now() }).where(eq(users.id, userId)).run()
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
  if (isSetupRequired() === false) {
    throw new AppError('FORBIDDEN', 'Setup already completed')
  }
  const db = getDb()
  if (findUsernameCollision(db, username)) {
    throw new AppError('USERNAME_TAKEN', 'Username is already taken')
  }
  const hash = await hashPassword(password)
  const user = db.transaction((tx) => {
    const passwordUser = tx.select({ id: users.id }).from(users).where(isNotNull(users.passwordHash)).get()
    if (passwordUser) throw new AppError('FORBIDDEN', 'Setup already completed')

    // Never take over the guest row: the guard caches its id, and promoting
    // it would silently expose the owner's library to anonymous visitors.
    const id = createId('user')
    const now = Date.now()
    try {
      tx.insert(users).values({ id, username, passwordHash: hash, role: 'owner', createdAt: now, updatedAt: now }).run()
    } catch (err) {
      if (isUsernameUniqueConstraint(err)) throw new AppError('USERNAME_TAKEN', 'Username is already taken')
      throw err
    }
    const created = tx.select().from(users).where(eq(users.id, id)).get()
    if (!created) throw new AppError('INTERNAL_ERROR', 'Failed to create user')
    return created
  })
  return { token: await issueToken(user), user: toAuthPayload(user) }
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

function seedInstanceSettings() {
  const db = getDb()
  const existing = db.select({ key: instanceSettings.key }).from(instanceSettings).all()
  if (existing.length > 0) return
  db.insert(instanceSettings).values([
    { key: 'allowRegistration', value: 'false' },
    // Guest access starts off; the owner can enable it after setup.
    { key: 'allowGuestAccess', value: 'false' },
  ]).run()
  resetInstanceCache()
}

export async function bootstrapAuth() {
  seedInstanceSettings()
  // The guest account is created lazily by the auth guard on the first guest
  // request — not here, or an unused account shows up on instances that
  // never enable guest access.
}
