import { and, desc, eq, inArray } from 'drizzle-orm'

import { getDb } from '../../db/client'
import {
  bookStates,
  contentRevisions,
  libraryBooks,
  libraryBookTags,
  libraryBookVersions,
  libraryCategories,
  libraryTags,
  libraries,
} from '../../db/schema'
import { AppError, isUniqueViolation } from '../../middleware/error'
import { createId } from '../../lib/id'
import { getLibraryBookVersion, getOwnsSourceVersionIds, resolveSharedVersionRead } from './library-access'
import { getCatalogBook } from './catalog.service'

/**
 * Add-to-private (7.1): one server action turns a shared library's version into
 * a B in the caller's private library. The blob is never copied — B is a
 * reference to the same BookVersion — and the private row is bound to exactly
 * one source for life.
 *
 * Authorization is the shared read verdict (4.5), not a bespoke check: you can
 * only collect what you could already read, so a Non-member of a public library
 * may collect while a Guest (`user = null`) never gets this far.
 */
export interface CollectResult {
  libraryBookId: string
  bookVersionId: string
  /** True when this BookVersion was already in the private library (7.5). */
  alreadyExists: boolean
  /** The single source this B is bound to; unchanged when alreadyExists. */
  sourceLibraryId: string
  sourceLibraryBookVersionId: string
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

export async function addToPrivateLibrary(
  userId: string,
  libraryId: string,
  versionLinkId: string,
  opts?: { categoryId?: string; tagIds?: string[] },
): Promise<CollectResult> {
  const db = getDb()
  // Only a shared library can be collected from; private rows keep NOT_FOUND.
  const link = await getLibraryBookVersion(libraryId, versionLinkId)
  const read = await resolveSharedVersionRead(libraryId, link.bookVersionId, userId)
  const source = read.link

  const privateLibrary = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (!privateLibrary) throw new AppError('BOOK_NOT_FOUND', 'Book not found')

  // (7.5) One B per BookVersion per private library, source-independent: a
  // second city offering the same version returns the existing card and never
  // re-points its provenance.
  const existing = db.select().from(libraryBookVersions)
    .where(and(
      eq(libraryBookVersions.libraryId, privateLibrary.id),
      eq(libraryBookVersions.bookVersionId, link.bookVersionId),
    )).get()
  if (existing) {
    return {
      libraryBookId: existing.libraryBookId,
      bookVersionId: existing.bookVersionId,
      alreadyExists: true,
      sourceLibraryId: existing.sourceLibraryId ?? libraryId,
      sourceLibraryBookVersionId: existing.sourceLibraryBookVersionId ?? versionLinkId,
    }
  }

  // Stage 5: collecting a version published from a book still held privately
  // would duplicate it. While the city hasn't moved past the publish base,
  // refuse with a pointer to the original; a moved city (or a gone original)
  // collects normally — that content is genuinely new to the caller.
  // The predicate lives in getOwnsSourceVersionIds, shared with the catalog
  // verdict, so the button and this refusal always agree.
  if (getOwnsSourceVersionIds(userId, [link]).has(link.bookVersionId)) {
    throw new AppError('ALREADY_OWNS_SOURCE', 'This version was published from a book already in the private library', {
      bookVersionId: link.sourceBaseVersionId,
    })
  }

  if (opts?.categoryId) {
    const category = db.select({ id: libraryCategories.id }).from(libraryCategories)
      .where(and(eq(libraryCategories.id, opts.categoryId), eq(libraryCategories.libraryId, privateLibrary.id))).get()
    if (!category) throw new AppError('SHELF_NOT_FOUND')
  }
  const tagIds = [...new Set(opts?.tagIds ?? [])]
  if (tagIds.length > 0) {
    const found = db.select({ id: libraryTags.id }).from(libraryTags)
      .where(and(eq(libraryTags.libraryId, privateLibrary.id), inArray(libraryTags.id, tagIds))).all()
    if (found.length !== tagIds.length) throw new AppError('TAG_NOT_FOUND')
  }

  // (7.4) Copy the source's effective metadata as the private card's own
  // values. Afterwards the two are independent: the version row keeps null
  // overrides, so it simply inherits whatever the private work says.
  const work = await getCatalogBook(userId, libraryId, source.libraryBookId)
  const version = work.versions.find((v) => v.id === versionLinkId)
  if (!version) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')

  // (7.3) Pin the revision published right now — the latest, not the first.
  // B never follows a later revision on its own, and the private read path
  // resolves this pin.
  const revision = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, link.bookVersionId))
    .orderBy(desc(contentRevisions.revisionNo)).get()
  if (!revision) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')

  const now = Date.now()
  const libraryBookId = createId('lb')
  // The existence check above ran before awaits, so a concurrent collect can
  // slip between it and this write. better-sqlite3 runs each synchronous
  // transaction body without yielding, so the re-check inside is the atomic
  // guard for in-process races; the partial unique index plus the catch below
  // is the backstop for anything else. Either way the loser reports the
  // existing card instead of duplicating or 500ing.
  let raced: typeof libraryBookVersions.$inferSelect | undefined
  try {
    db.transaction((tx) => {
      const fresh = tx.select().from(libraryBookVersions)
        .where(and(
          eq(libraryBookVersions.libraryId, privateLibrary.id),
          eq(libraryBookVersions.bookVersionId, link.bookVersionId),
        )).get()
      if (fresh) {
        raced = fresh
        return
      }
      tx.insert(libraryBooks).values({
        id: libraryBookId, libraryId: privateLibrary.id, userId, categoryId: opts?.categoryId ?? null,
        title: version.effective.title, author: version.effective.author, authors: version.effective.authors,
        description: version.effective.description, coverKey: version.effective.coverKey,
        createdAt: now, updatedAt: now,
      }).run()
      tx.insert(libraryBookVersions).values({
        id: createId('lbv'), libraryId: privateLibrary.id, libraryBookId, bookVersionId: link.bookVersionId,
        kind: 'shared', status: 'published',
        userId,
        // (7.2) The single source, stored as plain text so it survives source
        // deletion; the private card keeps naming it even when unreadable.
        sourceLibraryId: libraryId, sourceLibraryBookVersionId: versionLinkId,
        pinnedRevisionId: revision.id, createdAt: now, updatedAt: now,
      }).run()
      if (tagIds.length > 0) {
        tx.insert(libraryBookTags).values(tagIds.map((tagId) => ({ libraryBookId, tagId }))).run()
      }
      // Collected, not started: the row exists so the card sorts and filters
      // like any other, and reading takes over from here. Reading the version in
      // the library first already created a state row, and that progress is worth
      // more than a fresh 'wishlist', so never overwrite it. A fresh row starts
      // caught up at the pinned revision: the pin is the newest revision, so
      // there is no update to report until the city writes again.
      tx.insert(bookStates).values({
        userId, bookVersionId: link.bookVersionId, readStatus: 'wishlist', percent: 0,
        cfi: null, chapter: null, lastReadAt: null, readRevisionId: revision.id, updatedAt: now,
      }).onConflictDoNothing().run()
    })
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    const found = db.select().from(libraryBookVersions)
      .where(and(
        eq(libraryBookVersions.libraryId, privateLibrary.id),
        eq(libraryBookVersions.bookVersionId, link.bookVersionId),
      )).get()
    if (!found) throw err
    raced = found
  }
  if (raced) {
    return {
      libraryBookId: raced.libraryBookId,
      bookVersionId: raced.bookVersionId,
      alreadyExists: true,
      sourceLibraryId: raced.sourceLibraryId ?? libraryId,
      sourceLibraryBookVersionId: raced.sourceLibraryBookVersionId ?? versionLinkId,
    }
  }
  return {
    libraryBookId,
    bookVersionId: link.bookVersionId,
    alreadyExists: false,
    sourceLibraryId: libraryId,
    sourceLibraryBookVersionId: versionLinkId,
  }
}

/** 7.7: the source's display name for a private B, or null for A/C. */
export async function describeCollectSource(userId: string, bookVersionId: string) {
  const link = getPrivateLink(userId, bookVersionId)
  if (!link || link.kind !== 'shared' || !link.sourceLibraryId) return null
  const db = getDb()
  const source = db.select({ name: libraries.name }).from(libraries)
    .where(eq(libraries.id, link.sourceLibraryId)).get()
  return {
    libraryId: link.sourceLibraryId,
    libraryBookVersionId: link.sourceLibraryBookVersionId,
    // Null once the source library itself is gone: the card keeps its
    // provenance id, the name is simply unavailable.
    libraryName: source?.name ?? null,
  }
}
