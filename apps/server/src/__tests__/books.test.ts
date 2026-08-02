import { describe, it, expect, beforeAll } from 'vitest'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as schema from '../db/schema'
import { createId } from '../lib/id'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', 'db', 'migrations') })
  return db
}

function seedUser(db: ReturnType<typeof createTestDb>): string {
  const id = createId('user')
  db.insert(schema.users).values({
    id,
    username: 'test',
    passwordHash: null,
    role: 'owner',
    createdAt: Date.now(),
  }).run()
  return id
}

function seedBook(db: ReturnType<typeof createTestDb>, userId: string, overrides?: Partial<typeof schema.books.$inferInsert>) {
  const book = {
    id: createId('book'),
    userId,
    title: 'Test Book',
    author: 'Test Author',
    format: 'txt' as const,
    filePath: 'books/test/test.txt',
    coverKey: null,
    size: 100,
    meta: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
  db.insert(schema.books).values(book).run()
  return book
}

describe('books database operations', () => {
  let db: ReturnType<typeof createTestDb>
  let userId: string

  beforeAll(() => {
    db = createTestDb()
    userId = seedUser(db)
  })

  it('should insert and query a book', () => {
    const book = seedBook(db, userId)
    const result = db.select().from(schema.books).where(eq(schema.books.id, book.id)).get()
    expect(result).toBeDefined()
    expect(result!.title).toBe('Test Book')
    expect(result!.author).toBe('Test Author')
    expect(result!.format).toBe('txt')
  })

  it('should list books for a user', () => {
    seedBook(db, userId, { title: 'Book A' })
    seedBook(db, userId, { title: 'Book B' })
    const results = db.select().from(schema.books).where(eq(schema.books.userId, userId)).all()
    expect(results.length).toBeGreaterThanOrEqual(3)
  })

  it('should delete a book', () => {
    const book = seedBook(db, userId, { title: 'To Delete' })
    db.delete(schema.books).where(eq(schema.books.id, book.id)).run()
    const result = db.select().from(schema.books).where(eq(schema.books.id, book.id)).get()
    expect(result).toBeUndefined()
  })
})
