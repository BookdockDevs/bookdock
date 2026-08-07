import { and, count, eq, isNull, ne } from 'drizzle-orm'

import type { AdminUserRes, UpdateUserReq } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { books, users } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { invalidateUserCache } from '../../middleware/auth.guard'
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

  // The guest account is anonymous by design: a password would make it a
  // login-capable account while its role stays 'guest' — broken semantics
  if (target.role === 'guest' && patch.newPassword !== undefined) {
    throw new AppError('CANNOT_MODIFY_GUEST', 'Guest is anonymous and cannot have a password')
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
  invalidateUserCache(targetId)

  const updated = listUsers().find((u) => u.id === targetId)
  if (!updated) throw new AppError('INTERNAL_ERROR', 'Failed to load updated user')
  return updated
}
