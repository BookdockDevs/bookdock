import { and, desc, eq, inArray, or } from 'drizzle-orm'

import { normalizeUsername } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { ideas, libraries, libraryBooks, libraryBookVersions, libraryMemberships, users } from '../../db/schema'
import { createId } from '../../lib/id'
import { hashPassword, verifyPassword } from '../../lib/password'
import { AppError } from '../../middleware/error'
import { assertSharedLibraryVisible, deleteOrphanedBookVersions } from './library-access'
import type {
  Library,
  LibraryCreateReq,
  LibraryListItem,
  LibraryMembership,
  LibraryMembersRes,
  LibraryRelation,
  LibraryUpdateReq,
  MembershipManageReq,
} from '@bookdock/shared'

export interface LibraryIdentity {
  userId: string | null
  isGuest: boolean
}

function toLibraryRes(row: typeof libraries.$inferSelect): Library {
  return {
    id: row.id,
    type: row.type,
    ownerUserId: row.userId,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/**
 * The library list carries each row's relation to the reader. The sidebar has to
 * know, per row, whether to offer "join" or "manage" - and asking once per row
 * would be a request per library just to render a menu. Memberships for the
 * whole list are read in one query; the relation itself is the same
 * resolveRelation the single-library path uses, so the two cannot disagree.
 */
function toLibraryListRes(identity: LibraryIdentity, rows: (typeof libraries.$inferSelect)[], memberships: Map<string, LibraryMembership>): LibraryListItem[] {
  return rows.map((row) => {
    const library = toLibraryRes(row)
    if (row.type === 'private') return { ...library, relation: 'owner' as const }
    const membership = identity.userId ? memberships.get(row.id) : undefined
    return { ...library, relation: resolveRelation(row, membership, identity) }
  })
}

function toMembershipRes(row: typeof libraryMemberships.$inferSelect): LibraryMembership {
  return {
    id: row.id,
    libraryId: row.libraryId,
    userId: row.userId,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function requireUserId(identity: LibraryIdentity): string {
  if (!identity.userId || identity.isGuest) throw new AppError('FORBIDDEN', 'Guests cannot manage libraries')
  return identity.userId
}

function getLibraryRow(libraryId: string) {
  const db = getDb()
  const library = db.select().from(libraries).where(eq(libraries.id, libraryId)).get()
  if (!library) throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  return library
}

function resolveRelation(
  library: typeof libraries.$inferSelect,
  membership: { role: 'admin' | 'member' } | undefined,
  identity: LibraryIdentity,
): LibraryRelation {
  if (!identity.userId || identity.isGuest) return 'guest'
  if (library.userId === identity.userId) return 'owner'
  if (!membership) return 'non-member'
  return membership.role
}

function membershipOf(libraryId: string, userId: string) {
  const db = getDb()
  return db.select().from(libraryMemberships)
    .where(and(eq(libraryMemberships.libraryId, libraryId), eq(libraryMemberships.userId, userId))).get()
}

function getTargetUser(userId: string) {
  const db = getDb()
  const target = db.select().from(users).where(eq(users.id, userId)).get()
  if (!target) throw new AppError('USER_NOT_FOUND', 'User not found')
  if (target.role === 'guest') throw new AppError('FORBIDDEN', 'Guest identities cannot join libraries')
  if (target.disabled) throw new AppError('FORBIDDEN', 'Disabled accounts cannot join libraries')
  return target
}

function findUserIdByUsername(username: string | undefined): string {
  if (!username) throw new AppError('VALIDATION_ERROR', 'userId or username is required')
  const db = getDb()
  const exact = db.select({ id: users.id }).from(users).where(eq(users.username, username)).get()
  if (exact) return exact.id
  const normalized = normalizeUsername(username)
  const byColumn = db.select({ id: users.id }).from(users)
    .where(eq(users.usernameNormalized, normalized)).get()
  if (byColumn) return byColumn.id
  // Rows predating the normalized backfill have no column value, so fall back to
  // comparing in memory. The user table is small and this is an admin action.
  const scanned = db.select({ id: users.id, username: users.username }).from(users).all()
    .find((row) => normalizeUsername(row.username) === normalized)
  if (scanned) return scanned.id
  throw new AppError('USER_NOT_FOUND', 'User not found')
}

export async function listLibraries(identity: LibraryIdentity) {
  const db = getDb()
  if (!identity.userId || identity.isGuest) {
    const rows = db.select().from(libraries)
      .where(and(eq(libraries.type, 'shared'), eq(libraries.visibility, 'public')))
      .orderBy(desc(libraries.updatedAt)).all()
    return toLibraryListRes(identity, rows, new Map())
  }
  const memberRows = db.select().from(libraryMemberships)
    .where(eq(libraryMemberships.userId, identity.userId)).all()
  const memberLibraryIds = memberRows.map((row) => row.libraryId)
  const memberships = new Map(memberRows.map((row) => [row.libraryId, toMembershipRes(row)]))
  const shared = db.select().from(libraries)
    .where(and(
      eq(libraries.type, 'shared'),
      memberLibraryIds.length > 0
        ? or(
          eq(libraries.userId, identity.userId),
          inArray(libraries.id, memberLibraryIds),
          eq(libraries.visibility, 'public'),
          eq(libraries.visibility, 'password'),
        )
        : or(
          eq(libraries.userId, identity.userId),
          eq(libraries.visibility, 'public'),
          eq(libraries.visibility, 'password'),
        ),
    ))
    .orderBy(desc(libraries.updatedAt)).all()
  const ownPrivate = db.select().from(libraries)
    .where(and(eq(libraries.type, 'private'), eq(libraries.userId, identity.userId)))
    .orderBy(desc(libraries.updatedAt)).all()
  return toLibraryListRes(identity, [...ownPrivate, ...shared], memberships)
}

export async function getLibrary(identity: LibraryIdentity, libraryId: string) {
  const library = getLibraryRow(libraryId)
  if (library.type === 'private') {
    if (!identity.userId || identity.isGuest || library.userId !== identity.userId) {
      throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
    }
    return toLibraryRes(library)
  }
  const membership = identity.userId && !identity.isGuest ? membershipOf(libraryId, identity.userId) : undefined
  const relation = resolveRelation(library, membership, identity)
  if (relation === 'non-member' || relation === 'guest') {
    // Discoverable metadata only; content gating is enforced per request.
    assertSharedLibraryVisible(library, relation)
  }
  return toLibraryRes(library)
}

export async function createLibrary(identity: LibraryIdentity, data: LibraryCreateReq) {
  const userId = requireUserId(identity)
  if (data.visibility === 'password' && !data.accessPassword) {
    throw new AppError('VALIDATION_ERROR', 'Password libraries require an access password')
  }
  const now = Date.now()
  const row = {
    id: createId('lib'),
    userId,
    type: 'shared' as const,
    name: data.name,
    description: data.description ?? '',
    visibility: data.visibility ?? 'private',
    accessPasswordHash: data.visibility === 'password' && data.accessPassword
      ? await hashPassword(data.accessPassword)
      : null,
    createdAt: now,
    updatedAt: now,
  }
  getDb().insert(libraries).values(row).run()
  return toLibraryRes(row)
}

export async function updateLibrary(userId: string, libraryId: string, data: LibraryUpdateReq) {
  const db = getDb()
  const library = getLibraryRow(libraryId)
  if (library.type === 'private' || library.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Only the library owner can change its settings')
  }
  if (data.visibility === 'password' && !data.accessPassword && !library.accessPasswordHash) {
    throw new AppError('VALIDATION_ERROR', 'Password libraries require an access password')
  }
  const patch: Partial<typeof libraries.$inferInsert> = { updatedAt: Date.now() }
  if (data.name !== undefined) patch.name = data.name
  if (data.description !== undefined) patch.description = data.description
  if (data.visibility !== undefined) {
    patch.visibility = data.visibility
    if (data.visibility === 'password') {
      patch.accessPasswordHash = data.accessPassword
        ? await hashPassword(data.accessPassword)
        : (library.accessPasswordHash ?? null)
      if (!patch.accessPasswordHash) {
        throw new AppError('VALIDATION_ERROR', 'Password libraries require an access password')
      }
    } else {
      patch.accessPasswordHash = null
    }
  } else if (data.accessPassword !== undefined) {
    // Password rotation without a visibility change; only meaningful on
    // password libraries, cleared nowhere else.
    if (library.visibility !== 'password') {
      throw new AppError('VALIDATION_ERROR', 'Only password libraries have an access password')
    }
    patch.accessPasswordHash = data.accessPassword ? await hashPassword(data.accessPassword) : library.accessPasswordHash
  }
  db.update(libraries).set(patch).where(eq(libraries.id, libraryId)).run()
  return toLibraryRes(db.select().from(libraries).where(eq(libraries.id, libraryId)).get()!)
}

export async function deleteLibrary(userId: string, libraryId: string) {
  const db = getDb()
  const library = getLibraryRow(libraryId)
  if (library.type === 'private' || library.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Only the library owner can delete it')
  }
  // Versions that lose their last listing here go with their revisions; the
  // helper keeps anything another library still lists. Covers travel along so
  // an exclusive work does not leave orphan artwork.
  const versionIds = db.select({ bookVersionId: libraryBookVersions.bookVersionId }).from(libraryBookVersions)
    .where(eq(libraryBookVersions.libraryId, libraryId)).all().map((row) => row.bookVersionId)
  const coverKeys = db.select({ coverKey: libraryBooks.coverKey }).from(libraryBooks)
    .where(eq(libraryBooks.libraryId, libraryId)).all()
    .map((row) => row.coverKey).filter((key): key is string => key !== null)
    .concat(db.select({ coverKey: libraryBookVersions.coverKey }).from(libraryBookVersions)
      .where(eq(libraryBookVersions.libraryId, libraryId)).all()
      .map((row) => row.coverKey).filter((key): key is string => key !== null))
  // Shared ideas fall back to private instead of dying with the library;
  // private cards (B) and user-owned data in other libraries are untouched.
  db.update(ideas).set({ visibility: 'private', sharedLibraryId: null })
    .where(and(eq(ideas.sharedLibraryId, libraryId), eq(ideas.visibility, 'shared'))).run()
  db.delete(libraries).where(eq(libraries.id, libraryId)).run()
  await deleteOrphanedBookVersions([...new Set(versionIds)], { coverKeys })
  return { id: libraryId }
}

export async function listMembers(actorId: string, libraryId: string): Promise<LibraryMembersRes> {
  const db = getDb()
  const library = getLibraryRow(libraryId)
  if (library.type === 'private') throw new AppError('FORBIDDEN', 'Private libraries have no members')
  const membership = membershipOf(libraryId, actorId)
  const relation = resolveRelation(library, membership, { userId: actorId, isGuest: false })
  if (relation !== 'owner' && relation !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only owners and admins can list members')
  }
  const owner = db.select().from(users).where(eq(users.id, library.userId)).get()
  const rows = db.select().from(libraryMemberships).where(eq(libraryMemberships.libraryId, libraryId))
    .orderBy(desc(libraryMemberships.createdAt)).all()
  // User profiles travel with the rows: a member list without them is unusable.
  const memberUsers = new Map(
    rows.length > 0
      ? db.select({ id: users.id, username: users.username, avatarKey: users.avatarKey }).from(users)
          .where(inArray(users.id, rows.map((row) => row.userId))).all()
          .map((row) => [row.id, row])
      : [],
  )
  return {
    owner: owner ? { id: owner.id, username: owner.username, avatarKey: owner.avatarKey, createdAt: library.createdAt } : null,
    members: rows.map((row) => {
      const u = memberUsers.get(row.userId)
      return {
        ...toMembershipRes(row),
        username: u?.username ?? '',
        avatarKey: u?.avatarKey ?? null,
      }
    }),
  }
}

export async function addMember(actorId: string, libraryId: string, data: MembershipManageReq) {
  const db = getDb()
  const library = getLibraryRow(libraryId)
  if (library.type === 'private') throw new AppError('FORBIDDEN', 'Private libraries have no members')
  // A username is accepted because a management UI has no user directory; the
  // lookup is exact on the stored name, then on the normalized column.
  const targetUserId = data.userId ?? findUserIdByUsername(data.username)
  if (targetUserId === library.userId) throw new AppError('VALIDATION_ERROR', 'The owner already owns this library')
  const membership = membershipOf(libraryId, actorId)
  const relation = resolveRelation(library, membership, { userId: actorId, isGuest: false })
  if (relation === 'owner') {
    // Owners manage every role.
  } else if (relation === 'admin' && data.role === 'member') {
    // Admins manage members only.
  } else {
    throw new AppError('FORBIDDEN', 'Not allowed to manage members')
  }
  getTargetUser(targetUserId)
  if (membershipOf(libraryId, targetUserId)) {
    throw new AppError('VALIDATION_ERROR', 'User is already a member; change the role instead')
  }
  const now = Date.now()
  const row = {
    id: createId('lbm'), libraryId, userId: targetUserId, role: data.role,
    createdAt: now, updatedAt: now,
  }
  db.insert(libraryMemberships).values(row).run()
  return toMembershipRes(row)
}

export async function removeMember(actorId: string, libraryId: string, targetUserId: string) {
  const db = getDb()
  const library = getLibraryRow(libraryId)
  if (library.type === 'private') throw new AppError('FORBIDDEN', 'Private libraries have no members')
  if (targetUserId === library.userId) {
    throw new AppError('VALIDATION_ERROR', 'Transfer ownership before removing the owner')
  }
  const existing = membershipOf(libraryId, targetUserId)
  if (!existing) throw new AppError('MEMBERSHIP_NOT_FOUND', 'Membership not found')
  const membership = membershipOf(libraryId, actorId)
  const relation = resolveRelation(library, membership, { userId: actorId, isGuest: false })
  if (relation === 'owner') {
    // Owners remove anyone.
  } else if (relation === 'admin' && existing.role === 'member' && targetUserId !== actorId) {
    // Admins remove members other than themselves (self-removal is leaving).
  } else if ((relation === 'admin' || relation === 'member') && targetUserId === actorId) {
    // Anyone may leave.
  } else {
    throw new AppError('FORBIDDEN', 'Not allowed to remove this member')
  }
  db.delete(libraryMemberships).where(eq(libraryMemberships.id, existing.id)).run()
  return { id: existing.id }
}

export async function setMemberRole(actorId: string, libraryId: string, targetUserId: string, role: 'admin' | 'member') {
  const db = getDb()
  const library = getLibraryRow(libraryId)
  if (library.type === 'private') throw new AppError('FORBIDDEN', 'Private libraries have no members')
  if (library.userId !== actorId) throw new AppError('FORBIDDEN', 'Only the owner can change member roles')
  const existing = membershipOf(libraryId, targetUserId)
  if (!existing) throw new AppError('MEMBERSHIP_NOT_FOUND', 'Membership not found')
  db.update(libraryMemberships).set({ role, updatedAt: Date.now() })
    .where(eq(libraryMemberships.id, existing.id)).run()
  return toMembershipRes(db.select().from(libraryMemberships).where(eq(libraryMemberships.id, existing.id)).get()!)
}

export async function getRelation(identity: LibraryIdentity, libraryId: string) {
  const library = getLibraryRow(libraryId)
  if (library.type === 'private') {
    if (!identity.userId || identity.isGuest || library.userId !== identity.userId) {
      throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
    }
    return { relation: 'owner' as const }
  }
  const membership = identity.userId && !identity.isGuest ? membershipOf(libraryId, identity.userId) : undefined
  return { relation: resolveRelation(library, membership, identity) }
}

export async function joinLibrary(userId: string, libraryId: string, accessPassword?: string) {
  const db = getDb()
  const library = getLibraryRow(libraryId)
  if (library.type === 'private') throw new AppError('FORBIDDEN', 'Private libraries have no members')
  if (library.userId === userId) return { membership: null, relation: 'owner' as const }
  const existing = membershipOf(libraryId, userId)
  // Rejoining is idempotent and never re-asks the password: the relation is
  // already established and rechecked on every request.
  if (existing) return { membership: toMembershipRes(existing), relation: existing.role }
  getTargetUser(userId)
  if (library.visibility === 'public') {
    // Open libraries admit members freely; the invite-only path stays admin-driven.
  } else if (library.visibility === 'password') {
    if (!accessPassword || !library.accessPasswordHash || !(await verifyPassword(accessPassword, library.accessPasswordHash))) {
      throw new AppError('INVALID_LIBRARY_PASSWORD', 'Wrong access password')
    }
  } else {
    throw new AppError('FORBIDDEN', 'This library admits members by invitation only')
  }
  const now = Date.now()
  const row = {
    id: createId('lbm'), libraryId, userId, role: 'member' as const,
    createdAt: now, updatedAt: now,
  }
  db.insert(libraryMemberships).values(row).run()
  return { membership: toMembershipRes(row), relation: 'member' as const }
}

export async function setVersionGuestReadable(actorId: string, libraryId: string, bookVersionId: string, readable: boolean) {
  const db = getDb()
  const library = getLibraryRow(libraryId)
  const membership = membershipOf(libraryId, actorId)
  const relation = resolveRelation(library, membership, { userId: actorId, isGuest: false })
  if (relation !== 'owner' && relation !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only owners and admins can change readability')
  }
  const link = db.select({ id: libraryBookVersions.id }).from(libraryBookVersions)
    .where(and(eq(libraryBookVersions.libraryId, libraryId), eq(libraryBookVersions.bookVersionId, bookVersionId))).get()
  if (!link) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Version is not in this library')
  // Per-listing switch: opening this copy to guests leaves every other
  // library's copy of the same version exactly as it was.
  db.update(libraryBookVersions).set({ guestReadable: readable }).where(eq(libraryBookVersions.id, link.id)).run()
  return { bookVersionId, guestReadable: readable }
}

/**
 * Shared-library ownership transfer (4.9): the new owner must already be an
 * enabled admin or member of the library. Atomically drops their membership,
 * moves ownership, and seats the former owner as admin. Private libraries
 * are never transferable.
 */
export async function transferLibraryOwnership(actorId: string, libraryId: string, targetId: string) {
  const db = getDb()
  const library = getLibraryRow(libraryId)
  if (library.type === 'private') throw new AppError('FORBIDDEN', 'Private libraries cannot be transferred')
  if (library.userId !== actorId) throw new AppError('FORBIDDEN', 'Only the library owner can transfer it')
  const target = db.select().from(users).where(eq(users.id, targetId)).get()
  if (!target || target.role === 'guest') throw new AppError('USER_NOT_FOUND', 'User not found')
  if (target.disabled === 1) throw new AppError('FORBIDDEN', 'Transfer target must be enabled')
  const membership = membershipOf(libraryId, targetId)
  if (!membership) throw new AppError('FORBIDDEN', 'Transfer target must be an admin or member of the library')
  const now = Date.now()
  db.transaction((tx) => {
    // Re-assert ownership inside the transaction: the check above and these
    // writes must not straddle a concurrent transfer.
    const fresh = tx.select({ userId: libraries.userId }).from(libraries)
      .where(eq(libraries.id, libraryId)).get()
    if (!fresh || fresh.userId !== actorId) throw new AppError('FORBIDDEN', 'Only the library owner can transfer it')
    tx.delete(libraryMemberships).where(eq(libraryMemberships.id, membership.id)).run()
    tx.update(libraries).set({ userId: targetId, updatedAt: now }).where(eq(libraries.id, libraryId)).run()
    tx.insert(libraryMemberships).values({
      id: createId('lbm'), libraryId, userId: actorId, role: 'admin',
      createdAt: now, updatedAt: now,
    }).run()
  })
  return toLibraryRes(db.select().from(libraries).where(eq(libraries.id, libraryId)).get()!)
}
