import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'

import { getDb } from '../../db/client'
import {
  legacyCategoryAssignedBooks,
  legacyLibraryBookTags,
  legacyLibraryCategories,
  legacyLibraryTags,
} from '../../db/legacy-classification-schema'
import { libraryBookTagValues, libraryBookVersions, libraryBooks, libraryMigrationLog, libraries, shelves } from '../../db/schema'
import { createId } from '../../lib/id'

export const CATEGORY_SHELF_MIGRATION_BATCH = 'category-shelf-separation-v1'

type Db = ReturnType<typeof getDb>
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]
type MigrationStage = 'shelves-copied' | 'book-shelves-moved' | 'old-categories-deleted' | 'metadata-copied' | 'before-marker'

interface MigrationOptions {
  afterStage?: (stage: MigrationStage) => void
}

interface SourceBook {
  id: string
  libraryId: string
  userId: string
  sourceLibraryId: string | null
  sourceLibraryBookVersionId: string | null
  sourceBookId: string | null
  sourceBookLibraryId: string | null
  sourceVersionBookVersionId: string | null
  sourceCategoryId: string | null
  bookVersionId: string
}

/** Name path of a legacy category, or undefined when the row is not that library's. */
function categoryPath(db: Tx, categoryId: string, sourceLibraryId: string): string[] | undefined {
  const path: string[] = []
  let currentId: string | null = categoryId
  const seen = new Set<string>()
  while (currentId) {
    if (seen.has(currentId) || path.length === 2) return undefined
    seen.add(currentId)
    const row = db.select({ id: legacyLibraryCategories.id, name: legacyLibraryCategories.name, parentId: legacyLibraryCategories.parentId, libraryId: legacyLibraryCategories.libraryId })
      .from(legacyLibraryCategories).where(eq(legacyLibraryCategories.id, currentId)).get()
    if (!row || row.libraryId !== sourceLibraryId) return undefined
    path.unshift(row.name)
    currentId = row.parentId
  }
  return path
}

/**
 * Historical cutover: private libraries used to keep their bookshelves in the
 * category table, so the first step is separating the two — those rows become
 * shelves and their book assignments become shelf membership.
 *
 * The second half used to materialise the *source* library's categories and tags
 * in the private library. Categories and tags are values now, so it writes the
 * source's name path and tag names onto the collected card instead; the copy is
 * complete without inventing any row.
 */
