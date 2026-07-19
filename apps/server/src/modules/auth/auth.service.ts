import { eq } from 'drizzle-orm'
import { SignJWT } from 'jose'

import { getDb } from '../../db/client'
import { users } from '../../db/schema'
import { config } from '../../config'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import { hashPassword, verifyPassword } from '../../lib/password'

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
  const token = await new SignJWT({ userId: user.id, username: user.username, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(config.jwtSecret))
  return { token, user: { id: user.id, username: user.username, role: user.role } }
}

export async function isSetupRequired() {
  if (config.authMode === 'off') return false
  const db = getDb()
  const user = db.select().from(users).where(eq(users.username, config.defaultUsername)).get()
  if (!user) return true
  if (!user.passwordHash) return true
  return false
}

export async function setupUser(username: string, password: string) {
  if (!(await isSetupRequired())) {
    throw new AppError('FORBIDDEN', 'Setup already completed')
  }
  const db = getDb()
  const existing = db.select().from(users).where(eq(users.username, config.defaultUsername)).get()
  const hash = await hashPassword(password)
  const now = Date.now()
  if (existing) {
    db.update(users)
      .set({ username, passwordHash: hash })
      .where(eq(users.id, existing.id))
      .run()
    const updated = db.select().from(users).where(eq(users.id, existing.id)).get()
    if (!updated) throw new AppError('INTERNAL_ERROR', 'Failed to setup user')
    return { token: await issueToken(updated), user: { id: updated.id, username: updated.username, role: updated.role } }
  }
  const id = createId('user')
  db.insert(users).values({ id, username, passwordHash: hash, role: 'owner', createdAt: now }).run()
  const user = db.select().from(users).where(eq(users.id, id)).get()
  if (!user) throw new AppError('INTERNAL_ERROR', 'Failed to create user')
  return { token: await issueToken(user), user: { id: user.id, username: user.username, role: user.role } }
}

async function issueToken(user: { id: string; username: string; role: string }) {
  return new SignJWT({ userId: user.id, username: user.username, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(config.jwtSecret))
}

export async function getDefaultUser() {
  const db = getDb()
  const user = db.select().from(users).where(eq(users.username, config.defaultUsername)).get()
  if (!user) {
    const newUser = {
      id: createId('user'),
      username: config.defaultUsername,
      passwordHash: null,
      role: 'owner' as const,
      createdAt: Date.now(),
    }
    db.insert(users).values(newUser).run()
    return newUser
  }
  return user
}

export async function bootstrapAuth() {
  const db = getDb()
  if (config.authMode === 'off') {
    return getDefaultUser()
  }

  const user = db.select().from(users).where(eq(users.username, config.defaultUsername)).get()
  if (user) return user

  db.insert(users).values({
    id: createId('user'),
    username: config.defaultUsername,
    passwordHash: null,
    role: 'owner',
    createdAt: Date.now(),
  }).run()

  console.log(`[auth] default user created: ${config.defaultUsername}. Please complete setup via UI.`)
}
