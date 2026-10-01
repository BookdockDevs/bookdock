import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm'

import type { LibraryRelation } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { blobKeyReferenced, deleteBlobRowIfUnreferenced } from '../../db/blob-refs'
import { bookVersions, contentRevisions, instance, libraries, libraryBooks, libraryBookVersions, libraryMemberships } from '../../db/schema'
import { coverThumbnailKey } from '../../lib/cover'
import { AppError, isUniqueViolation } from '../../middleware/error'
import { getStorage } from '../../storage'
import { createId } from '../../lib/id'
import { isWorkEffectivelyHidden } from './library-query'

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
  try {
    db.insert(libraries).values({
      id, userId, type: 'private', name: '',
      description: '', visibility: null, createdAt: now, updatedAt: now,
    }).run()
  } catch (err) {
    // Lost a creation race: whoever won owns the row we return. The partial
    // unique index on (userId) WHERE private is the backstop; the re-read
    // below is what makes the loser idempotent instead of 500.
    if (!isUniqueViolation(err)) throw err
    const raced = db.select({ id: libraries.id }).from(libraries)
      .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
    if (raced) return raced.id
    throw err
  }
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
 * Shared-library visibility for browsers: members of any standing and the
 * owner pass; outsiders only see public libraries. Private libraries never
 * reach this helper (owner-only, NOT_FOUND elsewhere).
 */
export function assertSharedLibraryVisible(
  library: { type: string; visibility: 'public' | 'password' | 'private' | null },
  relation: LibraryRelation,
): void {
  if (relation === 'owner' || relation === 'admin' || relation === 'member') return
  if (library.visibility !== 'public') throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
}

export interface ManagedLibrary {
  library: typeof libraries.$inferSelect
  relation: 'owner' | 'admin'
}

/**
 * Management gate for library-scoped taxonomies and content (4.4): owners
 * and admins only. Private libraries resolve like any other row here — the
 * owner passes, everyone else is refused without leaking existence.
 */
export async function requireLibraryManager(actorId: string, libraryId: string): Promise<ManagedLibrary> {
  const db = getDb()
  const library = db.select().from(libraries).where(eq(libraries.id, libraryId)).get()
  if (!library) throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  if (library.type === 'private' && library.userId !== actorId) {
    throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  }
  if (library.type === 'private') return { library, relation: 'owner' }
  const membership = db.select({ role: libraryMemberships.role }).from(libraryMemberships)
    .where(and(eq(libraryMemberships.libraryId, libraryId), eq(libraryMemberships.userId, actorId))).get()
  const relation = library.userId === actorId ? 'owner' : membership?.role
  if (relation !== 'owner' && relation !== 'admin') {
    throw new AppError('FORBIDDEN', 'Only owners and admins can manage this library')
  }
  return { library, relation }
}

/**
 * Boolean manager check for read filtering: managers see hidden rows
 * (badged), everyone else does not. Permission/topology denials mean "not a
 * manager"; anything else is a real failure and must not masquerade as one.
 */
export async function isLibraryManager(actorId: string, libraryId: string): Promise<boolean> {
  try {
    await requireLibraryManager(actorId, libraryId)
    return true
  } catch (err) {
    if (err instanceof AppError) return false
    throw err
  }
}

/**
 * Shared-library trash settings, resolved with private-style defaults: NULL
 * means enabled on, 30d retention, unlimited capacity.
 */
export function getLibraryTrashSettings(library: typeof libraries.$inferSelect): {
  enabled: boolean
  autoCleanDays: number
  maxTrashBytes: number
} {
  return {
    enabled: library.trashEnabled ?? true,
    autoCleanDays: library.trashAutoCleanDays ?? 30,
    maxTrashBytes: library.trashMaxBytes ?? 0,
  }
}

export function isLibraryTrashEnabled(library: typeof libraries.$inferSelect): boolean {
  return getLibraryTrashSettings(library).enabled
}

/**
 * Shared-library trash gate: only the library owner lists, restores, empties
 * or permanently deletes trashed works, or edits trash settings. Admins move
 * normal works into the trash through the manager delete path but never open
 * it; members never see it.
 */
