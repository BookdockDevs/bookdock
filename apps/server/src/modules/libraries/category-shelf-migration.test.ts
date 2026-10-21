import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { runDatabaseMigrations } from '../../db/client'
import * as schema from '../../db/schema'
import * as storage from '../../storage'
import type { StorageDriver } from '../../storage/driver'
import { migrateBeforeBookRetirement } from '../../db/migration-stage'
import { retargetBookIdReferences } from '../../db/client'
import { migrateCategoryShelfSeparation, CATEGORY_SHELF_MIGRATION_BATCH } from './category-shelf-migration'

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations')

function createDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrateBeforeBookRetirement(db, { migrationsFolder })
  retargetBookIdReferences(db)
  migrate(db, { migrationsFolder })
  return { db, sqlite }
}

function seedLegacyState(db: ReturnType<typeof createDb>['db']) {
  db.insert(schema.users).values({ id: 'u1', username: 'user', createdAt: 1 }).run()
  db.insert(schema.libraries).values([
    { id: 'private', userId: 'u1', type: 'private', name: '', description: '', visibility: null, createdAt: 1, updatedAt: 1 },
    { id: 'shared', userId: 'u1', type: 'shared', name: 'Shared', description: '', visibility: 'public', createdAt: 1, updatedAt: 1 },
  ]).run()
  db.insert(schema.libraryCategories).values([
    { id: 'old-shelf', libraryId: 'private', userId: 'u1', name: 'Reading', parentId: null, sortOrder: 7, pinned: true, hidden: true, createdAt: 2, updatedAt: 3 },
    { id: 'source-root', libraryId: 'shared', userId: 'u1', name: 'Fiction', parentId: null, sortOrder: 4, pinned: false, hidden: false, createdAt: 2, updatedAt: 3 },
    { id: 'source-child', libraryId: 'shared', userId: 'u1', name: 'Mystery', parentId: 'source-root', sortOrder: 5, pinned: false, hidden: false, createdAt: 2, updatedAt: 3 },
  ]).run()
  db.insert(schema.libraryBooks).values([
    { id: 'personal-card', libraryId: 'private', userId: 'u1', categoryId: 'old-shelf', title: 'Personal', author: '', description: '', coverKey: null, createdAt: 2, updatedAt: 3 },
    { id: 'shared-card', libraryId: 'private', userId: 'u1', categoryId: null, title: 'Collected', author: '', description: '', coverKey: null, createdAt: 2, updatedAt: 3 },
    { id: 'source-card', libraryId: 'shared', userId: 'u1', categoryId: 'source-child', title: 'Source', author: '', description: '', coverKey: null, createdAt: 2, updatedAt: 3 },
  ]).run()
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
  db.insert(schema.libraryTags).values([
    { id: 'private-tag', libraryId: 'private', userId: 'u1', name: 'Personal label', sortOrder: 9, pinned: true, hidden: true, createdAt: 1, updatedAt: 2 },
    { id: 'source-tag', libraryId: 'shared', userId: 'u1', name: 'Mystery', sortOrder: 2, pinned: false, hidden: false, createdAt: 1, updatedAt: 2 },
  ]).run()
  db.insert(schema.libraryBookTags).values({ libraryBookId: 'shared-card', tagId: 'private-tag' }).run()
  db.insert(schema.libraryBookTags).values({ libraryBookId: 'source-card', tagId: 'source-tag' }).run()
}

