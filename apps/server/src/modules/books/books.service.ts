import type { Readable } from 'node:stream'

import { eq, ne, lt, desc, asc, and, sql, inArray, isNull, isNotNull } from 'drizzle-orm'
import JSZip from 'jszip'
import { getDb } from '../../db/client'
import { books, annotations, bookTags, shelves, tags, settings, users as usersTable, tocRules } from '../../db/schema'
import { getStorage } from '../../storage'
import { getParser } from '../../formats/registry'
import { extractEpubChapterText } from '../../formats/epub'
import {
  applyTxtChapterExclusions,
  canExcludeTxtChapter,
  decodeTextBuffer,
  getTxtChapterContent,
  normalizeText,
  scanTxtChapters,
  txtChapterId,
} from '../../formats/txt'
import { pickTocRule, TOC_SAMPLE_SIZE } from '../../formats/toc'
import { AppError } from '../../middleware/error'
import { createId } from '../../lib/id'
import { convertTxtToEpub, TXT_EPUB_ARTIFACT_VERSION } from '../../lib/txt-to-epub'
import { sha256 } from '../../lib/hash'
import { normalizeBookTitle } from '../../lib/book-title'
import { countWords } from '../../lib/word-count'
import { readProgressFile } from '../../lib/progress-file'
import { log } from '../../lib/logger'
import type { AppendContentCandidate, AppendContentPreviewRes, BookFormat, BookMetadata, CoverPaletteId, Chapter, TocPreviewChapter, TocPreviewRes, TocRulePattern, TrashSettings, ViewSettings } from '@bookdock/shared'

/**
 * The effective TOC preset for a book: the pinned rule id in books.meta
 * (user-chosen or auto-scored) when it still exists, otherwise nothing.
 * Returns `{ patterns, tocRuleId, tocRuleAuto }`; `patterns` is null when no
 * preset applies (the built-in patterns take over) and `tocRuleId` is
 * null then too.
 */
interface CachedNormalizedText {
  normalized: string
  cachedAt: number
}
const normalizedTextCache = new Map<string, CachedNormalizedText>()
const NORMALIZED_CACHE_TTL_MS = 5 * 60 * 1000
const EPUB_TOC_LEVEL_VERSION = 1

function getCachedNormalized(key: string): string | null {
  const item = normalizedTextCache.get(key)
  if (!item) return null
  if (Date.now() - item.cachedAt > NORMALIZED_CACHE_TTL_MS) {
    normalizedTextCache.delete(key)
    return null
  }
  return item.normalized
}

function setCachedNormalized(key: string, normalized: string) {
  if (normalizedTextCache.size > 50) {
    const oldestKey = normalizedTextCache.keys().next().value
    if (oldestKey) normalizedTextCache.delete(oldestKey)
  }
  normalizedTextCache.set(key, { normalized, cachedAt: Date.now() })
}

function invalidateCachedNormalized(bookId: string) {
  for (const key of normalizedTextCache.keys()) {
    if (key.startsWith(bookId + ':')) normalizedTextCache.delete(key)
  }
}

/**
 * The effective TOC preset for a book: the pinned rule id in books.meta
 * (user-chosen or auto-scored) when it still exists, otherwise nothing.
 * Returns `{ patterns, tocRuleId, tocRuleAuto, ruleName }`; `patterns` is null when no
 * preset applies (the built-in patterns take over) and `tocRuleId` is
 * null then too.
 */
export async function resolveEffectiveTocRule(
  userId: string,
  book: { meta: Record<string, unknown> },
): Promise<{ patterns: TocRulePattern[] | null; tocRuleId: string | null; tocRuleAuto: boolean; ruleName?: string }> {
  const meta = book.meta
  if (Array.isArray(meta.customTocPatterns) && meta.customTocPatterns.length > 0) {
    return {
      patterns: (meta.customTocPatterns as TocRulePattern[]).filter((p) => p.enabled !== false),
      tocRuleId: 'custom',
      tocRuleAuto: false,
      ruleName: '本书专属规则',
    }
  }
  const pinnedId = typeof meta.tocRuleId === 'string' ? meta.tocRuleId : null
  if (!pinnedId) return { patterns: null, tocRuleId: null, tocRuleAuto: false }
  const db = getDb()
  const rule = db.select().from(tocRules).where(and(eq(tocRules.id, pinnedId), eq(tocRules.userId, userId))).get()
  if (!rule) return { patterns: null, tocRuleId: null, tocRuleAuto: false }
  return {
    patterns: rule.patterns.filter((p) => p.enabled !== false),
    tocRuleId: pinnedId,
    tocRuleAuto: meta.tocRuleAuto === true,
    ruleName: rule.name,
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
    const shelfMatch = sql`EXISTS (
      SELECT 1 FROM shelves AS search_shelf
      WHERE search_shelf.id = ${books.shelfId}
        AND search_shelf.user_id = ${userId}
        AND search_shelf.name LIKE ${pattern} ESCAPE '!'
    )`
    const tagMatch = sql`EXISTS (
      SELECT 1
      FROM book_tags AS search_book_tag
      INNER JOIN tags AS search_tag ON search_tag.id = search_book_tag.tag_id
      WHERE search_book_tag.book_id = ${books.id}
        AND search_tag.user_id = ${userId}
        AND search_tag.name LIKE ${pattern} ESCAPE '!'
    )`
    conditions.push(sql`(
      ${books.title} LIKE ${pattern} ESCAPE '!'
      OR ${books.author} LIKE ${pattern} ESCAPE '!'
      OR ${books.format} LIKE ${pattern} ESCAPE '!'
      OR json_extract(${books.meta}, '$.bookmeta.description') LIKE ${pattern} ESCAPE '!'
      OR json_extract(${books.meta}, '$.bookmeta.series') LIKE ${pattern} ESCAPE '!'
      OR json_extract(${books.meta}, '$.bookmeta.subjects') LIKE ${pattern} ESCAPE '!'
      OR json_extract(${books.meta}, '$.bookmeta.publisher') LIKE ${pattern} ESCAPE '!'
      OR json_extract(${books.meta}, '$.bookmeta.isbn') LIKE ${pattern} ESCAPE '!'
      OR json_extract(${books.meta}, '$.bookmeta.identifier') LIKE ${pattern} ESCAPE '!'
      OR json_extract(${books.meta}, '$.bookmeta.source') LIKE ${pattern} ESCAPE '!'
      OR ${shelfMatch}
      OR ${tagMatch}
    )`)
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
    sortBy === 'createdAt' ? (sortOrder === 'asc' ? asc(books.createdAt) : desc(books.createdAt)) :
    sortBy === 'deletedAt' ? (sortOrder === 'asc' ? asc(books.deletedAt) : desc(books.deletedAt)) :
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
    // Extracted, not the whole meta column: list payloads must stay chapter-free.
    coverPaletteId: sql<CoverPaletteId | null>`json_extract(${books.meta}, '$.coverPaletteId')`,
  }).from(books).leftJoin(shelves, eq(books.shelfId, shelves.id)).where(where)
  // Pin-first is meaningless in the trash; there the chosen sort rules alone.
  const items = baseQuery()
    .orderBy(...(trash ? [] : [asc(sql`pinned_at IS NULL`)]), orderBy)
    .limit(pageSize).offset(offset).all()
  const agg = db.select({ count: sql<number>`count(*)`, totalSize: sql<number>`coalesce(sum(${books.size}), 0)` })
    .from(books).where(where).get()
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
  return { data, page, pageSize, total: agg?.count ?? 0, totalSize: agg?.totalSize ?? 0 }
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
  if (buffer.length >= 6 && (buffer.toString('ascii', 0, 6) === 'GIF87a' || buffer.toString('ascii', 0, 6) === 'GIF89a')) return 'gif'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  const header = buffer.toString('utf8', 0, Math.min(buffer.length, 4096)).replace(/^\uFEFF/, '')
  if (/<svg(?:\s|>)/i.test(header)) return 'svg'
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

