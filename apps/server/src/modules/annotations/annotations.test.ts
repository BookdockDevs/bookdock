import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as schema from '../../db/schema'
import * as client from '../../db/client'
import { createId } from '../../lib/id'
import { createAnnotation, deleteAnnotation, listAnnotations, searchAnnotations } from './annotations.service'

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
    // New-model mirror for the rewired service: private library, version, work, card.
    const libraryId = createId('lib')
    const now = Date.now()
    db.insert(schema.libraries).values({
      id: libraryId, userId: ownerId, type: 'private', name: 'owner',
      description: '', visibility: null, createdAt: now, updatedAt: now,
    }).run()
    db.insert(schema.bookVersions).values({ id: bookId, format: 'txt', size: 100, createdAt: now, updatedAt: now }).run()
    const libraryBookId = createId('lb')
    db.insert(schema.libraryBooks).values({
      id: libraryBookId, libraryId, userId: ownerId, title: 'Test Book', createdAt: now, updatedAt: now,
    }).run()
    db.insert(schema.libraryBookVersions).values({
      id: createId('lbv'), libraryId, libraryBookId, bookVersionId: bookId,
      kind: 'personal', createdAt: now, updatedAt: now,
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

  it('keeps the row id stable when restoring a soft-deleted highlight', async () => {
    const first = await createAnnotation(ownerId, bookId, {
      cfiRange: 'epubcfi(/6/2!/4/2)',
      type: 'highlight',
      text: 'hello',
    })
    await deleteAnnotation(ownerId, first.id)
    const restored = await createAnnotation(ownerId, bookId, {
      cfiRange: 'epubcfi(/6/2!/4/2)',
      type: 'highlight',
      text: 'restored text',
    })
    expect(restored).toBeDefined()
    expect(restored.id).toBe(first.id)
    expect(restored.text).toBe('restored text')
    expect(restored.deletedAt).toBeNull()
  })

  it('searches active annotations for the owner without treating query characters as wildcards', async () => {
    const match = await createAnnotation(ownerId, bookId, {
      cfiRange: 'epubcfi(/6/2!/4/2)',
      type: 'note',
      text: '命中的正文 %',
      note: '关于线索的想法',
      chapter: '第一章',
    })
    await createAnnotation(ownerId, bookId, {
      cfiRange: 'epubcfi(/6/2!/4/4)',
      type: 'highlight',
      text: '另一个正文',
      chapter: '第二章',
    })
    await deleteAnnotation(ownerId, match.id)
    await createAnnotation(ownerId, bookId, {
      cfiRange: 'epubcfi(/6/2!/4/6)',
      type: 'note',
      text: '保留的正文 %',
      note: '只匹配字面量百分号',
      chapter: '第一章',
    })

    const notes = await searchAnnotations(ownerId, bookId, '%')
    expect(notes).toHaveLength(1)
    expect(notes[0]?.text).toBe('保留的正文 %')
    expect(await searchAnnotations(otherId, bookId, '正文')).toEqual([])
  })

  it('persists the TOC href for duplicate chapter labels', async () => {
    const saved = await createAnnotation(ownerId, bookId, {
      cfiRange: 'epubcfi(/6/2!/4/8)',
      type: 'bookmark',
      chapter: '第二十七章',
      chapterHref: 'chapter:second-27',
    })
    expect(saved.chapter).toBe('第二十七章')
    expect(saved.chapterHref).toBe('chapter:second-27')
  })
})
