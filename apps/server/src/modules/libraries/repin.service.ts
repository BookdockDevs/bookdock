import { and, desc, eq } from 'drizzle-orm'

import type { BookSourceStatus, RepinRes } from '@bookdock/shared'

import { getDb } from '../../db/client'
import {
  contentRevisions,
  libraries,
  libraryBooks,
  libraryBookVersions,
} from '../../db/schema'
import { AppError } from '../../middleware/error'
import { sourceStillReadable } from './library-access'

const NEUTRAL_STATUS: BookSourceStatus = {
  readable: true,
  pinnedRevisionId: null,
  latestRevisionId: null,
  latestRevisionNo: null,
  hasUpdate: false,
}

/**
 * Source-follow state for a private B: whether the source still reads and
 * whether it published a newer revision than the pin. A/C rows report the
 * neutral status — they own their content and have no source to follow.
 */
export async function getSourceStatus(userId: string, bookVersionId: string): Promise<BookSourceStatus> {
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
  if (link.kind !== 'shared') return NEUTRAL_STATUS

  const readable = await sourceStillReadable(userId, bookVersionId)
  const latest = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookVersionId))
    .orderBy(desc(contentRevisions.revisionNo)).get()
  return {
    readable,
    pinnedRevisionId: link.pinnedRevisionId,
    latestRevisionId: latest?.id ?? null,
    latestRevisionNo: latest?.revisionNo ?? null,
    // Only a readable source offers an update: following an unreadable one
    // would re-pin to content the reader is not allowed to see.
    hasUpdate: readable && !!latest && latest.id !== link.pinnedRevisionId,
  }
}

/**
 * Re-pin a private B to its source's latest revision (explicit follow-up).
 * The pin never moves on its own; this is the only writer besides collect.
 * Idempotent: an up-to-date pin returns without writing.
 */
export async function repinToLatest(userId: string, bookVersionId: string): Promise<RepinRes> {
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
    throw new AppError('FORBIDDEN', 'Only collected books follow a source')
  }
  if (!(await sourceStillReadable(userId, bookVersionId))) {
    throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  }
  const latest = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookVersionId))
    .orderBy(desc(contentRevisions.revisionNo)).get()
  if (!latest) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  if (latest.id === link.pinnedRevisionId) {
    return { pinnedRevisionId: latest.id, revisionNo: latest.revisionNo, alreadyUpToDate: true }
  }

  const now = Date.now()
  db.transaction((tx) => {
    tx.update(libraryBookVersions).set({ pinnedRevisionId: latest.id, updatedAt: now })
      .where(eq(libraryBookVersions.id, link.id)).run()
    // The reader versions file URLs by the work's updatedAt; a pin move must
    // move it too, or the reader keeps serving the old pinned chapters from
    // its chapter-text cache.
    tx.update(libraryBooks).set({ updatedAt: now })
      .where(eq(libraryBooks.id, link.libraryBookId)).run()
  })
  return { pinnedRevisionId: latest.id, revisionNo: latest.revisionNo, alreadyUpToDate: false }
}
