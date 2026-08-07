import type { Readable } from 'node:stream'

import { eq, ne, lt, desc, asc, and, sql, inArray, isNull, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/client'
import { books, annotations, bookTags, bookShelves, shelves, tags, settings, users as usersTable } from '../../db/schema'
import { getStorage } from '../../storage'
import { getParser } from '../../formats/registry'
import { scanTxtChapters, normalizeText, decodeTextBuffer } from '../../formats/txt'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import { convertTxtToEpub } from '../../lib/txt-to-epub'
import { partialMD5, sha256 } from '../../lib/hash'
import { countWords } from '../../lib/word-count'
import type { BookFormat, BookMetadata, Chapter, TrashSettings, ViewSettings } from '@bookdock/shared'

export async function listBooks(userId: string, page: number, pageSize: number, search?: string, sortBy?: string, sortOrder?: string, shelfId?: string, tagId?: string, format?: BookFormat, readStatus?: string, trash?: boolean) {
  const db = getDb()
  const conditions = [eq(books.userId, userId), trash ? isNotNull(books.deletedAt) : isNull(books.deletedAt)]
  if (search) {
    // Escape LIKE wildcards so user input is matched literally. The escape
    // char is '!' (backslash would be mangled by drizzle's sql template) and
    // must itself be escaped first.
    const escaped = search.replace(/[!%_]/g, (m) => '!' + m)
    conditions.push(sql`${books.title} LIKE ${'%' + escaped + '%'} ESCAPE '!'`)
  }
  if (format) {
    conditions.push(eq(books.format, format))
  }
  if (readStatus) {
    conditions.push(eq(books.readStatus, readStatus as typeof books.$inferSelect.readStatus))
  }
  if (shelfId) {
    const sub = db.select({ bookId: bookShelves.bookId }).from(bookShelves).where(eq(bookShelves.shelfId, shelfId))
    conditions.push(sql`${books.id} IN ${sub}`)
  }
  if (tagId) {
    const sub = db.select({ bookId: bookTags.bookId }).from(bookTags).where(eq(bookTags.tagId, tagId))
    conditions.push(sql`${books.id} IN ${sub}`)
  }
  // sortBy=lastReadAt: pure sort — read books first by last-read time (desc
  // puts NULL lastReadAt at the bottom), never-read books stay visible; skips
  // pin-first ordering like the other explicit sorts.
  const orderBy = sortBy === 'title' ? (sortOrder === 'asc' ? asc(books.title) : desc(books.title)) :
    sortBy === 'author' ? (sortOrder === 'asc' ? asc(books.author) : desc(books.author)) :
    sortBy === 'size' ? (sortOrder === 'asc' ? asc(books.size) : desc(books.size)) :
    sortBy === 'progress' ? (sortOrder === 'asc' ? asc(books.progress) : desc(books.progress)) :
    sortBy === 'lastReadAt' ? (sortOrder === 'asc' ? asc(books.lastReadAt) : desc(books.lastReadAt)) :
    sortBy === 'updatedAt' ? (sortOrder === 'asc' ? asc(books.updatedAt) : desc(books.updatedAt)) :
    sortOrder === 'asc' ? asc(books.createdAt) : desc(books.createdAt)
  const offset = (page - 1) * pageSize
  const where = and(...conditions)
  const baseQuery = () => db.select({
    id: books.id,
    title: books.title,
    author: books.author,
    format: books.format,
    coverKey: books.coverKey,
    size: books.size,
    readStatus: books.readStatus,
    progress: books.progress,
    pinnedAt: books.pinnedAt,
    lastReadAt: books.lastReadAt,
    createdAt: books.createdAt,
    updatedAt: books.updatedAt,
    deletedAt: books.deletedAt,
  }).from(books).where(where)
  const items = sortBy === 'lastReadAt'
    ? baseQuery().orderBy(orderBy).limit(pageSize).offset(offset).all()
    : baseQuery().orderBy(asc(sql`pinned_at IS NULL`), desc(books.pinnedAt), orderBy).limit(pageSize).offset(offset).all()
  const total = db.select({ count: sql<number>`count(*)` }).from(books).where(where).get()
  return { data: items, page, pageSize, total: total?.count ?? 0 }
}

// Book rows returned to clients must not carry meta.chapters (huge payload);
// chapters are served by the dedicated GET /:id/chapters endpoint.
export function stripMetaChapters<T extends { meta: Record<string, unknown> }>(book: T): T {
  const meta = { ...book.meta }
  delete meta.chapters
  return { ...book, meta }
}

function detectImageExtension(buffer: Buffer): string | null {
  if (buffer.length < 4) return null
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return null
}

function blobKey(hash: string, ext: string): string {
  return `blobs/${hash.slice(0, 2)}/${hash}${ext}`
}

export async function bufferFromStream(stream: Readable): Promise<Buffer> {
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
  const db = getDb()

  // Content-based dedup. New rows store the FULL sha256 (64 hex) of the
  // original upload as contentHash; legacy rows hold the sampled partialMD5
  // (32 hex) — the query matches either. A sampled-hash hit is only a
  // fingerprint, so duplicates are adjudicated by full hash:
  // - new-style rows: string compare against the stored full hash (the stored
  //   blob may be a converted artifact for txt books, so no blob read)
  // - legacy epub rows: the blob IS the original — read and sha256-compare
  // - legacy txt rows: the blob is the converted EPUB, incomparable to the
  //   upload — the theoretical sampled-hash collision risk stays (B3 note)
  const contentHash = sha256(buffer)
  const partial = partialMD5(buffer)
  const existing = db.select({ id: books.id, filePath: books.filePath, format: books.format, contentHash: books.contentHash }).from(books).where(
    and(eq(books.userId, userId), inArray(books.contentHash, [contentHash, partial]), isNull(books.deletedAt)),
  ).get()
  if (existing) {
    let isDuplicate: boolean
    if (existing.contentHash?.length === 64) {
      isDuplicate = existing.contentHash === contentHash
    } else if (existing.format === 'epub') {
      const existingBuffer = await bufferFromStream(await getStorage().get(existing.filePath))
      isDuplicate = sha256(existingBuffer) === contentHash
    } else {
      isDuplicate = true
    }
    if (isDuplicate) {
      return { book: stripMetaChapters(db.select().from(books).where(eq(books.id, existing.id)).get()!), duplicated: true }
    }
  }

  const title = parsed.meta.title || fileName.replace(/\.[^.]+$/, '')
  const author = parsed.meta.author ?? ''

  let coverKey: string | null = null
  if (parsed.meta.cover) {
    const ext = detectImageExtension(parsed.meta.cover) || 'jpg'
    coverKey = blobKey(contentHash, `.cover.${ext}`)
    await storage.put(coverKey, parsed.meta.cover)
  }

  const meta: Record<string, unknown> = {}
  // Always persist bookmeta (empty object for formats that don't produce one,
  // e.g. txt): leaving it undefined makes every getBook/getActiveBook call
  // re-parse the whole stored file on first open (backfillBookmeta), and the
  // reader fires 3-4 such requests concurrently -> first open hangs.
  meta.bookmeta = parsed.meta.bookmeta ?? {}
  let fileKey: string
  let size = buffer.length

  if (format === 'txt') {
    const text = decodeTextBuffer(buffer)
    const normalized = normalizeText(text)
    const chapters = scanTxtChapters(normalized)
    meta.chapters = chapters.map((c) => ({
      id: `ch-${c.startOffset}`,
      title: c.title,
      level: c.level,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      contentStartOffset: c.contentStartOffset,
      wordCount: countWords(normalized.slice(c.contentStartOffset ?? c.startOffset, c.endOffset)),
    }))

    // Generate EPUB eagerly and save as the only file. Chapter content is
    // sliced on demand (B5): holding every chapter's slice at once roughly
    // doubles peak memory for large books — the getter keeps only metadata
    // plus the single normalized string.
    const epubChapters = chapters.map((c) => ({
      id: `ch-${c.startOffset}`,
      title: c.title,
      level: c.level,
    }))
    const contentFor = (index: number) => {
      const c = chapters[index]
      return normalized.slice(c.contentStartOffset ?? c.startOffset, c.endOffset)
    }
    const epubBuffer = await convertTxtToEpub(
      { title, author: author || undefined, id: bookId },
      epubChapters,
      contentFor,
    )
    fileKey = blobKey(contentHash, '.epub')
    await storage.put(fileKey, epubBuffer)
    size = epubBuffer.length
  } else {
    fileKey = blobKey(contentHash, '.epub')
    await storage.put(fileKey, buffer)
    if (parsed.chapters.length > 0) {
      meta.chapters = parsed.chapters.map((c, idx) => ({
        id: `ch-${idx}`,
        title: c.title,
        level: 1,
        startOffset: 0,
        endOffset: 0,
        wordCount: c.wordCount ?? 0,
      }))
    }
  }

  const metaChapters = meta.chapters as Array<{ wordCount?: number }> | undefined
  if (metaChapters && metaChapters.length > 0) {
    meta.wordCount = metaChapters.reduce((sum, c) => sum + (c.wordCount ?? 0), 0)
  }

  const now = Date.now()
  const book = {
    id: bookId,
    userId,
    title,
    author,
    format: format as BookFormat,
    filePath: fileKey,
    coverKey,
    contentHash,
    size,
    meta,
    readStatus: 'reading' as const,
    createdAt: now,
    updatedAt: now,
  }
  db.insert(books).values(book).run()
  return { book: stripMetaChapters(book), duplicated: false }
}

export async function getBook(userId: string, bookId: string) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  if ((book.meta as Record<string, unknown>).bookmeta === undefined) {
    return (await backfillBookmeta(book)) ?? book
  }
  return book
}