export async function requireLibraryOwner(actorId: string, libraryId: string): Promise<ManagedLibrary> {
  const db = getDb()
  const library = db.select().from(libraries).where(eq(libraries.id, libraryId)).get()
  if (!library) throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  if (library.type === 'private') throw new AppError('FORBIDDEN', 'Only shared libraries have an owner trash')
  if (library.userId !== actorId) throw new AppError('FORBIDDEN', 'Only the library owner can manage the trash')
  return { library, relation: 'owner' as const }
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

/**
 * Library-scoped version read (4.5): the single verdict every content,
 * cover, annotation and reading route uses. Anything that must not be seen
 * is LIBRARY_NOT_FOUND / LIBRARY_VERSION_NOT_FOUND — never a FORBIDDEN that
 * confirms existence, and never metadata about other libraries.
 *
 * - Private libraries never enter here (owner-only resolvePrivateBook path).
 * - Owners and admins read every version of their own libraries, hidden ones
 *   included: hiding is a member-facing switch, not a read ban. Members read
 *   published versions of non-hidden works; an unlisted version or an
 *   effectively hidden work disappears from their direct reads (pinned B reads
 *   bypass through Phase 7, not here).
 * - Authenticated non-members read published versions of public libraries,
 *   independent of the instance guest switch.
 * - Guests additionally need the instance guest switch and this listing's own
 *   guestReadable flag — never another library's copy of the same version.
 * Permissions are re-read from the database on every call.
 */
export interface SharedVersionRead {
  library: typeof libraries.$inferSelect
  link: typeof libraryBookVersions.$inferSelect
  relation: LibraryRelation
}

function resolveSharedVersionReadInternal(
  libraryId: string,
  bookVersionId: string,
  userId: string | null,
): SharedVersionRead {
  const db = getDb()
  const library = db.select().from(libraries).where(eq(libraries.id, libraryId)).get()
  if (!library || library.type === 'private') throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  let relation: LibraryRelation
  if (!userId) {
    relation = 'guest'
  } else if (library.userId === userId) {
    relation = 'owner'
  } else {
    const membership = db.select({ role: libraryMemberships.role }).from(libraryMemberships)
      .where(and(eq(libraryMemberships.libraryId, libraryId), eq(libraryMemberships.userId, userId))).get()
    relation = membership?.role ?? 'non-member'
  }
  if ((relation === 'non-member' || relation === 'guest') && library.visibility !== 'public') {
    throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  }
  const link = db.select().from(libraryBookVersions)
    .where(and(eq(libraryBookVersions.libraryId, libraryId), eq(libraryBookVersions.bookVersionId, bookVersionId))).get()
  if (!link) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
  // Trash binds every relation: a trashed work reads as deleted until restored.
  const trashedWork = db.select({ deletedAt: libraryBooks.deletedAt }).from(libraryBooks)
    .where(eq(libraryBooks.id, link.libraryBookId)).get()
  if (!trashedWork || trashedWork.deletedAt) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
  const manager = relation === 'owner' || relation === 'admin'
  // Both hides bind members only. A manager curates a library and must keep
  // reading, downloading and collecting what they hid, so neither the version
  // status nor the effective work hide closes the gate for them.
  if (!manager) {
    if (link.status !== 'published') throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
    const work = db.select().from(libraryBooks).where(eq(libraryBooks.id, link.libraryBookId)).get()
    if (!work || isWorkEffectivelyHidden(db, libraryId, work)) {
      throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
    }
  }
  if (relation === 'guest') {
    const settings = db.select().from(instance).get()
    // Per-listing flag: this library's own switch, never a sibling library's.
    if (!settings?.allowGuestAccess || !link.guestReadable) {
      throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
    }
  }
  return { library, link, relation }
}

export async function resolveSharedVersionRead(
  libraryId: string,
  bookVersionId: string,
  userId: string | null,
): Promise<SharedVersionRead> {
  return resolveSharedVersionReadInternal(libraryId, bookVersionId, userId)
}

export interface SourceReadVerdict {
  readable: boolean
  /** Retained source identity, even when it no longer resolves. */
  sourceLibraryId: string | null
  sourceLibraryBookVersionId: string | null
}

/**
 * B source readability: the pinned source version must still resolve inside
 * its library, and the reader must still be allowed to read it there. The
 * verdict delegates to resolveSharedVersionRead so visibility, publish state
 * and the guest switch have exactly one implementation — an earlier version of
 * this helper only accepted owner/admin/member and wrongly refused
 * non-members of a public library (found when Phase 7 wired it in).
 *
 * A dangling source is not an error here: the B row keeps its provenance and
 * reads as unavailable.
 */
function resolveSourceReadVerdict(
  version: { sourceLibraryId: string | null; sourceLibraryBookVersionId: string | null },
  identity: RequestIdentity,
): SourceReadVerdict {
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
  if (!source) return verdict
  try {
    resolveSharedVersionReadInternal(version.sourceLibraryId, source.bookVersionId, identity.userId)
  } catch (err) {
    // Permission and topology denials are the verdict; anything else (a
    // database or system failure) must not masquerade as "source gone".
    if (err instanceof AppError) return verdict
    throw err
  }
  return { ...verdict, readable: true }
}

export async function resolveSourceRead(
  version: { sourceLibraryId: string | null; sourceLibraryBookVersionId: string | null },
  identity: RequestIdentity,
): Promise<SourceReadVerdict> {
  return resolveSourceReadVerdict(version, identity)
}

export function resolveSourceReadSync(
  version: { sourceLibraryId: string | null; sourceLibraryBookVersionId: string | null },
  identity: RequestIdentity,
): SourceReadVerdict {
  return resolveSourceReadVerdict(version, identity)
}

/** The caller's private-library row for one BookVersion, if any. */
function getPrivateLink(userId: string, bookVersionId: string) {
  const db = getDb()
  const library = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (!library) return null
  const link = db.select().from(libraryBookVersions)
    .where(and(
      eq(libraryBookVersions.libraryId, library.id),
      eq(libraryBookVersions.bookVersionId, bookVersionId),
    )).get()
  return link ?? null
}

/**
 * 7.2 read gate: a B whose source was unlisted, deleted or lost membership
 * stays in the private library as a card but must not serve content. A and C
 * are always readable — they own their content.
 *
 * Lives here (not in collect.service) so the books domain can consume the
 * verdict without importing an action service: cross-domain reads go through
 * this access layer, action orchestration stays in collect.service.
 */
export async function sourceStillReadable(userId: string, bookVersionId: string): Promise<boolean> {
  const link = getPrivateLink(userId, bookVersionId)
  if (!link || link.kind !== 'shared') return true
  const verdict = await resolveSourceRead(
    { sourceLibraryId: link.sourceLibraryId, sourceLibraryBookVersionId: link.sourceLibraryBookVersionId },
    { userId },
  )
  return verdict.readable
}

export function sourceStillReadableSync(userId: string, bookVersionId: string): boolean {
  const link = getPrivateLink(userId, bookVersionId)
  if (!link || link.kind !== 'shared') return true
  return resolveSourceReadSync(
    { sourceLibraryId: link.sourceLibraryId, sourceLibraryBookVersionId: link.sourceLibraryBookVersionId },
    { userId },
  ).readable
}

/**
 * 7.x write gate: a library reference is read-only in content terms. Appending
 * or re-chaptering writes a new revision of a BookVersion the whole city
 * shares, so it must never run from a private B.
 */
export function assertMutableContent(kind: string): void {
  if (kind === 'shared') {
    throw new AppError('FORBIDDEN', 'This book comes from a shared library; its content is managed by the library')
  }
}

/**
 * Stage 5 owns-source verdict: versions published from a book the caller
 * still holds privately read as already-owned while the city still serves that
 * book's own bytes. Shared by the collect refusal and the catalog `ownsSource`
 * marking so the button and the action can never disagree.
 *
 * The test is byte identity between the city's current revision and the
 * source's current revision — never a revision count. A revision that reuses
 * the blob (a metadata reset) appends history without changing content, and
 * counting it as "the city moved on" would unblock a duplicate collect of the
 * very book the caller already holds.
 */
export function getOwnsSourceVersionIds(
  actorId: string,
  links: Array<{ bookVersionId: string; sourceBaseVersionId: string | null }>,
): Set<string> {
  const db = getDb()
  const owns = new Set<string>()
  const candidates = links.filter((l) => l.sourceBaseVersionId)
  if (candidates.length === 0) return owns
  const privateLibrary = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, actorId), eq(libraries.type, 'private'))).get()
  if (!privateLibrary) return owns
  // A trashed original counts as gone: holdings must be live cards.
  const holdings = new Set(
    db.select({ bookVersionId: libraryBookVersions.bookVersionId }).from(libraryBookVersions)
      .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
      .where(and(
        eq(libraryBookVersions.libraryId, privateLibrary.id),
        inArray(libraryBookVersions.bookVersionId, [...new Set(candidates.map((l) => l.sourceBaseVersionId as string))]),
        ne(libraryBookVersions.kind, 'shared'),
        isNull(libraryBooks.deletedAt),
      )).all().map((r) => r.bookVersionId),
  )
  if (holdings.size === 0) return owns
  const heldSources = [...new Set(candidates.map((l) => l.sourceBaseVersionId as string))].filter((id) => holdings.has(id))
  if (heldSources.length === 0) return owns
  const latestBlob = new Map<string, string>()
  for (const row of db.select({ bookVersionId: contentRevisions.bookVersionId, blobKey: contentRevisions.blobKey }).from(contentRevisions)
    .where(inArray(contentRevisions.bookVersionId, [...new Set([...candidates.map((l) => l.bookVersionId), ...heldSources])]))
    .orderBy(desc(contentRevisions.revisionNo)).all()) {
    if (!latestBlob.has(row.bookVersionId)) latestBlob.set(row.bookVersionId, row.blobKey)
  }
  for (const link of candidates) {
    if (!holdings.has(link.sourceBaseVersionId as string)) continue
    const cityBlob = latestBlob.get(link.bookVersionId)
    const sourceBlob = latestBlob.get(link.sourceBaseVersionId as string)
    if (cityBlob && sourceBlob && cityBlob === sourceBlob) owns.add(link.bookVersionId)
  }
  return owns
}

