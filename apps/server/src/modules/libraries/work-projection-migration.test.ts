import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import * as schema from '../../db/schema'
import { retargetBookIdReferences } from '../../db/client'
import { migrateBeforeBookRetirement } from '../../db/migration-stage'
import { WORK_META_DROP_BATCH, WORK_PROJECTION_BACKFILL_BATCH, backfillWorkProjection, dropWorkLevelBookmeta } from './work-projection-migration'

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'db', 'migrations')

/** The runtime upgrade path: retire the legacy base, retarget ids, finish. */
function createDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrateBeforeBookRetirement(db, { migrationsFolder })
  retargetBookIdReferences(db)
  migrate(db, { migrationsFolder })
  return db
}

function seed(db: ReturnType<typeof createDb>) {
  db.insert(schema.users).values({ id: 'u1', username: 'owner', passwordHash: null, role: 'owner', createdAt: 1 }).run()
  db.insert(schema.libraries).values([
    { id: 'shared', userId: 'u1', type: 'shared', name: 'City', description: '', visibility: 'public', createdAt: 1, updatedAt: 1 },
    { id: 'private', userId: 'u1', type: 'private', name: 'Mine', description: '', visibility: null, createdAt: 1, updatedAt: 1 },
  ]).run()
  db.insert(schema.bookVersions).values([
    { id: 'v1', format: 'epub', size: 1, createdAt: 1, updatedAt: 1 },
    { id: 'v2', format: 'epub', size: 1, createdAt: 1, updatedAt: 1 },
  ]).run()
  // A shared work written the old way: metadata only on the work row.
  db.insert(schema.libraryBooks).values([
    {
      id: 'w1', libraryId: 'shared', userId: 'u1', categoryId: null,
      title: '作品', author: '作者', authors: ['作者'], description: '简介', coverKey: 'cover-a',
      createdAt: 1, updatedAt: 1,
    },
    {
      id: 'w2', libraryId: 'private', userId: 'u1', categoryId: null,
      title: '私库作品', author: '', description: '', coverKey: 'cover-b', createdAt: 1, updatedAt: 1,
    },
  ]).run()
  db.insert(schema.libraryBookVersions).values([
    { id: 'l1', libraryId: 'shared', libraryBookId: 'w1', bookVersionId: 'v1', kind: 'personal', status: 'published', name: '', createdAt: 1, updatedAt: 1 },
    // A second version already owns its title; the backfill must not touch it.
    { id: 'l2', libraryId: 'shared', libraryBookId: 'w1', bookVersionId: 'v1', kind: 'personal', status: 'published', name: '第二版', title: '第二版', createdAt: 2, updatedAt: 2 },
    { id: 'l3', libraryId: 'private', libraryBookId: 'w2', bookVersionId: 'v2', kind: 'personal', status: 'published', name: '', createdAt: 1, updatedAt: 1 },
  ]).run()
}

describe('work projection backfill', () => {
  it('seeds null version fields from the work row, once, for shared libraries only', () => {
    const db = createDb()
    seed(db)

    expect(backfillWorkProjection(db)).toMatchObject({ skipped: false, works: 1, versions: 2, fields: 9 })

    const lead = db.select().from(schema.libraryBookVersions).where(eq(schema.libraryBookVersions.id, 'l1')).get()!
    expect(lead).toMatchObject({
      title: '作品', author: '作者', authors: ['作者'], description: '简介', coverKey: 'cover-a',
    })
    // The owned title wins; the rest is seeded. updatedAt is preserved so the
    // "recently updated" order does not jump on upgrade.
    const second = db.select().from(schema.libraryBookVersions).where(eq(schema.libraryBookVersions.id, 'l2')).get()!
    expect(second).toMatchObject({ title: '第二版', author: '作者', coverKey: 'cover-a', updatedAt: 2 })
    // Private libraries keep the work row as the source and stay untouched.
    const privateLink = db.select().from(schema.libraryBookVersions).where(eq(schema.libraryBookVersions.id, 'l3')).get()!
    expect(privateLink).toMatchObject({ title: null, author: null, coverKey: null })

    expect(db.select().from(schema.libraryMigrationLog)
      .where(eq(schema.libraryMigrationLog.batch, WORK_PROJECTION_BACKFILL_BATCH)).all()).toHaveLength(1)

    // Idempotent: the completion marker short-circuits the second run.
    expect(backfillWorkProjection(db)).toMatchObject({ skipped: true })
  })
})

describe('work-level bookmeta drop', () => {
  it('clears the shared work meta once, keeping the deletion flag and private rows', () => {
    const db = createDb()
    seed(db)
    db.update(schema.libraryBooks).set({ meta: { publisher: '旧出版社', isbn: '978', pendingUserDataDeletion: true } })
      .where(eq(schema.libraryBooks.id, 'w1')).run()
    db.update(schema.libraryBooks).set({ meta: { tocRuleId: 'rule-1' } })
      .where(eq(schema.libraryBooks.id, 'w2')).run()

    expect(dropWorkLevelBookmeta(db)).toMatchObject({ skipped: false, works: 1 })

    // The publication layer is gone; the deletion flag is not publication
    // metadata and stays where the deletion tooling reads it.
    expect(db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, 'w1')).get()!.meta)
      .toEqual({ pendingUserDataDeletion: true })
    // A private work's meta is the book's own (toc rules live there).
    expect(db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, 'w2')).get()!.meta)
      .toEqual({ tocRuleId: 'rule-1' })

    expect(db.select().from(schema.libraryMigrationLog)
      .where(eq(schema.libraryMigrationLog.batch, WORK_META_DROP_BATCH)).all()).toHaveLength(1)
    expect(dropWorkLevelBookmeta(db)).toMatchObject({ skipped: true })
  })
})
