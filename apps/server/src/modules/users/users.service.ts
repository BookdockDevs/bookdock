import { and, asc, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm'

import { normalizeUsername } from '@bookdock/shared'
import type { AdminUserRes, UpdateUserReq } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { blobKeyReferenced } from '../../db/blob-refs'
import { avatarVariantKeys } from '../../lib/avatar'
import { coverThumbnailKey } from '../../lib/cover'
import { deleteProgressFile } from '../../lib/progress-file'
import {
  blobs,
  bookStates,
  bookVersions,
  contentRevisions,
  fonts,
  libraries,
  libraryBooks,
  libraryBookVersions,
  libraryCategories,
  libraryTags,
  instance,
  readingRecords,
  settings,
  users,
} from '../../db/schema'
import { AppError } from '../../middleware/error'
import { invalidateUserCache } from '../../middleware/auth.guard'
import { revokeUserSessions, isInstanceOwner } from '../auth/auth.service'
import { createId } from '../../lib/id'
import { hashPassword, verifyPassword } from '../../lib/password'
import { getStorage } from '../../storage'

export function listUsers(): AdminUserRes[] {
  const db = getDb()
  const rows = db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      disabled: users.disabled,
      createdAt: users.createdAt,
      avatarKey: users.avatarKey,
      bookCount: count(libraryBookVersions.id),
    })
    .from(users)
    .leftJoin(libraries, and(eq(libraries.userId, users.id), eq(libraries.type, 'private')))
    .leftJoin(libraryBooks, and(eq(libraryBooks.libraryId, libraries.id), isNull(libraryBooks.deletedAt)))
    .leftJoin(libraryBookVersions, eq(libraryBookVersions.libraryBookId, libraryBooks.id))
    // The shared guest account is managed via the allowGuestAccess instance
    // switch, has no server-side data, and carries no owner actions —
    // listing it only confuses user management.
    .where(ne(users.role, 'guest'))
    .groupBy(users.id)
    .orderBy(
      sql`CASE ${users.role}
        WHEN 'owner' THEN 0
        WHEN 'admin' THEN 1
        WHEN 'member' THEN 2
        ELSE 3
      END ASC`,
      asc(users.createdAt),
    )
    .all()
  // One extra query for the delete guard: an account owning shared libraries
  // cannot be deleted until they are transferred or deleted.
  const owned = db
    .select({ userId: libraries.userId, id: libraries.id, name: libraries.name })
    .from(libraries)
    .where(eq(libraries.type, 'shared'))
    .all()
  const ownedByUser = new Map<string, { id: string; name: string }[]>()
  for (const lib of owned) {
    const list = ownedByUser.get(lib.userId) ?? []
    list.push({ id: lib.id, name: lib.name })
    ownedByUser.set(lib.userId, list)
  }
  return rows.map((r) => ({ ...r, disabled: r.disabled === 1, ownedLibraries: ownedByUser.get(r.id) ?? [] }))
}

export async function updateUser(actorId: string, targetId: string, patch: UpdateUserReq): Promise<AdminUserRes> {
  const db = getDb()
  // Defense in depth: routes already sit behind requireOwner, but user
  // management must not depend on a single middleware for its actor check.
  if (!isInstanceOwner(actorId)) throw new AppError('FORBIDDEN', 'Owner only')
  const target = db.select().from(users).where(eq(users.id, targetId)).get()
  if (!target) {
    throw new AppError('USER_NOT_FOUND', 'User not found')
  }

  if (actorId === targetId && patch.disabled === true) {
    throw new AppError('CANNOT_MODIFY_SELF', 'Cannot disable own account')
  }

  // The guest account is anonymous and managed by the allowGuestAccess
  // instance switch; per-account patches (disable, password) would
  // create state that contradicts the switch.
  if (target.role === 'guest') {
    throw new AppError('CANNOT_MODIFY_GUEST', 'Guest account is managed via instance settings')
  }

  const newDisabled = patch.disabled ?? target.disabled === 1
  // Single-owner model: the instance owner cannot be disabled, only
  // transferred away first. The legacy multi-owner role rows are ignored as
  // source of truth (see isInstanceOwner).
  if (target.disabled === 0 && newDisabled && isInstanceOwner(targetId)) {
    throw new AppError('LAST_OWNER', 'Cannot disable the instance owner; transfer ownership first')
  }

  const updates: Partial<typeof users.$inferInsert> = { updatedAt: Date.now() }
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
      id: createId('lib'), userId: id, type: 'private', name: '',
      description: '', visibility: null, createdAt: now, updatedAt: now,
    }).run()
  })
  const created = listUsers().find((u) => u.id === id)
  if (!created) throw new AppError('INTERNAL_ERROR', 'Failed to create user')
  return created
}

