import { and, eq, inArray } from 'drizzle-orm'

import { CONTENT_DRAFT_TTL_MS, CONTENT_FILES_MAX_COUNT, contentFileUrl } from '@bookdock/shared'
import type { ContentFile, ContentFileDomain } from '@bookdock/shared'

import type { getDb } from './client'
import { contentFiles, contentUploadDrafts } from './schema'
import { AppError } from '../middleware/error'

type FileDb = Pick<ReturnType<typeof getDb>, 'select' | 'update' | 'delete'>

export function contentFileProjection(row: typeof contentFiles.$inferSelect): ContentFile {
  return { id: row.id, kind: row.kind, name: row.name, mimeType: row.mimeType, size: row.size, url: contentFileUrl(row.id) }
}

export function publishedContentFiles(db: FileDb, domain: ContentFileDomain, id: string): ContentFile[] {
  return db.select().from(contentFiles).where(and(
    eq(domain === 'review' ? contentFiles.reviewId : contentFiles.ideaId, id), eq(contentFiles.ready, true),
  )).all().map(contentFileProjection)
}

export function syncContentFiles(db: FileDb, input: {
  userId: string; domain: ContentFileDomain; targetId: string; bookVersionId?: string
  draftId?: string; ids: string[]; imageIds: string[]
}) {
  const ids = [...new Set(input.ids)]
  if (ids.length > CONTENT_FILES_MAX_COUNT) throw new AppError('VALIDATION_ERROR', 'Too many content files')
  const rows = ids.length ? db.select().from(contentFiles).where(inArray(contentFiles.id, ids)).all() : []
  if (rows.length !== ids.length) throw new AppError('CONTENT_FILE_NOT_FOUND')
  const targetColumn = input.domain === 'review' ? contentFiles.reviewId : contentFiles.ideaId
  const draft = input.draftId ? db.select().from(contentUploadDrafts).where(and(eq(contentUploadDrafts.userId, input.userId), eq(contentUploadDrafts.draftId, input.draftId))).get() : null
  for (const row of rows) {
    const publishedId = row.reviewId ?? row.ideaId
    if (row.userId !== input.userId || row.domain !== input.domain || !row.ready
      || (input.imageIds.includes(row.id) && row.kind !== 'image')
      || (publishedId !== null && publishedId !== input.targetId)
      || (publishedId === null && (!draft || draft.cancelledAt !== null || draft.createdAt < Date.now() - CONTENT_DRAFT_TTL_MS || row.draftId !== input.draftId
        || (input.bookVersionId === undefined ? row.intendedTargetId !== input.targetId : row.intendedTargetId !== null && row.intendedTargetId !== input.targetId)
        || (input.bookVersionId !== undefined && row.bookVersionId !== input.bookVersionId)))) {
      throw new AppError('CONTENT_FILE_NOT_FOUND')
    }
  }
  const previous = db.select().from(contentFiles).where(eq(targetColumn, input.targetId)).all()
  for (const row of previous) if (!ids.includes(row.id)) db.delete(contentFiles).where(eq(contentFiles.id, row.id)).run()
  for (const row of rows) db.update(contentFiles).set(input.domain === 'review' ? { reviewId: input.targetId } : { ideaId: input.targetId })
    .where(eq(contentFiles.id, row.id)).run()
}