// One full-file re-parse per book at a time: the reader fires /books/:id,
// /file and /chapters concurrently on first open, and each getBook call would
// otherwise start its own parse of the whole stored file, blocking the event
// loop. The first resolver writes bookmeta; waiters re-read the row.
const bookmetaBackfills = new Map<string, Promise<unknown>>()

async function backfillBookmeta(book: typeof books.$inferSelect) {
  const inFlight = bookmetaBackfills.get(book.id)
  if (inFlight) {
    await inFlight
    return getDb().select().from(books).where(eq(books.id, book.id)).get()
  }
  const promise = (async () => {
    try {
      const storage = getStorage()
      const parser = getParser(book.filePath, '')
      if (!parser) return null
      const parsed = await parser.parse(await storage.get(book.filePath))
      const meta = { ...(book.meta as Record<string, unknown>), bookmeta: parsed.meta.bookmeta ?? {} }
      getDb().update(books).set({ meta }).where(eq(books.id, book.id)).run()
      return getDb().select().from(books).where(eq(books.id, book.id)).get()
    } catch {
      return null
    } finally {
      bookmetaBackfills.delete(book.id)
    }
  })()
  bookmetaBackfills.set(book.id, promise)
  return promise
}

export async function getActiveBook(userId: string, bookId: string) {
  const book = await getBook(userId, bookId)
  if (book.deletedAt) throw new AppError('BOOK_NOT_FOUND')
  return book
}

