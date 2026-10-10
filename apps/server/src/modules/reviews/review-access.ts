import { and, asc, desc, eq, isNull } from 'drizzle-orm'

import type {
  LibraryRelation,
  Review,
  ReviewAuthor,
  ReviewComposerContext,
  ReviewProvenance,
  ReviewSourceRef,
} from '@bookdock/shared'
import { REVIEW_RATINGS, REVIEW_VISIBILITY_KEY, reviewHalvesToRating } from '@bookdock/shared'

import { getDb } from '../../db/client'
import {
  bookReviewComments,
  bookReviewLikes,
  bookReviews,
  contentRevisions,
  instance,
  libraries,
  libraryBooks,
  libraryBookVersions,
  settings,
  users,
} from '../../db/schema'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'
import { assertReadableBook } from '../books/books.service'
import { assertSharedLibraryVisible, resolveLibraryRelation, resolveSharedVersionRead } from '../libraries/library-access'
import { isWorkEffectivelyHidden } from '../libraries/library-query'

type ReviewRow = typeof bookReviews.$inferSelect

export function reviewAuthor(userId: string | null): ReviewAuthor {
  if (!userId) return { id: '', name: 'Deleted user', avatarKey: null }
  const user = getDb().select().from(users).where(eq(users.id, userId)).get()
  if (!user) return { id: userId, name: 'Deleted user', avatarKey: null }
  return { id: user.id, name: user.username, avatarKey: user.avatarKey }
}

/** The caller's live private link for one BookVersion, if any. */
export function privateReviewLink(userId: string, bookVersionId: string) {
  const db = getDb()
  const library = db
    .select({ id: libraries.id })
    .from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private')))
    .get()
  if (!library) return null
  return (
    db
      .select({ link: libraryBookVersions, work: libraryBooks })
      .from(libraryBookVersions)
      .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
      .where(
        and(
          eq(libraryBookVersions.libraryId, library.id),
          eq(libraryBookVersions.bookVersionId, bookVersionId),
          isNull(libraryBooks.deletedAt),
        ),
      )
      .get() ?? null
  )
}

/**
 * Resolve a collected B link to its source work. A dangling source (deleted
 * listing or library) is null, not an error: the review stays put and shared
 * access simply closes.
 */
export function sourceWorkOf(link: { sourceLibraryId: string | null; sourceLibraryBookVersionId: string | null }) {
  if (!link.sourceLibraryId || !link.sourceLibraryBookVersionId) return null
  const db = getDb()
  const source = db
    .select()
    .from(libraryBookVersions)
    .where(
      and(
        eq(libraryBookVersions.id, link.sourceLibraryBookVersionId),
        eq(libraryBookVersions.libraryId, link.sourceLibraryId),
      ),
    )
    .get()
  if (!source) return null
  return { libraryId: link.sourceLibraryId, libraryBookId: source.libraryBookId }
}

/**
 * Exact-listing publish eligibility: the collector's own source listing must
 * still resolve and read. Other versions of the same work being readable
 * never substitutes for the listing this holding was collected from.
 */
export async function assertOwnListingReadable(
  userId: string,
  link: { sourceLibraryId: string | null; sourceLibraryBookVersionId: string | null },
): Promise<void> {
  if (!link.sourceLibraryId || !link.sourceLibraryBookVersionId) throw new AppError('REVIEW_NOT_FOUND')
  const listing = getDb()
    .select()
    .from(libraryBookVersions)
    .where(
      and(
        eq(libraryBookVersions.id, link.sourceLibraryBookVersionId),
        eq(libraryBookVersions.libraryId, link.sourceLibraryId),
      ),
    )
    .get()
  if (!listing) throw new AppError('REVIEW_NOT_FOUND')
  try {
    const read = await resolveSharedVersionRead(link.sourceLibraryId, listing.bookVersionId, userId)
    if (read.link.id !== link.sourceLibraryBookVersionId) throw new AppError('REVIEW_NOT_FOUND')
  } catch (error) {
    if (error instanceof AppError) throw new AppError('REVIEW_NOT_FOUND')
    throw error
  }
}

/** Any live holding of a source work whose own listing still reads. Trashed
 * private cards never qualify: only live holdings count for re-sharing. */
