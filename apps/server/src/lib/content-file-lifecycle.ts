import { and, asc, eq, gt, isNull, lt } from 'drizzle-orm'

import { CONTENT_DRAFT_TTL_MS } from '@bookdock/shared'

import { blobKeyReferenced, deleteBlobRowIfUnreferenced } from '../db/blob-refs'
import { getDb } from '../db/client'
import { blobs, contentFiles, contentUploadDrafts } from '../db/schema'
import { getStorage } from '../storage'
import { createId } from './id'
import { log } from './logger'

const blobOperations = new Map<string, Promise<unknown>>()

export async function withContentBlob<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = blobOperations.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(operation)
  blobOperations.set(key, current)
  try { return await current }
  finally { if (blobOperations.get(key) === current) blobOperations.delete(key) }
}

export async function cleanContentBlobs() {
  const db = getDb()
  let cursor = ''
  for (;;) {
    const rows = db.select().from(blobs).where(and(eq(blobs.kind, 'content'), gt(blobs.key, cursor))).orderBy(asc(blobs.key)).limit(100).all()
    for (const row of rows) {
      await withContentBlob(row.key, async () => {
        if (blobKeyReferenced(row.key)) return
        try {
          await getStorage().delete(row.key)
          deleteBlobRowIfUnreferenced(row.key)
        } catch (error) { log('warn', 'content_files.cleanup.failed', { error }) }
      })
      cursor = row.key
    }
    if (rows.length < 100) break
  }
}

export async function sweepContentFiles(now = Date.now()) {
  getDb().delete(contentFiles).where(and(
    isNull(contentFiles.reviewId), isNull(contentFiles.ideaId), lt(contentFiles.createdAt, now - CONTENT_DRAFT_TTL_MS),
  )).run()
  getDb().delete(contentUploadDrafts).where(lt(contentUploadDrafts.createdAt, now - CONTENT_DRAFT_TTL_MS)).run()
  await cleanContentBlobs()
}

export async function cancelContentDraft(userId: string, draftId: string) {
  getDb().insert(contentUploadDrafts).values({
    id: createId('cdraft'), userId, draftId, domain: 'review', bookVersionId: '', createdAt: Date.now(), cancelledAt: Date.now(),
  }).onConflictDoUpdate({ target: [contentUploadDrafts.userId, contentUploadDrafts.draftId], set: { cancelledAt: Date.now() } }).run()
  getDb().delete(contentFiles).where(and(
    eq(contentFiles.userId, userId), eq(contentFiles.draftId, draftId), isNull(contentFiles.reviewId), isNull(contentFiles.ideaId),
  )).run()
  await cleanContentBlobs()
}
