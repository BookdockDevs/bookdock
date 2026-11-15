import { describe, expect, it, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { classificationValueKey } from '@bookdock/shared'
import { migrateBeforeBookRetirementIncluding as migrate } from '../../db/migration-stage'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/legacy-test-schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import {
  clearCategoryValue,
  clearTagValue,
  listCategoryValues,
  listTagValues,
  reorderCategoryValues,
  reorderTagValues,
  updateCategoryValue,
  updateTagValue,
} from '../classification/classification.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') }, [])
  return db
}

/**
 * The library taxonomy (11.5) is the one surface where a wrong write is
 * silently destructive: categories and tags are values on books now, so a
 * rewrite reaches every book carrying the value, and clearing a category drops
 * that branch from all of them. Phase 4C built the endpoints; these tests are
 * what decide whether the rules actually hold.
 */
describe('library taxonomy (11.5)', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let memberId: string
  let outsiderId: string
  let cityId: string
  let otherCityId: string

  function seedUser(username: string) {
    const id = createId('user')
    db.insert(schema.users).values({
      id, username, passwordHash: null, role: 'member', disabled: 0, createdAt: 1,
    }).run()
    return id
  }

  function seedCity(userId: string) {
    const id = createId('lib')
    db.insert(schema.libraries).values({
      id, userId, type: 'shared', name: 'City', description: '',
      visibility: 'private', createdAt: 1, updatedAt: 1,
    }).run()
    return id
  }

  function seedWork(libraryId: string, overrides: Partial<typeof schema.libraryBooks.$inferInsert> = {}) {
    const id = createId('lb')
    db.insert(schema.libraryBooks).values({
      id, libraryId, userId: ownerId, title: 'Work', author: '', description: '',
      coverKey: null, categoryRoot: null, categoryLeaf: null, createdAt: 1, updatedAt: 1, ...overrides,
    }).run()
    return id
  }

  function seedBookTag(libraryBookId: string, name: string, sortOrder = 0) {
    db.insert(schema.libraryBookTagValues).values({
      id: createId('btv'), libraryBookId, name, sortOrder,
    }).run()
  }

  /** A published version, so a shared-library member's counts can see the work. */
  function publishWork(workId: string) {
    const versionId = createId('bv')
    db.insert(schema.bookVersions).values({ id: versionId, format: 'txt', size: 10, createdAt: 1, updatedAt: 1 }).run()
    db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId: cityId, libraryBookId: workId, bookVersionId: versionId,
      kind: 'shared', status: 'published', createdAt: 1, updatedAt: 1,
    }).run()
  }

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)
    ownerId = seedUser('owner')
    memberId = seedUser('member')
    outsiderId = seedUser('outsider')
    cityId = seedCity(ownerId)
    otherCityId = seedCity(ownerId)
    db.insert(schema.libraryMemberships).values({
      id: createId('lbm'), libraryId: cityId, userId: memberId, role: 'member', createdAt: 1, updatedAt: 1,
    }).run()
  })

  describe('categories', () => {
    it('refuses a rename onto a path already in use but keeps libraries independent', async () => {
      seedWork(cityId, { categoryRoot: 'A' })
      seedWork(cityId, { categoryRoot: 'B' })
      // The same path in another library is a different value.
      seedWork(otherCityId, { categoryRoot: 'B' })

      await expect(updateCategoryValue(ownerId, cityId, { path: ['A'], name: 'B' }))
        .rejects.toMatchObject({ code: 'CLASSIFICATION_CONFLICT' })

      // Renaming the other library's B does not touch this library's B.
      const other = await updateCategoryValue(ownerId, otherCityId, { path: ['B'], name: 'C' })
      expect(other.map((node) => node.path)).toEqual([['C']])
      expect((await listCategoryValues(ownerId, cityId)).map((node) => node.path).sort())
        .toEqual([['A'], ['B']])
    })

    it('allows renaming a path to itself', async () => {
      seedWork(cityId, { categoryRoot: 'A' })
      const listed = await updateCategoryValue(ownerId, cityId, { path: ['A'], name: 'A' })
      expect(listed.find((node) => node.path[0] === 'A')?.name).toBe('A')
    })

    it('never lets one library reach another library category', async () => {
      const foreign = seedWork(otherCityId, { categoryRoot: 'Foreign' })

      await expect(updateCategoryValue(ownerId, cityId, { path: ['Foreign'], name: 'Stolen' }))
        .rejects.toMatchObject({ code: 'CLASSIFICATION_NOT_FOUND' })
      await expect(clearCategoryValue(ownerId, cityId, ['Foreign']))
        .resolves.toEqual([])

      // And the foreign book is untouched.
      expect(db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, foreign)).get()?.categoryRoot)
        .toBe('Foreign')
    })

    it('refuses paths deeper than two levels and moves a leaf to a root', async () => {
      seedWork(cityId, { categoryRoot: 'Parent' })
      seedWork(cityId, { categoryRoot: 'Parent', categoryLeaf: 'Child' })

      await expect(updateCategoryValue(ownerId, cityId, { path: ['Parent', 'Child', 'Grandchild'] }))
        .rejects.toThrow('at most 2 levels')

      // Promoting a leaf to a root rewrites the value on its books.
      await updateCategoryValue(ownerId, cityId, { path: ['Parent', 'Child'], parentPath: null })
      const listed = await listCategoryValues(ownerId, cityId)
      expect(listed.map((node) => node.path)).toContainEqual(['Child'])
      expect(db.select().from(schema.libraryBooks).all().filter((book) => book.categoryRoot === 'Child')).toHaveLength(1)
    })

    it('clearing a category uncategorizes its whole branch and keeps preference rows', async () => {
      seedWork(cityId, { categoryRoot: 'Parent' })
      seedWork(cityId, { categoryRoot: 'Parent', categoryLeaf: 'Child' })
      await updateCategoryValue(ownerId, cityId, { path: ['Parent', 'Child'], pinned: true })

      const cleared = await clearCategoryValue(ownerId, cityId, ['Parent'])
      expect(cleared).toEqual([])
      expect(db.select().from(schema.libraryBooks).all().every((book) => book.categoryRoot === null)).toBe(true)

      // The pin survives: a value that comes back keeps its place.
      const returning = seedWork(cityId, { categoryRoot: 'Parent', categoryLeaf: 'Child' })
      expect(returning).toBeTruthy()
      const relisted = await listCategoryValues(ownerId, cityId)
      expect(relisted.find((node) => node.path.join('/') === 'Parent/Child')?.pinned).toBe(true)
    })


    it('reorder refuses duplicate and unknown keys and never moves another library value', async () => {
      seedWork(cityId, { categoryRoot: 'A' })
      seedWork(cityId, { categoryRoot: 'B' })
      seedWork(otherCityId, { categoryRoot: 'X' })
      const a = classificationValueKey('category', ['A'])

      await expect(reorderCategoryValues(ownerId, cityId, [a, a]))
        .rejects.toMatchObject({ code: 'CLASSIFICATION_NOT_FOUND' })
      await expect(reorderCategoryValues(ownerId, cityId, [a, classificationValueKey('category', createId('cat'))]))
        .rejects.toMatchObject({ code: 'CLASSIFICATION_NOT_FOUND' })
      await expect(reorderCategoryValues(ownerId, cityId, [a, classificationValueKey('category', ['X'])]))
        .rejects.toMatchObject({ code: 'CLASSIFICATION_NOT_FOUND' })

      // A partial list only orders what it names; it cannot drop book values.
      await reorderCategoryValues(ownerId, cityId, [classificationValueKey('category', ['B']), a])
      const order = new Map((await listCategoryValues(ownerId, cityId)).map((node) => [node.id, node.sortOrder]))
      expect(order.get(classificationValueKey('category', ['B']))!).toBeLessThan(order.get(a)!)
    })

    it('only owners and admins curate; members and outsiders get nothing', async () => {
      seedWork(cityId, { categoryRoot: 'X' })
      await expect(updateCategoryValue(memberId, cityId, { path: ['X'], name: 'Y' }))
        .rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(updateCategoryValue(outsiderId, cityId, { path: ['X'], name: 'Y' }))
        .rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(clearCategoryValue(memberId, cityId, ['X'])).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(reorderCategoryValues(memberId, cityId, [classificationValueKey('category', ['X'])]))
        .rejects.toMatchObject({ code: 'FORBIDDEN' })
      // Promotion to admin grants curation.
      db.update(schema.libraryMemberships).set({ role: 'admin' })
        .where(eq(schema.libraryMemberships.userId, memberId)).run()
      await expect(updateCategoryValue(memberId, cityId, { path: ['X'], name: 'Y' }))
        .resolves.toContainEqual(expect.objectContaining({ path: ['Y'] }))
    })

  })

  describe('tags', () => {
    it('treats a tag name as one value per library and keeps libraries independent', async () => {
      const mine = seedWork(cityId)
      const theirs = seedWork(otherCityId)
      seedBookTag(mine, 'Classic')
      seedBookTag(theirs, 'Classic')

      const renamed = await updateTagValue(ownerId, cityId, { name: 'Classic', renamedTo: 'Classics' })
      expect(renamed.map((tag) => tag.name)).toEqual(['Classics'])
      // The other library's value is not this library's tag.
      expect((await listTagValues(ownerId, otherCityId)).map((tag) => tag.name)).toEqual(['Classic'])
    })

    it('never lets one library reach another library tag', async () => {
      const foreign = seedWork(otherCityId)
      seedBookTag(foreign, 'Foreign')

      // A rename in this library finds nothing here and leaves the foreign value alone.
      await updateTagValue(ownerId, cityId, { name: 'Foreign', renamedTo: 'Stolen' })
      expect((await listTagValues(ownerId, otherCityId)).map((tag) => tag.name)).toEqual(['Foreign'])
      await expect(reorderTagValues(ownerId, cityId, ['Foreign']))
        .rejects.toMatchObject({ code: 'CLASSIFICATION_NOT_FOUND' })
    })

    it('clearing a tag drops its book links instead of leaving orphans', async () => {
      const work = seedWork(cityId)
      seedBookTag(work, 'Doomed')
      seedBookTag(work, 'Kept', 1)

      await clearTagValue(ownerId, cityId, 'Doomed')

      const left = db.select().from(schema.libraryBookTagValues).all()
      expect(left).toHaveLength(1)
      expect(left[0]!.name).toBe('Kept')
    })

    it('reorder demands the exact full set', async () => {
      const work = seedWork(cityId)
      seedBookTag(work, 'A')
      seedBookTag(work, 'B', 1)
      await expect(reorderTagValues(ownerId, cityId, ['A', 'A']))
        .rejects.toMatchObject({ code: 'CLASSIFICATION_NOT_FOUND' })
      await expect(reorderTagValues(ownerId, cityId, ['A', 'Missing']))
        .rejects.toMatchObject({ code: 'CLASSIFICATION_NOT_FOUND' })
      await reorderTagValues(ownerId, cityId, ['B', 'A'])
      expect((await listTagValues(ownerId, cityId)).map((tag) => tag.name)).toEqual(['B', 'A'])
    })

    it('only owners and admins curate', async () => {
      const work = seedWork(cityId)
      seedBookTag(work, 'X')
      await expect(updateTagValue(memberId, cityId, { name: 'X', renamedTo: 'Y' }))
        .rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(updateTagValue(outsiderId, cityId, { name: 'X', renamedTo: 'Y' }))
        .rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('lets any member browse the taxonomy but not a stranger', async () => {
      const visible = seedWork(cityId)
      publishWork(visible)
      seedBookTag(visible, 'Visible')
      await expect(listTagValues(memberId, cityId)).resolves.toHaveLength(1)
      await expect(listTagValues(outsiderId, cityId)).rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
    })
  })

  /**
   * The sidebar renders one taxonomy row component for every library, which only
   * works because a shared library's categories and tags report the same
   * bookCount a private shelf and tag already do. A count that silently came back
   * as 0 (or, worse, that counted another library's works) would look like an
   * empty library rather than a bug.
   */
  describe('taxonomy counts', () => {
    it('counts the works filed under a category, ignoring trashed ones', async () => {
      seedWork(cityId, { title: 'A', categoryRoot: 'Fiction' })
      seedWork(cityId, { title: 'B', categoryRoot: 'Fiction' })
      seedWork(cityId, { title: 'C', categoryRoot: 'Fiction', deletedAt: 2 })
      seedWork(cityId, { title: 'D', categoryRoot: 'Poetry' })

      const listed = await listCategoryValues(ownerId, cityId)
      expect(listed.find((node) => node.path.length === 1 && node.name === 'Fiction')?.bookCount).toBe(2)
      expect(listed.find((node) => node.path.length === 1 && node.name === 'Poetry')?.bookCount).toBe(1)
    })

    it('counts the works carrying a tag, ignoring trashed ones', async () => {
      const a = seedWork(cityId, { title: 'A' })
      const b = seedWork(cityId, { title: 'B' })
      const trashed = seedWork(cityId, { title: 'C', deletedAt: 2 })
      seedBookTag(a, 'Classic')
      seedBookTag(b, 'Classic')
      seedBookTag(trashed, 'Classic')
      seedBookTag(a, 'Modern')

      const listed = await listTagValues(ownerId, cityId)
      expect(listed.find((tag) => tag.name === 'Classic')?.bookCount).toBe(2)
      expect(listed.find((tag) => tag.name === 'Modern')?.bookCount).toBe(1)
    })

    it('drops a sibling count when a work is hidden through any dimension', async () => {
      const kept = seedWork(cityId, { title: 'Kept' })
      const hidden = seedWork(cityId, { title: 'Hidden' })
      publishWork(kept)
      publishWork(hidden)
      seedBookTag(kept, 'Author')
      seedBookTag(hidden, 'Author')
      seedBookTag(hidden, 'Adult')
      seedWork(cityId, { title: 'Secret work', categoryRoot: 'Secret' })

      // A manager sees hidden rows, so nothing is excluded for them.
      const asOwner = await listTagValues(ownerId, cityId)
      expect(asOwner.find((tag) => tag.name === 'Author')?.bookCount).toBe(2)

      // Hiding one tag closes every work carrying it, and the sibling tag's
      // capsule has to follow the list it counts, not just its own dimension.
      await updateTagValue(ownerId, cityId, { name: 'Adult', hidden: true })
      const asMember = await listTagValues(memberId, cityId)
      expect(asMember.find((tag) => tag.name === 'Author')?.bookCount).toBe(1)
      // The hidden tag itself drops out of the member's sidebar entirely.
      expect(asMember.find((tag) => tag.name === 'Adult')).toBeUndefined()

      // A work hidden through a hidden category is excluded from a tag count too.
      db.update(schema.libraryBooks).set({ categoryRoot: 'Secret' }).where(eq(schema.libraryBooks.id, kept)).run()
      await updateCategoryValue(ownerId, cityId, { path: ['Secret'], hidden: true })
      // Nothing visible carries the tag any more, so the value has no count row.
      expect((await listTagValues(memberId, cityId)).find((tag) => tag.name === 'Author')).toBeUndefined()
    })

    it('scopes each category to its own library, and leaves uncategorized work uncounted', async () => {
      seedWork(cityId, { title: 'Loose' })
      seedWork(otherCityId, { title: 'X', categoryRoot: 'Theirs' })
      seedWork(otherCityId, { title: 'Y', categoryRoot: 'Theirs' })

      // Uncounted because no book in this library carries a category value.
      await expect(listCategoryValues(ownerId, cityId)).resolves.toEqual([])
      const other = await listCategoryValues(ownerId, otherCityId)
      expect(other).toHaveLength(1)
      expect(other[0]?.bookCount).toBe(2)
    })

    it('reports the same count from a rename as from a listing', async () => {
      seedWork(cityId, { categoryRoot: 'Fiction' })
      const renamed = await updateCategoryValue(ownerId, cityId, { path: ['Fiction'], name: 'Novels' })
      expect(renamed.find((node) => node.path[0] === 'Novels')?.bookCount).toBe(1)
    })
  })
})