export async function uploadBook(
  userId: string,
  file: File,
  membership?: { shelfId?: string | null; tagIds?: string[] },
  opts?: { normalizeTitle?: boolean },
) {
  const storage = getStorage()
  const fileName = file.name
  const mime = file.type
  const parser = getParser(fileName, mime)
  if (!parser) {
    throw new AppError('UNSUPPORTED_FORMAT', `Unsupported format: ${fileName}`)
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const parsed = await parser.parse(buffer)
  const format = fileName.toLowerCase().endsWith('.txt') ? 'txt' : 'epub'
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
    // Tags are additive and side-effect-free, so honor the requested assignment
    // even for a duplicate. Shelf is deliberately not touched: it is a
    // single-value column and moving an already-shelved book silently would
    // be destructive - the UI surfaces the mismatch instead.
    if (tagIds.length > 0) {
      db.insert(bookTags)
        .values(tagIds.map((tagId) => ({ bookId: existing.id, tagId })))
        .onConflictDoNothing()
        .run()
    }
    return { book: stripMetaChapters(db.select().from(books).where(eq(books.id, existing.id)).get()!), duplicated: true }
  }

  let title = parsed.meta.title
  let author = parsed.meta.author ?? ''
  if (!title) {
    const derived = opts?.normalizeTitle ? normalizeBookTitle(fileName) : undefined
    title = derived?.title || fileName.replace(/\.[^.]+$/, '')
    // File names of web-novels often carry the author where metadata has none.
    if (!author && derived?.author) author = derived.author
  }

  let coverKey: string | null = null
  if (parsed.meta.cover) {
    const ext = detectImageExtension(parsed.meta.cover) || 'jpg'
    coverKey = blobKey(contentHash, `.cover.${ext}`)
    await storage.put(coverKey, parsed.meta.cover)
  }

  const meta: Record<string, unknown> = {}
  // Persist bookmeta for every upload so book reads never need a metadata pass.
  meta.bookmeta = parsed.meta.bookmeta ?? {}
  // Keep the upload's file name for provenance: content is stored under a
  // content-hash key and the title may later be edited away from it.
  meta.fileName = fileName
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
    meta.txtArtifactVersion = TXT_EPUB_ARTIFACT_VERSION

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
        level: c.level ?? 1,
        startOffset: 0,
        endOffset: 0,
        wordCount: c.wordCount ?? 0,
      }))
    }
    meta.epubTocLevelVersion = EPUB_TOC_LEVEL_VERSION
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

export function getBookMembership(userId: string, bookId: string, shelfId: string | null) {
  const db = getDb()
  const shelfName = shelfId
    ? db.select({ name: shelves.name })
      .from(shelves)
      .where(and(eq(shelves.id, shelfId), eq(shelves.userId, userId)))
      .get()?.name ?? null
    : null
  const tagRows = db.select({ name: tags.name })
    .from(bookTags)
    .innerJoin(tags, eq(bookTags.tagId, tags.id))
    .where(and(eq(bookTags.bookId, bookId), eq(tags.userId, userId)))
    .orderBy(asc(tags.sortOrder), asc(tags.name))
    .all()
  return { shelfName, tags: tagRows.map((tag) => tag.name) }
}

