import path from 'node:path'

import { and, eq, sql } from 'drizzle-orm'
import sharp from 'sharp'

import { CONTENT_DRAFT_TTL_MS, CONTENT_FILES_MAX_COUNT, CONTENT_IMAGE_MAX_BYTES, IDEA_IMAGE_MAX_COUNT } from '@bookdock/shared'
import type { ContentFileUpload } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { contentFileProjection } from '../../db/content-files'
import { blobs, contentFiles, contentUploadDrafts } from '../../db/schema'
import { cleanContentBlobs, withContentBlob } from '../../lib/content-file-lifecycle'
import { sha256 } from '../../lib/hash'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'
import { getStorage } from '../../storage'
import { assertContentUpload } from './file-access'

export async function uploadContentFile(userId: string, input: ContentFileUpload, file: File) {
  if (input.kind !== 'image') throw new AppError('UNSUPPORTED_FORMAT')
  await assertContentUpload(userId, input)
  const db = getDb()
  db.insert(contentUploadDrafts).values({ id: createId('cdraft'), userId, draftId: input.draftId, domain: input.domain, bookVersionId: input.bookVersionId, intendedTargetId: input.targetId ?? null, createdAt: Date.now() }).onConflictDoNothing().run()
  const draft = db.select().from(contentUploadDrafts).where(and(eq(contentUploadDrafts.userId, userId), eq(contentUploadDrafts.draftId, input.draftId))).get()
  if (!draft || draft.cancelledAt !== null || draft.createdAt < Date.now() - CONTENT_DRAFT_TTL_MS || draft.domain !== input.domain || draft.bookVersionId !== input.bookVersionId || draft.intendedTargetId !== (input.targetId ?? null)) throw new AppError('CONTENT_FILE_NOT_FOUND')
  if (!file.size || file.size > CONTENT_IMAGE_MAX_BYTES) throw new AppError('UPLOAD_TOO_LARGE')
  let data = Buffer.from(await file.arrayBuffer())
  let mimeType: string
  let extension: string
  try {
    const metadata = await sharp(data, { limitInputPixels: 40_000_000 }).metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) throw new AppError('UNSUPPORTED_FORMAT')
    data = await sharp(data, { limitInputPixels: 40_000_000, failOn: 'warning' })
      .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
    if (data.length > CONTENT_IMAGE_MAX_BYTES) throw new AppError('UPLOAD_TOO_LARGE')
    mimeType = 'image/webp'
    extension = 'webp'
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new AppError('UNSUPPORTED_FORMAT', 'The file could not be validated')
  }
  const hash = sha256(data)
  const key = `content/${hash.slice(0, 2)}/${hash}.${extension}`
  const name = Array.from(path.posix.basename(path.win32.basename(file.name)))
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).slice(0, 180).join('') || `file.${extension}`
  const row = { id: createId('cfile'), userId, ...input, intendedTargetId: input.targetId ?? null, blobKey: key, name, mimeType, size: data.length, ready: false, createdAt: Date.now() }
  await withContentBlob(key, async () => {
    await assertContentUpload(userId, input)
    db.transaction((tx) => {
      if (tx.select().from(contentUploadDrafts).where(eq(contentUploadDrafts.id, draft.id)).get()?.cancelledAt !== null) throw new AppError('CONTENT_FILE_NOT_FOUND')
      const count = tx.select({ count: sql<number>`count(*)` }).from(contentFiles)
        .where(and(eq(contentFiles.userId, userId), eq(contentFiles.draftId, input.draftId))).get()?.count ?? 0
      const maxCount = input.domain === 'idea' ? IDEA_IMAGE_MAX_COUNT : CONTENT_FILES_MAX_COUNT
      if (count >= maxCount) throw new AppError('VALIDATION_ERROR', 'Too many files in this draft')
      tx.insert(blobs).values({ key, kind: 'content', size: data.length, createdAt: row.createdAt }).onConflictDoNothing().run()
      tx.insert(contentFiles).values(row).run()
    })
    try {
      if (!(await getStorage().exists(key))) await getStorage().put(key, data)
      db.update(contentFiles).set({ ready: true }).where(eq(contentFiles.id, row.id)).run()
    } catch (error) {
      db.delete(contentFiles).where(eq(contentFiles.id, row.id)).run()
      throw error
    }
  }).catch(async (error) => { await cleanContentBlobs(); throw error })
  const ready = db.select().from(contentFiles).where(eq(contentFiles.id, row.id)).get()
  if (!ready) {
    await cleanContentBlobs()
    throw new AppError('CONTENT_FILE_NOT_FOUND')
  }
  return contentFileProjection(ready)
}
