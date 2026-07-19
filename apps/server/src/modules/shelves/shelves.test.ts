import { describe, it, expect, beforeEach, vi } from 'vitest'
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
  addBooksToShelf,
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

  it('should create and list shelves', async () => {
    const shelf = await createShelf(userId, 'Favorites')
    expect(shelf.name).toBe('Favorites')
    expect(shelf.bookCount).toBe(0)

    const shelves = await listShelves(userId)
    expect(shelves).toHaveLength(1)
    expect(shelves[0].name).toBe('Favorites')
    expect(shelves[0].bookCount).toBe(0)
  })

  it('should update a shelf name', async () => {
    const shelf = await createShelf(userId, 'Old Name')
    const updated = await updateShelf(userId, shelf.id, 'New Name')
    expect(updated.name).toBe('New Name')
  })

  it('should add and remove books from a shelf', async () => {
    const shelf = await createShelf(userId, 'Shelf A')
    await addBooksToShelf(userId, shelf.id, [bookId])

    const shelves = await listShelves(userId)
    expect(shelves[0].bookCount).toBe(1)

    await removeBooksFromShelf(userId, shelf.id, [bookId])
    const shelvesAfter = await listShelves(userId)
    expect(shelvesAfter[0].bookCount).toBe(0)
  })

  it('should delete a shelf', async () => {
    const shelf = await createShelf(userId, 'To Delete')
    await deleteShelf(userId, shelf.id)
    const shelves = await listShelves(userId)
    expect(shelves).toHaveLength(0)
  })
})