/**
 * Contributor gate for shared-library content (Stage 6): managers always;
 * members only when the library opened member uploads — for a new upload, or
 * for an existing version only its uploader. Guests/outsiders never
 * contribute. Private libraries stay owner-only.
 *
 * The verdict is one pure predicate so the write endpoints and the catalog
 * affordance (`CatalogVersion.maintainable`) can never disagree about who may
 * change a version's content. `relation` and the library row are resolved here
 * so both callers pass the same inputs.
 */
export type ContributorRelation = 'owner' | 'admin' | 'member' | 'none'

export function resolveContributorRelation(
  libraryOwnerId: string,
  actorId: string,
  memberRole: 'admin' | 'member' | undefined,
): ContributorRelation {
  if (libraryOwnerId === actorId) return 'owner'
  if (memberRole === 'admin') return 'admin'
  if (memberRole === 'member') return 'member'
  return 'none'
}

export interface ContributorLibrary {
  type: string
  userId: string
  allowMemberUpload: boolean | null
}

/** Library-level content lane: may this actor add or curate content here? */
export function canContributeToLibrary(
  actorId: string,
  library: ContributorLibrary,
  relation: ContributorRelation,
): boolean {
  if (library.type === 'private') return library.userId === actorId
  if (relation === 'owner' || relation === 'admin') return true
  return relation === 'member' && library.allowMemberUpload === true
}