export async function authorHoldingReadable(
  userId: string,
  sourceLibraryId: string,
  sourceLibraryBookId: string,
): Promise<boolean> {
  const db = getDb()
  const holdings = db
    .select({ link: libraryBookVersions })
    .from(libraryBookVersions)
    .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
    .where(
      and(
        eq(libraries.userId, userId),
        eq(libraries.type, 'private'),
        eq(libraryBookVersions.kind, 'shared'),
        eq(libraryBookVersions.sourceLibraryId, sourceLibraryId),
        isNull(libraryBooks.deletedAt),
      ),
    )
    .all()
    .map((row) => row.link)
  if (holdings.length === 0) return false
  // One round trip for the work's listings instead of resolving every holding
  // to its work first; only holdings of this work pay for a verdict.
  const targets = new Set(
    db
      .select({ id: libraryBookVersions.id })
      .from(libraryBookVersions)
      .where(
        and(
          eq(libraryBookVersions.libraryId, sourceLibraryId),
          eq(libraryBookVersions.libraryBookId, sourceLibraryBookId),
        ),
      )
      .all()
      .map((row) => row.id),
  )
  for (const link of holdings) {
    if (!link.sourceLibraryBookVersionId || !targets.has(link.sourceLibraryBookVersionId)) continue
    try {
      await assertOwnListingReadable(userId, link)
      return true
    } catch (error) {
      if (!(error instanceof AppError)) throw error
    }
  }
  return false
}

export interface SourceWorkRead {
  library: typeof libraries.$inferSelect
  work: typeof libraryBooks.$inferSelect
  relation: LibraryRelation
  /** Version links of this work the viewer may currently read. */
  readableLinkIds: string[]
}

/**
 * Work-level review ACL. Unlike the idea ACL (one exact listing), a review
 * opens while the source library is visible to the viewer, the work is live,
 * and at least one version of the work is currently readable (published and
 * effectively visible; managers bypass hidden and unlisted; guests
 * additionally need the instance switch plus a guest-readable listing of this
 * work). Anything else is REVIEW_NOT_FOUND, never a FORBIDDEN that confirms
 * existence.
 */
export async function assertSourceWorkReadable(
  userId: string | null,
  sourceLibraryId: string,
  sourceLibraryBookId: string,
): Promise<SourceWorkRead> {
  const db = getDb()
  const library = db.select().from(libraries).where(eq(libraries.id, sourceLibraryId)).get()
  if (!library || library.type !== 'shared') throw new AppError('REVIEW_NOT_FOUND')
  const relation = await resolveLibraryRelation(sourceLibraryId, { userId })
  try {
    assertSharedLibraryVisible(library, relation)
  } catch {
    throw new AppError('REVIEW_NOT_FOUND')
  }
  const work = db
    .select()
    .from(libraryBooks)
    .where(and(eq(libraryBooks.id, sourceLibraryBookId), eq(libraryBooks.libraryId, sourceLibraryId)))
    .get()
  if (!work || work.deletedAt) throw new AppError('REVIEW_NOT_FOUND')
  const manager = relation === 'owner' || relation === 'admin'
  const hidden = manager ? false : isWorkEffectivelyHidden(db, sourceLibraryId, work)
  const guestSettings = relation === 'guest' ? db.select().from(instance).get() : null
  const links = db
    .select()
    .from(libraryBookVersions)
    .where(
      and(
        eq(libraryBookVersions.libraryId, sourceLibraryId),
        eq(libraryBookVersions.libraryBookId, sourceLibraryBookId),
      ),
    )
    .orderBy(asc(libraryBookVersions.createdAt), asc(libraryBookVersions.id))
    .all()
  const readable = links.filter((link) => {
    if (manager) return true
    if (link.status !== 'published') return false
    if (hidden) return false
    if (relation === 'guest' && (!guestSettings?.allowGuestAccess || !link.guestReadable)) return false
    return true
  })
  if (readable.length === 0) throw new AppError('REVIEW_NOT_FOUND')
  return { library, work, relation, readableLinkIds: readable.map((link) => link.id) }
}