function getManagedUser(targetId: string) {
  const db = getDb()
  const target = db.select().from(users).where(eq(users.id, targetId)).get()
  if (!target) throw new AppError('USER_NOT_FOUND', 'User not found')
  if (target.role === 'guest') throw new AppError('CANNOT_MODIFY_GUEST', 'Guest account is managed via instance settings')
  return target
}

/**
 * Instance ownership transfer (4.9): the caller must be the current instance
 * owner; the target must be an enabled real user. The former owner becomes a
 * plain member atomically — role changes never happen through PATCH again.
 */
export async function transferInstanceOwnership(actorId: string, targetId: string) {
  const db = getDb()
  const row = db.select().from(instance).get()
  if (!row) throw new AppError('FORBIDDEN', 'Instance is not set up yet')
  if (row.ownerUserId !== actorId) throw new AppError('FORBIDDEN', 'Only the instance owner can transfer it')
  const target = getManagedUser(targetId)
  if (target.disabled === 1) throw new AppError('FORBIDDEN', 'Transfer target must be enabled')
  const now = Date.now()
  db.transaction((tx) => {
    tx.update(instance).set({ ownerUserId: targetId, updatedAt: now }).run()
    tx.update(users).set({ role: 'member', updatedAt: now }).where(eq(users.id, actorId)).run()
    tx.update(users).set({ role: 'owner', updatedAt: now }).where(eq(users.id, targetId)).run()
  })
  invalidateUserCache(actorId)
  invalidateUserCache(targetId)
  return { ownerUserId: targetId }
}

/**
 * User deletion (4.8): explicit cleanup of everything the user owns, with
 * shared blobs kept by reference count. Owners of anything — the instance
 * or any shared library — are refused until they transfer or delete it.
 * Self-deletion re-verifies the password; owners deleting others do not.
 */
