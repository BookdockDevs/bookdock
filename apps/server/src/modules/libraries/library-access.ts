import { and, eq } from 'drizzle-orm'

import type { LibraryRelation } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { libraries, libraryBookVersions, libraryMemberships } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'

/**
 * Phase 1 domain permission base (1.8): identity, library membership and
 * version/source readability expressed in one place so Phase 4+ routes and
 * services share the same verdicts. Visibility policy (public/password/
 * private) and write rules land in Phase 4; this file only computes the
 * relation and the two read verdicts every caller needs.
 *
 * `userId: null` is an anonymous guest. Today's guard still injects the
 * shared default user, so callers map that to null until 3.11 switches
 * the context over.
 */
export interface RequestIdentity {
  userId: string | null
}

/**
 * Shared library-domain helper (1.8 exception to the no-cross-module-imports
 * rule: every domain module resolves libraries through this file, never
 * through another domain's service). Returns the private library id,
 * creating it on demand for accounts predating the seed.
 */
export function ensurePrivateLibrary(db: ReturnType<typeof getDb>, userId: string): string {
  const existing = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (existing) return existing.id
  const id = createId('lib')
  const now = Date.now()
  db.insert(libraries).values({
    id, userId, type: 'private', name: userId,
    description: '', visibility: null, createdAt: now, updatedAt: now,
  }).run()
  return id
}

export async function getLibrary(libraryId: string) {
  const db = getDb()
  const library = db.select().from(libraries).where(eq(libraries.id, libraryId)).get()
  if (!library) throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  return library
}

export async function resolveLibraryRelation(libraryId: string, identity: RequestIdentity): Promise<LibraryRelation> {
  const db = getDb()
  const library = await getLibrary(libraryId)
  if (!identity.userId) return 'guest'
  if (library.userId === identity.userId) return 'owner'
  const membership = db.select({ role: libraryMemberships.role }).from(libraryMemberships)
    .where(and(eq(libraryMemberships.libraryId, libraryId), eq(libraryMemberships.userId, identity.userId))).get()
  if (!membership) return 'non-member'
  return membership.role
}

export function requireLibraryRelation(relation: LibraryRelation, allowed: LibraryRelation[]): void {
  if (!allowed.includes(relation)) throw new AppError('FORBIDDEN', 'Not allowed in this library')
}

/**
 * Library-scoped version read: the version must belong to the library,
 * otherwise it is a NOT_FOUND (never a cross-library existence leak).
 */
export async function getLibraryBookVersion(libraryId: string, versionId: string) {
  const db = getDb()
  const version = db.select().from(libraryBookVersions)
    .where(and(eq(libraryBookVersions.id, versionId), eq(libraryBookVersions.libraryId, libraryId))).get()
  if (!version) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
  return version
}

export interface SourceReadVerdict {
  readable: boolean
  /** Retained source identity, even when it no longer resolves. */
  sourceLibraryId: string | null
  sourceLibraryBookVersionId: string | null
}

/**
 * B source readability: the pinned source version must still resolve inside
 * its library and be published, and the reader must still hold a relation
 * there. A dangling source is not an error here — the B row keeps its
 * provenance and reads as unavailable (Phase 7 decision point).
 */
export async function resolveSourceRead(
  version: { sourceLibraryId: string | null; sourceLibraryBookVersionId: string | null },
  identity: RequestIdentity,
): Promise<SourceReadVerdict> {
  const verdict: SourceReadVerdict = {
    readable: false,
    sourceLibraryId: version.sourceLibraryId,
    sourceLibraryBookVersionId: version.sourceLibraryBookVersionId,
  }
  if (!version.sourceLibraryId || !version.sourceLibraryBookVersionId) return verdict
  const db = getDb()
  const source = db.select().from(libraryBookVersions)
    .where(and(
      eq(libraryBookVersions.id, version.sourceLibraryBookVersionId),
      eq(libraryBookVersions.libraryId, version.sourceLibraryId),
    )).get()
  if (!source || source.status !== 'published') return verdict
  const relation = await resolveLibraryRelation(version.sourceLibraryId, identity)
  if (relation === 'non-member' || relation === 'guest') return verdict
  return { ...verdict, readable: true }
}
