import type { Readable } from 'node:stream'

import { eq, ne, lt, desc, asc, and, sql, inArray, isNull, isNotNull } from 'drizzle-orm'
import JSZip from 'jszip'
import { getDb } from '../../db/client'
import { books, annotations, bookTags, shelves, tags, settings, users as usersTable, tocRules } from '../../db/schema'
import { getStorage } from '../../storage'
import { getParser } from '../../formats/registry'
import { extractEpubChapterText } from '../../formats/epub'
import { scanTxtChapters, normalizeText, decodeTextBuffer } from '../../formats/txt'
import { pickTocRule, TOC_SAMPLE_SIZE } from '../../formats/toc'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import { convertTxtToEpub } from '../../lib/txt-to-epub'
import { sha256 } from '../../lib/hash'
import { countWords } from '../../lib/word-count'
import type { BookFormat, BookMetadata, Chapter, TocRulePattern, TrashSettings, ViewSettings } from '@bookdock/shared'

/**
 * The effective TOC preset for a book: the pinned rule id in books.meta
 * (user-chosen or auto-scored) when it still exists, otherwise nothing.
 * Returns `{ patterns, tocRuleId, tocRuleAuto }`; `patterns` is null when no
 * preset applies (the built-in patterns take over) and `tocRuleId` is
 * null then too.
 */
export async function resolveEffectiveTocRule(
  userId: string,
  book: { meta: Record<string, unknown> },
): Promise<{ patterns: TocRulePattern[] | null; tocRuleId: string | null; tocRuleAuto: boolean }> {
  const meta = book.meta
  const pinnedId = typeof meta.tocRuleId === 'string' ? meta.tocRuleId : null
  if (!pinnedId) return { patterns: null, tocRuleId: null, tocRuleAuto: false }
  const db = getDb()
  const rule = db.select().from(tocRules).where(and(eq(tocRules.id, pinnedId), eq(tocRules.userId, userId))).get()
  if (!rule) return { patterns: null, tocRuleId: null, tocRuleAuto: false }
  return {
    patterns: rule.patterns.filter((p) => p.enabled !== false),
    tocRuleId: pinnedId,
    tocRuleAuto: meta.tocRuleAuto === true,
  }
}

/** Auto-score the user's enabled presets against a normalized sample.
 * Returns the winning preset row (with its patterns), or null when none clears the bar. */
export function scoreTocRules(userId: string, sample: string): typeof tocRules.$inferSelect | null {
  const db = getDb()
  const rules = db.select().from(tocRules)
    .where(and(eq(tocRules.userId, userId), eq(tocRules.enabled, 1)))
    .orderBy(tocRules.sortOrder, tocRules.createdAt)
    .all()
  const pickedId = pickTocRule(
    rules.map((r) => ({ id: r.id, patterns: r.patterns })),
    sample,
  )
  return pickedId ? rules.find((r) => r.id === pickedId) ?? null : null
}