export function migrateCategoryShelfSeparation(db: Db = getDb(), options: MigrationOptions = {}) {
  return db.transaction((tx) => {
    const completed = tx.select({ id: libraryMigrationLog.id }).from(libraryMigrationLog)
      .where(and(eq(libraryMigrationLog.batch, CATEGORY_SHELF_MIGRATION_BATCH), eq(libraryMigrationLog.status, 'completed'))).get()
    if (completed) return { skipped: true, shelves: 0, categories: 0, tags: 0, anomalies: [] as string[] }

    const privateLibraries = tx.select({ id: libraries.id, userId: libraries.userId }).from(libraries).where(eq(libraries.type, 'private')).all()
    const privateLibraryIds = privateLibraries.map((library) => library.id)
    const privateUserByLibrary = new Map(privateLibraries.map((library) => [library.id, library.userId] as const))
    const existingShelves = tx.select({ id: shelves.id }).from(shelves).get()
    const existingShelfAssignment = tx.select({ id: libraryBooks.id }).from(libraryBooks)
      .where(sql`${libraryBooks.shelfId} IS NOT NULL`).get()
    if (existingShelves || existingShelfAssignment) throw new Error('category/shelf separation has partial data without its completion marker')
    const oldShelves = privateLibraryIds.length
      ? tx.select().from(legacyLibraryCategories).where(inArray(legacyLibraryCategories.libraryId, privateLibraryIds)).all()
      : []
    const shelfIds = oldShelves.map((row) => row.id)
    if (oldShelves.some((row) => privateUserByLibrary.get(row.libraryId) !== row.userId)) {
      throw new Error('category/shelf separation found a shelf with mismatched private ownership')
    }
    if (shelfIds.length) {
      const references = tx.select({
        libraryId: legacyCategoryAssignedBooks.libraryId,
        userId: legacyCategoryAssignedBooks.userId,
        categoryLibraryId: legacyLibraryCategories.libraryId,
        categoryUserId: legacyLibraryCategories.userId,
        shelfId: legacyCategoryAssignedBooks.shelfId,
      }).from(legacyCategoryAssignedBooks).innerJoin(legacyLibraryCategories, eq(legacyLibraryCategories.id, legacyCategoryAssignedBooks.categoryId))
        .where(inArray(legacyCategoryAssignedBooks.categoryId, shelfIds)).all()
      if (references.some((row) => row.libraryId !== row.categoryLibraryId || row.userId !== row.categoryUserId || row.shelfId !== null)) {
        throw new Error('category/shelf separation found conflicting library-book assignments')
      }
    }
    for (const row of oldShelves) {
      tx.insert(shelves).values({ id: row.id, libraryId: row.libraryId, userId: row.userId, name: row.name, sortOrder: row.sortOrder, pinned: row.pinned, hidden: row.hidden, createdAt: row.createdAt, updatedAt: row.updatedAt }).run()
    }
    options.afterStage?.('shelves-copied')

    if (shelfIds.length) {
      for (const shelfId of shelfIds) {
        tx.update(legacyCategoryAssignedBooks).set({ shelfId: sql`${legacyCategoryAssignedBooks.categoryId}` })
          .where(and(inArray(legacyCategoryAssignedBooks.libraryId, privateLibraryIds), eq(legacyCategoryAssignedBooks.categoryId, shelfId), isNull(legacyCategoryAssignedBooks.shelfId))).run()
      }
    }
    options.afterStage?.('book-shelves-moved')

    if (shelfIds.length) tx.delete(legacyLibraryCategories).where(inArray(legacyLibraryCategories.id, shelfIds)).run()
    options.afterStage?.('old-categories-deleted')

    const anomalies: string[] = []
    let categories = 0
    let tags = 0
    const now = Date.now()
    for (const library of privateLibraries) {
      const sourceVersion = alias(libraryBookVersions, 'source_library_book_versions')
      const sourceBook = alias(legacyCategoryAssignedBooks, 'source_library_books')
      const targets = tx.select({
        id: libraryBooks.id,
        libraryId: libraryBooks.libraryId,
        userId: libraryBooks.userId,
        sourceLibraryId: libraryBookVersions.sourceLibraryId,
        sourceLibraryBookVersionId: libraryBookVersions.sourceLibraryBookVersionId,
        sourceBookId: sourceVersion.libraryBookId,
        sourceBookLibraryId: sourceBook.libraryId,
        sourceVersionBookVersionId: sourceVersion.bookVersionId,
        sourceCategoryId: sourceBook.categoryId,
        bookVersionId: libraryBookVersions.bookVersionId,
      }).from(libraryBooks)
        .innerJoin(libraryBookVersions, eq(libraryBookVersions.libraryBookId, libraryBooks.id))
        .leftJoin(sourceVersion, and(eq(sourceVersion.id, libraryBookVersions.sourceLibraryBookVersionId), eq(sourceVersion.libraryId, libraryBookVersions.sourceLibraryId)))
        .leftJoin(sourceBook, eq(sourceBook.id, sourceVersion.libraryBookId))
        .where(and(eq(libraryBooks.libraryId, library.id), eq(libraryBookVersions.kind, 'shared'))).all() as SourceBook[]
      for (const target of targets) {
        if (!target.sourceLibraryId || !target.sourceLibraryBookVersionId || !target.sourceBookId) {
          anomalies.push(`${target.id}: missing or mismatched source library/version`)
          continue
        }
        const sourceLibrary = tx.select({ id: libraries.id }).from(libraries)
          .where(and(eq(libraries.id, target.sourceLibraryId), eq(libraries.type, 'shared'))).get()
        const sourceLink = tx.select({ id: libraryBookVersions.id }).from(libraryBookVersions)
          .where(and(eq(libraryBookVersions.id, target.sourceLibraryBookVersionId), eq(libraryBookVersions.libraryId, target.sourceLibraryId), eq(libraryBookVersions.libraryBookId, target.sourceBookId))).get()
        if (!sourceLibrary || !sourceLink || target.sourceBookLibraryId !== target.sourceLibraryId || target.sourceVersionBookVersionId !== target.bookVersionId) {
          anomalies.push(`${target.id}: source identity mismatch`)
          continue
        }
        if (target.sourceCategoryId) {
          const path = categoryPath(tx, target.sourceCategoryId, target.sourceLibraryId)
          if (!path) {
            anomalies.push(`${target.id}: missing, mismatched or invalid source category path`)
          } else {
            tx.update(libraryBooks)
              .set({ categoryRoot: path[0] ?? null, categoryLeaf: path[1] ?? null })
              .where(and(eq(libraryBooks.id, target.id), isNull(libraryBooks.categoryRoot))).run()
            categories += 1
          }
        }
        const sourceTags = tx.select({ name: legacyLibraryTags.name }).from(legacyLibraryBookTags)
          .innerJoin(legacyLibraryTags, and(eq(legacyLibraryTags.id, legacyLibraryBookTags.tagId), eq(legacyLibraryTags.libraryId, target.sourceLibraryId)))
          .where(eq(legacyLibraryBookTags.libraryBookId, target.sourceBookId)).all()
        for (const [sortOrder, sourceTag] of sourceTags.entries()) {
          const existing = tx.select({ id: libraryBookTagValues.id }).from(libraryBookTagValues)
            .where(and(eq(libraryBookTagValues.libraryBookId, target.id), eq(libraryBookTagValues.name, sourceTag.name))).get()
          if (existing) continue
          tx.insert(libraryBookTagValues).values({ id: createId('btv'), libraryBookId: target.id, name: sourceTag.name, sortOrder }).run()
          tags += 1
        }
      }
    }
    options.afterStage?.('metadata-copied')
    options.afterStage?.('before-marker')
    tx.insert(libraryMigrationLog).values({ id: createId('mlog'), batch: CATEGORY_SHELF_MIGRATION_BATCH, status: 'completed', details: { shelves: oldShelves.length, categories, tags, anomalies }, startedAt: now, finishedAt: Date.now() }).run()
    return { skipped: false, shelves: oldShelves.length, categories, tags, anomalies }
  })
}
