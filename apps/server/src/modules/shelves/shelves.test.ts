import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import {
  listShelves,
  createShelf,
  updateShelf,
  deleteShelf,
  reorderShelves,
  moveBooksToShelf,
  removeBooksFromShelf,
} from './shelves.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

describe('shelves service', () => {
  let db: ReturnType<typeof createTestDb>
  let userId: string
  let bookId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)

    userId = createId('user')
    db.insert(schema.users).values({
      id: userId,
      username: 'test',
      passwordHash: null,
      role: 'owner',
      createdAt: Date.now(),
    }).run()

    bookId = createId('book')
    db.insert(schema.books).values({
      id: bookId,
      userId,
      title: 'Test Book',
      author: 'Author',
      format: 'txt',
      filePath: 'books/test/test.txt',
      coverKey: null,
      size: 100,
      meta: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }).run()
  })

  function getBookShelfId(id: string) {
    return db.select({ shelfId: schema.books.shelfId }).from(schema.books).where(eq(schema.books.id, id)).get()?.shelfId
  }

  it('should create and list shelves', async () => {
    const shelf = await createShelf(userId, 'Favorites')
    expect(shelf.name).toBe('Favorites')
    expect(shelf.bookCount).toBe(0)

    const shelves = await listShelves(userId)
    expect(shelves).toHaveLength(1)
    expect(shelves[0].name).toBe('Favorites')
    expect(shelves[0].bookCount).toBe(0)
  })

  it('should reject duplicate shelf names for the same user', async () => {
    await createShelf(userId, 'Favorites')

    await expect(createShelf(userId, 'Favorites')).rejects.toMatchObject({ code: 'SHELF_NAME_TAKEN' })
  })

  it('should update a shelf name', async () => {
    const shelf = await createShelf(userId, 'Old Name')
    const updated = await updateShelf(userId, shelf.id, 'New Name')
    expect(updated.name).toBe('New Name')
  })

  it('should reject renaming a shelf to another shelf name', async () => {
    const first = await createShelf(userId, 'Shelf A')
    const second = await createShelf(userId, 'Shelf B')

    await expect(updateShelf(userId, second.id, first.name)).rejects.toMatchObject({ code: 'SHELF_NAME_TAKEN' })
  })

  it('should move books into and out of a shelf', async () => {
    const shelf = await createShelf(userId, 'Shelf A')
    await moveBooksToShelf(userId, shelf.id, [bookId])
    expect(getBookShelfId(bookId)).toBe(shelf.id)

    const shelves = await listShelves(userId)
    expect(shelves[0].bookCount).toBe(1)

    await removeBooksFromShelf(userId, shelf.id, [bookId])
    expect(getBookShelfId(bookId)).toBeNull()
    const shelvesAfter = await listShelves(userId)
    expect(shelvesAfter[0].bookCount).toBe(0)
  })

  it('should keep a single shelf per book when moving between shelves', async () => {
    const shelfA = await createShelf(userId, 'Shelf A')
    const shelfB = await createShelf(userId, 'Shelf B')
    await moveBooksToShelf(userId, shelfA.id, [bookId])
    await moveBooksToShelf(userId, shelfB.id, [bookId])

    expect(getBookShelfId(bookId)).toBe(shelfB.id)
    const shelves = await listShelves(userId)
    expect(shelves.find((s) => s.id === shelfA.id)?.bookCount).toBe(0)
    expect(shelves.find((s) => s.id === shelfB.id)?.bookCount).toBe(1)
  })

  it('should only remove books that are currently on the shelf', async () => {
    const shelfA = await createShelf(userId, 'Shelf A')
    const shelfB = await createShelf(userId, 'Shelf B')
    await moveBooksToShelf(userId, shelfA.id, [bookId])
    // bookId is on shelf A now; removing it "from shelf B" is a no-op
    await removeBooksFromShelf(userId, shelfB.id, [bookId])
    expect(getBookShelfId(bookId)).toBe(shelfA.id)
  })

  it('should delete a shelf and set its books to uncategorized', async () => {
    const shelf = await createShelf(userId, 'To Delete')
    await moveBooksToShelf(userId, shelf.id, [bookId])

    await deleteShelf(userId, shelf.id)
    const shelves = await listShelves(userId)
    expect(shelves).toHaveLength(0)
    expect(getBookShelfId(bookId)).toBeNull()
  })

  it('should reorder shelves by the submitted id list', async () => {
    const a = await createShelf(userId, 'A')
    const b = await createShelf(userId, 'B')
    const c = await createShelf(userId, 'C')

    await reorderShelves(userId, [c.id, a.id, b.id])
    const ordered = (await listShelves(userId)).map((s) => s.id)
    expect(ordered).toEqual([c.id, a.id, b.id])
  })

  it('should reject reorder lists that are not the full shelf set', async () => {
    const a = await createShelf(userId, 'A')
    const b = await createShelf(userId, 'B')
    await createShelf(userId, 'C')

    await expect(reorderShelves(userId, [a.id, b.id])).rejects.toThrow('SHELF_NOT_FOUND')
    await expect(reorderShelves(userId, [a.id, b.id, 'foreign'])).rejects.toThrow('SHELF_NOT_FOUND')
  })

  it('should land new shelves at the end after a reorder', async () => {
    const a = await createShelf(userId, 'A')
    const b = await createShelf(userId, 'B')
    await reorderShelves(userId, [b.id, a.id])

    await createShelf(userId, 'C')
    const ordered = (await listShelves(userId)).map((s) => s.name)
    expect(ordered).toEqual(['B', 'A', 'C'])
  })

  it('should keep sortOrder isolated per user', async () => {
    const a = await createShelf(userId, 'A')
    await reorderShelves(userId, [a.id])

    const otherUserId = createId('user')
    db.insert(schema.users).values({
      id: otherUserId,
      username: 'other',
      passwordHash: null,
      role: 'member',
      createdAt: Date.now(),
    }).run()
    const theirs = await createShelf(otherUserId, 'Theirs')
    // No shelves for the other user: their own single-shelf reorder must pass.
    await reorderShelves(otherUserId, [theirs.id])
    expect((await listShelves(otherUserId))[0].id).toBe(theirs.id)
  })
})
