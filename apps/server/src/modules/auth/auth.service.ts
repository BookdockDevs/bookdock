import { and, eq, isNotNull, ne } from 'drizzle-orm'
import { SignJWT } from 'jose'

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
  const existing = db.select({ id: users.id }).from(users).where(eq(users.username, username)).get()
  if (existing) {
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
  const taken = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.username, username), ne(users.id, userId)))
    .get()
  if (taken) {
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
  const hash = await hashPassword(password)
  const user = db.transaction((tx) => {
    const passwordUser = tx.select({ id: users.id }).from(users).where(isNotNull(users.passwordHash)).get()
    if (passwordUser) throw new AppError('FORBIDDEN', 'Setup already completed')

    const existing = tx.select().from(users).where(eq(users.username, config.defaultUsername)).get()
    const now = Date.now()
    if (existing) {
      try {
        tx.update(users)
          .set({ username, passwordHash: hash, updatedAt: now })
          .where(eq(users.id, existing.id))
          .run()
      } catch (err) {
        if (isUsernameUniqueConstraint(err)) throw new AppError('USERNAME_TAKEN', 'Username is already taken')
        throw err
      }
      const updated = tx.select().from(users).where(eq(users.id, existing.id)).get()
      if (!updated) throw new AppError('INTERNAL_ERROR', 'Failed to setup user')
      return updated
    }

    const id = createId('user')
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
  const user = db.select().from(users).where(eq(users.username, config.defaultUsername)).get()
  if (!user) {
    const newUser = {
      id: createId('user'),
      username: config.defaultUsername,
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
      const racedUser = db.select().from(users).where(eq(users.username, config.defaultUsername)).get()
      if (racedUser) return racedUser
      throw err
    }
  }
  return user
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
  // The default user is created lazily by the auth guard on the first guest
  // request — not here, or an unused "admin" owner shows up in user
  // management on instances that never enable guest access.
}