export async function listBooks(userId: string, page: number, pageSize: number, search?: string, sortBy?: string, sortOrder?: string, shelfId?: string, tagId?: string, format?: BookFormat, readStatus?: string, trash?: boolean, author?: string, series?: string) {
  const db = getDb()
  const conditions = [eq(books.userId, userId), trash ? isNotNull(books.deletedAt) : isNull(books.deletedAt)]
  if (search) {
    // Escape LIKE wildcards so user input is matched literally. The escape
    // char is '!' (backslash would be mangled by drizzle's sql template) and
    // must itself be escaped first.
    const escaped = search.replace(/[!%_]/g, (m) => '!' + m)
    const pattern = '%' + escaped + '%'
    conditions.push(sql`(${books.title} LIKE ${pattern} ESCAPE '!' OR ${books.author} LIKE ${pattern} ESCAPE '!')`)
  }
  if (format) {
    conditions.push(eq(books.format, format))
  }
  if (readStatus) {
    conditions.push(eq(books.readStatus, readStatus as typeof books.$inferSelect.readStatus))
  }
  // 'none' sentinel filters uncategorized books (shelfId IS NULL)
  if (shelfId === 'none') {
    conditions.push(isNull(books.shelfId))
  } else if (shelfId) {
    conditions.push(eq(books.shelfId, shelfId))
  }
  if (tagId) {
    const sub = db.select({ bookId: bookTags.bookId }).from(bookTags).where(eq(bookTags.tagId, tagId))
    conditions.push(sql`${books.id} IN ${sub}`)
  }
  if (author) {
    conditions.push(eq(books.author, author))
  }
  if (series) {
    conditions.push(sql`json_extract(${books.meta}, '$.bookmeta.series') = ${series}`)
  }
  // Pin-first is universal (user decision 2026-08-12): pinned books lead in
  // every sort 鈥?including lastReadAt 鈥?and the pinned group itself follows
  // the chosen sort, not the pin time (reads first by last-read time, desc
  // puts NULL lastReadAt at the bottom, never-read books stay visible).
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
    shelfId: books.shelfId,
    shelfName: shelves.name,
  }).from(books).leftJoin(shelves, eq(books.shelfId, shelves.id)).where(where)
  const items = baseQuery()
    .orderBy(asc(sql`pinned_at IS NULL`), orderBy)
    .limit(pageSize).offset(offset).all()
  const total = db.select({ count: sql<number>`count(*)` }).from(books).where(where).get()
  // Tag names are fetched per page in a second query: joining book_tags into
  // the paginated query would multiply rows per book and break LIMIT/OFFSET.
  const tagRows = items.length > 0
    ? db.select({ bookId: bookTags.bookId, name: tags.name })
      .from(bookTags)
      .innerJoin(tags, eq(bookTags.tagId, tags.id))
      .where(inArray(bookTags.bookId, items.map((b) => b.id)))
      .all()
    : []
  const tagsByBook = new Map<string, string[]>()
  for (const row of tagRows) {
    const list = tagsByBook.get(row.bookId) ?? []
    list.push(row.name)
    tagsByBook.set(row.bookId, list)
  }
  const data = items.map((b) => ({ ...b, tags: tagsByBook.get(b.id) ?? [] }))
  return { data, page, pageSize, total: total?.count ?? 0 }
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

export async function uploadBook(userId: string, file: File, membership?: { shelfId?: string | null; tagIds?: string[] }) {
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
  const tagIds = [...new Set(membership?.tagIds ?? [])]
  if (membership?.shelfId) {
    const shelf = db.select({ id: shelves.id }).from(shelves).where(and(eq(shelves.id, membership.shelfId), eq(shelves.userId, userId))).get()
    if (!shelf) throw new AppError('SHELF_NOT_FOUND')
  }
  if (tagIds.length > 0) {
    const existingTags = db.select({ count: sql<number>`count(*)` }).from(tags)
      .where(and(eq(tags.userId, userId), inArray(tags.id, tagIds))).get()
    if ((existingTags?.count ?? 0) !== tagIds.length) throw new AppError('TAG_NOT_FOUND')
  }

  const contentHash = sha256(buffer)
  const existing = db.select({ id: books.id }).from(books).where(
    and(eq(books.userId, userId), eq(books.contentHash, contentHash), isNull(books.deletedAt)),
  ).get()
  if (existing) {
    return { book: stripMetaChapters(db.select().from(books).where(eq(books.id, existing.id)).get()!), duplicated: true }
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
  // Persist bookmeta for every upload so book reads never need a metadata pass.
  meta.bookmeta = parsed.meta.bookmeta ?? {}
  let fileKey: string
  let size = buffer.length

  if (format === 'txt') {
    const text = decodeTextBuffer(buffer)
    const normalized = normalizeText(text)
    const sample = normalized.slice(0, TOC_SAMPLE_SIZE)
    const scored = scoreTocRules(userId, sample)
    const effectivePatterns = scored ? scored.patterns.filter((p) => p.enabled !== false) : undefined
    const chapters = scanTxtChapters(normalized, effectivePatterns)
    meta.chapters = chapters.map((c) => ({
      id: `ch-${c.startOffset}`,
      title: c.title,
      level: c.level,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      contentStartOffset: c.contentStartOffset,
      wordCount: countWords(normalized.slice(c.contentStartOffset ?? c.startOffset, c.endOffset)),
    }))
    // Record the auto-scored preset (or the fallback) so re-toc keeps the same
    // split: pinned presets record tocRuleAuto=false, scoring results true.
    if (scored) {
      meta.tocRuleId = scored.id
      meta.tocRuleAuto = true
    }

    // Generate EPUB eagerly and save as the only file. Chapter content is
    // sliced on demand (B5): holding every chapter's slice at once roughly
    // doubles peak memory for large books 鈥?the getter keeps only metadata
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
    shelfId: membership?.shelfId ?? null,
    readStatus: 'reading' as const,
    createdAt: now,
    updatedAt: now,
  }
  db.transaction((tx) => {
    tx.insert(books).values(book).run()
    if (tagIds.length > 0) {
      tx.insert(bookTags).values(tagIds.map((tagId) => ({ bookId, tagId }))).run()
    }
  })
  return { book: stripMetaChapters(book), duplicated: false }
}

export async function getBook(userId: string, bookId: string) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  return book
}

