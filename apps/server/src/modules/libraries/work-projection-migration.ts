import { and, eq, inArray } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { libraries, libraryBooks, libraryBookVersions, libraryMigrationLog } from '../../db/schema'
import { createId } from '../../lib/id'

export const WORK_PROJECTION_BACKFILL_BATCH = 'phase4-work-projection'
export const WORK_META_DROP_BATCH = 'phase4-work-meta-drop'

export interface WorkProjectionBackfillReport {
  skipped: boolean
  works: number
  versions: number
  fields: number
}

export interface WorkMetaDropReport {
  skipped: boolean
  works: number
}

type Db = ReturnType<typeof getDb>

/**
 * Shared catalogs project the work row from the default version, so the
 * version row must be able to answer every field on its own. Rows written
 * before that rule existed carry the metadata only on the work row (publish
 * stored it there), which made `effective` fall back onto the projection
 * itself.
 *
 * This seeds the missing version values from the work row exactly once. Nulls
 * only: a value the version already owns always wins, and the work row itself
 * is never touched (the next projection syncs it). Private libraries are
 * skipped — there the work row is the source, not a projection.
 *
 * Atomic and idempotent: the completion marker is written in the same
 * transaction as the data, so an interrupted run leaves nothing behind and
 * simply runs again. `updatedAt` is preserved so the "recently updated" order
 * does not jump on upgrade.
 */
export function backfillWorkProjection(db: Db = getDb()): WorkProjectionBackfillReport {
  return db.transaction((tx) => {
    const done = tx.select({ id: libraryMigrationLog.id }).from(libraryMigrationLog)
      .where(and(
        eq(libraryMigrationLog.batch, WORK_PROJECTION_BACKFILL_BATCH),
        eq(libraryMigrationLog.status, 'completed'),
      )).get()
    if (done) return { skipped: true, works: 0, versions: 0, fields: 0 }

    const sharedIds = tx.select({ id: libraries.id }).from(libraries)
      .where(eq(libraries.type, 'shared')).all().map((row) => row.id)
    if (sharedIds.length === 0) {
      const empty = { skipped: false, works: 0, versions: 0, fields: 0 }
      tx.insert(libraryMigrationLog).values({
        id: createId('mlog'), batch: WORK_PROJECTION_BACKFILL_BATCH,
        status: 'completed', details: empty, startedAt: Date.now(), finishedAt: Date.now(),
      }).run()
      return empty
    }

    const works = tx.select().from(libraryBooks).where(inArray(libraryBooks.libraryId, sharedIds)).all()
    const links = tx.select().from(libraryBookVersions)
      .where(inArray(libraryBookVersions.libraryId, sharedIds)).all()
    const linksByWork = new Map<string, typeof links>()
    for (const link of links) {
      const list = linksByWork.get(link.libraryBookId) ?? []
      list.push(link)
      linksByWork.set(link.libraryBookId, list)
    }

    let versions = 0
    let fields = 0
    for (const work of works) {
      for (const link of linksByWork.get(work.id) ?? []) {
        const patch: Partial<typeof libraryBookVersions.$inferInsert> = {}
        if (link.title === null) { patch.title = work.title; fields += 1 }
        if (link.author === null) { patch.author = work.author; fields += 1 }
        if (link.authors === null) { patch.authors = work.authors ?? []; fields += 1 }
        if (link.description === null) { patch.description = work.description; fields += 1 }
        if (link.coverKey === null) { patch.coverKey = work.coverKey; fields += 1 }
        if (Object.keys(patch).length === 0) continue
        tx.update(libraryBookVersions).set(patch).where(eq(libraryBookVersions.id, link.id)).run()
        versions += 1
      }
    }

    const report = { skipped: false, works: works.length, versions, fields }
    tx.insert(libraryMigrationLog).values({
      id: createId('mlog'), batch: WORK_PROJECTION_BACKFILL_BATCH,
      status: 'completed', details: report, startedAt: Date.now(), finishedAt: Date.now(),
    }).run()
    return report
  })
}

/**
 * Drops the work-level publication layer that shared catalogs no longer have.
 *
 * In 5.3 the work row owned an editable `meta` that versions inherited. The
 * editor now writes each version's own meta, and the read path merges only the
 * parsed file with that override — so a leftover work value is unreachable
 * (invisible in the editor, impossible to clear) yet would still resurface
 * whenever a version override was cleared.
 *
 * Empties the column for shared works once. `pendingUserDataDeletion` is kept:
 * deletion tooling reads that flag off the row and it is not publication
 * metadata. Private libraries are untouched — there the work meta is the
 * book's own (toc rules, chapters, the same flag).
 */
export function dropWorkLevelBookmeta(db: Db = getDb()): WorkMetaDropReport {
  return db.transaction((tx) => {
    const done = tx.select({ id: libraryMigrationLog.id }).from(libraryMigrationLog)
      .where(and(
        eq(libraryMigrationLog.batch, WORK_META_DROP_BATCH),
        eq(libraryMigrationLog.status, 'completed'),
      )).get()
    if (done) return { skipped: true, works: 0 }

    const sharedIds = tx.select({ id: libraries.id }).from(libraries)
      .where(eq(libraries.type, 'shared')).all().map((row) => row.id)
    let works = 0
    if (sharedIds.length > 0) {
      for (const work of tx.select().from(libraryBooks).where(inArray(libraryBooks.libraryId, sharedIds)).all()) {
        const meta = (work.meta ?? {}) as Record<string, unknown>
        if (Object.keys(meta).length === 0) continue
        // `updatedAt` is left alone: dropping a layer nobody could reach is not
        // a reason to jump a work to the top of "recently updated".
        const kept = Object.hasOwn(meta, 'pendingUserDataDeletion')
          ? { pendingUserDataDeletion: meta.pendingUserDataDeletion }
          : {}
        tx.update(libraryBooks).set({ meta: kept }).where(eq(libraryBooks.id, work.id)).run()
        works += 1
      }
    }

    const report = { skipped: false, works }
    tx.insert(libraryMigrationLog).values({
      id: createId('mlog'), batch: WORK_META_DROP_BATCH,
      status: 'completed', details: report, startedAt: Date.now(), finishedAt: Date.now(),
    }).run()
    return report
  })
}
