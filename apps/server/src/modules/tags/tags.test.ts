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
  listTags,
  createTag,
  updateTag,
  deleteTag,
  addBooksToTag,
  removeBooksFromTag,
} from './tags.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

describe('tags service', () => {
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

  it('should create and list tags', async () => {
    const tag = await createTag(userId, 'Classic')
    expect(tag.name).toBe('Classic')
    expect(tag.bookCount).toBe(0)

    const tags = await listTags(userId)
    expect(tags).toHaveLength(1)
    expect(tags[0].name).toBe('Classic')
    expect(tags[0].bookCount).toBe(0)
  })

  it('should update a tag name', async () => {
    const tag = await createTag(userId, 'Old Tag')
    const updated = await updateTag(userId, tag.id, 'New Tag')
    expect(updated.name).toBe('New Tag')
  })

  it('should add and remove books from a tag', async () => {
    const tag = await createTag(userId, 'Tag A')
    await addBooksToTag(userId, tag.id, [bookId])

    const tags = await listTags(userId)
    expect(tags[0].bookCount).toBe(1)

    await removeBooksFromTag(userId, tag.id, [bookId])
    const tagsAfter = await listTags(userId)
    expect(tagsAfter[0].bookCount).toBe(0)
  })

  it('should delete a tag', async () => {
    const tag = await createTag(userId, 'To Delete')
    await deleteTag(userId, tag.id)
    const tags = await listTags(userId)
    expect(tags).toHaveLength(0)
  })
})
