import { and, eq, isNull, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type * as schema from '../../db/schema'
import { libraryBooks, libraryCategories } from '../../db/schema'
import { createId } from '../../lib/id'

type Database = BetterSQLite3Database<typeof schema>

/** Resolve or create a private category path while the caller's write transaction is open. */
export function resolveOrCreateCategoryPath(
  tx: Database,
  libraryId: string,
  userId: string,
  path: string[],
): string {
  if (path.length < 1 || path.length > 2 || path.some((name) => !name.trim())) {
    throw new Error('Category paths must contain one or two non-empty names')
  }
  const now = Date.now()
  let parentId: string | null = null
  let resolvedId = ''
  for (const name of path) {
    const existing = tx.select({ id: libraryCategories.id }).from(libraryCategories)
      .where(and(
        eq(libraryCategories.libraryId, libraryId),
        eq(libraryCategories.name, name),
        parentId === null ? isNull(libraryCategories.parentId) : eq(libraryCategories.parentId, parentId),
      )).get()
    if (existing) {
      resolvedId = existing.id
      parentId = existing.id
      continue
    }
    const max = tx.select({ max: sql<number>`max(${libraryCategories.sortOrder})` }).from(libraryCategories)
      .where(eq(libraryCategories.libraryId, libraryId)).get()
    resolvedId = createId('cat')
    tx.insert(libraryCategories).values({
      id: resolvedId, libraryId, userId, name, parentId,
      sortOrder: (max?.max ?? -1) + 1, pinned: false, hidden: false, createdAt: now, updatedAt: now,
    }).run()
    parentId = resolvedId
  }
  return resolvedId
}

/**
 * Remove categories a save created that nothing uses any more, deepest first so
 * a parent with no children of its own also goes.
 *
 * Undo calls this after restoring a book's previous category: a scraped
 * classification that no longer has a book should leave the tree exactly as it
 * was, instead of a row the user has to hunt down in the sidebar. Categories
 * that already existed before the save are never candidates — only the ids the
 * same write created.
 */
export function pruneEmptyCategories(
  tx: Pick<Database, 'select' | 'delete'>,
  libraryId: string,
  userId: string,
  createdIds: readonly string[],
) {
  for (const categoryId of [...createdIds].reverse()) {
    const category = tx.select({ parentId: libraryCategories.parentId }).from(libraryCategories)
      .where(and(
        eq(libraryCategories.id, categoryId),
        eq(libraryCategories.libraryId, libraryId),
        eq(libraryCategories.userId, userId),
      )).get()
    if (!category) continue
    const hasBooks = tx.select({ id: libraryBooks.id }).from(libraryBooks)
      .where(eq(libraryBooks.categoryId, categoryId)).get()
    const hasChildren = tx.select({ id: libraryCategories.id }).from(libraryCategories)
      .where(eq(libraryCategories.parentId, categoryId)).get()
    if (!hasBooks && !hasChildren) tx.delete(libraryCategories).where(eq(libraryCategories.id, categoryId)).run()
  }
}
