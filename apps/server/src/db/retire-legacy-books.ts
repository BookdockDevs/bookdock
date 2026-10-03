import { promises as fs } from 'node:fs'
import path from 'node:path'

import { sql } from 'drizzle-orm'

import { config } from '../config'
import { createId } from '../lib/id'
import { log } from '../lib/logger'
import { getStorage } from '../storage'
import type { getDb } from './client'
import { libraryMigrationLog } from './schema'

const dependentTables = [
  'reading_records', 'reading_sessions', 'ai_threads', 'ai_book_indexes',
  'ai_chunks', 'ai_chunk_embeddings', 'text_replacements', 'text_replacement_overrides',
]

/** One-time bridge. Frozen snapshots never replace subsequently edited values. */
export async function prepareBookRetirement(db: ReturnType<typeof getDb>) {
  const startedAt = Date.now()
  const storage = getStorage()
  const losses: Record<string, number> = {}
  const progress = { moved: 0, currentKept: 0, archived: 0 }
  // Complete the old read-core fallback only for the unchanged initial revision.
  db.run(sql.raw(`UPDATE content_revisions SET meta = (
    SELECT b.meta FROM books b WHERE b.id = content_revisions.book_version_id
  ) WHERE revision_no = 1 AND meta IN ('{}', 'null') AND EXISTS (
    SELECT 1 FROM books b JOIN book_versions v ON v.id = b.id
    WHERE b.id = content_revisions.book_version_id AND v.updated_at <= b.updated_at
      AND b.meta NOT IN ('{}', 'null')
  )`))
  db.run(sql.raw(`UPDATE bookmarks SET
    title = COALESCE(title, (SELECT text FROM annotations a WHERE a.id = bookmarks.id)),
    chapter_href = COALESCE(chapter_href, (SELECT chapter_href FROM annotations a WHERE a.id = bookmarks.id))
    WHERE EXISTS (SELECT 1 FROM annotations a WHERE a.id = bookmarks.id
      AND a.type = 'bookmark' AND a.user_id = bookmarks.user_id
      AND a.book_id = bookmarks.book_version_id AND a.updated_at >= bookmarks.updated_at)`))
  db.run(sql.raw(`UPDATE ideas SET
    color = (SELECT color FROM annotations a WHERE a.id = ideas.id),
    style = (SELECT style FROM annotations a WHERE a.id = ideas.id),
    cfi_anchor = COALESCE(cfi_anchor, (SELECT cfi_anchor FROM annotations a WHERE a.id = ideas.id))
    WHERE EXISTS (SELECT 1 FROM annotations a WHERE a.id = ideas.id AND a.type = 'note'
      AND a.user_id = ideas.user_id AND a.book_id = ideas.book_version_id
      AND a.updated_at >= ideas.updated_at)`))

  // Sweep files even when all BookState rows already exist: they omit intervals,
  // speed samples and extension fields, so rebuilding JSON from them loses data.
  const progressDir = path.join(config.dataDir, 'files/progress')
  const entries = await fs.readdir(progressDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    const versionId = entry.name.slice(0, -5)
    const owner = db.get<{ userId: string }>(sql`
      SELECT b.user_id AS userId FROM books b JOIN book_versions v ON v.id = b.id WHERE b.id = ${versionId}
    `)
    const oldKey = `progress/${entry.name}`
    const buffer = await fs.readFile(path.join(progressDir, entry.name))
    let valid = false
    try {
      const value = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>
      valid = value !== null && typeof value === 'object' && typeof value.percent === 'number'
        && Number.isFinite(value.percent) && Array.isArray(value.intervals)
    } catch { /* Invalid originals are retained for manual recovery. */ }
    if (!owner || !valid) {
      await storage.put(`legacy-retirement/progress/${entry.name}`, buffer)
      progress.archived++
    } else {
      const currentKey = `progress/${owner.userId}/${versionId}.json`
      if (await storage.exists(currentKey)) {
        await storage.put(`legacy-retirement/progress/${entry.name}`, buffer)
        progress.currentKept++
      } else {
        await storage.put(currentKey, buffer)
        progress.moved++
      }
    }
    await storage.delete(oldKey)
  }

  db.transaction((tx) => {
    // Orphaned caches/history cannot acquire a fabricated content identity.
    // Delete children first while the original foreign keys are still active.
    for (const table of [...dependentTables].reverse()) {
      const result = tx.run(sql.raw(`DELETE FROM "${table}" WHERE book_id IS NOT NULL
        AND book_id NOT IN (SELECT id FROM book_versions)`))
      losses[table] = result.changes
      tx.run(sql.raw(`UPDATE "${table}" SET book_version_id = book_id WHERE book_id IS NOT NULL
        AND (book_version_id IS NULL OR book_version_id <> book_id)`))
    }
    losses.booksWithoutVersion = tx.get<{ n: number }>(sql.raw(`SELECT COUNT(*) n FROM books b
      WHERE NOT EXISTS (SELECT 1 FROM book_versions v WHERE v.id = b.id)`))!.n
    losses.annotationsWithoutTarget = tx.get<{ n: number }>(sql.raw(`SELECT COUNT(*) n FROM annotations a
      WHERE (a.type = 'highlight' AND NOT EXISTS (SELECT 1 FROM highlights h WHERE h.id = a.id))
        OR (a.type = 'bookmark' AND NOT EXISTS (SELECT 1 FROM bookmarks b WHERE b.id = a.id))
        OR (a.type = 'note' AND NOT EXISTS (SELECT 1 FROM ideas i WHERE i.id = a.id))`))!.n
    tx.insert(libraryMigrationLog).values({
      id: createId('mig'), batch: 'book-retirement-preflight', status: 'completed',
      details: { losses, progress }, startedAt, finishedAt: Date.now(),
    }).run()
  })
  log('info', 'database.book_retirement.prepared', { meta: { losses, progress } })
  return { losses, progress }
}
