import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { createAnnotation, listAnnotations } from './annotations.service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'db', 'migrations') })
  return db
}

describe('annotations service', () => {
  let db: ReturnType<typeof createTestDb>
  let ownerId: string
  let otherId: string
  let bookId: string

  beforeEach(() => {
    db = createTestDb()
    vi.spyOn(client, 'getDb').mockReturnValue(db)

    ownerId = createId('user')
    db.insert(schema.users).values({
      id: ownerId,
      username: 'owner',
      passwordHash: null,
      role: 'owner',
      createdAt: Date.now(),
    }).run()
    otherId = createId('user')
    db.insert(schema.users).values({
      id: otherId,
      username: 'other',
      passwordHash: null,
      role: 'owner',
      createdAt: Date.now(),
    }).run()

    bookId = createId('book')
    db.insert(schema.books).values({
      id: bookId,
      userId: ownerId,
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

  it('should create an annotation on the owner\'s book', async () => {
    const annotation = await createAnnotation(ownerId, bookId, {
      cfiRange: 'epubcfi(/6/2!/4/2)',
      type: 'highlight',
      text: 'hello',
    })
    expect(annotation.bookId).toBe(bookId)

    const items = await listAnnotations(ownerId, bookId)
    expect(items).toHaveLength(1)
  })

  it('should reject annotation creation on another user\'s book with BOOK_NOT_FOUND', async () => {
    await expect(createAnnotation(otherId, bookId, {
      cfiRange: 'epubcfi(/6/2!/4/2)',
      type: 'highlight',
    })).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    expect(await listAnnotations(ownerId, bookId)).toHaveLength(0)
  })

  it('allows multiple notes on the same range without overwriting earlier ideas', async () => {
    await createAnnotation(ownerId, bookId, {
      cfiRange: 'epubcfi(/6/2!/4/2)',
      type: 'note',
      text: 'hello',
      note: 'first idea',
    })
    await createAnnotation(ownerId, bookId, {
      cfiRange: 'epubcfi(/6/2!/4/2)',
      type: 'note',
      text: 'hello',
      note: 'second idea',
    })
    const items = await listAnnotations(ownerId, bookId)
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.note).sort()).toEqual(['first idea', 'second idea'])
  })

  it('restores the existing highlight on the same range instead of duplicating', async () => {
    await createAnnotation(ownerId, bookId, {
      cfiRange: 'epubcfi(/6/2!/4/2)',
      type: 'highlight',
      text: 'hello',
    })
    await createAnnotation(ownerId, bookId, {
      cfiRange: 'epubcfi(/6/2!/4/2)',
      type: 'highlight',
      text: 'hello',
      color: 'red',
    })
    const items = await listAnnotations(ownerId, bookId)
    expect(items).toHaveLength(1)
    expect(items[0].color).toBe('red')
  })
})