describe('category and shelf separation migration', () => {
  let db: ReturnType<typeof createDb>['db']
  let sqlite: Database.Database

  beforeEach(() => {
    const created = createDb()
    db = created.db
    sqlite = created.sqlite
    seedLegacyState(db)
  })

  it('moves private shelves and their book links, then copies collected taxonomy by source path and name', () => {
    const result = migrateCategoryShelfSeparation(db)

    expect(result).toMatchObject({ skipped: false, shelves: 1, categories: 1, tags: 1 })
    expect(db.select().from(schema.shelves).all()).toMatchObject([
      { id: 'old-shelf', libraryId: 'private', userId: 'u1', name: 'Reading', sortOrder: 7, pinned: true, hidden: true, createdAt: 2, updatedAt: 3 },
    ])
    expect(db.select({ shelfId: schema.libraryBooks.shelfId, categoryId: schema.libraryBooks.categoryId }).from(schema.libraryBooks).where(eq(schema.libraryBooks.id, 'personal-card')).get())
      .toEqual({ shelfId: 'old-shelf', categoryId: null })
    expect(db.select().from(schema.libraryCategories).all().filter((row) => row.libraryId === 'private'))
      .toMatchObject([{ name: 'Fiction', parentId: null }, { name: 'Mystery', parentId: expect.any(String) }])
    const collected = db.select({ categoryId: schema.libraryBooks.categoryId }).from(schema.libraryBooks).where(eq(schema.libraryBooks.id, 'shared-card')).get()
    expect(db.select({ name: schema.libraryCategories.name }).from(schema.libraryCategories).where(eq(schema.libraryCategories.id, collected!.categoryId!)).get())
      .toEqual({ name: 'Mystery' })
    const tags = db.select({ id: schema.libraryTags.id, name: schema.libraryTags.name, pinned: schema.libraryTags.pinned, hidden: schema.libraryTags.hidden }).from(schema.libraryTags).where(eq(schema.libraryTags.libraryId, 'private')).all()
    expect(tags).toContainEqual({ id: 'private-tag', name: 'Personal label', pinned: true, hidden: true })
    expect(tags.filter((tag) => tag.name === 'Mystery')).toHaveLength(1)
    expect(db.select().from(schema.libraryBookTags).where(eq(schema.libraryBookTags.libraryBookId, 'shared-card')).all()).toHaveLength(2)

    db.update(schema.libraryCategories).set({ name: 'User edited' }).where(eq(schema.libraryCategories.id, collected!.categoryId!)).run()
    expect(migrateCategoryShelfSeparation(db)).toMatchObject({ skipped: true })
    expect(db.select({ name: schema.libraryCategories.name }).from(schema.libraryCategories).where(eq(schema.libraryCategories.id, collected!.categoryId!)).get())
      .toEqual({ name: 'User edited' })
    sqlite.close()
  })

  it('rolls every data stage back when interrupted, including immediately before the marker', () => {
    for (const stage of ['shelves-copied', 'book-shelves-moved', 'old-categories-deleted', 'metadata-copied', 'before-marker'] as const) {
      const isolated = createDb()
      seedLegacyState(isolated.db)
      expect(() => migrateCategoryShelfSeparation(isolated.db, { afterStage(current) { if (current === stage) throw new Error(stage) } })).toThrow(stage)
      expect(isolated.db.select().from(schema.shelves).all()).toEqual([])
      expect(isolated.db.select({ categoryId: schema.libraryBooks.categoryId, shelfId: schema.libraryBooks.shelfId }).from(schema.libraryBooks).where(eq(schema.libraryBooks.id, 'personal-card')).get())
        .toEqual({ categoryId: 'old-shelf', shelfId: null })
      expect(isolated.db.select().from(schema.libraryMigrationLog).where(eq(schema.libraryMigrationLog.batch, CATEGORY_SHELF_MIGRATION_BATCH)).all()).toEqual([])
      expect(isolated.db.select({ id: schema.libraryCategories.id }).from(schema.libraryCategories).where(eq(schema.libraryCategories.id, 'old-shelf')).get()).toEqual({ id: 'old-shelf' })
      isolated.sqlite.close()
    }
    sqlite.close()
  })

  it('rolls back prior shelf moves and deletions when a category write fails', () => {
    sqlite.exec(`
      CREATE TRIGGER fail_private_category_insert
      BEFORE INSERT ON library_categories
      WHEN NEW.library_id = 'private'
      BEGIN
        SELECT RAISE(ABORT, 'injected category write failure');
      END;
    `)

    expect(() => migrateCategoryShelfSeparation(db)).toThrow(/injected category write failure/)
    expect(db.select().from(schema.shelves).all()).toEqual([])
    expect(db.select({ id: schema.libraryCategories.id }).from(schema.libraryCategories).where(eq(schema.libraryCategories.libraryId, 'private')).all())
      .toEqual([{ id: 'old-shelf' }])
    expect(db.select({ categoryId: schema.libraryBooks.categoryId, shelfId: schema.libraryBooks.shelfId }).from(schema.libraryBooks).where(eq(schema.libraryBooks.id, 'personal-card')).get())
      .toEqual({ categoryId: 'old-shelf', shelfId: null })
    expect(db.select({ libraryBookId: schema.libraryBookTags.libraryBookId, tagId: schema.libraryBookTags.tagId }).from(schema.libraryBookTags).where(eq(schema.libraryBookTags.libraryBookId, 'shared-card')).all())
      .toEqual([{ libraryBookId: 'shared-card', tagId: 'private-tag' }])
    expect(db.select().from(schema.libraryMigrationLog).where(eq(schema.libraryMigrationLog.batch, CATEGORY_SHELF_MIGRATION_BATCH)).all()).toEqual([])
    sqlite.close()
  })

  it('blocks unmarked partial shelf state instead of guessing old IDs', () => {
    db.insert(schema.shelves).values({ id: 'already-moved', libraryId: 'private', userId: 'u1', name: 'Existing', createdAt: 1, updatedAt: 1 }).run()
    expect(() => migrateCategoryShelfSeparation(db)).toThrow(/partial data/)
    expect(db.select({ id: schema.libraryCategories.id }).from(schema.libraryCategories).where(eq(schema.libraryCategories.id, 'old-shelf')).get())
      .toEqual({ id: 'old-shelf' })
    expect(db.select().from(schema.libraryMigrationLog).where(eq(schema.libraryMigrationLog.batch, CATEGORY_SHELF_MIGRATION_BATCH)).all()).toEqual([])
    sqlite.close()
  })

  it('rejects a private book that points at another private library shelf', () => {
    db.insert(schema.users).values({ id: 'u2', username: 'other', createdAt: 1 }).run()
    db.insert(schema.libraries).values({ id: 'private-2', userId: 'u2', type: 'private', name: '', description: '', visibility: null, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBooks).values({ id: 'cross-private-card', libraryId: 'private-2', userId: 'u2', categoryId: 'old-shelf', title: 'Invalid', author: '', description: '', coverKey: null, createdAt: 2, updatedAt: 3 }).run()

    expect(() => migrateCategoryShelfSeparation(db)).toThrow(/conflicting library-book assignments/)
    expect(db.select().from(schema.shelves).all()).toEqual([])
    expect(db.select({ categoryId: schema.libraryBooks.categoryId }).from(schema.libraryBooks).where(eq(schema.libraryBooks.id, 'cross-private-card')).get())
      .toEqual({ categoryId: 'old-shelf' })
    sqlite.close()
  })

  it('skips source metadata when the collected version identity no longer matches', () => {
    db.update(schema.libraryBookVersions).set({ bookVersionId: 'collected-version' }).where(eq(schema.libraryBookVersions.id, 'collected-link')).run()
    const result = migrateCategoryShelfSeparation(db)

    expect(result.anomalies).toContain('shared-card: source identity mismatch')
    expect(db.select({ categoryId: schema.libraryBooks.categoryId }).from(schema.libraryBooks).where(eq(schema.libraryBooks.id, 'shared-card')).get())
      .toEqual({ categoryId: null })
    expect(db.select({ name: schema.libraryTags.name }).from(schema.libraryTags).where(eq(schema.libraryTags.libraryId, 'private')).all())
      .toEqual([{ name: 'Personal label' }])
    sqlite.close()
  })

  it('records an empty fresh install without creating categories', () => {
    const fresh = createDb()
    expect(migrateCategoryShelfSeparation(fresh.db)).toMatchObject({ skipped: false, shelves: 0, categories: 0, tags: 0 })
    expect(fresh.db.select().from(schema.libraryCategories).all()).toEqual([])
    expect(migrateCategoryShelfSeparation(fresh.db)).toMatchObject({ skipped: true })
    fresh.sqlite.close()
    sqlite.close()
  })

  it('records the completion marker from the runtime migration path and skips it on restart', async () => {
    const fresh = createDb()
    vi.spyOn(storage, 'getStorage').mockReturnValue({} as StorageDriver)

    await runDatabaseMigrations(fresh.db)
    await runDatabaseMigrations(fresh.db)

    expect(fresh.db.select().from(schema.libraryMigrationLog).where(eq(schema.libraryMigrationLog.batch, CATEGORY_SHELF_MIGRATION_BATCH)).all())
      .toHaveLength(1)
    expect(fresh.db.select().from(schema.libraryCategories).all()).toEqual([])
    vi.restoreAllMocks()
    fresh.sqlite.close()
    sqlite.close()
  })
})