export async function getBookChapters(userId: string, bookId: string) {
  const book = await getBook(userId, bookId)
  let chapters = (book.meta?.chapters ?? []) as Chapter[]

  // Migrate old txt books that lack normalized chapter metadata.
  if (book.format === 'txt' && chapters.length > 0 && chapters[0]?.contentStartOffset === undefined) {
    await regenerateTxtBookContent(userId, bookId)
    const updatedBook = await getBook(userId, bookId)
    chapters = (updatedBook.meta?.chapters ?? []) as Chapter[]
  }

  // Backfill word counts for books uploaded before the feature existed.
  if (chapters.length > 0 && chapters[0]?.wordCount === undefined) {
    chapters = (await backfillWordCounts(userId, bookId)) ?? chapters
  }

  return chapters
}

async function backfillWordCounts(userId: string, bookId: string): Promise<Chapter[] | null> {
  try {
    const book = await getBook(userId, bookId)
    const storage = getStorage()
    const buffer = await bufferFromStream(await storage.get(book.filePath))
    let chapters: Chapter[]
    if (book.filePath.endsWith('.txt')) {
      const normalized = normalizeText(decodeTextBuffer(buffer))
      chapters = scanTxtChapters(normalized).map((c) => ({
        id: `ch-${c.startOffset}`,
        title: c.title,
        level: c.level,
        startOffset: c.startOffset,
        endOffset: c.endOffset,
        contentStartOffset: c.contentStartOffset,
        wordCount: countWords(normalized.slice(c.contentStartOffset ?? c.startOffset, c.endOffset)),
      }))
    } else {
      const parser = getParser(book.filePath, '')
      if (!parser) return null
      const parsed = await parser.parse(buffer)
      // meta.chapters were built from the same parser output, in the same order
      const existing = (book.meta?.chapters ?? []) as Chapter[]
      if (existing.length !== parsed.chapters.length) return null
      chapters = existing.map((c, idx) => ({ ...c, wordCount: parsed.chapters[idx].wordCount ?? 0 }))
    }
    const wordCount = chapters.reduce((sum, c) => sum + (c.wordCount ?? 0), 0)
    const meta = { ...(book.meta as Record<string, unknown>), chapters, wordCount }
    getDb().update(books).set({ meta }).where(eq(books.id, bookId)).run()
    return chapters
  } catch {
    // Missing/corrupt file: serve chapters without counts, retry next time.
    return null
  }
}

