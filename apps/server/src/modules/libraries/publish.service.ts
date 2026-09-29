import { and, desc, eq, inArray, isNull } from 'drizzle-orm'

import type { PublishPrivateBookReq, PublishPrivateBookRes } from '@bookdock/shared'

import { getDb } from '../../db/client'
import {
  blobs,
  bookVersions,
  contentRevisions,
  libraryBooks,
  libraryBookTags,
  libraryBookVersions,
  libraryCategories,
  libraryTags,
  libraries,
} from '../../db/schema'
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

  if (opts.categoryId) {
    const category = db.select({ id: libraryCategories.id }).from(libraryCategories)
      .where(and(eq(libraryCategories.id, opts.categoryId), eq(libraryCategories.libraryId, targetLibraryId))).get()
    if (!category) throw new AppError('CATEGORY_NOT_FOUND', 'Category not found')
  }
  const tagIds = [...new Set(opts.tagIds ?? [])]
  if (tagIds.length > 0) {
    const found = db.select({ id: libraryTags.id }).from(libraryTags)
      .where(and(eq(libraryTags.libraryId, targetLibraryId), inArray(libraryTags.id, tagIds))).all()
    if (found.length !== tagIds.length) throw new AppError('TAG_NOT_FOUND', 'Tag not found')
  }

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
      if (tagIds.length > 0) {
        tx.insert(libraryBookTags)
          .values(tagIds.map((tagId) => ({ libraryBookId: duplicate.libraryBookId, tagId })))
          .onConflictDoNothing()
          .run()
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
      categoryId: opts.categoryId ?? null,
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
      createdAt: now,
      updatedAt: now,
    }).run()
    if (tagIds.length > 0) {
      tx.insert(libraryBookTags).values(tagIds.map((tagId) => ({ libraryBookId: newLibraryBookId, tagId }))).run()
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