/**
 * Version-level content right, on top of that lane: managers everywhere, a
 * member only for the versions they uploaded. A null `link` is a library-scoped
 * action (a new upload), which the lane alone covers.
 */
export function canContributeToVersion(
  actorId: string,
  library: ContributorLibrary,
  relation: ContributorRelation,
  link: { userId: string | null } | null,
): boolean {
  if (!canContributeToLibrary(actorId, library, relation)) return false
  if (relation === 'owner' || relation === 'admin') return true
  return link === null || link.userId === actorId
}

/**
 * Every link in `links` this actor may change the content of. Pure filtering
 * over rows the caller already loaded, so a catalog page costs no extra query.
 */
export function getMaintainableVersionLinkIds(
  actorId: string,
  library: ContributorLibrary,
  relation: ContributorRelation,
  links: Array<{ id: string; userId: string | null }>,
): Set<string> {
  const maintainable = new Set<string>()
  for (const link of links) {
    if (canContributeToVersion(actorId, library, relation, link)) maintainable.add(link.id)
  }
  return maintainable
}

export async function assertCanContribute(actorId: string, libraryId: string, versionLinkId?: string): Promise<void> {
  const db = getDb()
  const library = db.select().from(libraries).where(eq(libraries.id, libraryId)).get()
  if (!library) throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  if (library.type === 'private' && library.userId !== actorId) {
    throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  }
  // Owners and admins never need the membership row, and an owner must not pay
  // for it: the relation is resolved before any second query.
  const memberRole = library.userId === actorId
    ? undefined
    : db.select({ role: libraryMemberships.role }).from(libraryMemberships)
        .where(and(eq(libraryMemberships.libraryId, libraryId), eq(libraryMemberships.userId, actorId))).get()?.role
  const relation = resolveContributorRelation(library.userId, actorId, memberRole)
  const link = versionLinkId
    ? db.select({ userId: libraryBookVersions.userId }).from(libraryBookVersions)
        .where(and(eq(libraryBookVersions.id, versionLinkId), eq(libraryBookVersions.libraryId, libraryId))).get() ?? null
    : null
  if (canContributeToVersion(actorId, library, relation, link)) return
  // One verdict, two refusals: a closed lane reads as "this library is not
  // yours to curate", a member reaching someone else's version reads only as
  // "that version is not yours".
  throw new AppError(
    'FORBIDDEN',
    relation === 'member' && library.allowMemberUpload
      ? 'Only the uploader can maintain this version'
      : 'Only owners and admins can manage this library',
  )
}