async function regenerateTxtBookContent(userId: string, bookId: string): Promise<string> {
  const storage = getStorage()
  const book = await getBook(userId, bookId)

  // Legacy: parse from original TXT file (pre-refactor books)
  const stream = await storage.get(book.filePath)
  const buffer = await bufferFromStream(stream)
  const text = decodeTextBuffer(buffer)
  const normalized = normalizeText(text)
  const chapters = scanTxtChapters(normalized)

  const db = getDb()
  const metaChapters = chapters.map((c) => ({
    id: `ch-${c.startOffset}`,
    title: c.title,
    level: c.level,
    startOffset: c.startOffset,
    endOffset: c.endOffset,
    contentStartOffset: c.contentStartOffset,
    wordCount: countWords(normalized.slice(c.contentStartOffset ?? c.startOffset, c.endOffset)),
  }))
  const wordCount = metaChapters.reduce((sum, c) => sum + c.wordCount, 0)
  const meta = { ...book.meta, chapters: metaChapters, wordCount }
  db.update(books).set({ meta, updatedAt: Date.now() }).where(eq(books.id, bookId)).run()

  return normalized
}

export async function getBookContent(userId: string, bookId: string): Promise<string> {
  const storage = getStorage()
  const book = await getBook(userId, bookId)
  if (book.format !== 'txt') {
    throw new AppError('UNSUPPORTED_FORMAT', 'Content endpoint only supports txt')
  }
  // Legacy path (pre-refactor content.txt)
  const legacyKey = `books/${bookId}/content.txt`
  if (await storage.exists(legacyKey)) {
    const stream = await storage.get(legacyKey)
    return (await bufferFromStream(stream)).toString('utf-8')
  }
  return regenerateTxtBookContent(userId, bookId)
}

export async function getBookEpubBuffer(userId: string, bookId: string): Promise<Buffer> {
  const storage = getStorage()
  const book = await getBook(userId, bookId)

  // New-style path: filePath points to an EPUB (hash-based or books/<id>/book.epub)
  if (book.filePath.endsWith('.epub') && await storage.exists(book.filePath)) {
    return bufferFromStream(await storage.get(book.filePath))
  }

  if (book.format === 'txt') {
    // Legacy: check old generated.epub cache
    const cacheKey = `books/${bookId}/generated.epub`
    if (await storage.exists(cacheKey)) {
      return bufferFromStream(await storage.get(cacheKey))
    }

    // Legacy: lazy-generate from normalized text
    const [content, chapters] = await Promise.all([
      getBookContent(userId, bookId),
      getBookChapters(userId, bookId),
    ])
    const epubChapters = chapters.map((c) => ({
      id: c.id,
      title: c.title,
      level: c.level,
    }))
    const contentFor = (i: number) => {
      const c = chapters[i]
      return content.slice(c.contentStartOffset ?? c.startOffset, c.endOffset)
    }
    const buffer = await convertTxtToEpub(
      { title: book.title, author: book.author || undefined, id: book.id },
      epubChapters,
      contentFor,
    )
    await storage.put(cacheKey, buffer)
    return buffer
  }

  throw new AppError('UNSUPPORTED_FORMAT', 'EPUB export only supports txt and epub')
}