/** Read-time provenance display: re-resolves its listing, never leaks metadata. */
async function resolveProvenance(row: ReviewRow, viewerId: string | null): Promise<ReviewProvenance | null> {
  if (!row.sourceLibraryId) return null
  const base: ReviewProvenance = {
    listingId: viewerId === row.userId ? row.readListingId : null,
    bookVersionId: viewerId === row.userId ? row.readBookVersionId : null,
    revisionId: viewerId === row.userId ? row.readRevisionId : null,
    versionName: null,
    available: false,
  }
  if (!row.sourceLibraryId || !row.readListingId || !row.readBookVersionId) return base
  const listing = getDb()
    .select()
    .from(libraryBookVersions)
    .where(and(eq(libraryBookVersions.id, row.readListingId), eq(libraryBookVersions.libraryId, row.sourceLibraryId)))
    .get()
  if (!listing || listing.bookVersionId !== row.readBookVersionId) return base
  try {
    await resolveSharedVersionRead(row.sourceLibraryId, row.readBookVersionId, viewerId)
  } catch {
    return base
  }
  const revision = row.readRevisionId ? getDb().select().from(contentRevisions)
    .where(and(eq(contentRevisions.id, row.readRevisionId), eq(contentRevisions.bookVersionId, row.readBookVersionId))).get() : null
  if (!revision) return base
  return { ...base, listingId: row.readListingId, bookVersionId: row.readBookVersionId, revisionId: row.readRevisionId, versionName: listing.name || null, available: true }
}

export async function projectReview(
  userId: string | null,
  row: ReviewRow,
  manager: boolean,
  preset?: {
    /**
     * Work ACL pre-resolved by the caller (list paths assert once per work,
     * not once per row): skips the per-row readability re-check and the
     * library-name lookup. Single-row callers omit this and pay per row.
     */
    libraryName?: string | null
    likes?: Array<typeof bookReviewLikes.$inferSelect>
    commentCount?: number
    author?: ReviewAuthor
  },
): Promise<Review> {
  const db = getDb()
  const likes = preset?.likes ??
    db.select().from(bookReviewLikes).where(eq(bookReviewLikes.reviewId, row.id)).all()
  const commentCount = preset?.commentCount ??
    db
      .select({ id: bookReviewComments.id })
      .from(bookReviewComments)
      .where(and(eq(bookReviewComments.reviewId, row.id), isNull(bookReviewComments.deletedAt)))
      .all().length
  let source: ReviewSourceRef | null = null
  if (row.sourceLibraryId && row.sourceLibraryBookId) {
    let libraryName: string | null = null
    if (preset && preset.libraryName !== undefined) {
      libraryName = preset.libraryName
    } else {
      // Live source metadata needs current read permission of its own: holding
      // the review never implies holding the library or work. The retained
      // rating, body and discussion below stay visible regardless.
      try {
        await assertSourceWorkReadable(userId, row.sourceLibraryId, row.sourceLibraryBookId)
        libraryName = db.select().from(libraries).where(eq(libraries.id, row.sourceLibraryId)).get()?.name ?? null
      } catch (error) {
        if (!(error instanceof AppError)) throw error
      }
    }
    source = { libraryId: row.sourceLibraryId, libraryBookId: row.sourceLibraryBookId, libraryName }
  }
  const provenance = await resolveProvenance(row, userId)
  return {
    id: row.id,
    rating: row.ratingHalves == null ? null : reviewHalvesToRating(row.ratingHalves),
    body: row.body,
    bodyFormat: row.bodyFormat,
    visibility: row.visibility,
    source,
    privateLibraryBookId: row.privateLibraryBookId,
    provenance,
    author: preset?.author ?? reviewAuthor(row.userId),
    own: row.userId === userId,
    canDelete: row.userId === userId || manager,
    likeCount: likes.length,
    liked: likes.some((like) => like.userId === userId),
    commentCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    editedAt: row.editedAt,
  }
}

/**
 * Review ACL: private rows (either anchor with visibility private) are
 * author-only, including from library managers. Shared source rows require
 * current source-work readability; the author always reads their own.
 */
export async function readableReview(userId: string | null, id: string) {
  const row = getDb().select().from(bookReviews).where(eq(bookReviews.id, id)).get()
  if (!row) throw new AppError('REVIEW_NOT_FOUND')
  if (row.visibility === 'private') {
    if (userId !== row.userId) throw new AppError('REVIEW_NOT_FOUND')
    return { row, manager: false }
  }
  if (!row.sourceLibraryId || !row.sourceLibraryBookId) throw new AppError('REVIEW_NOT_FOUND')
  if (userId === row.userId) {
    // Authorship keeps the retained read but never grants management: the
    // manager bit resolves from the current source relation on its own, and a
    // dead source falls back to a plain author read instead of denying it.
    let manager = false
    try {
      const own = await assertSourceWorkReadable(userId, row.sourceLibraryId, row.sourceLibraryBookId)
      manager = own.relation === 'owner' || own.relation === 'admin'
    } catch (error) {
      if (!(error instanceof AppError)) throw error
    }
    return { row, manager }
  }
  const read = await assertSourceWorkReadable(userId, row.sourceLibraryId, row.sourceLibraryBookId)
  return { row, manager: read.relation === 'owner' || read.relation === 'admin' }
}

