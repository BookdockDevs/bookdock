import type { Readable } from 'node:stream'

import { eq, desc, asc, and, sql, inArray, isNull, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/client'
import { books, readingProgress, annotations, bookTags, bookShelves, shelves, tags } from '../../db/schema'
import { getStorage } from '../../storage'
import { getParser } from '../../formats/registry'
import { detectTxtChapters, normalizeText, decodeTextBuffer } from '../../formats/txt'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import { convertTxtToEpub } from '../../lib/txt-to-epub'
import type { BookFormat } from '@bookdock/shared'

export async function listBooks(userId: string, page: number, pageSize: number, search?: string, sortBy?: string, sortOrder?: string, shelfId?: string, tagId?: string, format?: BookFormat, trash?: boolean) {
  const db = getDb()
  const conditions = [eq(books.userId, userId), trash ? isNotNull(books.deletedAt) : isNull(books.deletedAt)]
  if (search) {
    conditions.push(sql`${books.title} LIKE ${'%' + search + '%'}`)
  }
  if (format) {
    conditions.push(eq(books.format, format))
  }
  if (shelfId) {
    const sub = db.select({ bookId: bookShelves.bookId }).from(bookShelves).where(eq(bookShelves.shelfId, shelfId))
    conditions.push(sql`${books.id} IN ${sub}`)
  }
  if (tagId) {
    const sub = db.select({ bookId: bookTags.bookId }).from(bookTags).where(eq(bookTags.tagId, tagId))
    conditions.push(sql`${books.id} IN ${sub}`)
  }
  const orderBy = sortBy === 'title' ? (sortOrder === 'asc' ? asc(books.title) : desc(books.title)) :
    sortBy === 'author' ? (sortOrder === 'asc' ? asc(books.author) : desc(books.author)) :
    sortBy === 'size' ? (sortOrder === 'asc' ? asc(books.size) : desc(books.size)) :
    desc(books.createdAt)
  const offset = (page - 1) * pageSize
  const items = db.select().from(books).where(and(...conditions)).orderBy(orderBy).limit(pageSize).offset(offset).all()
  const total = db.select({ count: sql<number>`count(*)` }).from(books).where(and(...conditions)).get()
  return { data: items, page, pageSize, total: total?.count ?? 0 }
}

function detectImageExtension(buffer: Buffer): string | null {
  if (buffer.length < 4) return null
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  return null
}

export function getBookContentKey(bookId: string): string {
  return `books/${bookId}/content.txt`
}

function getBookEpubCacheKey(bookId: string): string {
  return `books/${bookId}/generated.epub`
}

async function bufferFromStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function uploadBook(userId: string, file: File) {
  const storage = getStorage()
  const fileName = file.name
  const mime = file.type
  const parser = getParser(fileName, mime)
  if (!parser) {
    throw new AppError('UNSUPPORTED_FORMAT', `Unsupported format: ${fileName}`)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const parsed = await parser.parse(buffer)
  const format = fileName.endsWith('.txt') ? 'txt' : 'epub'
  const bookId = createId('book')
  const fileKey = `books/${bookId}/${fileName}`

  await storage.put(fileKey, buffer)

  const title = parsed.meta.title || fileName.replace(/\.[^.]+$/, '')
  const author = parsed.meta.author ?? ''

  let coverKey: string | null = null
  if (parsed.meta.cover) {
    const ext = detectImageExtension(parsed.meta.cover) || 'jpg'
    coverKey = `covers/${bookId}.${ext}`
    await storage.put(coverKey, parsed.meta.cover)
  }

  const meta: Record<string, unknown> = {}
  if (format === 'txt') {
    const text = decodeTextBuffer(buffer)
    const normalized = normalizeText(text)
    const chapters = detectTxtChapters(normalized)
    meta.chapters = chapters.map((c) => ({
      id: `ch-${c.startOffset}`,
      title: c.title,
      level: c.level,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      contentStartOffset: c.contentStartOffset,
    }))
    const contentKey = getBookContentKey(bookId)
    await storage.put(contentKey, Buffer.from(normalized, 'utf-8'))
  }

  if (format === 'epub' && parsed.chapters.length > 0) {
    meta.chapters = parsed.chapters.map((c, idx) => ({
      id: `ch-${idx}`,
      title: c.title,
      level: 1,
      startOffset: 0,
      endOffset: 0,
    }))
  }

  const db = getDb()
  const now = Date.now()
  const book = {
    id: bookId,
    userId,
    title,
    author,
    format: format as BookFormat,
    filePath: fileKey,
    coverKey,
    size: buffer.length,
    meta,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(books).values(book).run()
  return book
}

export async function getBook(bookId: string) {
  const db = getDb()
  const book = db.select().from(books).where(eq(books.id, bookId)).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  return book
}

export async function getActiveBook(bookId: string) {
  const book = await getBook(bookId)
  if (book.deletedAt) throw new AppError('BOOK_NOT_FOUND')
  return book
}

export async function getBookChapters(bookId: string) {
  const book = await getBook(bookId)
  let chapters = (book.meta?.chapters ?? []) as Array<{
    id: string
    title: string
    level: number
    startOffset: number
    endOffset: number
    contentStartOffset?: number
  }>

  // Migrate old txt books that lack normalized chapter metadata.
  if (book.format === 'txt' && chapters.length > 0 && chapters[0]?.contentStartOffset === undefined) {
    await regenerateTxtBookContent(bookId)
    const updatedBook = await getBook(bookId)
    chapters = (updatedBook.meta?.chapters ?? []) as Array<{
      id: string
      title: string
      level: number
      startOffset: number
      endOffset: number
      contentStartOffset?: number
    }>
  }

  return chapters
}

async function regenerateTxtBookContent(bookId: string): Promise<string> {
  const storage = getStorage()
  const book = await getBook(bookId)
  const stream = await storage.get(book.filePath)
  const buffer = await bufferFromStream(stream)
  const text = decodeTextBuffer(buffer)
  const normalized = normalizeText(text)
  const chapters = detectTxtChapters(normalized)

  const contentKey = getBookContentKey(bookId)
  await storage.put(contentKey, Buffer.from(normalized, 'utf-8'))

  const db = getDb()
  const metaChapters = chapters.map((c) => ({
    id: `ch-${c.startOffset}`,
    title: c.title,
    level: c.level,
    startOffset: c.startOffset,
    endOffset: c.endOffset,
    contentStartOffset: c.contentStartOffset,
  }))
  const meta = { ...book.meta, chapters: metaChapters }
  db.update(books).set({ meta, updatedAt: Date.now() }).where(eq(books.id, bookId)).run()

  return normalized
}

export async function getBookContent(bookId: string): Promise<string> {
  const storage = getStorage()
  const book = await getBook(bookId)
  if (book.format !== 'txt') {
    throw new AppError('UNSUPPORTED_FORMAT', 'Content endpoint only supports txt')
  }
  const contentKey = getBookContentKey(bookId)
  if (await storage.exists(contentKey)) {
    const stream = await storage.get(contentKey)
    const buffer = await bufferFromStream(stream)
    return buffer.toString('utf-8')
  }
  return regenerateTxtBookContent(bookId)
}

export async function getBookEpubBuffer(bookId: string): Promise<Buffer> {
  const storage = getStorage()
  const book = await getBook(bookId)

  if (book.format === 'epub') {
    const stream = await storage.get(book.filePath)
    return bufferFromStream(stream)
  }

  if (book.format === 'txt') {
    const cacheKey = getBookEpubCacheKey(bookId)
    if (await storage.exists(cacheKey)) {
      const stream = await storage.get(cacheKey)
      return bufferFromStream(stream)
    }

    const [content, chapters] = await Promise.all([
      getBookContent(bookId),
      getBookChapters(bookId),
    ])
    const epubChapters = chapters.map((c) => {
      const text = content.slice(c.contentStartOffset ?? c.startOffset, c.endOffset)
      return {
        id: c.id,
        title: c.title,
        level: c.level,
        content: text,
      }
    })
    const buffer = await convertTxtToEpub(
      { title: book.title, author: book.author || undefined, id: book.id },
      epubChapters
    )
    await storage.put(cacheKey, buffer)
    return buffer
  }

  throw new AppError('UNSUPPORTED_FORMAT', 'EPUB export only supports txt and epub')
}

export async function trashBook(bookId: string) {
  const db = getDb()
  const book = db.select().from(books).where(eq(books.id, bookId)).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  db.update(books).set({ deletedAt: Date.now(), updatedAt: Date.now() }).where(eq(books.id, bookId)).run()
}

export async function restoreBook(bookId: string) {
  const db = getDb()
  const book = db.select().from(books).where(eq(books.id, bookId)).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  db.update(books).set({ deletedAt: null, updatedAt: Date.now() }).where(eq(books.id, bookId)).run()
}

export async function emptyTrash(userId: string) {
  const db = getDb()
  const trashed = db.select({ id: books.id }).from(books).where(and(eq(books.userId, userId), isNotNull(books.deletedAt))).all()
  for (const row of trashed) {
    await deleteBook(row.id)
  }
  return trashed.length
}

export async function deleteBook(bookId: string) {
  const db = getDb()
  const storage = getStorage()
  const book = db.select().from(books).where(eq(books.id, bookId)).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')

  db.delete(readingProgress).where(eq(readingProgress.bookId, bookId)).run()
  db.delete(annotations).where(eq(annotations.bookId, bookId)).run()
  db.delete(bookTags).where(eq(bookTags.bookId, bookId)).run()
  db.delete(bookShelves).where(eq(bookShelves.bookId, bookId)).run()

  if (await storage.exists(book.filePath)) {
    await storage.delete(book.filePath)
  }
  const contentKey = getBookContentKey(bookId)
  if (await storage.exists(contentKey)) {
    await storage.delete(contentKey)
  }
  if (book.coverKey && (await storage.exists(book.coverKey))) {
    await storage.delete(book.coverKey)
  }
  const cacheKey = getBookEpubCacheKey(bookId)
  if (await storage.exists(cacheKey)) {
    await storage.delete(cacheKey)
  }
  db.delete(books).where(eq(books.id, bookId)).run()
  return book
}

export async function setBookShelves(userId: string, bookId: string, shelfIds: string[]) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  if (shelfIds.length > 0) {
    const existing = db
      .select({ count: sql<number>`count(*)` })
      .from(shelves)
      .where(and(eq(shelves.userId, userId), inArray(shelves.id, shelfIds)))
      .get()
    if ((existing?.count ?? 0) !== shelfIds.length) {
      throw new AppError('SHELF_NOT_FOUND')
    }
  }
  db.delete(bookShelves).where(eq(bookShelves.bookId, bookId)).run()
  if (shelfIds.length > 0) {
    const values = shelfIds.map((shelfId) => ({ bookId, shelfId, sortOrder: 0 }))
    db.insert(bookShelves).values(values).onConflictDoNothing().run()
  }
}

export async function getBookShelves(userId: string, bookId: string) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  const rows = db
    .select({ shelfId: bookShelves.shelfId })
    .from(bookShelves)
    .where(eq(bookShelves.bookId, bookId))
    .all()
  return rows.map((r) => r.shelfId)
}

export async function setBookTags(userId: string, bookId: string, tagIds: string[]) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  if (tagIds.length > 0) {
    const existing = db
      .select({ count: sql<number>`count(*)` })
      .from(tags)
      .where(and(eq(tags.userId, userId), inArray(tags.id, tagIds)))
      .get()
    if ((existing?.count ?? 0) !== tagIds.length) {
      throw new AppError('TAG_NOT_FOUND')
    }
  }
  db.delete(bookTags).where(eq(bookTags.bookId, bookId)).run()
  if (tagIds.length > 0) {
    const values = tagIds.map((tagId) => ({ bookId, tagId }))
    db.insert(bookTags).values(values).onConflictDoNothing().run()
  }
}

export async function getBookTags(userId: string, bookId: string) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  const rows = db
    .select({ tagId: bookTags.tagId })
    .from(bookTags)
    .where(eq(bookTags.bookId, bookId))
    .all()
  return rows.map((r) => r.tagId)
}
