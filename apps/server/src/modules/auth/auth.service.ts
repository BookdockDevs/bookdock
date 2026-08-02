import { eq, isNotNull } from 'drizzle-orm'
import { SignJWT } from 'jose'

import type { InstanceInfoRes, UpdateInstanceReq } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { instanceSettings, users } from '../../db/schema'
import { config } from '../../config'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import { hashPassword, verifyPassword } from '../../lib/password'

const INSTANCE_CACHE_TTL = 5_000

export interface InstanceSettings {
  allowRegistration: boolean
  allowGuestAccess: boolean
}

let instanceCache: { value: InstanceSettings; at: number } | null = null

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
  const value: InstanceSettings = {
    allowRegistration: map.allowRegistration === 'true',
    allowGuestAccess: map.allowGuestAccess === 'true',
  }
  instanceCache = { value, at: Date.now() }
  return value
}

export function getInstanceInfo(): InstanceInfoRes {
  return { initialized: hasPasswordUser(), ...getInstanceSettings() }
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
  db.insert(users).values({
    id,
    username,
    passwordHash: await hashPassword(password),
    role: 'member',
    createdAt: now,
    updatedAt: now,
  }).run()
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

export async function setupUser(username: string, password: string) {
  if (isSetupRequired() === false) {
    throw new AppError('FORBIDDEN', 'Setup already completed')
  }
  const db = getDb()
  const existing = db.select().from(users).where(eq(users.username, config.defaultUsername)).get()
  const hash = await hashPassword(password)
  const now = Date.now()
  if (existing) {
    db.update(users)
      .set({ username, passwordHash: hash, updatedAt: now })
      .where(eq(users.id, existing.id))
      .run()
    const updated = db.select().from(users).where(eq(users.id, existing.id)).get()
    if (!updated) throw new AppError('INTERNAL_ERROR', 'Failed to setup user')
    return { token: await issueToken(updated), user: toAuthPayload(updated) }
  }
  const id = createId('user')
  db.insert(users).values({ id, username, passwordHash: hash, role: 'owner', createdAt: now, updatedAt: now }).run()
  const user = db.select().from(users).where(eq(users.id, id)).get()
  if (!user) throw new AppError('INTERNAL_ERROR', 'Failed to create user')
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
    db.insert(users).values(newUser).run()
    return newUser
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
