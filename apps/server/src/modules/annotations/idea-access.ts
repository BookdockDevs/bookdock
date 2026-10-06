import { and, desc, eq, isNull } from 'drizzle-orm'

import type { IdeaComposerContext } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { contentRevisions, ideas, libraries, libraryBooks, libraryBookVersions, settings } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { assertReadableBook } from '../books/books.service'
import { resolveSharedVersionRead } from '../libraries/library-access'

export const IDEA_VISIBILITY_KEY = 'ideas.last-created-visibility'

export function privateIdeaLink(userId: string, bookId: string) {
  const db = getDb()
  const library = db.select().from(libraries).where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (!library) return null
  return db.select({ link: libraryBookVersions }).from(libraryBookVersions)
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
    .where(and(eq(libraryBookVersions.libraryId, library.id), eq(libraryBookVersions.bookVersionId, bookId), isNull(libraryBooks.deletedAt))).get()?.link ?? null
}

export function ideaRevision(userId: string, bookId: string) {
  const link = privateIdeaLink(userId, bookId)
  if (link?.kind === 'shared' && link.pinnedRevisionId) {
    return getDb().select().from(contentRevisions).where(and(eq(contentRevisions.id, link.pinnedRevisionId), eq(contentRevisions.bookVersionId, bookId))).get() ?? null
  }
  return getDb().select().from(contentRevisions).where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).get() ?? null
}

export async function assertIdeaSource(userId: string | null, source: {
  sharedLibraryId: string | null
  sourceLibraryBookVersionId: string | null
  bookVersionId: string | null
}) {
  if (!source.sharedLibraryId || !source.sourceLibraryBookVersionId || !source.bookVersionId) throw new AppError('ANNOTATION_NOT_FOUND')
  try {
    const read = await resolveSharedVersionRead(source.sharedLibraryId, source.bookVersionId, userId)
    if (read.link.id !== source.sourceLibraryBookVersionId) throw new AppError('ANNOTATION_NOT_FOUND')
    return read
  } catch (error) {
    if (error instanceof AppError) throw new AppError('ANNOTATION_NOT_FOUND')
    throw error
  }
}

export async function ideaComposerContext(userId: string, bookId: string): Promise<IdeaComposerContext> {
  const link = privateIdeaLink(userId, bookId)
  if (!link) await assertReadableBook(userId, bookId)
  const eligible = link?.kind === 'shared' && !!link.sourceLibraryId && !!link.sourceLibraryBookVersionId
  let sourceReadable = false
  if (eligible) {
    try {
      await assertIdeaSource(userId, { sharedLibraryId: link.sourceLibraryId, sourceLibraryBookVersionId: link.sourceLibraryBookVersionId, bookVersionId: bookId })
      sourceReadable = true
    } catch (error) {
      if (!(error instanceof AppError)) throw error
    }
  }
  const preference = getDb().select().from(settings).where(and(eq(settings.userId, userId), eq(settings.key, IDEA_VISIBILITY_KEY))).get()
  return {
    eligible: !!eligible,
    sourceReadable,
    defaultVisibility: eligible && preference?.value !== 'private' ? 'shared' : 'private',
    revisionId: ideaRevision(userId, bookId)?.id ?? null,
  }
}

export async function readableIdea(userId: string | null, id: string) {
  const row = getDb().select().from(ideas).where(and(eq(ideas.id, id), isNull(ideas.deletedAt))).get()
  if (!row) throw new AppError('ANNOTATION_NOT_FOUND')
  if (row.visibility === 'private') {
    if (userId !== row.userId) throw new AppError('ANNOTATION_NOT_FOUND')
    return { row, manager: false }
  }
  const read = await assertIdeaSource(userId, row)
  return { row, manager: read.relation === 'owner' || read.relation === 'admin' }
}