export async function getBookChapters(userId: string, bookId: string) {
  const book = await getBook(userId, bookId)
  const existingChapters = (book.meta?.chapters ?? []) as Chapter[]
  if (book.format !== 'epub' || book.meta?.epubTocLevelVersion === EPUB_TOC_LEVEL_VERSION) {
    return existingChapters
  }

  const storage = getStorage()
  if (!(await storage.exists(book.filePath))) return existingChapters
  const parser = getParser(book.filePath, '')
  if (!parser) return existingChapters

  try {
    const parsed = await parser.parse(await storage.get(book.filePath))
    const sameLength = parsed.chapters.length === existingChapters.length
    const chapters = parsed.chapters.map((parsedChapter, index) => {
      const existing = sameLength ? existingChapters[index] : undefined
      return {
        id: existing?.id ?? `ch-${index}`,
        title: existing?.title ?? parsedChapter.title,
        level: parsedChapter.level ?? existing?.level ?? 1,
        startOffset: existing?.startOffset ?? 0,
        endOffset: existing?.endOffset ?? 0,
        wordCount: existing?.wordCount ?? parsedChapter.wordCount ?? 0,
      }
    })
    const meta: Record<string, unknown> = { ...(book.meta as Record<string, unknown>), epubTocLevelVersion: EPUB_TOC_LEVEL_VERSION }
    if (chapters.length > 0) meta.chapters = chapters
    getDb().update(books).set({ meta, updatedAt: Date.now() }).where(and(eq(books.id, book.id), eq(books.userId, userId))).run()
    return (chapters.length > 0 ? chapters : existingChapters) as Chapter[]
  } catch {
    return existingChapters
  }
}

interface PreparedTxtAppend {
  mergedNormalized: string
  chapters: ReturnType<typeof scanTxtChapters>
  originalWordCount: number
  newWordCount: number
  mergedRawChapters: ReturnType<typeof scanTxtChapters>
  excludedChapterIds: string[]
  metaChapters: Array<{
    id: string
    title: string
    level: number
    startOffset: number
    endOffset: number
    contentStartOffset: number
    contentRanges?: Array<{ startOffset: number; endOffset: number }>
    wordCount: number
  }>
  candidateChapters: AppendContentCandidate[]
  predictedStartIndex: number
  preview: AppendContentPreviewRes
}

function chapterSequenceKey(chapter: Pick<AppendContentCandidate, 'title' | 'level'>): string {
  return `${chapter.level}:${chapter.title.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()}`
}

function parseChineseChapterNumber(value: string): number | null {
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1_000, 万: 10_000, 亿: 100_000_000 }
  if (!value || [...value].some((char) => digits[char] === undefined && units[char] === undefined)) return null

  let total = 0
  let section = 0
  for (const char of value) {
    const digit = digits[char]
    if (digit !== undefined) {
      section = digit
      continue
    }
    const unit = units[char]!
    if (unit >= 10_000) {
      total += section
      total *= unit
      section = 0
    } else {
      total += (section || 1) * unit
      section = 0
    }
  }
  return total + section
}

function chapterNumber(title: string): number | null {
  const arabic = title.match(/第\s*(\d+)\s*(?:章|回|节)/i)?.[1]
    ?? title.match(/\bchapter\s+(\d+)\b/i)?.[1]
  if (arabic) return Number(arabic)
  const chinese = title.match(/第\s*([零〇一二两三四五六七八九十百千万亿]+)\s*(?:章|回|节)/)?.[1]
  return chinese ? parseChineseChapterNumber(chinese) : null
}

function sumCandidateWords(candidates: AppendContentCandidate[], endExclusive: number): number {
  return candidates.slice(0, endExclusive).reduce((sum, chapter) => sum + chapter.wordCount, 0)
}

export function predictAppendStartIndex(
  originalChapters: AppendContentCandidate[],
  candidates: AppendContentCandidate[],
  originalWordCount: number,
): number {
  if (candidates.length === 0 || originalChapters.length === 0) return 0

  const sequenceLength = Math.min(3, originalChapters.length)
  for (let length = sequenceLength; length >= 1; length -= 1) {
    const suffix = originalChapters.slice(-length).map(chapterSequenceKey)
    const matches: number[] = []
    for (let index = 0; index <= candidates.length - length; index += 1) {
      const sequence = candidates.slice(index, index + length).map(chapterSequenceKey)
      if (sequence.every((key, sequenceIndex) => key === suffix[sequenceIndex])) {
        matches.push(index + length)
      }
    }
    if (matches.length > 0) {
      return matches.sort((left, right) =>
        Math.abs(sumCandidateWords(candidates, left) - originalWordCount) -
        Math.abs(sumCandidateWords(candidates, right) - originalWordCount),
      )[0]!
    }
  }

  const lastNumber = chapterNumber(originalChapters[originalChapters.length - 1]!.title)
  if (lastNumber !== null) {
    const nextNumber = lastNumber + 1
    const nextIndex = candidates.findIndex((chapter) => chapterNumber(chapter.title) === nextNumber)
    if (nextIndex >= 0) return nextIndex
  }

  if (candidates.length > originalChapters.length) {
    const prefixWords = sumCandidateWords(candidates, originalChapters.length)
    const tolerance = Math.max(100, originalWordCount * 0.15)
    if (Math.abs(prefixWords - originalWordCount) <= tolerance) return originalChapters.length
  }

  return 0
}

function resolveAppendStartOffset(
  appendedNormalized: string,
  candidates: AppendContentCandidate[],
  predictedStartIndex: number,
  requestedStartOffset?: number,
): number {
  const startOffset = requestedStartOffset ?? candidates[predictedStartIndex]?.startOffset ?? appendedNormalized.length
  if (!Number.isInteger(startOffset) || startOffset < 0 || startOffset > appendedNormalized.length) {
    throw new AppError('VALIDATION_ERROR', 'Invalid append start offset')
  }
  if (startOffset !== 0 && startOffset !== appendedNormalized.length && !candidates.some((chapter) => chapter.startOffset === startOffset)) {
    throw new AppError('VALIDATION_ERROR', 'Append start must be a chapter boundary')
  }
  return startOffset
}

