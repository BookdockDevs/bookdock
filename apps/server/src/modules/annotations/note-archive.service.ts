import { and, eq, inArray, sql } from 'drizzle-orm'

import type { ArchivePage, ArchiveQuery, NoteArchiveEntry } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { contentFileProjection } from '../../db/content-files'
import { bookmarks, contentFiles, highlights, ideas, libraries, libraryBooks, libraryBookVersions, readingArchives } from '../../db/schema'
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
  const pageItems = rows.slice(0, query.pageSize)
  const highlightIds = pageItems.filter((item) => item.kind === 'highlight').map((item) => item.id)
  const bookmarkIds = pageItems.filter((item) => item.kind === 'bookmark').map((item) => item.id)
  const ideaIds = pageItems.filter((item) => item.kind === 'idea').map((item) => item.id)
  const highlightById = new Map(highlightIds.length ? db.select().from(highlights).where(and(eq(highlights.userId, userId), inArray(highlights.id, highlightIds))).all().map((row) => [row.id, row]) : [])
  const bookmarkById = new Map(bookmarkIds.length ? db.select().from(bookmarks).where(and(eq(bookmarks.userId, userId), inArray(bookmarks.id, bookmarkIds))).all().map((row) => [row.id, row]) : [])
  const ideaById = new Map(ideaIds.length ? db.select().from(ideas).where(and(eq(ideas.userId, userId), inArray(ideas.id, ideaIds))).all().map((row) => [row.id, row]) : [])
  const versionIds = [...new Set(pageItems.flatMap((item) => {
    const row = item.kind === 'highlight' ? highlightById.get(item.id) : item.kind === 'bookmark' ? bookmarkById.get(item.id) : ideaById.get(item.id)
    return row?.bookVersionId ? [row.bookVersionId] : []
  }))]
  const archiveByVersion = new Map(versionIds.length ? db.select().from(readingArchives)
    .where(and(eq(readingArchives.userId, userId), inArray(readingArchives.bookVersionId, versionIds))).all().map((row) => [row.bookVersionId, row]) : [])
  const heldByVersion = new Map(versionIds.length ? db.select({ bookVersionId: libraryBookVersions.bookVersionId, work: libraryBooks })
    .from(libraryBookVersions)
    .innerJoin(libraries, eq(libraries.id, libraryBookVersions.libraryId))
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'), inArray(libraryBookVersions.bookVersionId, versionIds)))
    .all().map((row) => [row.bookVersionId, row.work]) : [])
  const imagesByIdea = new Map<string, ReturnType<typeof contentFileProjection>[]>()
  if (ideaIds.length) {
    for (const file of db.select().from(contentFiles).where(and(inArray(contentFiles.ideaId, ideaIds), eq(contentFiles.ready, true)))
      .orderBy(contentFiles.sortOrder, contentFiles.createdAt, contentFiles.id).all()) {
      const list = imagesByIdea.get(file.ideaId!) ?? []
      list.push(contentFileProjection(file))
      imagesByIdea.set(file.ideaId!, list)
    }
  }
  const readableByVersion = new Map<string, Promise<boolean>>()
  const ideaSourceReadable = new Map<string, Promise<boolean>>()
  const revisionByVersion = new Map<string, ReturnType<typeof ideaRevision>>()
  const isReadable = (bookVersionId: string) => {
    const existing = readableByVersion.get(bookVersionId)
    if (existing) return existing
    const check = (async () => {
      try {
        await assertReadableBook(userId, bookVersionId)
        return true
      } catch (error) {
        if (error instanceof AppError) return false
        throw error
      }
    })()
    readableByVersion.set(bookVersionId, check)
    return check
  }
  const isIdeaSourceReadable = (idea: typeof ideas.$inferSelect) => {
    const key = [idea.sharedLibraryId, idea.sourceLibraryBookVersionId, idea.bookVersionId].join(':')
    const existing = ideaSourceReadable.get(key)
    if (existing) return existing
    const check = (async () => {
      try {
        await assertIdeaSource(userId, idea)
        return true
      } catch (error) {
        if (error instanceof AppError) return false
        throw error
      }
    })()
    ideaSourceReadable.set(key, check)
    return check
  }
  const entries: NoteArchiveEntry[] = []
  for (const item of pageItems) {
    const row = item.kind === 'highlight' ? highlightById.get(item.id) : item.kind === 'bookmark' ? bookmarkById.get(item.id) : ideaById.get(item.id)
    if (!row) throw new Error('Archive annotation disappeared during projection: ' + item.kind + ':' + item.id)
    const annotation = {
      ...toRes(item.kind, row, item.kind === 'idea' ? { images: imagesByIdea.get(item.id) ?? [] } : undefined),
      revisionId: row.revisionId,
    }
    let bookTitle: string | null = row.bookVersionId ? archiveByVersion.get(row.bookVersionId)?.title ?? null : null
    let locationStatus: NoteArchiveEntry['locationStatus'] = 'source-unavailable'
    try {
      if (!row.bookVersionId) throw new AppError('BOOK_NOT_FOUND')
      if (item.kind === 'idea') {
        const idea = ideaById.get(row.id)
        if (!idea) throw new Error('Archive idea disappeared during projection: ' + row.id)
        if (idea.sharedLibraryId && !(await isIdeaSourceReadable(idea))) throw new AppError('ANNOTATION_NOT_FOUND')
      }
      if (!(await isReadable(row.bookVersionId))) throw new AppError('BOOK_NOT_FOUND')
      const held = heldByVersion.get(row.bookVersionId)
      // A lost holding does not grant a substitute source or a new title.
      bookTitle = held?.title ?? bookTitle
      if (!revisionByVersion.has(row.bookVersionId)) revisionByVersion.set(row.bookVersionId, ideaRevision(userId, row.bookVersionId))
      const revision = revisionByVersion.get(row.bookVersionId)
      locationStatus = annotation.cfiRange && (!('relocation' in row) || row.relocation !== 'unresolved') && (!annotation.revisionId || annotation.revisionId === revision?.id)
        ? 'available' : 'position-unavailable'
    } catch (error) {
      if (!(error instanceof AppError)) throw error
    }
    entries.push({ annotation, bookTitle, locationStatus })
  }
  return { entries, page: query.page, hasMore: rows.length > query.pageSize }
}
