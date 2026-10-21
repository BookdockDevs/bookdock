import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/sqlite-core'

import { getDb } from '../../db/client'
import { libraryBookTags, libraryBookVersions, libraryBooks, libraryCategories, libraryMigrationLog, libraryTags, libraries, shelves } from '../../db/schema'
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

function categoryPath(db: Tx, categoryId: string, sourceLibraryId: string): Array<{ id: string; name: string; sortOrder: number }> | undefined {
  const path: Array<{ id: string; name: string; sortOrder: number }> = []
  let currentId: string | null = categoryId
  const seen = new Set<string>()
  while (currentId) {
    if (seen.has(currentId) || path.length === 2) return undefined
    seen.add(currentId)
    const row = db.select({ id: libraryCategories.id, name: libraryCategories.name, sortOrder: libraryCategories.sortOrder, parentId: libraryCategories.parentId, libraryId: libraryCategories.libraryId })
      .from(libraryCategories).where(eq(libraryCategories.id, currentId)).get()
    if (!row || row.libraryId !== sourceLibraryId) return undefined
    path.unshift({ id: row.id, name: row.name, sortOrder: row.sortOrder })
    currentId = row.parentId
  }
  return path
}

function ensurePrivateCategory(db: Tx, libraryId: string, userId: string, path: Array<{ id: string; name: string; sortOrder: number }>, now: number): string {
  let parentId: string | null = null
  let categoryId = ''
  for (const node of path) {
    const existing = db.select({ id: libraryCategories.id }).from(libraryCategories)
      .where(and(eq(libraryCategories.libraryId, libraryId), eq(libraryCategories.name, node.name), parentId === null ? isNull(libraryCategories.parentId) : eq(libraryCategories.parentId, parentId))).get()
    if (existing) {
      categoryId = existing.id
    } else {
      categoryId = createId('cat')
      db.insert(libraryCategories).values({ id: categoryId, libraryId, userId, name: node.name, parentId, sortOrder: node.sortOrder, pinned: false, hidden: false, createdAt: now, updatedAt: now }).run()
    }
    parentId = categoryId
  }
  return categoryId
}

/** Synchronous, atomic structure and metadata cutover. */
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
      ? tx.select().from(libraryCategories).where(inArray(libraryCategories.libraryId, privateLibraryIds)).all()
      : []
    const shelfIds = oldShelves.map((row) => row.id)
    if (oldShelves.some((row) => privateUserByLibrary.get(row.libraryId) !== row.userId)) {
      throw new Error('category/shelf separation found a shelf with mismatched private ownership')
    }
    if (shelfIds.length) {
      const references = tx.select({
        libraryId: libraryBooks.libraryId,
        userId: libraryBooks.userId,
        categoryLibraryId: libraryCategories.libraryId,
        categoryUserId: libraryCategories.userId,
        shelfId: libraryBooks.shelfId,
      }).from(libraryBooks).innerJoin(libraryCategories, eq(libraryCategories.id, libraryBooks.categoryId))
        .where(inArray(libraryBooks.categoryId, shelfIds)).all()
      if (references.some((row) => row.libraryId !== row.categoryLibraryId || row.userId !== row.categoryUserId || row.shelfId !== null)) {
        throw new Error('category/shelf separation found conflicting library-book assignments')
      }
    }
    for (const row of oldShelves) {
      tx.insert(shelves).values({ id: row.id, libraryId: row.libraryId, userId: row.userId, name: row.name, sortOrder: row.sortOrder, pinned: row.pinned, hidden: row.hidden, createdAt: row.createdAt, updatedAt: row.updatedAt }).run()
    }
    options.afterStage?.('shelves-copied')

    if (shelfIds.length) {
      for (const shelfId of shelfIds) tx.update(libraryBooks).set({ shelfId: sql`${libraryBooks.categoryId}` })
        .where(and(inArray(libraryBooks.libraryId, privateLibraryIds), eq(libraryBooks.categoryId, shelfId), isNull(libraryBooks.shelfId))).run()
    }
    options.afterStage?.('book-shelves-moved')

    if (shelfIds.length) tx.delete(libraryCategories).where(inArray(libraryCategories.id, shelfIds)).run()
    options.afterStage?.('old-categories-deleted')

    const anomalies: string[] = []
    let categories = 0
    let tags = 0
    const now = Date.now()
    for (const library of privateLibraries) {
      const sourceVersion = alias(libraryBookVersions, 'source_library_book_versions')
      const sourceBook = alias(libraryBooks, 'source_library_books')
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
            const categoryId = ensurePrivateCategory(tx, library.id, library.userId, path, now)
            tx.update(libraryBooks).set({ categoryId }).where(and(eq(libraryBooks.id, target.id), isNull(libraryBooks.categoryId))).run()
            categories += 1
          }
        }
        const sourceTags = tx.select({ name: libraryTags.name }).from(libraryBookTags)
          .innerJoin(libraryTags, and(eq(libraryTags.id, libraryBookTags.tagId), eq(libraryTags.libraryId, target.sourceLibraryId)))
          .where(eq(libraryBookTags.libraryBookId, target.sourceBookId)).all()
        for (const sourceTag of sourceTags) {
          let privateTag = tx.select({ id: libraryTags.id }).from(libraryTags)
            .where(and(eq(libraryTags.libraryId, library.id), eq(libraryTags.name, sourceTag.name))).get()
          if (!privateTag) {
            const id = createId('tag')
            tx.insert(libraryTags).values({ id, libraryId: library.id, userId: library.userId, name: sourceTag.name, sortOrder: 0, pinned: false, hidden: false, createdAt: now, updatedAt: now }).run()
            privateTag = { id }
          }
          const relation = tx.select({ tagId: libraryBookTags.tagId }).from(libraryBookTags)
            .where(and(eq(libraryBookTags.libraryBookId, target.id), eq(libraryBookTags.tagId, privateTag.id))).get()
          if (!relation) {
            tx.insert(libraryBookTags).values({ libraryBookId: target.id, tagId: privateTag.id }).run()
            tags += 1
          }
        }
      }
    }
    options.afterStage?.('metadata-copied')
    options.afterStage?.('before-marker')
    tx.insert(libraryMigrationLog).values({ id: createId('mlog'), batch: CATEGORY_SHELF_MIGRATION_BATCH, status: 'completed', details: { shelves: oldShelves.length, categories, tags, anomalies }, startedAt: now, finishedAt: Date.now() }).run()
    return { skipped: false, shelves: oldShelves.length, categories, tags, anomalies }
  })
}