async function prepareTxtAppend(userId: string, bookId: string, appendedText: string, requestedStartOffset?: number): Promise<PreparedTxtAppend> {
  if (!appendedText.trim()) throw new AppError('VALIDATION_ERROR', 'Append content is required')

  const book = await getActiveBook(userId, bookId)
  if (book.format !== 'txt') throw new AppError('UNSUPPORTED_FORMAT', 'Appending content only supports txt books')

  const normalized = await getOrRecoverTxtNormalized(book)
  const appendedNormalized = normalizeText(appendedText)
  if (!appendedNormalized) throw new AppError('VALIDATION_ERROR', 'Append content is required')

  const effective = await resolveEffectiveTocRule(userId, book)
  let patterns = effective.patterns
  if (patterns === null) {
    const scored = scoreTocRules(userId, normalized.slice(0, TOC_SAMPLE_SIZE))
    patterns = scored ? scored.patterns.filter((pattern) => pattern.enabled !== false) : null
  }

  const storedExcludedChapterIds = Array.isArray(book.meta.tocExcludedChapterIds)
    ? book.meta.tocExcludedChapterIds.filter((id): id is string => typeof id === 'string')
    : []
  const originalRawChapters = scanTxtChapters(normalized, patterns ?? undefined)
  const { chapters: originalChapters } = applyTxtChapterExclusions(originalRawChapters, storedExcludedChapterIds)
  const originalCandidateChapters = originalChapters.map((chapter) => ({
    title: chapter.title,
    level: chapter.level,
    wordCount: countWords(getTxtChapterContent(normalized, chapter)),
    startOffset: chapter.startOffset,
  }))
  const candidateRawChapters = scanTxtChapters(appendedNormalized, patterns ?? undefined)
  const candidateChapters = candidateRawChapters.map((chapter) => ({
    title: chapter.title,
    level: chapter.level,
    wordCount: countWords(getTxtChapterContent(appendedNormalized, chapter)),
    startOffset: chapter.startOffset,
  }))
  const originalWordCount = originalCandidateChapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
  const predictedStartIndex = predictAppendStartIndex(originalCandidateChapters, candidateChapters, originalWordCount)
  const selectedStartOffset = resolveAppendStartOffset(appendedNormalized, candidateChapters, predictedStartIndex, requestedStartOffset)
  const validAppendedNormalized = appendedNormalized.slice(selectedStartOffset).trimStart()
  const mergedNormalized = validAppendedNormalized
    ? `${normalized.trimEnd()}\n\n${validAppendedNormalized}`
    : normalized
  const mergedRawChapters = scanTxtChapters(mergedNormalized, patterns ?? undefined)
  const { chapters, excludedChapterIds } = applyTxtChapterExclusions(mergedRawChapters, storedExcludedChapterIds)

  const originalMetaChapters = originalChapters.map((chapter) => ({
    ...chapter,
    id: txtChapterId(chapter),
    wordCount: countWords(getTxtChapterContent(normalized, chapter)),
  }))
  const metaChapters = chapters.map((chapter) => ({
    id: txtChapterId(chapter),
    title: chapter.title,
    level: chapter.level,
    startOffset: chapter.startOffset,
    endOffset: chapter.endOffset,
    contentStartOffset: chapter.contentStartOffset,
    contentRanges: chapter.contentRanges,
    wordCount: countWords(getTxtChapterContent(mergedNormalized, chapter)),
  }))
  const newWordCount = metaChapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
  const addedChapterCount = Math.max(0, metaChapters.length - originalMetaChapters.length)
  const addedChapters = metaChapters.slice(originalMetaChapters.length).map((chapter) => ({
    title: chapter.title,
    level: chapter.level,
    wordCount: chapter.wordCount,
  }))
  const appendedToLastChapter = addedChapterCount === 0

  // A stored exclusion is a persistent boundary decision, so keep its actual
  // value in the rebuilt metadata even when a stale id no longer matches.
  const preview: AppendContentPreviewRes = {
    originalChapterCount: originalMetaChapters.length,
    originalWordCount,
    newChapterCount: metaChapters.length,
    newWordCount,
    addedChapterCount,
    addedWordCount: Math.max(0, newWordCount - originalWordCount),
    candidateTextLength: appendedNormalized.length,
    candidateChapters,
    predictedStartIndex,
    addedChapters,
    appendedToLastChapter,
    ...(appendedToLastChapter && metaChapters.length > 0 ? { lastChapterTitle: metaChapters[metaChapters.length - 1]!.title } : {}),
  }

  return {
    mergedNormalized,
    chapters,
    originalWordCount,
    newWordCount,
    mergedRawChapters,
    excludedChapterIds,
    metaChapters,
    candidateChapters,
    predictedStartIndex,
    preview,
  }
}

export async function previewAppendTxtBookContent(userId: string, bookId: string, appendedText: string, startOffset?: number): Promise<AppendContentPreviewRes> {
  const prepared = await prepareTxtAppend(userId, bookId, appendedText, startOffset)
  return prepared.preview
}