export async function updateBook(userId: string, bookId: string, data: { readStatus?: string; progress?: number; pinned?: boolean; title?: string; author?: string; bookmeta?: BookMetadata; viewSettings?: ViewSettings | null }) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  const set: Record<string, unknown> = { updatedAt: Date.now() }
  if (data.readStatus) set.readStatus = data.readStatus
  if (data.progress !== undefined) set.progress = data.progress
  if (data.pinned !== undefined) set.pinnedAt = data.pinned ? Date.now() : null
  if (data.title) set.title = data.title
  if (data.author !== undefined) set.author = data.author
  if (data.bookmeta !== undefined) {
    set.meta = { ...(book.meta as Record<string, unknown>), bookmeta: data.bookmeta }
  }
  if (data.viewSettings !== undefined) {
    // Diff semantics: shallow-merge into the existing per-book overrides;
    // null removes the whole override so the book falls back to global.
    const meta = { ...(book.meta as Record<string, unknown>) }
    if (data.viewSettings === null) {
      delete meta.viewSettings
    } else {
      meta.viewSettings = { ...((meta.viewSettings as ViewSettings | undefined) ?? {}), ...data.viewSettings }
    }
    set.meta = meta
  }
  db.update(books).set(set).where(eq(books.id, bookId)).run()
  return stripMetaChapters(db.select().from(books).where(eq(books.id, bookId)).get()!)
}

export async function updateBookCover(userId: string, bookId: string, file: File) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > 5 * 1024 * 1024) throw new AppError('UPLOAD_TOO_LARGE')
  const ext = detectImageExtension(buffer)
  if (!ext) throw new AppError('UNSUPPORTED_FORMAT', 'Cover must be a PNG, JPEG or WebP image')
  const storage = getStorage()
  const coverKey = blobKey(partialMD5(buffer), `.cover.${ext}`)
  await storage.put(coverKey, buffer)
  db.update(books).set({ coverKey, updatedAt: Date.now() }).where(eq(books.id, bookId)).run()
  return stripMetaChapters(db.select().from(books).where(eq(books.id, bookId)).get()!)
}

export async function removeBookCover(userId: string, bookId: string) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  db.update(books).set({ coverKey: null, updatedAt: Date.now() }).where(eq(books.id, bookId)).run()
  return stripMetaChapters(db.select().from(books).where(eq(books.id, bookId)).get()!)
}

export async function resetBookMetadata(userId: string, bookId: string) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  const storage = getStorage()
  const parser = getParser(book.filePath, '')
  if (!parser) throw new AppError('UNSUPPORTED_FORMAT')
  const parsed = await parser.parse(await storage.get(book.filePath))
  const meta = { ...(book.meta as Record<string, unknown>), bookmeta: parsed.meta.bookmeta ?? {} }
  db.update(books).set({
    title: parsed.meta.title || book.title,
    author: parsed.meta.author ?? '',
    meta,
    updatedAt: Date.now(),
  }).where(eq(books.id, bookId)).run()
  return stripMetaChapters(db.select().from(books).where(eq(books.id, bookId)).get()!)
}

export async function trashBook(userId: string, bookId: string) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  db.update(books).set({ deletedAt: Date.now(), updatedAt: Date.now() }).where(eq(books.id, bookId)).run()
}

export async function restoreBook(userId: string, bookId: string) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  db.update(books).set({ deletedAt: null, updatedAt: Date.now() }).where(eq(books.id, bookId)).run()
}