export async function getActiveBook(userId: string, bookId: string) {
  const book = await getBook(userId, bookId)
  if (book.deletedAt) throw new AppError('BOOK_NOT_FOUND')
  return book
}

export async function getBookChapters(userId: string, bookId: string) {
  const book = await getBook(userId, bookId)
  return (book.meta?.chapters ?? []) as Chapter[]
}

/**
 * Rebuild a TXT book's chapters and stored EPUB from the effective TOC preset.
 * The normalized text is recovered from the server-generated EPUB, then the
 * stored artifact is replaced so the reader serves the new split immediately.
 */
async function rebuildTocBook(
  userId: string,
  bookId: string,
  patterns: TocRulePattern[] | null,
  tocRuleId: string | null,
  tocRuleAuto: boolean,
): Promise<string> {
  const storage = getStorage()
  const book = await getBook(userId, bookId)
  if (book.format !== 'txt') throw new AppError('UNSUPPORTED_FORMAT', 'Re-TOC only supports txt books')

  const normalized = await recoverTxtNormalized(book)
  const chapters = scanTxtChapters(normalized, patterns ?? undefined)

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
  const meta: Record<string, unknown> = { ...book.meta, chapters: metaChapters, wordCount }
  const oldChapters = (book.meta as { chapters?: { id?: string }[] } | undefined)?.chapters
  // CFIs address the EPUB by chapter-file index, so only the chapter
  // boundaries (ids = start offsets) decide whether the saved position is
  // stale — title-only drift keeps every file structurally identical.
  const chaptersChanged =
    !oldChapters ||
    oldChapters.length !== metaChapters.length ||
    oldChapters.some((c, i) => c.id !== metaChapters[i]?.id)
  if (tocRuleId) {
    meta.tocRuleId = tocRuleId
    meta.tocRuleAuto = tocRuleAuto
  } else {
    delete meta.tocRuleId
    delete meta.tocRuleAuto
  }

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
    { title: book.title, author: book.author || undefined, id: book.id },
    epubChapters,
    contentFor,
  )
  await storage.put(book.filePath, epubBuffer)

  // A re-split re-indexes the EPUB's chapter files, so the saved progress CFI
  // is stale; keep the book-level percent so the reader can restore by
  // fraction. No-op when the split is unchanged (identical chapters).
  if (chaptersChanged) {
    const progressKey = `progress/${bookId}.json`
    if (await storage.exists(progressKey)) {
      const stream = await storage.get(progressKey)
      const chunks: Buffer[] = []
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const progress = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { cfi?: string | null; chapter?: string | null } | null
      if (progress) {
        progress.cfi = null
        progress.chapter = null
        await storage.put(progressKey, Buffer.from(JSON.stringify(progress), 'utf-8'))
      }
    }
  }

  db.update(books).set({ meta, updatedAt: Date.now() }).where(eq(books.id, bookId)).run()
  return normalized
}