export async function appendTxtBookContent(userId: string, bookId: string, appendedText: string, startOffset?: number) {
  const prepared = await prepareTxtAppend(userId, bookId, appendedText, startOffset)
  const db = getDb()
  const storage = getStorage()
  const book = await getActiveBook(userId, bookId)
  const meta: Record<string, unknown> = {
    ...book.meta,
    chapters: prepared.metaChapters,
    wordCount: prepared.newWordCount,
    txtArtifactVersion: TXT_EPUB_ARTIFACT_VERSION,
  }
  const leadingExcludedId = prepared.mergedRawChapters[0] ? txtChapterId(prepared.mergedRawChapters[0]) : null
  if (prepared.excludedChapterIds.length > 0) meta.tocExcludedChapterIds = prepared.excludedChapterIds
  else delete meta.tocExcludedChapterIds
  if (prepared.mergedRawChapters[0]?.synthetic && leadingExcludedId && prepared.excludedChapterIds.includes(leadingExcludedId)) {
    const leadingText = getTxtChapterContent(prepared.mergedNormalized, prepared.mergedRawChapters[0]).trim()
    if (leadingText) meta.tocExcludedLeadingText = leadingText
  } else {
    delete meta.tocExcludedLeadingText
  }

  const epubChapters = prepared.chapters.map((chapter) => ({
    id: txtChapterId(chapter),
    title: chapter.title,
    level: chapter.level,
  }))
  const contentFor = (index: number) => getTxtChapterContent(prepared.mergedNormalized, prepared.chapters[index]!)
  const epubBuffer = await convertTxtToEpub(
    { title: book.title, author: book.author || undefined, id: book.id },
    epubChapters,
    contentFor,
  )
  const contentHash = sha256(epubBuffer)
  const filePath = blobKey(contentHash, '.epub')
  await storage.put(filePath, epubBuffer)

  const progress = await readProgressFile(bookId)
  const scale = prepared.newWordCount > 0 ? prepared.originalWordCount / prepared.newWordCount : 1
  const scaleFraction = (value: number) => Math.max(0, Math.min(1, value * scale))
  const oldPercent = progress?.percent ?? book.progress
  const newPercent = Math.min(100, Math.round(oldPercent * scale))
  if (progress) {
    const nextProgress = {
      ...progress,
      percent: newPercent,
      fraction: typeof progress.fraction === 'number' ? scaleFraction(progress.fraction) : progress.fraction,
      intervals: (progress.intervals ?? []).map(([start, end]) => [scaleFraction(start), scaleFraction(end)] as [number, number]),
      rateSamples: Array.isArray(progress.rateSamples)
        ? progress.rateSamples.map((sample) => (
            sample && typeof sample === 'object' && typeof (sample as { fraction?: unknown }).fraction === 'number'
              ? { ...sample, fraction: scaleFraction((sample as { fraction: number }).fraction) }
              : sample
          ))
        : progress.rateSamples,
      updatedAt: Date.now(),
    }
    await storage.put(`progress/${bookId}.json`, Buffer.from(JSON.stringify(nextProgress), 'utf-8'))
  }

  const oldFilePath = book.filePath
  const updatedAt = Date.now()
  db.update(books).set({
    filePath,
    contentHash,
    size: epubBuffer.length,
    meta,
    progress: newPercent,
    updatedAt,
  }).where(and(eq(books.id, bookId), eq(books.userId, userId))).run()
  invalidateCachedNormalized(bookId)

  if (oldFilePath !== filePath) {
    const refs = db.select({ count: sql<number>`count(*)` }).from(books).where(eq(books.filePath, oldFilePath)).get()
    if ((refs?.count ?? 0) === 0 && await storage.exists(oldFilePath)) {
      await storage.delete(oldFilePath)
    }
  }

  return stripMetaChapters(db.select().from(books).where(eq(books.id, bookId)).get()!)
}

const LEGACY_TXT_FONT_DECLARATION = /font-family\s*:\s*"Noto Serif SC"\s*,\s*"Source Han Serif SC"\s*,\s*"SimSun"\s*,\s*serif\s*;/i

export interface TxtArtifactMigrationResult {
  examined: number
  migrated: number
  skipped: number
  failed: number
}

