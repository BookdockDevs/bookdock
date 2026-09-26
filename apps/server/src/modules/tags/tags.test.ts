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
  listTags,
  createTag,
  updateTag,
  reorderTags,
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
    // New-model mirror for rewired reads: private library, version, work, card.
    const libraryId = createId('lib')
    const now = Date.now()
    db.insert(schema.libraries).values({
      id: libraryId, userId, type: 'private', name: 'test',
      description: '', visibility: null, createdAt: now, updatedAt: now,
    }).run()
    db.insert(schema.bookVersions).values({ id: bookId, format: 'txt', size: 100, createdAt: now, updatedAt: now }).run()
    const libraryBookId = createId('lb')
    db.insert(schema.libraryBooks).values({
      id: libraryBookId, libraryId, userId, title: 'Test Book', createdAt: now, updatedAt: now,
    }).run()
    db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId, libraryBookId, bookVersionId: bookId,
      kind: 'personal', createdAt: now, updatedAt: now,
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

  it('should reject duplicate tag names for the same user', async () => {
    await createTag(userId, 'Classic')

    await expect(createTag(userId, 'Classic')).rejects.toMatchObject({ code: 'TAG_NAME_TAKEN' })
  })

  it('should update a tag name', async () => {
    const tag = await createTag(userId, 'Old Tag')
    const updated = await updateTag(userId, tag.id, { name: 'New Tag' })
    expect(updated.name).toBe('New Tag')
  })

  it('should toggle a tag pin without touching membership timestamps', async () => {
    const tag = await createTag(userId, 'Tag A')
    const pinned = await updateTag(userId, tag.id, { pinned: true })
    expect(pinned.pinned).toBe(true)

    const listed = (await listTags(userId)).find((t) => t.id === tag.id)
    expect(listed?.pinned).toBe(true)
    expect(listed?.updatedAt).toBe(tag.updatedAt)

    const unpinned = await updateTag(userId, tag.id, { pinned: false })
    expect(unpinned.pinned).toBe(false)
  })

  it('should reject renaming a tag to another tag name', async () => {
    const first = await createTag(userId, 'Tag A')
    const second = await createTag(userId, 'Tag B')

    await expect(updateTag(userId, second.id, { name: first.name })).rejects.toMatchObject({ code: 'TAG_NAME_TAKEN' })
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

  it('should exclude trashed books from tag counts', async () => {
    const tag = await createTag(userId, 'Tag A')
    await addBooksToTag(userId, tag.id, [bookId])
    expect((await listTags(userId))[0].bookCount).toBe(1)

    const book = db.select({ libraryBookId: schema.libraryBookVersions.libraryBookId })
      .from(schema.libraryBookVersions).where(eq(schema.libraryBookVersions.bookVersionId, bookId)).get()!
    db.update(schema.libraryBooks).set({ deletedAt: Date.now() }).where(eq(schema.libraryBooks.id, book.libraryBookId)).run()
    expect((await listTags(userId))[0].bookCount).toBe(0)

    db.update(schema.libraryBooks).set({ deletedAt: null }).where(eq(schema.libraryBooks.id, book.libraryBookId)).run()
    expect((await listTags(userId))[0].bookCount).toBe(1)
  })

  it('should delete a tag', async () => {
    const tag = await createTag(userId, 'To Delete')
    await deleteTag(userId, tag.id)
    const tags = await listTags(userId)
    expect(tags).toHaveLength(0)
  })

  it('should reorder tags by the submitted id list', async () => {
    const a = await createTag(userId, 'A')
    const b = await createTag(userId, 'B')
    const c = await createTag(userId, 'C')

    await reorderTags(userId, [c.id, a.id, b.id])
    const ordered = (await listTags(userId)).map((tag) => tag.id)
    expect(ordered).toEqual([c.id, a.id, b.id])
  })

  it('should reject reorder lists that are not the full tag set', async () => {
    const a = await createTag(userId, 'A')
    const b = await createTag(userId, 'B')
    await createTag(userId, 'C')

    await expect(reorderTags(userId, [a.id, b.id])).rejects.toThrow('TAG_NOT_FOUND')
    await expect(reorderTags(userId, [a.id, b.id, 'foreign'])).rejects.toThrow('TAG_NOT_FOUND')
    await expect(reorderTags(userId, [a.id, a.id, b.id])).rejects.toThrow('TAG_NOT_FOUND')
  })

  it('should append new tags after the saved order', async () => {
    const a = await createTag(userId, 'A')
    const b = await createTag(userId, 'B')
    await reorderTags(userId, [b.id, a.id])

    const c = await createTag(userId, 'C')
    const ordered = (await listTags(userId)).map((tag) => tag.id)
    expect(ordered).toEqual([b.id, a.id, c.id])
  })
})