/**
 * Recover the normalized text of a TXT book from its server-generated EPUB.
 */
export async function recoverTxtNormalized(book: { filePath: string }): Promise<string> {
  const storage = getStorage()
  const buffer = await bufferFromStream(await storage.get(book.filePath))

  const zip = await JSZip.loadAsync(buffer)
  const opfEntry = zip.file('OEBPS/content.opf')
  if (!opfEntry) throw new AppError('BOOK_FILE_MISSING', 'Book file is missing its package document')
  const opf = await opfEntry.async('string')
  const manifest = new Map<string, string>()
  for (const m of opf.matchAll(/<item\s+id="([^"]+)"\s+href="([^"]+)"[^>]*>/g)) {
    manifest.set(m[1]!, m[2]!)
  }
  const hrefs: string[] = []
  for (const m of opf.matchAll(/<itemref\s+idref="([^"]+)"[^>]*\/?>/g)) {
    const href = manifest.get(m[1]!)
    if (href) hrefs.push(href)
  }

  const parts: string[] = []
  for (const href of hrefs) {
    const entry = zip.file(`OEBPS/${href}`)
    if (!entry) continue
    const xhtml = await entry.async('string')
    const { title, paragraphs } = extractChapterRuns(xhtml)
    // Rebuild the normalized paragraph layout the server originally wrote
    parts.push(`${title}\n\n${paragraphs.join('\n\n')}`)
  }
  return parts.join('\n\n')
}

/** Extract the chapter's h1 title + <p> paragraphs from server-generated XHTML. */
function extractChapterRuns(xhtml: string): { title: string; paragraphs: string[] } {
  const titles: string[] = []
  const paragraphs: string[] = []
  const re = /<(h1|p)>([^<]*)<\/\1>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xhtml))) {
    const text = unescapeXml(m[2]!)
    if (m[1] === 'h1') titles.push(text)
    else paragraphs.push(text)
  }
  return { title: titles.join(''), paragraphs }
}

function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (m, name: string) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name] ?? m)
}

/**
 * Re-TOC a TXT book (POST /books/:id/re-toc). With an explicit `tocRuleId` the
 * rule is pinned (tocRuleAuto=false) and used; with `null` the pin is cleared
 * and auto-scoring decides; with undefined the current effective rule wins.
 * Rebuilds meta.chapters + the stored EPUB, then returns the normalized text.
 */
export async function reTocBook(
  userId: string,
  bookId: string,
  tocRuleId?: string | null,
): Promise<string> {
  const db = getDb()
  const book = await getBook(userId, bookId)
  if (book.format !== 'txt') throw new AppError('UNSUPPORTED_FORMAT', 'Re-TOC only supports txt books')

  if (tocRuleId !== undefined) {
    // Explicit pin or clear: tocRuleId is validated against the user's rules
    if (tocRuleId !== null) {
      const rule = db.select().from(tocRules).where(and(eq(tocRules.id, tocRuleId), eq(tocRules.userId, userId))).get()
      if (!rule) throw new AppError('TOC_RULE_NOT_FOUND')
      return rebuildTocBook(userId, bookId, rule.patterns.filter((p) => p.enabled !== false), rule.id, false)
    }
    // Clear the pin: auto-score decides from scratch (rebuildTocBook with
    // tocRuleId null removes the recorded pin).
    const normalized = await recoverTxtNormalized(book)
    const scored = scoreTocRules(userId, normalized.slice(0, TOC_SAMPLE_SIZE))
    if (scored) {
      return rebuildTocBook(userId, bookId, scored.patterns.filter((p) => p.enabled !== false), scored.id, true)
    }
    return rebuildTocBook(userId, bookId, null, null, false)
  }

  // No explicit instruction: keep the current pin (auto-scored or user-chosen)
  const effective = await resolveEffectiveTocRule(userId, book)
  if (effective.tocRuleId) {
    return rebuildTocBook(userId, bookId, effective.patterns, effective.tocRuleId, effective.tocRuleAuto)
  }

  // No pin (or it dangles): auto-score now
  const normalized = await recoverTxtNormalized(book)
  const scored = scoreTocRules(userId, normalized.slice(0, TOC_SAMPLE_SIZE))
  if (scored) {
    return rebuildTocBook(userId, bookId, scored.patterns.filter((p) => p.enabled !== false), scored.id, true)
  }
  return rebuildTocBook(userId, bookId, null, null, false)
}

