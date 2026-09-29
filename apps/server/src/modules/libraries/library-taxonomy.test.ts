import { describe, expect, it, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import {
  createLibraryCategory,
  deleteLibraryCategory,
  listLibraryCategories,
  reorderLibraryCategories,
  setLibraryCategoryParent,
  updateLibraryCategory,
} from '../shelves/shelves.service'
import {
  createLibraryTag,
  deleteLibraryTag,
  listLibraryTags,
  reorderLibraryTags,
  updateLibraryTag,
} from '../tags/tags.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

/**
 * The library taxonomy (11.5) is the one surface where a wrong write is
 * silently destructive: categories are a parent-linked tree, books fall back to
 * uncategorized on delete, and a tag set is replaced wholesale. Phase 4C built
 * the endpoints; these tests are what decide whether the rules actually hold.
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

  function seedCategory(libraryId: string, name: string, parentId: string | null = null) {
    const id = createId('cat')
    db.insert(schema.libraryCategories).values({
      id, libraryId, userId: ownerId, name, parentId, sortOrder: 0, pinned: false,
      createdAt: 1, updatedAt: 1,
    }).run()
    return id
  }

  function seedTag(libraryId: string, name: string) {
    const id = createId('ltag')
    db.insert(schema.libraryTags).values({
      id, libraryId, userId: ownerId, name, sortOrder: 0, pinned: false, createdAt: 1, updatedAt: 1,
    }).run()
    return id
  }

  function seedWork(libraryId: string, overrides: Partial<typeof schema.libraryBooks.$inferInsert> = {}) {
    const id = createId('lb')
    db.insert(schema.libraryBooks).values({
      id, libraryId, userId: ownerId, title: 'Work', author: '', description: '',
      coverKey: null, categoryId: null, createdAt: 1, updatedAt: 1, ...overrides,
    }).run()
    return id
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
    it('refuses a duplicate name inside the same library but allows it across libraries', async () => {
      await createLibraryCategory(ownerId, cityId, { name: 'Sci-Fi' })
      await expect(createLibraryCategory(ownerId, cityId, { name: 'Sci-Fi' }))
        .rejects.toMatchObject({ code: 'CATEGORY_NAME_TAKEN' })
      // Another library is a different taxonomy, so the same name is fine.
      const other = await createLibraryCategory(ownerId, otherCityId, { name: 'Sci-Fi' })
      expect(other.name).toBe('Sci-Fi')
    })

    it('rejects a rename onto an existing name but allows renaming to itself', async () => {
      const a = await createLibraryCategory(ownerId, cityId, { name: 'A' })
      await createLibraryCategory(ownerId, cityId, { name: 'B' })
      await expect(updateLibraryCategory(ownerId, cityId, a.id, { name: 'B' }))
        .rejects.toMatchObject({ code: 'CATEGORY_NAME_TAKEN' })
      // Idempotent rename: the same name is not a conflict with itself.
      await expect(updateLibraryCategory(ownerId, cityId, a.id, { name: 'A' })).resolves.toMatchObject({ name: 'A' })
    })

    it('never lets one library reach another library category', async () => {
      const foreign = seedCategory(otherCityId, 'Foreign')
      const own = await createLibraryCategory(ownerId, cityId, { name: 'Own' })

      await expect(createLibraryCategory(ownerId, cityId, { name: 'Kid', parentId: foreign }))
        .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
      await expect(setLibraryCategoryParent(ownerId, cityId, own.id, foreign))
        .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
      await expect(updateLibraryCategory(ownerId, cityId, foreign, { name: 'Stolen' }))
        .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
      await expect(deleteLibraryCategory(ownerId, cityId, foreign))
        .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
      // And the foreign row is untouched.
      expect(db.select().from(schema.libraryCategories).where(eq(schema.libraryCategories.id, foreign)).get()?.name)
        .toBe('Foreign')
    })

    it('refuses cycles: self-parenting and moving a category under its own descendant', async () => {
      const root = await createLibraryCategory(ownerId, cityId, { name: 'Root' })
      const child = await createLibraryCategory(ownerId, cityId, { name: 'Child', parentId: root.id })
      const grandchild = await createLibraryCategory(ownerId, cityId, { name: 'Grandchild', parentId: child.id })

      await expect(setLibraryCategoryParent(ownerId, cityId, root.id, root.id))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      // root -> grandchild would close the loop root -> child -> grandchild.
      await expect(setLibraryCategoryParent(ownerId, cityId, root.id, grandchild.id))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      // The valid direction still works.
      const promoted = await setLibraryCategoryParent(ownerId, cityId, grandchild.id, null)
      expect(promoted.parentId).toBeNull()
    })

    it('deleting a category uncategorizes its books and promotes its children to roots', async () => {
      const parent = seedCategory(cityId, 'Parent')
      const child = seedCategory(cityId, 'Child', parent)
      const tagged = seedWork(cityId, { categoryId: parent })
      const inChild = seedWork(cityId, { categoryId: child })

      await deleteLibraryCategory(ownerId, cityId, parent)

      // Books fall back to uncategorized rather than pointing at a dead row.
      expect(db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, tagged)).get()?.categoryId).toBeNull()
      expect(db.select().from(schema.libraryBooks).where(eq(schema.libraryBooks.id, inChild)).get()?.categoryId).toBe(child)
      // The child survives as a root instead of dangling.
      expect(db.select().from(schema.libraryCategories).where(eq(schema.libraryCategories.id, child)).get()?.parentId)
        .toBeNull()
    })

    it('reorder demands the exact full set, so a partial list cannot silently drop rows', async () => {
      const a = await createLibraryCategory(ownerId, cityId, { name: 'A' })
      const b = await createLibraryCategory(ownerId, cityId, { name: 'B' })

      await expect(reorderLibraryCategories(ownerId, cityId, [a.id]))
        .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
      await expect(reorderLibraryCategories(ownerId, cityId, [a.id, a.id]))
        .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
      await expect(reorderLibraryCategories(ownerId, cityId, [a.id, createId('cat')]))
        .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })
      // A foreign category id is not orderable either.
      await expect(reorderLibraryCategories(ownerId, cityId, [a.id, b.id, seedCategory(otherCityId, 'X')]))
        .rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND' })

      await reorderLibraryCategories(ownerId, cityId, [b.id, a.id])
      const order = new Map(listLibraryCategoriesRes().map((c: { id: string; sortOrder: number }) => [c.id, c.sortOrder]))
      expect(order.get(b.id)).toBeLessThan(order.get(a.id)!)
    })

    it('only owners and admins curate; members and outsiders get nothing', async () => {
      await expect(createLibraryCategory(memberId, cityId, { name: 'X' }))
        .rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(createLibraryCategory(outsiderId, cityId, { name: 'X' }))
        .rejects.toMatchObject({ code: 'FORBIDDEN' })
      const id = await createLibraryCategory(ownerId, cityId, { name: 'X' })
      await expect(deleteLibraryCategory(memberId, cityId, id)).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(reorderLibraryCategories(memberId, cityId, [id])).rejects.toMatchObject({ code: 'FORBIDDEN' })
      // Promotion to admin grants curation.
      db.update(schema.libraryMemberships).set({ role: 'admin' })
        .where(eq(schema.libraryMemberships.userId, memberId)).run()
      await expect(createLibraryCategory(memberId, cityId, { name: 'Y' })).resolves.toMatchObject({ name: 'Y' })
    })
  })

  describe('tags', () => {
    it('refuses a duplicate name inside the same library but allows it across libraries', async () => {
      await createLibraryTag(ownerId, cityId, 'Classic')
      await expect(createLibraryTag(ownerId, cityId, 'Classic'))
        .rejects.toMatchObject({ code: 'TAG_NAME_TAKEN' })
      await expect(createLibraryTag(ownerId, otherCityId, 'Classic')).resolves.toMatchObject({ name: 'Classic' })
    })

    it('never lets one library reach another library tag', async () => {
      const foreign = seedTag(otherCityId, 'Foreign')
      const own = await createLibraryTag(ownerId, cityId, 'Own')

      await expect(updateLibraryTag(ownerId, cityId, foreign, { name: 'Stolen' }))
        .rejects.toMatchObject({ code: 'TAG_NOT_FOUND' })
      await expect(deleteLibraryTag(ownerId, cityId, foreign))
        .rejects.toMatchObject({ code: 'TAG_NOT_FOUND' })
      await expect(reorderLibraryTags(ownerId, cityId, [own.id, foreign]))
        .rejects.toMatchObject({ code: 'TAG_NOT_FOUND' })
      expect(db.select().from(schema.libraryTags).where(eq(schema.libraryTags.id, foreign)).get()?.name).toBe('Foreign')
    })

    it('deleting a tag drops its book links instead of leaving orphans', async () => {
      const tag = await createLibraryTag(ownerId, cityId, 'Doomed')
      const keep = await createLibraryTag(ownerId, cityId, 'Kept')
      const work = seedWork(cityId)
      for (const tagId of [tag.id, keep.id]) {
        db.insert(schema.libraryBookTags).values({ libraryBookId: work, tagId }).run()
      }

      await deleteLibraryTag(ownerId, cityId, tag.id)

      const left = db.select().from(schema.libraryBookTags).all()
      expect(left).toHaveLength(1)
      expect(left[0]!.tagId).toBe(keep.id)
    })

    it('reorder demands the exact full set', async () => {
      const a = await createLibraryTag(ownerId, cityId, 'A')
      const b = await createLibraryTag(ownerId, cityId, 'B')
      await expect(reorderLibraryTags(ownerId, cityId, [a.id])).rejects.toMatchObject({ code: 'TAG_NOT_FOUND' })
      await reorderLibraryTags(ownerId, cityId, [b.id, a.id])
      const listed = await listLibraryTags(ownerId, cityId)
      expect(listed.map((t) => t.name)).toEqual(['B', 'A'])
    })

    it('only owners and admins curate', async () => {
      await expect(createLibraryTag(memberId, cityId, 'X')).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(createLibraryTag(outsiderId, cityId, 'X')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    })

    it('lets any member browse the taxonomy but not a stranger', async () => {
      await createLibraryTag(ownerId, cityId, 'Visible')
      await expect(listLibraryTags(memberId, cityId)).resolves.toHaveLength(1)
      await expect(listLibraryTags(outsiderId, cityId)).rejects.toMatchObject({ code: 'LIBRARY_NOT_FOUND' })
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
      const fiction = await createLibraryCategory(ownerId, cityId, { name: 'Fiction' })
      const poetry = await createLibraryCategory(ownerId, cityId, { name: 'Poetry' })
      seedWork(cityId, { title: 'A', categoryId: fiction.id })
      seedWork(cityId, { title: 'B', categoryId: fiction.id })
      seedWork(cityId, { title: 'C', categoryId: fiction.id, deletedAt: 2 })
      seedWork(cityId, { title: 'D', categoryId: poetry.id })

      const listed = await listLibraryCategories(ownerId, cityId)
      expect(listed.find((c) => c.id === fiction.id)?.bookCount).toBe(2)
      expect(listed.find((c) => c.id === poetry.id)?.bookCount).toBe(1)
    })

    it('counts the works carrying a tag, ignoring trashed ones', async () => {
      const classic = await createLibraryTag(ownerId, cityId, 'Classic')
      const modern = await createLibraryTag(ownerId, cityId, 'Modern')
      const a = seedWork(cityId, { title: 'A' })
      const b = seedWork(cityId, { title: 'B' })
      const trashed = seedWork(cityId, { title: 'C', deletedAt: 2 })
      db.insert(schema.libraryBookTags).values([
        { libraryBookId: a, tagId: classic.id },
        { libraryBookId: b, tagId: classic.id },
        { libraryBookId: trashed, tagId: classic.id },
        { libraryBookId: a, tagId: modern.id },
      ]).run()

      const listed = await listLibraryTags(ownerId, cityId)
      expect(listed.find((t) => t.id === classic.id)?.bookCount).toBe(2)
      expect(listed.find((t) => t.id === modern.id)?.bookCount).toBe(1)
    })

    it('drops a sibling count when a work is hidden through any dimension', async () => {
      const adult = await createLibraryTag(ownerId, cityId, 'Adult')
      const name = await createLibraryTag(ownerId, cityId, 'Author')
      const secret = await createLibraryCategory(ownerId, cityId, { name: 'Secret' })
      const kept = seedWork(cityId, { title: 'Kept' })
      const hidden = seedWork(cityId, { title: 'Hidden' })
      db.insert(schema.libraryBookTags).values([
        { libraryBookId: kept, tagId: name.id },
        { libraryBookId: hidden, tagId: name.id },
        { libraryBookId: hidden, tagId: adult.id },
      ]).run()

      // A manager sees hidden rows, so nothing is excluded for them.
      const asOwner = await listLibraryTags(ownerId, cityId)
      expect(asOwner.find((t) => t.id === name.id)?.bookCount).toBe(2)

      // Hiding one tag closes every work carrying it, and the sibling tag's
      // capsule has to follow the list it counts, not just its own dimension.
      await updateLibraryTag(ownerId, cityId, adult.id, { hidden: true })
      const asMember = await listLibraryTags(memberId, cityId)
      expect(asMember.find((t) => t.id === name.id)?.bookCount).toBe(1)
      // The hidden tag itself drops out of the member's sidebar entirely.
      expect(asMember.find((t) => t.id === adult.id)).toBeUndefined()

      // A work hidden through a hidden category is excluded from a tag count too.
      db.update(schema.libraryBooks).set({ categoryId: secret.id }).where(eq(schema.libraryBooks.id, kept)).run()
      await updateLibraryCategory(ownerId, cityId, secret.id, { hidden: true })
      expect((await listLibraryTags(memberId, cityId)).find((t) => t.id === name.id)?.bookCount).toBe(0)
    })

    it('scopes each category to its own library, and leaves uncategorized work uncounted', async () => {
      const mine = await createLibraryCategory(ownerId, cityId, { name: 'Mine' })
      const theirs = await createLibraryCategory(ownerId, otherCityId, { name: 'Theirs' })
      seedWork(cityId, { title: 'Loose' })
      seedWork(otherCityId, { title: 'X', categoryId: theirs.id })
      seedWork(otherCityId, { title: 'Y', categoryId: theirs.id })

      // The same shape listShelves already relies on: a category id belongs to
      // exactly one library, so counting by categoryId is counting by library.
      const listed = await listLibraryCategories(ownerId, cityId)
      expect(listed).toHaveLength(1)
      expect(listed[0]?.bookCount).toBe(0)
      expect((await listLibraryCategories(ownerId, otherCityId))[0]?.bookCount).toBe(2)
      expect(mine.id).not.toBe(theirs.id)
    })

    it('reports the same count from a rename as from a listing', async () => {
      const fiction = await createLibraryCategory(ownerId, cityId, { name: 'Fiction' })
      seedWork(cityId, { categoryId: fiction.id })
      const renamed = await updateLibraryCategory(ownerId, cityId, fiction.id, { name: 'Novels' })
      expect(renamed.bookCount).toBe(1)
    })
  })

  // Sync helper: the service is async but the taxonomy read is pure, and the
  // reorder assertion only needs the resulting order.
  function listLibraryCategoriesRes() {
    return db.select().from(schema.libraryCategories)
      .where(eq(schema.libraryCategories.libraryId, cityId))
      .orderBy(schema.libraryCategories.sortOrder).all()
  }
})

// Keep the async listing referenced so the import stays honest if the helper
// above is ever inlined.
void listLibraryCategories
