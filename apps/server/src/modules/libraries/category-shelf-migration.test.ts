import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runDatabaseMigrations } from '../../db/client'
import * as schema from '../../db/schema'
import { legacyCategoryAssignedBooks, legacyLibraryBookTags, legacyLibraryCategories, legacyLibraryTags } from '../../db/legacy-classification-schema'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { migrateBeforeBookRetirement, migrateWithTagFilter } from '../../db/migration-stage'
import { retargetBookIdReferences } from '../../db/client'
import { migrateCategoryShelfSeparation, CATEGORY_SHELF_MIGRATION_BATCH } from './category-shelf-migration'

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations')

function createDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrateBeforeBookRetirement(db, { migrationsFolder })
  retargetBookIdReferences(db)
  migrateWithTagFilter(db, { migrationsFolder }, ({ tag }) => tag <= '0068_book_classification_values')
  return { db, sqlite }
}

function seedLegacyState(db: ReturnType<typeof createDb>['db'], sqlite: Database.Database) {
  db.insert(schema.users).values({ id: 'u1', username: 'user', createdAt: 1 }).run()
  db.insert(schema.libraries).values([
    { id: 'private', userId: 'u1', type: 'private', name: '', description: '', visibility: null, createdAt: 1, updatedAt: 1 },
    { id: 'shared', userId: 'u1', type: 'shared', name: 'Shared', description: '', visibility: 'public', createdAt: 1, updatedAt: 1 },
  ]).run()
  db.insert(legacyLibraryCategories).values([
    { id: 'old-shelf', libraryId: 'private', userId: 'u1', name: 'Reading', parentId: null, sortOrder: 7, pinned: true, hidden: true, createdAt: 2, updatedAt: 3 },
    { id: 'source-root', libraryId: 'shared', userId: 'u1', name: 'Fiction', parentId: null, sortOrder: 4, pinned: false, hidden: false, createdAt: 2, updatedAt: 3 },
    { id: 'source-child', libraryId: 'shared', userId: 'u1', name: 'Mystery', parentId: 'source-root', sortOrder: 5, pinned: false, hidden: false, createdAt: 2, updatedAt: 3 },
  ]).run()
  db.insert(schema.libraryBooks).values([
    { id: 'personal-card', libraryId: 'private', userId: 'u1', title: 'Personal', author: '', description: '', coverKey: null, createdAt: 2, updatedAt: 3 },
    { id: 'shared-card', libraryId: 'private', userId: 'u1', title: 'Collected', author: '', description: '', coverKey: null, createdAt: 2, updatedAt: 3 },
    { id: 'source-card', libraryId: 'shared', userId: 'u1', title: 'Source', author: '', description: '', coverKey: null, createdAt: 2, updatedAt: 3 },
  ]).run()
  sqlite.exec("UPDATE library_books SET category_id = 'old-shelf' WHERE id = 'personal-card'; UPDATE library_books SET category_id = 'source-child' WHERE id = 'source-card';")
  db.insert(schema.bookVersions).values([
    { id: 'personal-version', format: 'epub', size: 1, createdAt: 2, updatedAt: 3 },
    { id: 'source-version', format: 'epub', size: 1, createdAt: 2, updatedAt: 3 },
    { id: 'collected-version', format: 'epub', size: 1, createdAt: 2, updatedAt: 3 },
  ]).run()
  db.insert(schema.libraryBookVersions).values([
    { id: 'personal-link', libraryId: 'private', libraryBookId: 'personal-card', bookVersionId: 'personal-version', kind: 'personal', status: 'published', name: '', createdAt: 2, updatedAt: 3 },
    { id: 'source-link', libraryId: 'shared', libraryBookId: 'source-card', bookVersionId: 'source-version', kind: 'personal', status: 'published', name: '', createdAt: 2, updatedAt: 3 },
    { id: 'collected-link', libraryId: 'private', libraryBookId: 'shared-card', bookVersionId: 'source-version', kind: 'shared', status: 'published', name: '', sourceLibraryId: 'shared', sourceLibraryBookVersionId: 'source-link', createdAt: 2, updatedAt: 3 },
  ]).run()
  db.insert(legacyLibraryTags).values([
    { id: 'private-tag', libraryId: 'private', userId: 'u1', name: 'Personal label', sortOrder: 9, pinned: true, hidden: true, createdAt: 1, updatedAt: 2 },
    { id: 'source-tag', libraryId: 'shared', userId: 'u1', name: 'Mystery', sortOrder: 2, pinned: false, hidden: false, createdAt: 1, updatedAt: 2 },
  ]).run()
  db.insert(legacyLibraryBookTags).values({ libraryBookId: 'shared-card', tagId: 'private-tag' }).run()
  db.insert(legacyLibraryBookTags).values({ libraryBookId: 'source-card', tagId: 'source-tag' }).run()
}

