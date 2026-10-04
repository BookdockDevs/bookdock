import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'

import { normalizeUsername } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { ideas, libraries, libraryBooks, libraryBookVersions, libraryInvites, libraryMemberships, users } from '../../db/schema'
import { createId } from '../../lib/id'
import { hashPassword, verifyPassword } from '../../lib/password'
import { assertUserCreateLibraryAllowed } from '../auth/auth.service'
import { generateLibraryInviteToken } from '../../lib/token'
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

function toLibraryRes(row: typeof libraries.$inferSelect, isOwner?: boolean): Library {
  const shared = row.type === 'shared'
  return {
    id: row.id,
    type: row.type,
    ownerUserId: row.userId,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    accessPassword: isOwner ? (row.accessPassword ?? null) : undefined,
    // Trash knobs are owner-only like the access password; other relations
    // get null (shared) so the UI can tell "shared" from "private" (undefined).
    trashEnabled: !shared ? undefined : (isOwner ? (row.trashEnabled ?? true) : null),
    trashAutoCleanDays: !shared ? undefined : (isOwner ? (row.trashAutoCleanDays ?? 30) : null),
    trashMaxBytes: !shared ? undefined : (isOwner ? (row.trashMaxBytes ?? 0) : null),
    // Member upload is library policy like visibility: every reader of a
    // shared row sees it (enforcement stays server-side). Private rows omit it.
    allowMemberUpload: !shared ? undefined : row.allowMemberUpload,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

interface LibraryListStats {
  memberCount: number
  workCount: number
}

/**
 * Head counts for the list rows, in two grouped queries rather than one per
 * library. Member count is the membership rows plus the owner, who holds none of
 * his own — a private library is always just its owner. Work count is what the
 * reader can actually open: trash never counts, and a plain member does not get
 * hidden works or all-unlisted works counted, so the number matches the catalog
 * they are about to open. A private library is its reader's, so it always counts
 * in full. Hidden categories and tags are a listing concern and do not subtract.
 */
function libraryListStats(
  identity: LibraryIdentity,
  rows: (typeof libraries.$inferSelect)[],
  memberships: Map<string, LibraryMembership>,
): Map<string, LibraryListStats> {
  const db = getDb()
  const stats = new Map<string, LibraryListStats>()
  if (rows.length === 0) return stats
  const shared = rows.filter((row) => row.type === 'shared')
  // Every row starts at one member: the private library has no membership rows
  // at all, and a shared library always counts its owner.
  for (const row of rows) stats.set(row.id, { memberCount: 1, workCount: 0 })

  const sharedIds = shared.map((row) => row.id)
  if (sharedIds.length > 0) {
    for (const row of db.select({
      libraryId: libraryMemberships.libraryId,
      count: sql<number>`count(*)`,
    }).from(libraryMemberships).where(inArray(libraryMemberships.libraryId, sharedIds)).groupBy(libraryMemberships.libraryId).all()) {
      const entry = stats.get(row.libraryId)
      if (entry) entry.memberCount += row.count
    }
  }

  // A private library belongs to its reader, so it is always managed: its hidden
  // and unlisted works are the reader's own.
  const managedIds = rows
    .filter((row) => row.type === 'private' || (() => {
      const relation = resolveRelation(row, identity.userId ? memberships.get(row.id) : undefined, identity)
      return relation === 'owner' || relation === 'admin'
    })())
    .map((row) => row.id)
  for (const row of db.select({
    libraryId: libraryBooks.libraryId,
    count: sql<number>`count(*)`,
  }).from(libraryBooks).where(and(
    inArray(libraryBooks.libraryId, rows.map((row) => row.id)),
    isNull(libraryBooks.deletedAt),
    or(
      inArray(libraryBooks.libraryId, managedIds),
      and(
        eq(libraryBooks.hidden, false),
        sql`EXISTS (SELECT 1 FROM library_book_versions AS visible_version
          WHERE visible_version.library_book_id = ${libraryBooks.id}
            AND visible_version.status = 'published')`,
      ),
    ),
  )).groupBy(libraryBooks.libraryId).all()) {
    const entry = stats.get(row.libraryId)
    if (entry) entry.workCount = row.count
  }
  return stats
}

/**
 * The library list carries each row's relation to the reader. The sidebar has to
 * know, per row, whether to offer "join" or "manage" - and asking once per row
 * would be a request per library just to render a menu. Memberships for the
 * whole list are read in one query; the relation itself is the same
 * resolveRelation the single-library path uses, so the two cannot disagree.
 */
function toLibraryListRes(
  identity: LibraryIdentity,
  rows: (typeof libraries.$inferSelect)[],
  memberships: Map<string, LibraryMembership>,
  stats: Map<string, LibraryListStats>,
  ownerNames: Map<string, string>,
): LibraryListItem[] {
  return rows.map((row) => {
    const isOwner = Boolean(identity.userId && row.userId === identity.userId)
    const library = toLibraryRes(row, isOwner)
    const count = stats.get(row.id) ?? { memberCount: 1, workCount: 0 }
    const ownerUsername = ownerNames.get(row.userId) ?? ''
    if (row.type === 'private') return { ...library, relation: 'owner' as const, ...count, ownerUsername }
    const membership = identity.userId ? memberships.get(row.id) : undefined
    return { ...library, relation: resolveRelation(row, membership, identity), ...count, ownerUsername }
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

/**
 * Default sidebar order: when *this* reader joined, oldest first, so a library
 * keeps its place instead of jumping around. An owner holds no membership row,
 * so their entry date is the library's own creation. A manual drag overrides
 * this on the client; anything the manual order does not mention simply follows
 * it, which is how a newly joined library lands at the bottom.
 */
function byJoinTime(
  rows: (typeof libraries.$inferSelect)[],
  memberships: Map<string, LibraryMembership>,
): (typeof libraries.$inferSelect)[] {
  const joinedAt = (row: typeof libraries.$inferSelect) => memberships.get(row.id)?.createdAt ?? row.createdAt
  return [...rows].sort((a, b) => (
    joinedAt(a) - joinedAt(b) || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  ))
}

export async function listLibraries(identity: LibraryIdentity) {
  const db = getDb()
  if (!identity.userId || identity.isGuest) {
    const rows = db.select().from(libraries)
      .where(and(eq(libraries.type, 'shared'), eq(libraries.visibility, 'public')))
      .orderBy(desc(libraries.updatedAt)).all()
    return toLibraryListRes(identity, byJoinTime(rows, new Map()), new Map(), libraryListStats(identity, rows, new Map()), ownerNamesOf(rows))
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
  const ordered = [...ownPrivate, ...byJoinTime(shared, memberships)]
  return toLibraryListRes(identity, ordered, memberships, libraryListStats(identity, ordered, memberships), ownerNamesOf(ordered))
}

/** Owner display names for the list rows, read in one query for all of them. */
function ownerNamesOf(rows: (typeof libraries.$inferSelect)[]) {
  const ids = [...new Set(rows.map((row) => row.userId))]
  if (ids.length === 0) return new Map<string, string>()
  const db = getDb()
  return new Map(db.select({ id: users.id, username: users.username }).from(users)
    .where(inArray(users.id, ids)).all().map((row) => [row.id, row.username]))
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
  const isOwner = Boolean(identity.userId && library.userId === identity.userId)
  return toLibraryRes(library, isOwner)
}

export async function createLibrary(identity: LibraryIdentity, data: LibraryCreateReq) {
  const userId = requireUserId(identity)
  assertUserCreateLibraryAllowed(userId)
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
    accessPassword: data.visibility === 'password' && data.accessPassword ? data.accessPassword : null,
    accessPasswordHash: data.visibility === 'password' && data.accessPassword
      ? await hashPassword(data.accessPassword)
      : null,
    trashEnabled: null,
    trashAutoCleanDays: null,
    trashMaxBytes: null,
    allowMemberUpload: false,
    createdAt: now,
    updatedAt: now,
  }
  getDb().transaction((tx) => {
    tx.insert(libraries).values(row).run()
    if (row.visibility === 'private') {
      tx.insert(libraryInvites).values({
        id: createId('lbi'), libraryId: row.id, userId,
        token: generateLibraryInviteToken(), createdAt: now,
      }).run()
    }
  })
  return toLibraryRes(row, true)
}

export async function updateLibrary(userId: string, libraryId: string, data: LibraryUpdateReq) {
  const db = getDb()
  const library = getLibraryRow(libraryId)
  if (library.userId !== userId) {
    throw new AppError('FORBIDDEN', 'Only the library owner can change its settings')
  }
  if (library.type === 'private' && (
    data.name === undefined || data.description !== undefined
    || data.visibility !== undefined || data.accessPassword !== undefined
    || data.trashEnabled !== undefined || data.trashAutoCleanDays !== undefined
    || data.trashMaxBytes !== undefined || data.allowMemberUpload !== undefined
  )) {
    throw new AppError('VALIDATION_ERROR', 'Only the private library name can be changed')
  }
  if (data.visibility === 'password' && !data.accessPassword && !library.accessPassword && !library.accessPasswordHash) {
    throw new AppError('VALIDATION_ERROR', 'Password libraries require an access password')
  }
  const patch: Partial<typeof libraries.$inferInsert> = { updatedAt: Date.now() }
  if (data.name !== undefined) patch.name = data.name
  if (data.description !== undefined) patch.description = data.description
  // Shared-library trash knobs (owner-only; updateLibrary itself is owner-only).
  let trashDisabling = false
  if (library.type === 'shared') {
    if (data.trashEnabled !== undefined) {
      patch.trashEnabled = data.trashEnabled
      if (!data.trashEnabled) trashDisabling = true
    }
    if (data.allowMemberUpload !== undefined) patch.allowMemberUpload = data.allowMemberUpload
    if (data.trashAutoCleanDays !== undefined) patch.trashAutoCleanDays = data.trashAutoCleanDays
    if (data.trashMaxBytes !== undefined) patch.trashMaxBytes = data.trashMaxBytes
  } else if (data.trashEnabled !== undefined || data.trashAutoCleanDays !== undefined || data.trashMaxBytes !== undefined || data.allowMemberUpload !== undefined) {
    throw new AppError('VALIDATION_ERROR', 'Private libraries have no trash settings')
  }
  if (data.visibility !== undefined) {
    patch.visibility = data.visibility
    if (data.visibility === 'password') {
      if (data.accessPassword !== undefined) {
        patch.accessPassword = data.accessPassword
        patch.accessPasswordHash = data.accessPassword ? await hashPassword(data.accessPassword) : null
      } else {
        patch.accessPassword = library.accessPassword ?? null
        patch.accessPasswordHash = library.accessPasswordHash ?? null
      }
      if (!patch.accessPassword && !patch.accessPasswordHash) {
        throw new AppError('VALIDATION_ERROR', 'Password libraries require an access password')
      }
    } else {
      patch.accessPassword = null
      patch.accessPasswordHash = null
    }
  } else if (data.accessPassword !== undefined) {
    if (library.visibility !== 'password') {
      throw new AppError('VALIDATION_ERROR', 'Only password libraries have an access password')
    }
    patch.accessPassword = data.accessPassword
    patch.accessPasswordHash = data.accessPassword ? await hashPassword(data.accessPassword) : library.accessPasswordHash
  }
  db.transaction((tx) => {
    tx.update(libraries).set(patch).where(eq(libraries.id, libraryId)).run()
    if (library.visibility === 'private' && data.visibility && data.visibility !== 'private') {
      tx.delete(libraryInvites).where(eq(libraryInvites.libraryId, libraryId)).run()
    } else if (library.type === 'shared' && library.visibility !== 'private' && data.visibility === 'private') {
      tx.insert(libraryInvites).values({
        id: createId('lbi'), libraryId, userId,
        token: generateLibraryInviteToken(), createdAt: Date.now(),
      }).run()
    }
  })
  // Flipping the switch off permanently deletes the current trash, mirroring
  // the private-library master switch.
  if (trashDisabling) {
    const { emptyLibraryTrash } = await import('./catalog.service')
    await emptyLibraryTrash(userId, libraryId)
  }
  return toLibraryRes(db.select().from(libraries).where(eq(libraries.id, libraryId)).get()!, true)
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
    .orderBy(
      sql`CASE ${libraryMemberships.role}
        WHEN 'admin' THEN 0
        WHEN 'member' THEN 1
        ELSE 2
      END ASC`,
      asc(libraryMemberships.createdAt),
    ).all()
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
    const matches = accessPassword && (
      (library.accessPassword && accessPassword === library.accessPassword)
      || (library.accessPasswordHash && (await verifyPassword(accessPassword, library.accessPasswordHash)))
    )
    if (!matches) {
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

export function getLibraryInviteStatus(actorId: string, libraryId: string) {
  const library = getLibraryRow(libraryId)
  if (library.type !== 'shared' || library.visibility !== 'private') {
    throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  }
  const relation = resolveRelation(library, membershipOf(libraryId, actorId), { userId: actorId, isGuest: false })
  if (relation !== 'owner' && relation !== 'admin') throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  const invite = getDb().select({ createdAt: libraryInvites.createdAt, token: libraryInvites.token, revokedAt: libraryInvites.revokedAt }).from(libraryInvites)
    .where(eq(libraryInvites.libraryId, libraryId)).get()
  return { active: Boolean(invite && !invite.revokedAt), createdAt: invite?.createdAt ?? null, token: invite && !invite.revokedAt ? invite.token : null }
}

export function createLibraryInvite(actorId: string, libraryId: string) {
  const library = getLibraryRow(libraryId)
  if (library.type !== 'shared' || library.visibility !== 'private') {
    throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  }
  const relation = resolveRelation(library, membershipOf(libraryId, actorId), { userId: actorId, isGuest: false })
  if (relation !== 'owner' && relation !== 'admin') throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  const token = generateLibraryInviteToken()
  const now = Date.now()
  getDb().transaction((tx) => {
    tx.delete(libraryInvites).where(eq(libraryInvites.libraryId, libraryId)).run()
    tx.insert(libraryInvites).values({
      id: createId('lbi'), libraryId, userId: library.userId,
      token, createdAt: now,
    }).run()
  })
  return { token, createdAt: now }
}

export function revokeLibraryInvite(actorId: string, libraryId: string) {
  const library = getLibraryRow(libraryId)
  if (library.type !== 'shared' || library.visibility !== 'private') {
    throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  }
  const relation = resolveRelation(library, membershipOf(libraryId, actorId), { userId: actorId, isGuest: false })
  if (relation !== 'owner' && relation !== 'admin') throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  getDb().update(libraryInvites).set({ revokedAt: Date.now() }).where(eq(libraryInvites.libraryId, libraryId)).run()
  return { active: false, createdAt: null, token: null }
}

export function previewLibraryInvite(userId: string, token: string) {
  const db = getDb()
  const invite = db.select().from(libraryInvites)
    .where(and(eq(libraryInvites.token, token), isNull(libraryInvites.revokedAt))).get()
  if (!invite) throw new AppError('LIBRARY_NOT_FOUND', 'Invitation not found')
  const library = getLibraryRow(invite.libraryId)
  if (library.type !== 'shared' || library.visibility !== 'private') {
    throw new AppError('LIBRARY_NOT_FOUND', 'Invitation not found')
  }
  const membership = membershipOf(library.id, userId)
  // Same reader-scoped counts the library list rows carry, so what an invitee is
  // told about the library matches what a member sees.
  const stats = libraryListStats(
    { userId, isGuest: false },
    [library],
    new Map(membership ? [[library.id, membership]] : []),
  ).get(library.id)
  return {
    libraryId: library.id,
    name: library.name,
    description: library.description,
    relation: resolveRelation(library, membership, { userId, isGuest: false }),
    memberCount: stats?.memberCount ?? 1,
    workCount: stats?.workCount ?? 0,
  }
}

export function joinLibraryByInvite(userId: string, token: string) {
  getTargetUser(userId)
  const db = getDb()
  return db.transaction((tx) => {
    const invite = tx.select().from(libraryInvites)
      .where(and(eq(libraryInvites.token, token), isNull(libraryInvites.revokedAt))).get()
    if (!invite) throw new AppError('LIBRARY_NOT_FOUND', 'Invitation not found')
    const library = tx.select().from(libraries).where(eq(libraries.id, invite.libraryId)).get()
    if (!library || library.type !== 'shared' || library.visibility !== 'private') {
      throw new AppError('LIBRARY_NOT_FOUND', 'Invitation not found')
    }
    if (library.userId === userId) return { libraryId: library.id, relation: 'owner' as const }
    const existing = tx.select().from(libraryMemberships)
      .where(and(eq(libraryMemberships.libraryId, library.id), eq(libraryMemberships.userId, userId))).get()
    if (existing) return { libraryId: library.id, relation: existing.role }
    const now = Date.now()
    tx.insert(libraryMemberships).values({
      id: createId('lbm'), libraryId: library.id, userId,
      role: 'member', createdAt: now, updatedAt: now,
    }).run()
    return { libraryId: library.id, relation: 'member' as const }
  })
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
  if (!target) throw new AppError('USER_NOT_FOUND', 'User not found')
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
    tx.update(libraryInvites).set({ userId: targetId }).where(eq(libraryInvites.libraryId, libraryId)).run()
    tx.insert(libraryMemberships).values({
      id: createId('lbm'), libraryId, userId: actorId, role: 'admin',
      createdAt: now, updatedAt: now,
    }).run()
  })
  return toLibraryRes(db.select().from(libraries).where(eq(libraries.id, libraryId)).get()!)
}
