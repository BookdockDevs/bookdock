import { eq, or } from 'drizzle-orm'

import { getDb } from './client'
import { blobs, books, contentRevisions, libraryBooks, libraryBookVersions } from './schema'

/**
 * Physical-file liveness (Phase 1.4/5.6). Content is addressed by
 * content-hash key, so the same file legitimately serves several versions,
 * covers and users. A blob may only be deleted once nothing references it —
 * getting this wrong is unrecoverable data loss, which is why every delete
 * path in the app funnels through here instead of counting rows itself.
 */
export function blobKeyReferenced(key: string): boolean {
  const db = getDb()
  return db.select({ id: contentRevisions.id }).from(contentRevisions).where(eq(contentRevisions.blobKey, key)).get() !== undefined
    || db.select({ id: libraryBooks.id }).from(libraryBooks).where(eq(libraryBooks.coverKey, key)).get() !== undefined
    || db.select({ id: libraryBookVersions.id }).from(libraryBookVersions).where(eq(libraryBookVersions.coverKey, key)).get() !== undefined
    || db.select({ id: books.id }).from(books).where(or(eq(books.filePath, key), eq(books.coverKey, key))).get() !== undefined
}

/**
 * Drop the blob row when nothing references the key. Callers delete the file
 * themselves first: the storage driver is injected per module, while this
 * helper only owns the registry row.
 */
export function deleteBlobRowIfUnreferenced(key: string): boolean {
  if (blobKeyReferenced(key)) return false
  getDb().delete(blobs).where(eq(blobs.key, key)).run()
  return true
}
