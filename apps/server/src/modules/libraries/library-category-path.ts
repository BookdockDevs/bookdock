import { and, eq, isNull, sql } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

import type * as schema from '../../db/schema'
import { libraryCategories } from '../../db/schema'
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