describe('category and shelf separation migration', () => {
  let db: ReturnType<typeof createDb>['db']
  let sqlite: Database.Database

  beforeEach(() => {
    const created = createDb()
    db = created.db
    sqlite = created.sqlite
    seedLegacyState(db, sqlite)
  })

  it('moves private shelves and their book links, then copies collected taxonomy by source path and name', () => {
    const result = migrateCategoryShelfSeparation(db)

    expect(result).toMatchObject({ skipped: false, shelves: 1, categories: 1, tags: 1 })
    expect(db.select().from(schema.shelves).all()).toMatchObject([
      { id: 'old-shelf', libraryId: 'private', userId: 'u1', name: 'Reading', sortOrder: 7, pinned: true, hidden: true, createdAt: 2, updatedAt: 3 },
    ])
    expect(db.select({ shelfId: legacyCategoryAssignedBooks.shelfId, categoryId: legacyCategoryAssignedBooks.categoryId }).from(legacyCategoryAssignedBooks).where(eq(legacyCategoryAssignedBooks.id, 'personal-card')).get())
      .toEqual({ shelfId: 'old-shelf', categoryId: null })
    expect(db.select().from(legacyLibraryCategories).all().filter((row) => row.libraryId === 'private')).toEqual([])
    expect(db.select({ categoryRoot: schema.libraryBooks.categoryRoot, categoryLeaf: schema.libraryBooks.categoryLeaf }).from(schema.libraryBooks).where(eq(schema.libraryBooks.id, 'shared-card')).get())
      .toEqual({ categoryRoot: 'Fiction', categoryLeaf: 'Mystery' })
    const tags = db.select({ id: legacyLibraryTags.id, name: legacyLibraryTags.name, pinned: legacyLibraryTags.pinned, hidden: legacyLibraryTags.hidden }).from(legacyLibraryTags).where(eq(legacyLibraryTags.libraryId, 'private')).all()
    expect(tags).toContainEqual({ id: 'private-tag', name: 'Personal label', pinned: true, hidden: true })
    expect(tags).toEqual([{ id: 'private-tag', name: 'Personal label', pinned: true, hidden: true }])
    expect(db.select({ name: schema.libraryBookTagValues.name }).from(schema.libraryBookTagValues).where(eq(schema.libraryBookTagValues.libraryBookId, 'shared-card')).all())
      .toEqual([{ name: 'Mystery' }])

    expect(migrateCategoryShelfSeparation(db)).toMatchObject({ skipped: true })
    expect(db.select({ categoryRoot: schema.libraryBooks.categoryRoot, categoryLeaf: schema.libraryBooks.categoryLeaf }).from(schema.libraryBooks).where(eq(schema.libraryBooks.id, 'shared-card')).get())
      .toEqual({ categoryRoot: 'Fiction', categoryLeaf: 'Mystery' })
    sqlite.close()
  }, 15000)

  it('rolls every data stage back when interrupted, including immediately before the marker', () => {
    for (const stage of ['shelves-copied', 'book-shelves-moved', 'old-categories-deleted', 'metadata-copied', 'before-marker'] as const) {
      const isolated = createDb()
      seedLegacyState(isolated.db, isolated.sqlite)
      expect(() => migrateCategoryShelfSeparation(isolated.db, { afterStage(current) { if (current === stage) throw new Error(stage) } })).toThrow(stage)
      expect(isolated.db.select().from(schema.shelves).all()).toEqual([])
      expect(isolated.db.select({ categoryId: legacyCategoryAssignedBooks.categoryId, shelfId: legacyCategoryAssignedBooks.shelfId }).from(legacyCategoryAssignedBooks).where(eq(legacyCategoryAssignedBooks.id, 'personal-card')).get())
        .toEqual({ categoryId: 'old-shelf', shelfId: null })
      expect(isolated.db.select().from(schema.libraryMigrationLog).where(eq(schema.libraryMigrationLog.batch, CATEGORY_SHELF_MIGRATION_BATCH)).all()).toEqual([])
      expect(isolated.db.select({ id: legacyLibraryCategories.id }).from(legacyLibraryCategories).where(eq(legacyLibraryCategories.id, 'old-shelf')).get()).toEqual({ id: 'old-shelf' })
      isolated.sqlite.close()
    }
    sqlite.close()
  }, 15000)

  it('rolls back prior shelf moves and deletions when a category write fails', () => {
    sqlite.exec(`
      CREATE TRIGGER fail_collected_tag_insert
      BEFORE INSERT ON library_book_tag_values
      WHEN NEW.library_book_id = 'shared-card'
      BEGIN
        SELECT RAISE(ABORT, 'injected collected tag write failure');
      END;
    `)

    expect(() => migrateCategoryShelfSeparation(db)).toThrow(/injected collected tag write failure/)
    expect(db.select().from(schema.shelves).all()).toEqual([])
    expect(db.select({ id: legacyLibraryCategories.id }).from(legacyLibraryCategories).where(eq(legacyLibraryCategories.libraryId, 'private')).all())
      .toEqual([{ id: 'old-shelf' }])
    expect(db.select({ categoryId: legacyCategoryAssignedBooks.categoryId, shelfId: legacyCategoryAssignedBooks.shelfId }).from(legacyCategoryAssignedBooks).where(eq(legacyCategoryAssignedBooks.id, 'personal-card')).get())
      .toEqual({ categoryId: 'old-shelf', shelfId: null })
    expect(db.select({ libraryBookId: legacyLibraryBookTags.libraryBookId, tagId: legacyLibraryBookTags.tagId }).from(legacyLibraryBookTags).where(eq(legacyLibraryBookTags.libraryBookId, 'shared-card')).all())
      .toEqual([{ libraryBookId: 'shared-card', tagId: 'private-tag' }])
    expect(db.select().from(schema.libraryMigrationLog).where(eq(schema.libraryMigrationLog.batch, CATEGORY_SHELF_MIGRATION_BATCH)).all()).toEqual([])
    sqlite.close()
  }, 15000)

  it('blocks unmarked partial shelf state instead of guessing old IDs', () => {
    db.insert(schema.shelves).values({ id: 'already-moved', libraryId: 'private', userId: 'u1', name: 'Existing', createdAt: 1, updatedAt: 1 }).run()
    expect(() => migrateCategoryShelfSeparation(db)).toThrow(/partial data/)
    expect(db.select({ id: legacyLibraryCategories.id }).from(legacyLibraryCategories).where(eq(legacyLibraryCategories.id, 'old-shelf')).get())
      .toEqual({ id: 'old-shelf' })
    expect(db.select().from(schema.libraryMigrationLog).where(eq(schema.libraryMigrationLog.batch, CATEGORY_SHELF_MIGRATION_BATCH)).all()).toEqual([])
    sqlite.close()
  }, 15000)

  it('rejects a private book that points at another private library shelf', () => {
    db.insert(schema.users).values({ id: 'u2', username: 'other', createdAt: 1 }).run()
    db.insert(schema.libraries).values({ id: 'private-2', userId: 'u2', type: 'private', name: '', description: '', visibility: null, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBooks).values({ id: 'cross-private-card', libraryId: 'private-2', userId: 'u2', title: 'Invalid', author: '', description: '', coverKey: null, createdAt: 2, updatedAt: 3 }).run()
    sqlite.exec("UPDATE library_books SET category_id = 'old-shelf' WHERE id = 'cross-private-card'")

    expect(() => migrateCategoryShelfSeparation(db)).toThrow(/conflicting library-book assignments/)
    expect(db.select().from(schema.shelves).all()).toEqual([])
    expect(db.select({ categoryId: legacyCategoryAssignedBooks.categoryId }).from(legacyCategoryAssignedBooks).where(eq(legacyCategoryAssignedBooks.id, 'cross-private-card')).get())
      .toEqual({ categoryId: 'old-shelf' })
    sqlite.close()
  }, 15000)

  it('skips source metadata when the collected version identity no longer matches', () => {
    db.update(schema.libraryBookVersions).set({ bookVersionId: 'collected-version' }).where(eq(schema.libraryBookVersions.id, 'collected-link')).run()
    const result = migrateCategoryShelfSeparation(db)

    expect(result.anomalies).toContain('shared-card: source identity mismatch')
    expect(db.select({ categoryId: legacyCategoryAssignedBooks.categoryId }).from(legacyCategoryAssignedBooks).where(eq(legacyCategoryAssignedBooks.id, 'shared-card')).get())
      .toEqual({ categoryId: null })
    expect(db.select({ name: legacyLibraryTags.name }).from(legacyLibraryTags).where(eq(legacyLibraryTags.libraryId, 'private')).all())
      .toEqual([{ name: 'Personal label' }])
    sqlite.close()
  }, 15000)

  it('records an empty fresh install without creating categories', () => {
    const fresh = createDb()
    expect(migrateCategoryShelfSeparation(fresh.db)).toMatchObject({ skipped: false, shelves: 0, categories: 0, tags: 0 })
    expect(fresh.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'library_categories'").all()).toEqual([{ name: 'library_categories' }])
    expect(migrateCategoryShelfSeparation(fresh.db)).toMatchObject({ skipped: true })
    fresh.sqlite.close()
    sqlite.close()
  }, 15000)

  it('records the completion marker from the runtime migration path and skips it on restart', async () => {
    const fresh = createDb()
    vi.spyOn(storage, 'getStorage').mockReturnValue({} as StorageDriver)

    await runDatabaseMigrations(fresh.db)
    await runDatabaseMigrations(fresh.db)

    expect(fresh.db.select().from(schema.libraryMigrationLog).where(eq(schema.libraryMigrationLog.batch, CATEGORY_SHELF_MIGRATION_BATCH)).all())
      .toHaveLength(1)
    expect(fresh.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'library_categories'").all()).toEqual([])
    vi.restoreAllMocks()
    fresh.sqlite.close()
    sqlite.close()
  }, 15000)
})