export async function emptyTrash(userId: string) {
  const db = getDb()
  const trashed = db.select({ id: books.id }).from(books).where(and(eq(books.userId, userId), isNotNull(books.deletedAt))).all()
  for (const row of trashed) {
    await deleteBook(userId, row.id)
  }
  return trashed.length
}

/** Purge trash rows whose deletedAt is older than `days`; 0 or negative disables auto-clean */
export async function purgeExpiredTrash(userId: string, days: number) {
  if (days <= 0) return 0
  const db = getDb()
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const expired = db.select({ id: books.id }).from(books)
    .where(and(eq(books.userId, userId), isNotNull(books.deletedAt), lt(books.deletedAt, cutoff)))
    .all()
  for (const row of expired) {
    await deleteBook(userId, row.id)
  }
  return expired.length
}

/** Boot-time sweep of every user's expired trash (B6): one settings read, one
 * expired query per distinct retention cutoff, rows processed in chunks with
 * event-loop yields so synchronous SQLite churn never stalls a busy server. */
export async function purgeAllExpiredTrash() {
  const db = getDb()
  const allUsers = db.select({ id: usersTable.id }).from(usersTable).all()
  if (allUsers.length === 0) return
  const settingsRows = db.select({ userId: settings.userId, value: settings.value })
    .from(settings).where(eq(settings.key, 'trash')).all()
  const daysByUser = new Map(settingsRows.map((r) => [r.userId, (r.value as TrashSettings | undefined)?.autoCleanDays ?? 30]))

  const now = Date.now()
  const groups = new Map<number, string[]>()
  for (const { id } of allUsers) {
    const days = daysByUser.get(id) ?? 30
    if (days <= 0) continue
    const cutoff = now - days * 24 * 60 * 60 * 1000
    const list = groups.get(cutoff) ?? []
    list.push(id)
    groups.set(cutoff, list)
  }
  for (const [cutoff, userIds] of groups) {
    const expired = db.select({ id: books.id, userId: books.userId }).from(books)
      .where(and(inArray(books.userId, userIds), isNotNull(books.deletedAt), lt(books.deletedAt, cutoff)))
      .all()
    for (let i = 0; i < expired.length; i++) {
      await deleteBook(expired[i].userId, expired[i].id)
      if (i % 10 === 9) await new Promise((resolve) => setImmediate(resolve))
    }
  }
}

export async function deleteBook(userId: string, bookId: string) {
  const db = getDb()
  const storage = getStorage()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')

  db.delete(annotations).where(eq(annotations.bookId, bookId)).run()
  db.delete(bookTags).where(eq(bookTags.bookId, bookId)).run()
  db.delete(bookShelves).where(eq(bookShelves.bookId, bookId)).run()

  // Blobs are content-hash addressed and shared across users' book rows;
  // delete the physical file only when no other row (including trashed) references it.
  const fileRefs = db.select({ count: sql<number>`count(*)` }).from(books)
    .where(and(eq(books.filePath, book.filePath), ne(books.id, bookId))).get()
  if ((fileRefs?.count ?? 0) === 0 && await storage.exists(book.filePath)) {
    await storage.delete(book.filePath)
  }
  // Progress file
  const progressKey = `progress/${bookId}.json`
  if (await storage.exists(progressKey)) {
    await storage.delete(progressKey)
  }
  // Legacy content.txt (pre-refactor TXT books)
  const oldContentKey = `books/${bookId}/content.txt`
  if (await storage.exists(oldContentKey)) {
    await storage.delete(oldContentKey)
  }
  // Legacy generated.epub (pre-refactor TXT lazy cache)
  const oldEpubKey = `books/${bookId}/generated.epub`
  if (await storage.exists(oldEpubKey)) {
    await storage.delete(oldEpubKey)
  }
  if (book.coverKey) {
    const coverRefs = db.select({ count: sql<number>`count(*)` }).from(books)
      .where(and(eq(books.coverKey, book.coverKey), ne(books.id, bookId))).get()
    if ((coverRefs?.count ?? 0) === 0 && await storage.exists(book.coverKey)) {
      await storage.delete(book.coverKey)
    }
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
