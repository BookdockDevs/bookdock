import { and, desc, eq, isNull } from 'drizzle-orm'

import { normalizeCategoryPath, normalizeTagNames, type PublishPrivateBookReq, type PublishPrivateBookRes } from '@bookdock/shared'

import { getDb } from '../../db/client'
import {
  blobs,
  bookVersions,
  contentRevisions,
  libraryBooks,
  libraryBookTagValues,
  libraryBookVersions,
  libraries,
} from '../../db/schema'
import { recordActivityEvent } from '../../lib/activity-events'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'
import { getStorage } from '../../storage'
import { requireLibraryManager } from './library-access'

/**
 * Publish a private A entry as a new shared-library content snapshot. The
 * source work and its content identity are never moved or edited.
 */
export async function publishPrivateBook(
  actorId: string,
  targetLibraryId: string,
  opts: PublishPrivateBookReq,
): Promise<PublishPrivateBookRes> {
  const { library: targetLibrary } = await requireLibraryManager(actorId, targetLibraryId)
  if (targetLibrary.type !== 'shared') {
    throw new AppError('FORBIDDEN', 'Books can only be published to shared libraries')
  }

  const db = getDb()
  const privateLibrary = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, actorId), eq(libraries.type, 'private'))).get()
  if (!privateLibrary) throw new AppError('BOOK_NOT_FOUND', 'Book not found')

  const sourceLink = db.select().from(libraryBookVersions)
    .where(and(
      eq(libraryBookVersions.libraryId, privateLibrary.id),
      eq(libraryBookVersions.bookVersionId, opts.bookId),
      eq(libraryBookVersions.kind, 'personal'),
    )).get()
  if (!sourceLink) throw new AppError('BOOK_NOT_FOUND', 'Book not found')

  const sourceWork = db.select().from(libraryBooks)
    .where(and(
      eq(libraryBooks.id, sourceLink.libraryBookId),
      eq(libraryBooks.libraryId, privateLibrary.id),
      eq(libraryBooks.userId, actorId),
      isNull(libraryBooks.deletedAt),
    )).get()
  if (!sourceWork) throw new AppError('BOOK_NOT_FOUND', 'Book not found')

  const sourceVersion = db.select().from(bookVersions)
    .where(eq(bookVersions.id, sourceLink.bookVersionId)).get()
  const sourceRevision = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, opts.bookId))
    .orderBy(desc(contentRevisions.revisionNo)).get()
  if (!sourceVersion || !sourceRevision) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')

  const contentBlob = db.select({ key: blobs.key }).from(blobs)
    .where(eq(blobs.key, sourceRevision.blobKey)).get()
  if (!contentBlob || !(await getStorage().exists(sourceRevision.blobKey))) {
    throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  }

  // Values need no existence check: a name the target library no longer lists is
  // still a legitimate value to publish under.
  const categoryPath = normalizeCategoryPath(opts.categoryPath ?? null)
  const tags = normalizeTagNames(opts.tags ?? [])

  const sourceTitle = sourceLink.title ?? sourceWork.title
  const sourceAuthor = sourceLink.author ?? sourceWork.author
  const sourceAuthors = sourceLink.authors ?? sourceWork.authors ?? []
  const sourceDescription = sourceLink.description ?? sourceWork.description
  const sourceCoverKey = sourceLink.coverKey ?? sourceWork.coverKey
  const sourceMeta = (sourceRevision.meta ?? {}) as Record<string, unknown>
  const snapshotMeta = {
    ...sourceMeta,
    coverPaletteKey: typeof sourceMeta.coverPaletteKey === 'string' ? sourceMeta.coverPaletteKey : opts.bookId,
  }
  const now = Date.now()
  const newLibraryBookId = createId('lb')
  const newBookVersionId = createId('book')
  const newVersionLinkId = createId('lbv')
  let result: PublishPrivateBookRes | undefined

  db.transaction((tx) => {
    const candidates = tx.select({
      libraryBookId: libraryBookVersions.libraryBookId,
      versionLinkId: libraryBookVersions.id,
      bookVersionId: libraryBookVersions.bookVersionId,
    }).from(libraryBookVersions)
      .innerJoin(contentRevisions, eq(contentRevisions.bookVersionId, libraryBookVersions.bookVersionId))
      .where(and(
        eq(libraryBookVersions.libraryId, targetLibraryId),
        eq(libraryBookVersions.kind, 'personal'),
        eq(contentRevisions.blobKey, sourceRevision.blobKey),
      )).all()
    const duplicate = candidates.find((candidate) => {
      const latest = tx.select({ blobKey: contentRevisions.blobKey }).from(contentRevisions)
        .where(eq(contentRevisions.bookVersionId, candidate.bookVersionId))
        .orderBy(desc(contentRevisions.revisionNo)).get()
      return latest?.blobKey === sourceRevision.blobKey
    })
    if (duplicate) {
      if (tags.length > 0) {
        const existing = new Set(tx.select({ name: libraryBookTagValues.name }).from(libraryBookTagValues)
          .where(eq(libraryBookTagValues.libraryBookId, duplicate.libraryBookId)).all().map((row) => row.name))
        const missing = tags.filter((name) => !existing.has(name))
        if (missing.length > 0) {
          tx.insert(libraryBookTagValues)
            .values(missing.map((name, index) => ({
              id: createId('btv'), libraryBookId: duplicate.libraryBookId, name, sortOrder: existing.size + index,
            })))
            .run()
        }
      }
      result = {
        libraryBookId: duplicate.libraryBookId,
        versionLinkId: duplicate.versionLinkId,
        bookVersionId: duplicate.bookVersionId,
        duplicated: true,
      }
      return
    }

    tx.insert(bookVersions).values({
      id: newBookVersionId,
      format: sourceVersion.format,
      size: sourceRevision.size,
      createdAt: now,
      updatedAt: now,
    }).run()
    tx.insert(contentRevisions).values({
      id: createId('rev'),
      bookVersionId: newBookVersionId,
      revisionNo: 1,
      blobKey: sourceRevision.blobKey,
      size: sourceRevision.size,
      wordCount: sourceRevision.wordCount,
      chapterCount: sourceRevision.chapterCount,
      meta: snapshotMeta,
      createdAt: now,
    }).run()
    tx.insert(libraryBooks).values({
      id: newLibraryBookId,
      libraryId: targetLibraryId,
      // This column is still the shared-catalog write actor in the current
      // transition model; ACL decisions use the library and membership rows.
      userId: actorId,
      categoryRoot: categoryPath?.[0] ?? null,
      categoryLeaf: categoryPath?.[1] ?? null,
      title: sourceTitle,
      author: sourceAuthor,
      authors: sourceAuthors,
      description: sourceDescription,
      coverKey: sourceCoverKey,
      createdAt: now,
      updatedAt: now,
    }).run()
    tx.insert(libraryBookVersions).values({
      id: newVersionLinkId,
      libraryId: targetLibraryId,
      libraryBookId: newLibraryBookId,
      bookVersionId: newBookVersionId,
      kind: 'personal',
      status: 'published',
      userId: actorId,
      // The version row is the source of truth for a shared work's metadata;
      // the work row is only its projection. Publishing must therefore seed
      // the version too, or the first projection would have nothing to copy.
      title: sourceTitle,
      author: sourceAuthor,
      authors: sourceAuthors,
      description: sourceDescription,
      coverKey: sourceCoverKey,
      // Source base for push/collect-dedup decisions: the private version and
      // revision this snapshot was taken from. Plain text, survives deletion.
      sourceBaseVersionId: opts.bookId,
      sourceBaseRevisionId: sourceRevision.id,
      createdAt: now,
      updatedAt: now,
    }).run()
    recordActivityEvent(tx, {
      idempotencyKey: `work.added:${newLibraryBookId}`,
      eventType: 'work.added', audience: 'library', libraryId: targetLibraryId, actorUserId: actorId,
      targetKind: 'work', targetId: newLibraryBookId, workId: newLibraryBookId,
      versionId: newBookVersionId, occurredAt: now,
    })
    if (tags.length > 0) {
      tx.insert(libraryBookTagValues)
        .values(tags.map((name, index) => ({ id: createId('btv'), libraryBookId: newLibraryBookId, name, sortOrder: index })))
        .run()
    }
    result = {
      libraryBookId: newLibraryBookId,
      versionLinkId: newVersionLinkId,
      bookVersionId: newBookVersionId,
      duplicated: false,
    }
  })

  return result!
}