/** Upgrade stored TXT-derived EPUB styles without changing chapter files or CFIs. */
export async function migrateTxtArtifacts(): Promise<TxtArtifactMigrationResult> {
  const db = getDb()
  const storage = getStorage()
  const txtBooks = db.select().from(books).where(eq(books.format, 'txt')).all()
  const result: TxtArtifactMigrationResult = { examined: txtBooks.length, migrated: 0, skipped: 0, failed: 0 }

  for (const book of txtBooks) {
    if (book.meta.txtArtifactVersion === TXT_EPUB_ARTIFACT_VERSION) {
      result.skipped++
      continue
    }

    try {
      const buffer = await bufferFromStream(await storage.get(book.filePath))
      const zip = await JSZip.loadAsync(buffer)
      const styleEntry = zip.file('OEBPS/style.css')
      let migratedBuffer: Buffer | null = null
      if (styleEntry) {
        const css = await styleEntry.async('string')
        const migratedCss = css.replace(LEGACY_TXT_FONT_DECLARATION, '')
        if (migratedCss !== css) {
          zip.file('OEBPS/style.css', migratedCss)
          migratedBuffer = await zip.generateAsync({ type: 'nodebuffer' })
          await storage.put(book.filePath, migratedBuffer)
        }
      }

      const meta = { ...book.meta, txtArtifactVersion: TXT_EPUB_ARTIFACT_VERSION }
      db.update(books).set({
        meta,
        size: migratedBuffer?.length ?? book.size,
        updatedAt: Date.now(),
      }).where(eq(books.id, book.id)).run()
      result.migrated++
    } catch (error) {
      result.failed++
      log('error', 'books.txt_artifact_migration.failed', { error, meta: { bookId: book.id } })
    }
  }

  return result
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
  customPatterns?: TocRulePattern[] | null,
  requestedExcludedChapterIds: string[] = [],
): Promise<string> {
  const storage = getStorage()
  const book = await getBook(userId, bookId)
  if (book.format !== 'txt') throw new AppError('UNSUPPORTED_FORMAT', 'Re-TOC only supports txt books')

  const normalized = await getOrRecoverTxtNormalized(book)
  const rawChapters = scanTxtChapters(normalized, patterns ?? undefined)
  const { chapters, excludedChapterIds } = applyTxtChapterExclusions(rawChapters, requestedExcludedChapterIds)

  const db = getDb()
  const metaChapters = chapters.map((c) => ({
    id: txtChapterId(c),
    title: c.title,
    level: c.level,
    startOffset: c.startOffset,
    endOffset: c.endOffset,
    contentStartOffset: c.contentStartOffset,
    contentRanges: c.contentRanges,
    wordCount: countWords(getTxtChapterContent(normalized, c)),
  }))
  const wordCount = metaChapters.reduce((sum, c) => sum + c.wordCount, 0)
  const meta: Record<string, unknown> = {
    ...book.meta,
    chapters: metaChapters,
    wordCount,
    txtArtifactVersion: TXT_EPUB_ARTIFACT_VERSION,
  }
  if (excludedChapterIds.length > 0) meta.tocExcludedChapterIds = excludedChapterIds
  else delete meta.tocExcludedChapterIds
  const leadingExcludedId = rawChapters[0] ? txtChapterId(rawChapters[0]) : null
  if (rawChapters[0]?.synthetic && leadingExcludedId && excludedChapterIds.includes(leadingExcludedId)) {
    const leadingText = getTxtChapterContent(normalized, rawChapters[0]).trim()
    if (leadingText) meta.tocExcludedLeadingText = leadingText
  } else {
    delete meta.tocExcludedLeadingText
  }
  const oldChapters = (book.meta as { chapters?: { id?: string }[] } | undefined)?.chapters
  // CFIs address the EPUB by chapter-file index, so only the chapter
  // boundaries (ids = start offsets) decide whether the saved position is
  // stale — title-only drift keeps every file structurally identical.
  const chaptersChanged =
    !oldChapters ||
    oldChapters.length !== metaChapters.length ||
    oldChapters.some((c, i) => c.id !== metaChapters[i]?.id)
  if (customPatterns && customPatterns.length > 0) {
    meta.customTocPatterns = customPatterns
    meta.tocRuleId = 'custom'
    meta.tocRuleAuto = false
  } else if (tocRuleId) {
    meta.tocRuleId = tocRuleId
    meta.tocRuleAuto = tocRuleAuto
    delete meta.customTocPatterns
  } else {
    delete meta.tocRuleId
    delete meta.tocRuleAuto
    delete meta.customTocPatterns
  }

  const epubChapters = chapters.map((c) => ({
    id: txtChapterId(c),
    title: c.title,
    level: c.level,
  }))
  const contentFor = (index: number) => {
    const c = chapters[index]
    return getTxtChapterContent(normalized, c)
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
export async function getOrRecoverTxtNormalized(book: { filePath: string; id: string; updatedAt: number; meta?: unknown }): Promise<string> {
  const cacheKey = book.id + ':' + book.updatedAt
  const cached = getCachedNormalized(cacheKey)
  if (cached) return cached
  let normalized = await recoverTxtNormalized(book)
  const meta = (book as { meta?: { chapters?: Array<{ title?: string; startOffset?: number; contentStartOffset?: number }>; tocExcludedLeadingText?: string } }).meta
  const firstChapter = meta?.chapters?.[0]
  if (firstChapter?.startOffset === 0 && firstChapter.contentStartOffset === 0 && firstChapter.title) {
    const generatedTitlePrefix = firstChapter.title.trim() + '\n\n'
    if (normalized.startsWith(generatedTitlePrefix)) normalized = normalized.slice(generatedTitlePrefix.length)
  }
  const leadingText = meta?.tocExcludedLeadingText?.trim()
  const firstTitle = meta?.chapters?.[0]?.title?.trim()
  if (leadingText && firstTitle) {
    const titlePrefix = firstTitle + '\n\n'
    if (normalized.startsWith(titlePrefix)) {
      const afterTitle = normalized.slice(titlePrefix.length)
      if (afterTitle.startsWith(leadingText)) {
        const body = afterTitle.slice(leadingText.length).replace(/^\n+/, '')
        normalized = leadingText + '\n\n' + firstTitle + (body ? '\n\n' + body : '')
      }
    }
  }
  setCachedNormalized(cacheKey, normalized)
  return normalized
}

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
    parts.push([title, ...paragraphs].filter((part) => part.length > 0).join('\n\n'))
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
  customPatterns?: TocRulePattern[],
  excludedChapterIds?: string[],
): Promise<string> {
  const db = getDb()
  const book = await getBook(userId, bookId)
  if (book.format !== 'txt') throw new AppError('UNSUPPORTED_FORMAT', 'Re-TOC only supports txt books')
  const storedExcludedChapterIds = (book.meta as { tocExcludedChapterIds?: string[] }).tocExcludedChapterIds ?? []
  const effectiveExcludedChapterIds = excludedChapterIds ?? storedExcludedChapterIds

  if (customPatterns && customPatterns.length > 0) {
    const active = customPatterns.filter((p) => p.enabled !== false)
    return rebuildTocBook(userId, bookId, active, 'custom', false, customPatterns, effectiveExcludedChapterIds)
  }

  if (tocRuleId !== undefined) {
    // Explicit pin or clear: tocRuleId is validated against the user's rules
    if (tocRuleId !== null) {
      const rule = db.select().from(tocRules).where(and(eq(tocRules.id, tocRuleId), eq(tocRules.userId, userId))).get()
      if (!rule) throw new AppError('TOC_RULE_NOT_FOUND')
      return rebuildTocBook(userId, bookId, rule.patterns.filter((p) => p.enabled !== false), rule.id, false, null, effectiveExcludedChapterIds)
    }
    // Clear the pin: auto-score decides from scratch
    const normalized = await getOrRecoverTxtNormalized(book)
    const scored = scoreTocRules(userId, normalized.slice(0, TOC_SAMPLE_SIZE))
    if (scored) {
      return rebuildTocBook(userId, bookId, scored.patterns.filter((p) => p.enabled !== false), scored.id, true, null, effectiveExcludedChapterIds)
    }
    return rebuildTocBook(userId, bookId, null, null, false, null, effectiveExcludedChapterIds)
  }

  // No explicit instruction: keep the current pin (auto-scored or user-chosen or custom)
  const effective = await resolveEffectiveTocRule(userId, book)
  if (effective.tocRuleId === 'custom' && Array.isArray((book.meta as Record<string, unknown>).customTocPatterns)) {
    return rebuildTocBook(
      userId,
      bookId,
      effective.patterns,
      'custom',
      false,
      (book.meta as Record<string, unknown>).customTocPatterns as TocRulePattern[],
      effectiveExcludedChapterIds,
    )
  }
  if (effective.tocRuleId) {
    return rebuildTocBook(userId, bookId, effective.patterns, effective.tocRuleId, effective.tocRuleAuto, null, effectiveExcludedChapterIds)
  }

  // No pin (or it dangles): auto-score now
  const normalized = await getOrRecoverTxtNormalized(book)
  const scored = scoreTocRules(userId, normalized.slice(0, TOC_SAMPLE_SIZE))
  if (scored) {
    return rebuildTocBook(userId, bookId, scored.patterns.filter((p) => p.enabled !== false), scored.id, true, null, effectiveExcludedChapterIds)
  }
  return rebuildTocBook(userId, bookId, null, null, false, null, effectiveExcludedChapterIds)
}

export interface PreviewBookTocOptions {
  tocRuleId?: string | null
  customPatterns?: TocRulePattern[]
  limit?: number
  offset?: number
  excludedChapterIds?: string[]
}

export async function previewBookToc(
  userId: string,
  bookId: string,
  options: PreviewBookTocOptions = {},
): Promise<TocPreviewRes> {
  const db = getDb()
  const book = await getBook(userId, bookId)
  if (book.format !== 'txt') throw new AppError('UNSUPPORTED_FORMAT', 'TOC preview only supports txt books')

  const normalized = await getOrRecoverTxtNormalized(book)
  const storedExcludedChapterIds = (book.meta as { tocExcludedChapterIds?: string[] }).tocExcludedChapterIds ?? []
  const requestedExcludedChapterIds = options.excludedChapterIds ?? storedExcludedChapterIds
  let patterns: TocRulePattern[] | null = null
  let ruleId: string | null = null
  let ruleName: string | undefined
  let autoScored = false

  if (options.customPatterns && options.customPatterns.length > 0) {
    patterns = options.customPatterns.filter((p) => p.enabled !== false)
    ruleId = 'custom'
    ruleName = '本书专属规则'
  } else if (options.tocRuleId !== undefined) {
    if (options.tocRuleId !== null) {
      if (options.tocRuleId === 'custom') {
        const custom = (book.meta as { customTocPatterns?: TocRulePattern[] } | undefined)?.customTocPatterns
        if (custom && custom.length > 0) {
          patterns = custom.filter((p) => p.enabled !== false)
          ruleId = 'custom'
          ruleName = '本书专属规则'
        }
      } else {
        const rule = db.select().from(tocRules).where(and(eq(tocRules.id, options.tocRuleId), eq(tocRules.userId, userId))).get()
        if (!rule) throw new AppError('TOC_RULE_NOT_FOUND')
        patterns = rule.patterns.filter((p) => p.enabled !== false)
        ruleId = rule.id
        ruleName = rule.name
      }
    } else {
      // Auto-scoring preview
      const scored = scoreTocRules(userId, normalized.slice(0, TOC_SAMPLE_SIZE))
      if (scored) {
        patterns = scored.patterns.filter((p) => p.enabled !== false)
        ruleId = scored.id
        ruleName = scored.name
        autoScored = true
      }
    }
  } else {
    // Default / effective
    const effective = await resolveEffectiveTocRule(userId, book)
    patterns = effective.patterns
    ruleId = effective.tocRuleId
    ruleName = effective.ruleName
    autoScored = effective.tocRuleAuto
  }

  const outMeta: { fallback?: boolean } = {}
  const rawChapters = scanTxtChapters(normalized, patterns ?? undefined, outMeta)
  const { chapters: effectiveChapters, excludedChapterIds } = applyTxtChapterExclusions(rawChapters, requestedExcludedChapterIds)

  const currentChapters = (book.meta as { chapters?: Chapter[] } | undefined)?.chapters ?? []
  const currentTotalChapters = currentChapters.length

  const levelCounts: Record<number, number> = {}
  for (const c of effectiveChapters) {
    levelCounts[c.level] = (levelCounts[c.level] ?? 0) + 1
  }

  const previewLimit = options.limit ?? 1000
  const previewOffset = options.offset ?? 0
  const chapters: TocPreviewChapter[] = rawChapters.slice(previewOffset, previewOffset + previewLimit).map((c, index) => ({
    id: txtChapterId(c),
    title: c.title,
    level: c.level,
    wordCount: countWords(getTxtChapterContent(normalized, c)),
    excluded: excludedChapterIds.includes(txtChapterId(c)),
    canExclude: canExcludeTxtChapter(c, previewOffset + index),
  }))

  return {
    ruleId,
    ruleName,
    autoScored,
    fallback: outMeta.fallback === true,
    totalChapters: effectiveChapters.length,
    matchedTotalChapters: rawChapters.length,
    currentTotalChapters,
    levelCounts,
    excludedChapterIds,
    chapters,
  }
}

export async function getBookContent(userId: string, bookId: string): Promise<string> {
  const book = await getBook(userId, bookId)
  if (book.format !== 'txt') {
    throw new AppError('UNSUPPORTED_FORMAT', 'Content endpoint only supports txt')
  }
  return getOrRecoverTxtNormalized(book)
}

export async function getBookChapterContent(userId: string, bookId: string, chapterIndex: number) {
  const book = await getActiveBook(userId, bookId)
  const chapters = await getBookChapters(userId, bookId)
  const chapter = chapters[chapterIndex]
  if (!chapter) throw new AppError('VALIDATION_ERROR', 'Chapter index is out of range')

  const content = book.format === 'txt'
    ? getTxtChapterContent(await getBookContent(userId, bookId), chapter).trim()
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

export async function updateBook(userId: string, bookId: string, data: { readStatus?: string; progress?: number; pinned?: boolean; title?: string; author?: string; bookmeta?: BookMetadata; viewSettings?: ViewSettings | null; boundPresetId?: string | null; tocRuleId?: string | null; coverPaletteId?: CoverPaletteId | null }) {
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
  if (data.coverPaletteId !== undefined) {
    // Decorative pin: null removes the key so the cover falls back to the id hash.
    const meta = { ...(book.meta as Record<string, unknown>), ...(set.meta as Record<string, unknown> | undefined) }
    if (data.coverPaletteId === null) {
      delete meta.coverPaletteId
    } else {
      meta.coverPaletteId = data.coverPaletteId
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
  if (!ext) throw new AppError('UNSUPPORTED_FORMAT', 'Cover must be a PNG, JPEG, GIF, SVG or WebP image')
  const storage = getStorage()
  const coverKey = blobKey(sha256(buffer), `.cover.${ext}`)
  await storage.put(coverKey, buffer)
  const meta = { ...(book.meta as Record<string, unknown>) }
  delete meta.coverSuppressed
  db.update(books).set({ coverKey, meta, updatedAt: Date.now() }).where(eq(books.id, bookId)).run()
  return stripMetaChapters(db.select().from(books).where(eq(books.id, bookId)).get()!)
}

export async function getBookCover(userId: string, bookId: string): Promise<{ coverKey: string } | null> {
  const db = getDb()
  const book = await getBook(userId, bookId)
  const storage = getStorage()
  if (book.coverKey && await storage.exists(book.coverKey)) return { coverKey: book.coverKey }
  if (book.format !== 'epub' || book.meta?.coverSuppressed === true) return null
  if (!(await storage.exists(book.filePath))) return null
  const parser = getParser(book.filePath, '')
  if (!parser) return null
  if (!book.contentHash) return null
  try {
    const parsed = await parser.parse(await storage.get(book.filePath))
    if (!parsed.meta.cover) return null
    const ext = detectImageExtension(parsed.meta.cover)
    if (!ext) return null
    const coverKey = blobKey(book.contentHash, `.cover.${ext}`)
    await storage.put(coverKey, parsed.meta.cover)
    db.update(books).set({ coverKey, updatedAt: Date.now() }).where(eq(books.id, book.id)).run()
    return { coverKey }
  } catch {
    return null
  }
}

export async function removeBookCover(userId: string, bookId: string) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  const meta = { ...(book.meta as Record<string, unknown>), coverSuppressed: true }
  db.update(books).set({ coverKey: null, meta, updatedAt: Date.now() }).where(eq(books.id, bookId)).run()
  return stripMetaChapters(db.select().from(books).where(eq(books.id, bookId)).get()!)
}

export async function resetBookMetadata(userId: string, bookId: string, opts?: { normalizeTitle?: boolean }) {
  const db = getDb()
  const book = db.select().from(books).where(and(eq(books.id, bookId), eq(books.userId, userId))).get()
  if (!book) throw new AppError('BOOK_NOT_FOUND')
  const storage = getStorage()
  const parser = getParser(book.filePath, '')
  if (!parser) throw new AppError('UNSUPPORTED_FORMAT')
  const parsed = await parser.parse(await storage.get(book.filePath))
  const meta = { ...(book.meta as Record<string, unknown>), bookmeta: parsed.meta.bookmeta ?? {} }
  let title = parsed.meta.title
  let author = parsed.meta.author ?? ''
  const originalFileName = (book.meta as Record<string, unknown>).fileName
  if (!title && opts?.normalizeTitle && typeof originalFileName === 'string') {
    const derived = normalizeBookTitle(originalFileName)
    if (derived.title) title = derived.title
    if (!author && derived.author) author = derived.author
  }
  db.update(books).set({
    title: title || book.title,
    author,
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

/** Evict trash oldest-deleted-first until the user's trash total is at or
 * under `maxBytes`; stops as soon as the cap is back, so rows under the cap
 * keep their full time-based grace period. `maxBytes` <= 0 disables. */
export async function purgeTrashToCapacity(userId: string, maxBytes: number) {
  if (maxBytes <= 0) return 0
  const db = getDb()
  const ownedTrash = and(eq(books.userId, userId), isNotNull(books.deletedAt))
  const agg = db.select({ total: sql<number>`coalesce(sum(${books.size}), 0)` })
    .from(books).where(ownedTrash).get()
  let total = agg?.total ?? 0
  if (total <= maxBytes) return 0
  const rows = db.select({ id: books.id, size: books.size }).from(books)
    .where(ownedTrash).orderBy(asc(books.deletedAt)).all()
  let purged = 0
  for (const row of rows) {
    if (total <= maxBytes) break
    await deleteBook(userId, row.id)
    total -= row.size
    purged++
  }
  return purged
}

/** Boot-time sweep of every user's trash (B6): day-based purge (one settings
 * read, one expired query per distinct retention cutoff) plus a per-user
 * capacity pass; rows processed in chunks with event-loop yields so
 * synchronous SQLite churn never stalls a busy server. */
export async function purgeAllExpiredTrash() {
  const db = getDb()
  const allUsers = db.select({ id: usersTable.id }).from(usersTable).all()
  if (allUsers.length === 0) return
  const settingsRows = db.select({ userId: settings.userId, value: settings.value })
    .from(settings).where(eq(settings.key, 'trash')).all()
  const trashSettingsByUser = new Map(settingsRows.map((r) => [r.userId, r.value as TrashSettings | undefined]))

  const now = Date.now()
  const groups = new Map<number, string[]>()
  for (const { id } of allUsers) {
    const days = trashSettingsByUser.get(id)?.autoCleanDays ?? 30
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
  // Capacity pass runs after the day purge so each rule only evicts what the
  // other left behind; users without a stored cap cost one SUM query.
  for (const { id } of allUsers) {
    const purged = await purgeTrashToCapacity(id, trashSettingsByUser.get(id)?.maxTrashBytes ?? 0)
    if (purged > 0) await new Promise((resolve) => setImmediate(resolve))
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