/**
 * Version end-of-life (5.6 lifecycle template): drop every version no library
 * lists anymore, with its revisions, then release each physical file whose key
 * has no remaining reference. Callers delete the library rows first and pass
 * the versions that lost their last listing; still-listed versions are kept,
 * so removing one card can never pull another library's content.
 *
 * Cleanup runs after the caller's transaction: a rollback must not leave
 * files missing, and a failure here leaves an unreferenced blob rather than a
 * dangling revision. Revisions go before the reference check — checking first
 * always sees the rows being removed and keeps even exclusive blobs forever.
 */
export async function deleteOrphanedBookVersions(versionIds: string[], opts?: { coverKeys?: string[] }): Promise<string[]> {
  const db = getDb()
  const storage = getStorage()
  const doomed = versionIds.filter((id) => !db.select({ id: libraryBookVersions.id }).from(libraryBookVersions)
    .where(eq(libraryBookVersions.bookVersionId, id)).get())
  const keys = [...(opts?.coverKeys ?? [])]
  for (const versionId of doomed) {
    for (const revision of db.select().from(contentRevisions).where(eq(contentRevisions.bookVersionId, versionId)).all()) {
      keys.push(revision.blobKey)
      // A collected B may still pin one of these revisions by id; clear the
      // pin so the delete cannot hit the NO ACTION reference. The card keeps
      // its text provenance and reads as source-unavailable.
      db.update(libraryBookVersions).set({ pinnedRevisionId: null })
        .where(eq(libraryBookVersions.pinnedRevisionId, revision.id)).run()
    }
    db.delete(contentRevisions).where(eq(contentRevisions.bookVersionId, versionId)).run()
    db.delete(bookVersions).where(eq(bookVersions.id, versionId)).run()
  }
  for (const key of new Set(keys)) {
    if (blobKeyReferenced(key)) continue
    if (await storage.exists(key)) await storage.delete(key)
    deleteBlobRowIfUnreferenced(key)
    const thumbKey = coverThumbnailKey(key)
    if (thumbKey !== key && await storage.exists(thumbKey)) await storage.delete(thumbKey)
  }
  return doomed
}

/**
 * Browse gate for library taxonomies (4.7): the owner passes everywhere,
 * members pass inside their libraries, and outsiders only enter public
 * ones. Mutations stay behind requireLibraryManager.
 */
export async function assertLibraryBrowsable(actorId: string, libraryId: string) {
  const db = getDb()
  const library = db.select().from(libraries).where(eq(libraries.id, libraryId)).get()
  if (!library) throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  if (library.type === 'private') {
    if (library.userId !== actorId) throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
    return library
  }
  if (library.userId === actorId) return library
  const membership = db.select({ id: libraryMemberships.id }).from(libraryMemberships)
    .where(and(eq(libraryMemberships.libraryId, libraryId), eq(libraryMemberships.userId, actorId))).get()
  if (!membership && library.visibility !== 'public') {
    throw new AppError('LIBRARY_NOT_FOUND', 'Library not found')
  }
  return library
}
