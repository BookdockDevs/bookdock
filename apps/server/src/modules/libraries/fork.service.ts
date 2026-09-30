import { and, desc, eq, or } from 'drizzle-orm'

import { getDb } from '../../db/client'
import {
  aiThreads,
  blobs,
  bookmarks,
  bookStates,
  bookVersions,
  contentRevisions,
  highlights,
  ideas,
  libraries,
  libraryBooks,
  libraryBookVersions,
  readingRecords,
  readingSessions,
  settings,
  textReplacementOverrides,
  textReplacements,
} from '../../db/schema'
import { createId } from '../../lib/id'
import { deleteProgressFile, readProgressFile, writeProgressFile } from '../../lib/progress-file'
import { AppError } from '../../middleware/error'
import { getStorage } from '../../storage'
import { sourceStillReadable } from './library-access'

export interface ForkResult {
  libraryBookId: string
  bookVersionId: string
}

/**
 * Fork a private B into a local C. The same card keeps its work,
 * shelf/category and tags; only the version link swaps to a new independent
 * BookVersion built from the pinned revision. The blob is never copied — the
 * new revision reuses the pinned blobKey exactly like a publish snapshot —
 * and the city copy is untouched. Afterwards the card is a fully local book:
 * re-toc, append and other content writes are allowed on it.
 *
 * Forking requires the source to still be readable: an unlisted source or a
 * deleted/lost library is an admin revocation, and forking past it would
 * defeat that control.
 *
 * The forker's own User x BookVersion rows move to the new version (UPDATE in
 * place, scoped by userId, so other readers of the old version keep theirs).
 * The old version itself is left alone; the existing orphan path reaps it
 * when no library lists it anymore.
 */
export async function forkLocalBook(userId: string, bookVersionId: string): Promise<ForkResult> {
  const db = getDb()
  const privateLibrary = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (!privateLibrary) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  const link = db.select().from(libraryBookVersions)
    .where(and(
      eq(libraryBookVersions.libraryId, privateLibrary.id),
      eq(libraryBookVersions.bookVersionId, bookVersionId),
    )).get()
  if (!link) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  if (link.kind !== 'shared') {
    throw new AppError('FORBIDDEN', 'Only collected books can be forked to a local copy')
  }
  const work = db.select().from(libraryBooks)
    .where(eq(libraryBooks.id, link.libraryBookId)).get()
  if (!work || work.deletedAt) throw new AppError('BOOK_NOT_FOUND', 'Book not found')

  // Forking is only allowed while the source still reads: an unlisted source
  // or a deleted/lost library is an admin revocation, and forking past it
  // would defeat that control. The B card itself stays put either way.
  if (!(await sourceStillReadable(userId, bookVersionId))) {
    throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  }

  // The pinned revision is the rescue source; a cleared pin (source version
  // already reaped) falls back to the latest surviving revision, if any.
  const pinned = link.pinnedRevisionId
    ? db.select().from(contentRevisions)
      .where(and(
        eq(contentRevisions.id, link.pinnedRevisionId),
        eq(contentRevisions.bookVersionId, bookVersionId),
      )).get()
    : undefined
  const sourceRevision = pinned
    ?? db.select().from(contentRevisions)
      .where(eq(contentRevisions.bookVersionId, bookVersionId))
      .orderBy(desc(contentRevisions.revisionNo)).get()
  if (!sourceRevision) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  const sourceVersion = db.select().from(bookVersions)
    .where(eq(bookVersions.id, bookVersionId)).get()
  if (!sourceVersion) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  const blobRow = db.select({ key: blobs.key }).from(blobs)
    .where(eq(blobs.key, sourceRevision.blobKey)).get()
  if (!blobRow || !(await getStorage().exists(sourceRevision.blobKey))) {
    throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  }

  const now = Date.now()
  const newBookVersionId = createId('book')

  db.transaction((tx) => {
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
      // Keep the pinned meta untouched: a carried coverPaletteKey preserves
      // the card's placeholder palette across the fork.
      meta: sourceRevision.meta,
      createdAt: now,
    }).run()
    tx.update(libraryBookVersions).set({
      bookVersionId: newBookVersionId,
      kind: 'local',
      sourceLibraryId: null,
      sourceLibraryBookVersionId: null,
      pinnedRevisionId: null,
      updatedAt: now,
    }).where(eq(libraryBookVersions.id, link.id)).run()
    tx.update(libraryBooks).set({ updatedAt: now })
      .where(eq(libraryBooks.id, link.libraryBookId)).run()

    // Move the forker's own reading data to the new version. Every predicate
    // is scoped by userId: other readers of the old version keep their rows.
    tx.update(bookStates).set({ bookVersionId: newBookVersionId })
      .where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookVersionId))).run()
    tx.update(highlights).set({ bookVersionId: newBookVersionId })
      .where(and(eq(highlights.userId, userId), eq(highlights.bookVersionId, bookVersionId))).run()
    tx.update(bookmarks).set({ bookVersionId: newBookVersionId })
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.bookVersionId, bookVersionId))).run()
    tx.update(ideas).set({ bookVersionId: newBookVersionId })
      .where(and(eq(ideas.userId, userId), eq(ideas.bookVersionId, bookVersionId))).run()
    tx.update(readingRecords).set({ bookId: newBookVersionId, bookVersionId: newBookVersionId })
      .where(and(eq(readingRecords.userId, userId), eq(readingRecords.bookVersionId, bookVersionId))).run()
    tx.update(readingSessions).set({ bookId: newBookVersionId, bookVersionId: newBookVersionId })
      .where(and(eq(readingSessions.userId, userId), eq(readingSessions.bookVersionId, bookVersionId))).run()
    // Book-local patches only (bookId set); user-global pattern rules have
    // bookId null and stay shared.
    tx.update(textReplacements)
      .set({ bookId: newBookVersionId, bookVersionId: newBookVersionId })
      .where(and(eq(textReplacements.userId, userId), eq(textReplacements.bookId, bookVersionId))).run()
    tx.update(textReplacementOverrides)
      .set({ bookId: newBookVersionId, bookVersionId: newBookVersionId })
      .where(and(eq(textReplacementOverrides.userId, userId), eq(textReplacementOverrides.bookId, bookVersionId))).run()
    // Threads carry their messages via threadId; retargeting the thread row
    // is enough. or() covers rows where only the legacy bookId is set.
    tx.update(aiThreads)
      .set({ bookId: newBookVersionId, bookVersionId: newBookVersionId })
      .where(and(
        eq(aiThreads.userId, userId),
        or(eq(aiThreads.bookId, bookVersionId), eq(aiThreads.bookVersionId, bookVersionId)),
      )).run()
    tx.update(settings).set({ key: `reader.book:${newBookVersionId}` })
      .where(and(eq(settings.userId, userId), eq(settings.key, `reader.book:${bookVersionId}`))).run()
  })

  // The progress file follows the card: move the forker's position to the new
  // version so the reader resumes where it left off.
  const progress = await readProgressFile(userId, bookVersionId)
  if (progress) {
    await writeProgressFile(userId, newBookVersionId, progress)
    await deleteProgressFile(userId, bookVersionId).catch(() => undefined)
  }

  return { libraryBookId: link.libraryBookId, bookVersionId: newBookVersionId }
}
