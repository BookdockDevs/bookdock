import { and, eq, sql } from 'drizzle-orm'

import type { ArchivePage, ArchiveQuery, NoteArchiveEntry } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { bookmarks, highlights, ideas, libraries, libraryBooks, libraryBookVersions, readingArchives } from '../../db/schema'
import { AppError } from '../../middleware/error'
import { assertReadableBook } from '../books/books.service'
import { pendingBookDataDeletionVersionIds } from '../libraries/library-query'
import { toRes } from './annotations.service'
import { assertIdeaSource, ideaRevision } from './idea-access'

export async function noteArchive(userId: string, query: ArchiveQuery): Promise<ArchivePage<NoteArchiveEntry>> {
  const db = getDb()
  const excluded = pendingBookDataDeletionVersionIds(db, userId)
  const pendingFilter = excluded.length ? sql`AND (book_version_id IS NULL OR book_version_id NOT IN (${sql.join(excluded.map((id) => sql`${id}`), sql`, `)}))` : sql``
  const filter = sql`${query.bookId ? sql`AND book_version_id = ${query.bookId}` : sql``} ${pendingFilter}`
  const rows = db.all<{ id: string; kind: 'highlight' | 'bookmark' | 'idea' }>(sql`
    SELECT id, kind FROM (
      SELECT id, 'highlight' AS kind, updated_at FROM highlights WHERE user_id = ${userId} AND deleted_at IS NULL ${filter}
      UNION ALL
      SELECT id, 'bookmark' AS kind, updated_at FROM bookmarks WHERE user_id = ${userId} AND deleted_at IS NULL ${filter}
      UNION ALL
      SELECT id, 'idea' AS kind, updated_at FROM ideas WHERE user_id = ${userId} AND deleted_at IS NULL ${filter}
    ) ORDER BY updated_at DESC, id DESC LIMIT ${query.pageSize + 1} OFFSET ${(query.page - 1) * query.pageSize}
  `)
  const entries: NoteArchiveEntry[] = []
  for (const item of rows.slice(0, query.pageSize)) {
    const table = item.kind === 'highlight' ? highlights : item.kind === 'bookmark' ? bookmarks : ideas
    const row = db.select().from(table).where(and(eq(table.id, item.id), eq(table.userId, userId))).get()!
    const annotation = { ...toRes(item.kind, row), revisionId: row.revisionId }
    let bookTitle: string | null = row.bookVersionId ? db.select().from(readingArchives).where(and(eq(readingArchives.userId, userId), eq(readingArchives.bookVersionId, row.bookVersionId))).get()?.title ?? null : null
    let locationStatus: NoteArchiveEntry['locationStatus'] = 'source-unavailable'
    try {
      if (!row.bookVersionId) throw new AppError('BOOK_NOT_FOUND')
      if (item.kind === 'idea') {
        const idea = db.select().from(ideas).where(eq(ideas.id, row.id)).get()!
        if (idea.sharedLibraryId) await assertIdeaSource(userId, idea)
      }
      await assertReadableBook(userId, row.bookVersionId)
      const held = db.select({ work: libraryBooks }).from(libraryBookVersions)
        .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
        .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
        .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'), eq(libraryBookVersions.bookVersionId, row.bookVersionId))).get()
      // A lost holding does not grant a substitute source or a new title.
      bookTitle = held?.work.title ?? bookTitle
      const revision = ideaRevision(userId, row.bookVersionId)
      locationStatus = annotation.cfiRange && (!('relocation' in row) || row.relocation !== 'unresolved') && (!annotation.revisionId || annotation.revisionId === revision?.id)
        ? 'available' : 'position-unavailable'
    } catch (error) {
      if (!(error instanceof AppError)) throw error
    }
    entries.push({ annotation, bookTitle, locationStatus })
  }
  return { entries, page: query.page, hasMore: rows.length > query.pageSize }
}
