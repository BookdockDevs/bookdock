import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm'

import { getDb } from '../../db/client'
import { libraries, libraryBooks, libraryBookTags, libraryBookVersions, libraryTags } from '../../db/schema'
import { loadLibraryHiddenTaxonomy, pendingBookDataDeletionVersionIds } from '../libraries/library-query'

export function excludedReadingBookVersionIds(db: ReturnType<typeof getDb>, userId: string, showHidden = false): string[] {
  return [...new Set([...pendingBookDataDeletionVersionIds(db, userId), ...(showHidden ? [] : hiddenBookVersionIds(db, userId))])]
}
/**
 * Version ids hidden from the owner's default stats views (private vault).
 * Aggregates exclude these rows unless the caller reveals them; per-book
 * endpoints keep their own assertReadableBook flag instead.
 */
export function hiddenBookVersionIds(db: ReturnType<typeof getDb>, userId: string): string[] {
  const library = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (!library) return []
  const taxonomy = loadLibraryHiddenTaxonomy(db, library.id)
  const hiddenWorkConditions: SQL[] = [eq(libraryBooks.hidden, true)]
  if (taxonomy.hiddenCategoryIds.length > 0) {
    hiddenWorkConditions.push(inArray(libraryBooks.categoryId, taxonomy.hiddenCategoryIds))
  }
  if (taxonomy.hiddenTagIds.length > 0) {
    hiddenWorkConditions.push(sql`EXISTS (
      SELECT 1 FROM ${libraryBookTags} AS stats_hidden_tag
      INNER JOIN ${libraryTags} AS stats_hidden_name ON stats_hidden_name.id = stats_hidden_tag.tag_id
      WHERE stats_hidden_tag.library_book_id = ${libraryBooks.id}
        AND stats_hidden_tag.tag_id IN ${taxonomy.hiddenTagIds}
    )`)
  }
  const works = db.select({ id: libraryBooks.id }).from(libraryBooks)
    .where(and(eq(libraryBooks.libraryId, library.id), or(...hiddenWorkConditions))).all()
  if (works.length === 0) return []
  return db.select({ bookVersionId: libraryBookVersions.bookVersionId }).from(libraryBookVersions)
    .where(inArray(libraryBookVersions.libraryBookId, works.map((w) => w.id)))
    .all().map((row) => row.bookVersionId)
}