export async function getBookContent(userId: string, bookId: string): Promise<string> {
  const book = await getBook(userId, bookId)
  if (book.format !== 'txt') {
    throw new AppError('UNSUPPORTED_FORMAT', 'Content endpoint only supports txt')
  }
  return recoverTxtNormalized(book)
}

export async function getBookChapterContent(userId: string, bookId: string, chapterIndex: number) {
  const book = await getActiveBook(userId, bookId)
  const chapters = await getBookChapters(userId, bookId)
  const chapter = chapters[chapterIndex]
  if (!chapter) throw new AppError('VALIDATION_ERROR', 'Chapter index is out of range')

  const content = book.format === 'txt'
    ? (await getBookContent(userId, bookId)).slice(chapter.contentStartOffset ?? chapter.startOffset, chapter.endOffset).trim()
    : await extractEpubChapterText(await getBookEpubBuffer(userId, bookId), chapterIndex)

  return {
    id: chapter.id,
    index: chapterIndex,
    title: chapter.title,
    level: chapter.level,
    wordCount: chapter.wordCount,
    content,
  }
}

export async function getBookEpubBuffer(userId: string, bookId: string): Promise<Buffer> {
  const storage = getStorage()
  const book = await getBook(userId, bookId)
  if (!(await storage.exists(book.filePath))) throw new AppError('BOOK_FILE_MISSING')
  return bufferFromStream(await storage.get(book.filePath))
}

export async function updateBook(userId: string, bookId: string, data: { readStatus?: string; progress?: number; pinned?: boolean; title?: string; author?: string; bookmeta?: BookMetadata; viewSettings?: ViewSettings | null; boundPresetId?: string | null; tocRuleId?: string | null }) {
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
  if (data.boundPresetId !== undefined) {
    // Binding semantics mirror viewSettings: null removes the key so the book
    // falls back to the device resolution chain.
    const meta = { ...(book.meta as Record<string, unknown>), ...(set.meta as Record<string, unknown> | undefined) }
    if (data.boundPresetId === null) {
      delete meta.boundPresetId
    } else {
      meta.boundPresetId = data.boundPresetId
    }
    set.meta = meta
  }
  if (data.tocRuleId !== undefined) {
    // Pin semantics: null removes the pin (book falls back to auto-scoring on
    // the next re-toc). A non-null id is validated against the user's rules.
    const meta = { ...(book.meta as Record<string, unknown>), ...(set.meta as Record<string, unknown> | undefined) }
    if (data.tocRuleId === null) {
      delete meta.tocRuleId
      delete meta.tocRuleAuto
    } else {
      const rule = db.select().from(tocRules).where(and(eq(tocRules.id, data.tocRuleId), eq(tocRules.userId, userId))).get()
      if (!rule) throw new AppError('TOC_RULE_NOT_FOUND')
      meta.tocRuleId = data.tocRuleId
      meta.tocRuleAuto = false
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
  const coverKey = blobKey(sha256(buffer), `.cover.${ext}`)
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

export async function setBookShelf(userId: string, bookId: string, shelfId: string | null) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  if (shelfId !== null) {
    const shelf = db.select({ id: shelves.id }).from(shelves).where(and(eq(shelves.id, shelfId), eq(shelves.userId, userId))).get()
    if (!shelf) throw new AppError('SHELF_NOT_FOUND')
  }
  db.update(books).set({ shelfId }).where(eq(books.id, bookId)).run()
}

export async function getBookShelf(userId: string, bookId: string) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  return book.shelfId
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