/** Latest revision id behind a private link (pinned for B, newest otherwise). */
export function reviewReadRevision(
  link: { kind: string; pinnedRevisionId: string | null },
  bookVersionId: string,
): string | null {
  const db = getDb()
  if (link.kind === 'shared' && link.pinnedRevisionId) {
    const pinned = db
      .select()
      .from(contentRevisions)
      .where(and(eq(contentRevisions.id, link.pinnedRevisionId), eq(contentRevisions.bookVersionId, bookVersionId)))
      .get()
    if (pinned) return pinned.id
  }
  return (
    db
      .select()
      .from(contentRevisions)
      .where(eq(contentRevisions.bookVersionId, bookVersionId))
      .orderBy(desc(contentRevisions.revisionNo))
      .get()?.id ?? null
  )
}

export async function reviewComposerContext(userId: string, bookVersionId: string): Promise<ReviewComposerContext> {
  const held = privateReviewLink(userId, bookVersionId)
  if (!held) {
    await assertReadableBook(userId, bookVersionId)
    return { anchor: null, eligible: false, sourceReadable: false, canPublishShared: false, defaultVisibility: 'private', existing: null, bookVersionId: null }
  }
  const db = getDb()
  if (held.link.kind === 'shared' && held.link.sourceLibraryId && held.link.sourceLibraryBookVersionId) {
    const work = sourceWorkOf(held.link)
    let sourceReadable = false
    if (work) {
      try {
        await assertSourceWorkReadable(userId, work.libraryId, work.libraryBookId)
        sourceReadable = true
      } catch (error) {
        if (!(error instanceof AppError)) throw error
      }
    }
    // Publishing shared additionally requires the collector's own listing to
    // still read; sibling versions of the same work never substitute for it.
    let listingReadable = false
    try {
      await assertOwnListingReadable(userId, held.link)
      listingReadable = true
    } catch (error) {
      if (!(error instanceof AppError)) throw error
    }
    const canPublishShared = sourceReadable && listingReadable
    const existing = work
      ? db
          .select()
          .from(bookReviews)
          .where(
            and(
              eq(bookReviews.userId, userId),
              eq(bookReviews.sourceLibraryId, work.libraryId),
              eq(bookReviews.sourceLibraryBookId, work.libraryBookId),
            ),
          )
          .get() ?? null
      : null
    const preference = db
      .select()
      .from(settings)
      .where(and(eq(settings.userId, userId), eq(settings.key, REVIEW_VISIBILITY_KEY)))
      .get()
    return {
      anchor: 'source',
      eligible: true,
      sourceReadable,
      canPublishShared,
      defaultVisibility: canPublishShared && preference?.value !== 'private' ? 'shared' : 'private',
      existing: existing ? await projectReview(userId, existing, false) : null,
      bookVersionId,
    }
  }
  const existing = db
    .select()
    .from(bookReviews)
    .where(and(eq(bookReviews.userId, userId), eq(bookReviews.privateLibraryBookId, held.work.id)))
    .get() ?? null
  return {
    anchor: 'private',
    eligible: true,
    sourceReadable: false,
    canPublishShared: false,
    defaultVisibility: 'private',
    existing: existing ? await projectReview(userId, existing, false) : null,
    bookVersionId,
  }
}

/** Remember the last successful new-review choice; edits and failures never move it. */
export function recordReviewVisibilityPref(userId: string, visibility: 'private' | 'shared') {
  getDb()
    .insert(settings)
    .values({ id: createId('setting'), userId, key: REVIEW_VISIBILITY_KEY, value: visibility })
    .onConflictDoUpdate({ target: [settings.userId, settings.key], set: { value: visibility } })
    .run()
}

export function emptyDistribution(): Array<{ rating: number; count: number }> {
  return REVIEW_RATINGS.map((rating) => ({ rating, count: 0 }))
}