export async function deleteUser(actorId: string, targetId: string, password?: string) {
  const db = getDb()
  const target = getManagedUser(targetId)
  const selfDelete = actorId === targetId
  if (!selfDelete) {
    if (!isInstanceOwner(actorId)) throw new AppError('FORBIDDEN', 'Only instance owners can delete users')
    if (isInstanceOwner(targetId)) throw new AppError('FORBIDDEN', 'Instance owners cannot be deleted; transfer first')
  } else {
    if (isInstanceOwner(targetId)) throw new AppError('FORBIDDEN', 'Instance owners cannot delete themselves; transfer first')
    if (!target.passwordHash || !password || !(await verifyPassword(password, target.passwordHash))) {
      throw new AppError('UNAUTHORIZED', 'Password verification failed')
    }
  }
  const ownedShared = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, targetId), eq(libraries.type, 'shared'))).all()
  if (ownedShared.length > 0) {
    throw new AppError('FORBIDDEN', 'Transfer or delete owned shared libraries first')
  }
  const storage = getStorage()

  // Collect everything addressable before touching rows: the user's works,
  // their versions, and every file key that might be exclusive to them.
  const userLibraryBooks = db.select().from(libraryBooks).where(eq(libraryBooks.userId, targetId)).all()
  const userLibraryBookIds = new Set(userLibraryBooks.map((row) => row.id))
  const userVersionIds = [...new Set(
    (userLibraryBookIds.size > 0
      ? db.select().from(libraryBookVersions)
        .where(inArray(libraryBookVersions.libraryBookId, [...userLibraryBookIds])).all()
      : []).map((row) => row.bookVersionId),
  )]
  const coverKeys = new Set<string>()
  for (const row of userLibraryBooks) {
    if (row.coverKey) coverKeys.add(row.coverKey)
  }
  // Version-level cover overrides live on the link rows, not the works.
  if (userLibraryBookIds.size > 0) {
    for (const row of db.select({ coverKey: libraryBookVersions.coverKey }).from(libraryBookVersions)
      .where(inArray(libraryBookVersions.libraryBookId, [...userLibraryBookIds])).all()) {
      if (row.coverKey) coverKeys.add(row.coverKey)
    }
  }
  const revisionBlobKeys = userVersionIds.length > 0
    ? db.select({ blobKey: contentRevisions.blobKey }).from(contentRevisions)
      .where(inArray(contentRevisions.bookVersionId, userVersionIds)).all().map((row) => row.blobKey)
    : []
  // Positions are filed per user, so deleting an account removes exactly its own
  // and can no longer take another reader's place with it - which the old
  // book-keyed layout did as soon as someone collected the same version.
  // A position exists exactly where the account has a card, a BookState or a
  // reading record. Cards and records point at versions, never at works: the
  // work ids used to sit here and matched no progress file at all.
  const progressVersionIds = new Set<string>([
    ...userVersionIds,
    ...db.select({ bookVersionId: bookStates.bookVersionId }).from(bookStates)
      .where(eq(bookStates.userId, targetId)).all().map((row) => row.bookVersionId),
    ...db.select({ bookVersionId: readingRecords.bookVersionId }).from(readingRecords)
      .where(eq(readingRecords.userId, targetId)).all()
      .map((row) => row.bookVersionId).filter((id): id is string => id !== null),
  ])

  db.transaction((tx) => {
    // Library-scoped rows with restricting user FKs go first; member rows,
    // states, annotations, reading data and credentials cascade off the user.
    const privateLibraries = tx.select({ id: libraries.id }).from(libraries)
      .where(and(eq(libraries.userId, targetId), eq(libraries.type, 'private'))).all()
    for (const library of privateLibraries) {
      tx.delete(libraryBooks).where(eq(libraryBooks.libraryId, library.id)).run()
      tx.delete(libraryCategories).where(eq(libraryCategories.libraryId, library.id)).run()
      tx.delete(libraryTags).where(eq(libraryTags.libraryId, library.id)).run()
      tx.delete(libraries).where(eq(libraries.id, library.id)).run()
    }
    // Creator rows inside libraries the account does not own (shared works,
    // categories, tags uploaded/created as a manager) belong to the library,
    // so authorship falls back to the library owner instead of blocking the
    // whole deletion on a restricting FK. A full createdByUserId split is
    // deferred (review §4.2); this keeps the delete working without inventing
    // new relations.
    const sharedLibraries = tx.select({ id: libraries.id, userId: libraries.userId }).from(libraries)
      .where(eq(libraries.type, 'shared')).all()
    for (const library of sharedLibraries) {
      if (library.userId === targetId) continue
      tx.update(libraryBooks).set({ userId: library.userId })
        .where(and(eq(libraryBooks.libraryId, library.id), eq(libraryBooks.userId, targetId))).run()
      tx.update(libraryCategories).set({ userId: library.userId })
        .where(and(eq(libraryCategories.libraryId, library.id), eq(libraryCategories.userId, targetId))).run()
      tx.update(libraryTags).set({ userId: library.userId })
        .where(and(eq(libraryTags.libraryId, library.id), eq(libraryTags.userId, targetId))).run()
    }
    tx.delete(settings).where(eq(settings.userId, targetId)).run()
    tx.delete(fonts).where(eq(fonts.userId, targetId)).run()
    // Versions nobody else points at go with their revisions; anything still
    // referenced (shared catalog, other readers) survives with its blobs.
    for (const versionId of userVersionIds) {
      const stillLinked = tx.select({ id: libraryBookVersions.id }).from(libraryBookVersions)
        .where(eq(libraryBookVersions.bookVersionId, versionId)).get()
      if (stillLinked) continue
      tx.delete(contentRevisions).where(eq(contentRevisions.bookVersionId, versionId)).run()
      tx.delete(bookVersions).where(eq(bookVersions.id, versionId)).run()
    }
    tx.delete(users).where(eq(users.id, targetId)).run()
  })

  // Files last, each guarded by a live reference check: content-addressed
  // blobs may serve another user's identical upload, covers double as
  // library artwork, and avatar keys may be shared between users.
  const deletedBlobKeys = new Set<string>()
  const contentKeys = new Set<string>([
    ...revisionBlobKeys,
  ])
  for (const key of contentKeys) {
    if (!blobKeyReferenced(key) && (await storage.exists(key))) {
      await storage.delete(key)
      deletedBlobKeys.add(key)
    }
  }
  for (const key of coverKeys) {
    if (!blobKeyReferenced(key) && (await storage.exists(key))) {
      await storage.delete(key)
      deletedBlobKeys.add(key)
      const thumbKey = coverThumbnailKey(key)
      if (thumbKey !== key && (await storage.exists(thumbKey))) {
        await storage.delete(thumbKey)
      }
    }
  }
  if (deletedBlobKeys.size > 0) {
    db.delete(blobs).where(inArray(blobs.key, [...deletedBlobKeys])).run()
  }
  if (target.avatarKey) {
    const sharedAvatar = db.select({ id: users.id }).from(users).where(eq(users.avatarKey, target.avatarKey)).get()
    if (!sharedAvatar) {
      for (const key of avatarVariantKeys(target.avatarKey)) {
        const storageKey = `avatars/${key}`
        if (await storage.exists(storageKey)) await storage.delete(storageKey)
      }
    }
  }
  // Includes any version the account read through a library without collecting.
  for (const versionId of progressVersionIds) {
    await deleteProgressFile(targetId, versionId)
  }
  invalidateUserCache(targetId)
  return { id: targetId }
}
