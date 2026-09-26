import { and, count, eq, isNull, ne } from 'drizzle-orm'

import { normalizeUsername } from '@bookdock/shared'
import type { AdminUserRes, UpdateUserReq } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { books, libraries, users } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { invalidateUserCache } from '../../middleware/auth.guard'
import { revokeUserSessions } from '../auth/auth.service'
import { createId } from '../../lib/id'
import { hashPassword } from '../../lib/password'

export function listUsers(): AdminUserRes[] {
  const db = getDb()
  const rows = db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      disabled: users.disabled,
      createdAt: users.createdAt,
      bookCount: count(books.id),
    })
    .from(users)
    .leftJoin(books, and(eq(books.userId, users.id), isNull(books.deletedAt)))
    // The shared guest account is managed via the allowGuestAccess instance
    // switch, has no server-side data, and carries no owner actions —
    // listing it only confuses user management.
    .where(ne(users.role, 'guest'))
    .groupBy(users.id)
    .all()
  return rows.map((r) => ({ ...r, disabled: r.disabled === 1 }))
}

export async function updateUser(actorId: string, targetId: string, patch: UpdateUserReq): Promise<AdminUserRes> {
  const db = getDb()
  const target = db.select().from(users).where(eq(users.id, targetId)).get()
  if (!target) {
    throw new AppError('USER_NOT_FOUND', 'User not found')
  }

  if (actorId === targetId && (patch.disabled === true || patch.role !== undefined)) {
    throw new AppError('CANNOT_MODIFY_SELF', 'Cannot change own role or disable own account')
  }

  // The guest account is anonymous and managed by the allowGuestAccess
  // instance switch; per-account patches (role, disable, password) would
  // create state that contradicts the switch.
  if (target.role === 'guest') {
    throw new AppError('CANNOT_MODIFY_GUEST', 'Guest account is managed via instance settings')
  }

  const newRole = patch.role ?? target.role
  const newDisabled = patch.disabled ?? target.disabled === 1
  const wasActiveOwner = target.role === 'owner' && target.disabled === 0
  if (wasActiveOwner && (newRole !== 'owner' || newDisabled)) {
    const otherActiveOwners = db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'owner'), eq(users.disabled, 0), ne(users.id, targetId)))
      .all()
    if (otherActiveOwners.length === 0) {
      throw new AppError('LAST_OWNER', 'Cannot remove the last active owner')
    }
  }

  const updates: Partial<typeof users.$inferInsert> = { updatedAt: Date.now() }
  if (patch.role !== undefined) updates.role = patch.role
  if (patch.disabled !== undefined) updates.disabled = patch.disabled ? 1 : 0
  if (patch.newPassword !== undefined) updates.passwordHash = await hashPassword(patch.newPassword)
  db.update(users).set(updates).where(eq(users.id, targetId)).run()
  if (patch.disabled === true || patch.newPassword !== undefined) revokeUserSessions(targetId)
  invalidateUserCache(targetId)

  const updated = listUsers().find((u) => u.id === targetId)
  if (!updated) throw new AppError('INTERNAL_ERROR', 'Failed to load updated user')
  return updated
}

/**
 * Owner-created account (3.12): real user plus their private library, but no
 * session — the new user logs in themselves. Registration switch irrelevant.
 */
export async function createUser(username: string, password: string): Promise<AdminUserRes> {
  const db = getDb()
  const norm = normalizeUsername(username)
  const clash = db.select({ id: users.id, username: users.username }).from(users).all()
    .find((r) => normalizeUsername(r.username) === norm)
  if (clash) throw new AppError('USERNAME_TAKEN', 'Username is already taken')
  const id = createId('user')
  const now = Date.now()
  const hash = await hashPassword(password)
  db.transaction((tx) => {
    try {
      tx.insert(users).values({
        id, username, usernameNormalized: norm, passwordHash: hash,
        role: 'member', createdAt: now, updatedAt: now,
      }).run()
    } catch (err) {
      if (err instanceof Error && 'code' in err && (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_UNIQUE') {
        throw new AppError('USERNAME_TAKEN', 'Username is already taken')
      }
      throw err
    }
    tx.insert(libraries).values({
      id: createId('lib'), userId: id, type: 'private', name: username,
      description: '', visibility: null, createdAt: now, updatedAt: now,
    }).run()
  })
  const created = listUsers().find((u) => u.id === id)
  if (!created) throw new AppError('INTERNAL_ERROR', 'Failed to create user')
  return created
}
