import path from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '../../db/client'
import { migrateBeforeBookRetirement } from '../../db/migration-stage'
import * as schema from '../../db/schema'
import { AppError } from '../../middleware/error'
import * as books from '../books/books.service'
import { readingHoldings } from './reading-holdings'
import { getByBook, getByCategory, getByTag, getDaily, getSummary } from './reading-records.service'

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../db/migrations')

describe('reading taxonomy attribution', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof drizzle<typeof schema>>

  function library(id: string, userId = 'u2', type: 'private' | 'shared' = 'shared', createdAt = 1) {
    db.insert(schema.libraries).values({ id, userId, type, name: id, visibility: type === 'shared' ? 'private' : null, createdAt, updatedAt: 1 }).run()
  }

  function holding(id: string, libraryId: string, userId = 'u2', categoryId: string | null = null, version = 'v1') {
    db.insert(schema.libraryBooks).values({ id, libraryId, userId, categoryId, title: id, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBookVersions).values({ id: `${id}-link`, libraryId, libraryBookId: id, bookVersionId: version, kind: 'personal', createdAt: 1, updatedAt: 1 }).run()
  }

  function category(id: string, libraryId: string, userId = 'u2', parentId: string | null = null) {
    db.insert(schema.libraryCategories).values({ id, libraryId, userId, name: id, parentId, createdAt: 1, updatedAt: 1 }).run()
  }

  function tag(id: string, libraryId: string, workId: string, userId = 'u2') {
    db.insert(schema.libraryTags).values({ id, libraryId, userId, name: id, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBookTags).values({ libraryBookId: workId, tagId: id }).run()
  }

  function join(libraryId: string, createdAt = 1, role: 'admin' | 'member' = 'member') {
    db.insert(schema.libraryMemberships).values({ id: `${libraryId}-member`, libraryId, userId: 'u1', role, createdAt, updatedAt: 1 }).run()
  }

  beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    db = drizzle(sqlite, { schema })
    migrateBeforeBookRetirement(db, { migrationsFolder })
    client.retargetBookIdReferences(db)
    migrate(db, { migrationsFolder })
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    vi.spyOn(books, 'getBook').mockRejectedValue(new AppError('BOOK_NOT_FOUND'))
    db.insert(schema.users).values([{ id: 'u1', username: 'first', createdAt: 1 }, { id: 'u2', username: 'second', createdAt: 1 }]).run()
    db.insert(schema.bookVersions).values([{ id: 'v1', format: 'epub', size: 1, createdAt: 1, updatedAt: 1 }, { id: 'v2', format: 'txt', size: 1, createdAt: 1, updatedAt: 1 }]).run()
    db.insert(schema.readingRecords).values([
      { id: 'r1', userId: 'u1', bookId: 'v1', date: '2026-10-01', durationSeconds: 400 },
      { id: 'r2', userId: 'u1', bookId: 'v1', date: '2026-10-02', durationSeconds: 200 },
    ]).run()
  })

  afterEach(() => { vi.restoreAllMocks(); sqlite.close() })

  it('uses only the private holding and deduplicates version/tag links after daily aggregation', async () => {
    library('private', 'u1', 'private')
    category('own-category', 'private', 'u1')
    holding('own', 'private', 'u1', 'own-category')
    tag('own-tag', 'private', 'own', 'u1')
    tag('second-tag', 'private', 'own', 'u1')
    // A second link is permitted for personal/local editions and must not multiply tags.
    db.insert(schema.libraryBookVersions).values({ id: 'duplicate', libraryId: 'private', libraryBookId: 'own', bookVersionId: 'v1', kind: 'local', createdAt: 1, updatedAt: 1 }).run()
    library('foreign-private', 'u2', 'private')
    holding('foreign', 'foreign-private')
    tag('secret-tag', 'foreign-private', 'foreign')
    for (const id of ['shared-a', 'shared-b']) {
      library(id); join(id); category(`${id}-category`, id); holding(`${id}-work`, id, 'u2', `${id}-category`); tag(`${id}-tag`, id, `${id}-work`)
    }
    expect(await getByTag('u1', {})).toEqual([
      { tagId: 'own-tag', name: 'own-tag', durationSeconds: 600, bookCount: 1 },
      { tagId: 'second-tag', name: 'second-tag', durationSeconds: 600, bookCount: 1 },
    ])
    expect(await getByCategory('u1', {})).toEqual([{ categoryId: 'own-category', name: 'own-category', parentId: null, parentName: null, durationSeconds: 600, bookCount: 1 }])
    expect((await getByTag('u1', { from: '2026-10-02', to: '2026-10-02' }))[0].durationSeconds).toBe(200)
    expect(await getByTag('u2', {})).toEqual([])
  })

  it('keeps empty private metadata empty and preserves orphan archive facts as Uncategorized', async () => {
    library('private', 'u1', 'private'); holding('own', 'private', 'u1')
    library('shared'); join('shared'); category('source-category', 'shared'); holding('source', 'shared', 'u2', 'source-category'); tag('source-tag', 'shared', 'source')
    expect(await getByTag('u1', {})).toEqual([])
    expect((await getByCategory('u1', {}))[0]).toMatchObject({ categoryId: null, durationSeconds: 600 })
    db.delete(schema.libraryBooks).run()
    db.insert(schema.readingArchives).values({ userId: 'u1', bookVersionId: 'v1', title: 'Retained', createdAt: 1, updatedAt: 1 }).run()
    expect((await getByCategory('u1', {}))[0]).toMatchObject({ categoryId: null, durationSeconds: 600 })
    expect((await getSummary('u1', '2026-10-02')).totalSeconds).toBe(600)
    expect((await getByBook('u1', {}))[0]).toMatchObject({ title: 'Retained', durationSeconds: 600 })
  })

  it('chooses legal shared holdings deterministically including owners without membership', async () => {
    library('owned', 'u1', 'shared', 5); category('owned-category', 'owned', 'u1'); holding('owned-work', 'owned', 'u1', 'owned-category')
    for (const id of ['b', 'a']) {
      library(id, 'u2', 'shared', 5); join(id, 5); category(`${id}-category`, id); holding(`${id}-work`, id, 'u2', `${id}-category`); tag(`${id}-tag`, id, `${id}-work`)
    }
    library('inaccessible', 'u2', 'shared', 0); holding('forbidden', 'inaccessible'); tag('secret', 'inaccessible', 'forbidden')
    expect(readingHoldings(db, 'u1')[0].libraryId).toBe('a')
    expect((await getByTag('u1', {}))[0].tagId).toBe('a-tag')
    db.delete(schema.libraryMemberships).run()
    expect((await getByCategory('u1', {}))[0]).toMatchObject({ categoryId: 'owned-category', durationSeconds: 600 })
    db.delete(schema.libraries).where(eq(schema.libraries.id, 'owned')).run()
    expect(await getByTag('u1', {}, true)).toEqual([])
    expect((await getByCategory('u1', {}, true))[0].categoryId).toBeNull()
  })

  it.each(['shelf', 'parent', 'tag', 'work'] as const)('applies private %s hiding consistently without shared bypass', async (dimension) => {
    library('private', 'u1', 'private'); category('parent', 'private', 'u1'); category('child', 'private', 'u1', 'parent'); holding('own', 'private', 'u1', 'child'); tag('own-tag', 'private', 'own', 'u1')
    library('shared'); join('shared'); holding('source', 'shared'); tag('source-tag', 'shared', 'source')
    if (dimension === 'shelf') {
      db.insert(schema.shelves).values({ id: 'shelf', libraryId: 'private', userId: 'u1', name: 'Hidden shelf', hidden: true, createdAt: 1, updatedAt: 1 }).run()
      db.update(schema.libraryBooks).set({ shelfId: 'shelf' }).where(eq(schema.libraryBooks.id, 'own')).run()
    } else if (dimension === 'parent') db.update(schema.libraryCategories).set({ hidden: true }).where(eq(schema.libraryCategories.id, 'parent')).run()
    else if (dimension === 'tag') db.update(schema.libraryTags).set({ hidden: true }).where(eq(schema.libraryTags.id, 'own-tag')).run()
    else db.update(schema.libraryBooks).set({ hidden: true }).where(eq(schema.libraryBooks.id, 'own')).run()
    expect(await getByTag('u1', {})).toEqual([])
    expect(await getByCategory('u1', {})).toEqual([])
    expect(await getDaily('u1', {})).toEqual([])
    expect(await getByBook('u1', {})).toEqual([])
    expect((await getSummary('u1', '2026-10-02')).totalSeconds).toBe(0)
    expect((await getByCategory('u1', {}, true))[0]).toMatchObject({ categoryId: 'child', parentName: 'parent', durationSeconds: 600 })
    expect((await getByTag('u1', {}, true))[0].tagId).toBe('own-tag')
    db.update(schema.libraryBooks).set({ deletedAt: 1, meta: { pendingUserDataDeletion: true } }).where(eq(schema.libraryBooks.id, 'own')).run()
    expect(await getByCategory('u1', {}, true)).toEqual([])
    expect((await getSummary('u1', '2026-10-02', true)).totalSeconds).toBe(0)
  })

  it('tries visible shared alternatives but never reveals hidden member or unlisted metadata', async () => {
    for (const id of ['a', 'b']) {
      library(id); join(id); category(`${id}-category`, id); holding(`${id}-work`, id, 'u2', `${id}-category`); tag(`${id}-tag`, id, `${id}-work`)
    }
    db.update(schema.libraryBooks).set({ hidden: true }).where(eq(schema.libraryBooks.id, 'a-work')).run()
    expect((await getByTag('u1', {}))[0].tagId).toBe('b-tag')
    expect((await getByTag('u1', {}, true))[0].tagId).toBe('b-tag')
    db.update(schema.libraryBookVersions).set({ status: 'unlisted' }).where(eq(schema.libraryBookVersions.libraryBookId, 'b-work')).run()
    expect(await getByCategory('u1', {}, true)).toEqual([])
    db.update(schema.libraryMemberships).set({ role: 'admin' }).where(eq(schema.libraryMemberships.libraryId, 'a')).run()
    expect((await getByTag('u1', {}, true))[0].tagId).toBe('a-tag')
  })

  it('conserves category totals including Uncategorized and counts versions rather than works', async () => {
    library('private', 'u1', 'private'); category('category', 'private', 'u1'); holding('own', 'private', 'u1', 'category')
    db.insert(schema.readingRecords).values({ id: 'other-fact', userId: 'u1', bookId: 'v2', date: '2026-10-02', durationSeconds: 75 }).run()
    const range = { from: '2026-10-02', to: '2026-10-02' }
    const grouped = await getByCategory('u1', range)
    const daily = await getDaily('u1', range)
    expect(grouped).toHaveLength(2)
    expect(grouped.reduce((sum, group) => sum + group.durationSeconds, 0)).toBe(daily.reduce((sum, day) => sum + day.durationSeconds, 0))
    expect(grouped.reduce((sum, group) => sum + group.bookCount, 0)).toBe(2)
    expect((await getSummary('u1', '2026-10-02', false, range)).scope.totalSeconds).toBe(275)
  })
})
