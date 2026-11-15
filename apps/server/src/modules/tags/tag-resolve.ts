import { and, eq, inArray, sql } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { libraryBookTags, libraryTags } from '../../db/schema'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'

type Tx = Pick<ReturnType<typeof getDb>, 'select' | 'insert'>

export interface TagResolution {
  /** Every id the caller asked for plus every name that resolved to one. */
  tagIds: string[]
  /** Tags this call created, so undo can drop them again once nothing links to them. */
  createdIds: string[]
}

/**
 * Turn "these ids plus these names" into one tag set inside the caller's
 * transaction.
 *
 * Scraped tags reach an editor as bare names and used to be created the moment
 * the user pressed 应用, which left orphan rows whenever they backed out or
 * removed the tag before saving. Names now ride along with the save, so the tag
 * rows appear — and disappear with a rollback — as part of the same write.
 *
 * Names are matched case-insensitively against the library's existing tags
 * before a new one is inserted, so a scrape that names the same tag twice, or a
 * tag another device created a second ago, never duplicates.
 */
export function resolveTagSet(
  tx: Tx,
  libraryId: string,
  userId: string,
  input: { tagIds?: string[]; tagNames?: string[] },
): TagResolution {
  const tagIds = [...new Set(input.tagIds ?? [])]
  if (tagIds.length > 0) {
    const found = tx.select({ count: sql<number>`count(*)` }).from(libraryTags)
      .where(and(eq(libraryTags.libraryId, libraryId), inArray(libraryTags.id, tagIds))).get()
    if ((found?.count ?? 0) !== tagIds.length) throw new AppError('TAG_NOT_FOUND', 'Tag not found')
  }
  const names = (input.tagNames ?? []).map((name) => name.trim().slice(0, 100)).filter(Boolean)
  if (names.length === 0) return { tagIds, createdIds: [] }

  const rows = tx.select({ id: libraryTags.id, name: libraryTags.name, sortOrder: libraryTags.sortOrder })
    .from(libraryTags).where(eq(libraryTags.libraryId, libraryId)).all()
  const byName = new Map(rows.map((row) => [row.name.trim().toLowerCase(), row.id]))
  let nextSortOrder = rows.reduce((max, row) => Math.max(max, row.sortOrder), -1) + 1
  const now = Date.now()
  const createdIds: string[] = []
  for (const name of names) {
    const key = name.toLowerCase()
    const existing = byName.get(key)
    if (existing) {
      if (!tagIds.includes(existing)) tagIds.push(existing)
      continue
    }
    const id = createId('tag')
    tx.insert(libraryTags).values({
      id, libraryId, userId, name, sortOrder: nextSortOrder++, pinned: false, hidden: false, createdAt: now, updatedAt: now,
    }).run()
    byName.set(key, id)
    tagIds.push(id)
    createdIds.push(id)
  }
  return { tagIds, createdIds }
}

/**
 * Drop tags a save created once nothing references them any more.
 *
 * Only the ids that same write created are candidates: a tag the user already
 * had is never deleted here, no matter where its links end up, because undo
 * must not turn "restore my book" into "delete my taxonomy".
 */
export function deleteUnusedCreatedTags(
  tx: Pick<ReturnType<typeof getDb>, 'select' | 'delete'>,
  createdIds: readonly string[],
) {
  for (const tagId of createdIds) {
    const linked = tx.select({ id: libraryBookTags.libraryBookId }).from(libraryBookTags)
      .where(eq(libraryBookTags.tagId, tagId)).get()
    if (linked) continue
    tx.delete(libraryTags).where(eq(libraryTags.id, tagId)).run()
  }
}
