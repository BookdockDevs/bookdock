import type { Readable } from 'node:stream'

import { eq, lt, desc, asc, and, sql, inArray, isNull, isNotNull } from 'drizzle-orm'
import JSZip from 'jszip'
import sharp from 'sharp'
import { getDb } from '../../db/client'
import {
  blobs, books, annotations, bookTags, bookVersions, bookStates, contentRevisions, libraries, libraryBooks,
  libraryBookTags, libraryBookVersions, libraryCategories, libraryTags, settings,
  users as usersTable, tocRules,
} from '../../db/schema'
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
import { ensurePrivateLibrary } from '../libraries/library-access'
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
  const library = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (!library) return { data: [], page, pageSize, total: 0, totalSize: 0 }
  // Latest-revision meta as a scalar subquery: content-derived fields
  // (description/series/cover palette) always follow the current revision.
  const revMeta = (jsonPath: string) => sql`json_extract((SELECT ${contentRevisions.meta} FROM ${contentRevisions} WHERE ${contentRevisions.bookVersionId} = ${bookVersions.id} ORDER BY ${contentRevisions.revisionNo} DESC LIMIT 1), ${jsonPath})`
  const effTitle = sql<string>`coalesce(${libraryBookVersions.title}, ${libraryBooks.title})`
  const effAuthor = sql<string>`coalesce(${libraryBookVersions.author}, ${libraryBooks.author})`
  const effReadStatus = sql<string>`coalesce(${bookStates.readStatus}, 'reading')`
  const effProgress = sql<number>`coalesce(${bookStates.percent}, 0)`
  const conditions = [
    eq(libraryBookVersions.libraryId, library.id),
    eq(libraryBooks.userId, userId),
    trash ? isNotNull(libraryBooks.deletedAt) : isNull(libraryBooks.deletedAt),
  ]
  if (search) {
    // Escape LIKE wildcards so user input is matched literally. The escape
    // char is '!' (backslash would be mangled by drizzle's sql template) and
    // must itself be escaped first.
    const escaped = search.replace(/[!%_]/g, (m) => '!' + m)
    const pattern = '%' + escaped + '%'
    const categoryMatch = sql`EXISTS (
      SELECT 1 FROM ${libraryCategories} AS search_category
      WHERE search_category.id = ${libraryBooks.categoryId}
        AND search_category.library_id = ${library.id}
        AND search_category.name LIKE ${pattern} ESCAPE '!'
    )`
    const tagMatch = sql`EXISTS (
      SELECT 1
      FROM ${libraryBookTags} AS search_book_tag
      INNER JOIN ${libraryTags} AS search_tag ON search_tag.id = search_book_tag.tag_id
      WHERE search_book_tag.library_book_id = ${libraryBooks.id}
        AND search_tag.library_id = ${library.id}
        AND search_tag.name LIKE ${pattern} ESCAPE '!'
    )`
    conditions.push(sql`(
      ${effTitle} LIKE ${pattern} ESCAPE '!'
      OR ${effAuthor} LIKE ${pattern} ESCAPE '!'
      OR ${bookVersions.format} LIKE ${pattern} ESCAPE '!'
      OR ${revMeta('$.bookmeta.description')} LIKE ${pattern} ESCAPE '!'
      OR ${revMeta('$.bookmeta.series')} LIKE ${pattern} ESCAPE '!'
      OR ${revMeta('$.bookmeta.subjects')} LIKE ${pattern} ESCAPE '!'
      OR ${revMeta('$.bookmeta.publisher')} LIKE ${pattern} ESCAPE '!'
      OR ${revMeta('$.bookmeta.isbn')} LIKE ${pattern} ESCAPE '!'
      OR ${revMeta('$.bookmeta.identifier')} LIKE ${pattern} ESCAPE '!'
      OR ${revMeta('$.bookmeta.source')} LIKE ${pattern} ESCAPE '!'
      OR ${categoryMatch}
      OR ${tagMatch}
    )`)
  }
  if (format) {
    conditions.push(eq(bookVersions.format, format))
  }
  if (readStatus) {
    conditions.push(eq(effReadStatus, readStatus))
  }
  // 'none' sentinel filters uncategorized books (categoryId IS NULL)
  if (shelfId === 'none') {
    conditions.push(isNull(libraryBooks.categoryId))
  } else if (shelfId) {
    conditions.push(eq(libraryBooks.categoryId, shelfId))
  }
  if (tagId) {
    const sub = db.select({ libraryBookId: libraryBookTags.libraryBookId }).from(libraryBookTags).where(eq(libraryBookTags.tagId, tagId))
    conditions.push(sql`${libraryBooks.id} IN ${sub}`)
  }
  if (author) {
    conditions.push(eq(effAuthor, author))
  }
  if (series) {
    conditions.push(sql`${revMeta('$.bookmeta.series')} = ${series}`)
  }
  // Pin-first is universal (user decision 2026-08-12): pinned books lead in
  // every sort 鈥?including lastReadAt 鈥?and the pinned group itself follows
  // the chosen sort, not the pin time (reads first by last-read time, desc
  // puts NULL lastReadAt at the bottom, never-read books stay visible).
  const orderBy = sortBy === 'title' ? (sortOrder === 'asc' ? asc(effTitle) : desc(effTitle)) :
    sortBy === 'author' ? (sortOrder === 'asc' ? asc(effAuthor) : desc(effAuthor)) :
    sortBy === 'size' ? (sortOrder === 'asc' ? asc(bookVersions.size) : desc(bookVersions.size)) :
    sortBy === 'progress' ? (sortOrder === 'asc' ? asc(effProgress) : desc(effProgress)) :
    sortBy === 'lastReadAt' ? (sortOrder === 'asc' ? asc(bookStates.lastReadAt) : desc(bookStates.lastReadAt)) :
    sortBy === 'updatedAt' ? (sortOrder === 'asc' ? asc(libraryBooks.updatedAt) : desc(libraryBooks.updatedAt)) :
    sortBy === 'createdAt' ? (sortOrder === 'asc' ? asc(libraryBooks.createdAt) : desc(libraryBooks.createdAt)) :
    sortBy === 'deletedAt' ? (sortOrder === 'asc' ? asc(libraryBooks.deletedAt) : desc(libraryBooks.deletedAt)) :
    sortOrder === 'asc' ? asc(libraryBooks.createdAt) : desc(libraryBooks.createdAt)
  const offset = (page - 1) * pageSize
  const where = and(...conditions)
  const baseQuery = () => db.select({
    id: bookVersions.id,
    libraryBookId: libraryBooks.id,
    title: effTitle,
    author: effAuthor,
    format: bookVersions.format,
    coverKey: sql<string | null>`coalesce(${libraryBookVersions.coverKey}, ${libraryBooks.coverKey})`,
    size: bookVersions.size,
    readStatus: effReadStatus,
    progress: effProgress,
    pinnedAt: libraryBookVersions.pinnedAt,
    lastReadAt: bookStates.lastReadAt,
    createdAt: libraryBooks.createdAt,
    updatedAt: libraryBooks.updatedAt,
    deletedAt: libraryBooks.deletedAt,
    shelfId: libraryBooks.categoryId,
    shelfName: libraryCategories.name,
    // Extracted, not the whole meta column: list payloads must stay chapter-free.
    coverPaletteId: sql<CoverPaletteId | null>`${revMeta('$.coverPaletteId')}`,
  }).from(libraryBookVersions)
    .innerJoin(libraryBooks, eq(libraryBookVersions.libraryBookId, libraryBooks.id))
    .innerJoin(bookVersions, eq(libraryBookVersions.bookVersionId, bookVersions.id))
    .leftJoin(bookStates, and(eq(bookStates.bookVersionId, bookVersions.id), eq(bookStates.userId, userId)))
    .leftJoin(libraryCategories, eq(libraryBooks.categoryId, libraryCategories.id))
    .where(where)
  // Pin-first is meaningless in the trash; there the chosen sort rules alone.
  const rows = baseQuery()
    .orderBy(...(trash ? [] : [asc(sql`${libraryBookVersions.pinnedAt} IS NULL`)]), orderBy)
    .limit(pageSize).offset(offset).all()
  const agg = db.select({ count: sql<number>`count(*)`, totalSize: sql<number>`coalesce(sum(${bookVersions.size}), 0)` })
    .from(libraryBookVersions)
    .innerJoin(libraryBooks, eq(libraryBookVersions.libraryBookId, libraryBooks.id))
    .innerJoin(bookVersions, eq(libraryBookVersions.bookVersionId, bookVersions.id))
    .leftJoin(bookStates, and(eq(bookStates.bookVersionId, bookVersions.id), eq(bookStates.userId, userId)))
    .leftJoin(libraryCategories, eq(libraryBooks.categoryId, libraryCategories.id))
    .where(where).get()
  // Tag names are fetched per page in a second query: joining tags into
  // the paginated query would multiply rows per book and break LIMIT/OFFSET.
  const tagRows = rows.length > 0
    ? db.select({ libraryBookId: libraryBookTags.libraryBookId, name: libraryTags.name })
      .from(libraryBookTags)
      .innerJoin(libraryTags, eq(libraryBookTags.tagId, libraryTags.id))
      .where(inArray(libraryBookTags.libraryBookId, rows.map((b) => b.libraryBookId)))
      .all()
    : []
  const tagsByBook = new Map<string, string[]>()
  for (const row of tagRows) {
    const list = tagsByBook.get(row.libraryBookId) ?? []
    list.push(row.name)
    tagsByBook.set(row.libraryBookId, list)
  }
  const data = rows.map(({ libraryBookId: _libraryBookId, ...b }) => ({ ...b, tags: tagsByBook.get(_libraryBookId) ?? [] }))
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

export function coverThumbnailKey(coverKey: string): string {
  return coverKey.replace(/\.cover\.[^.]+$/, '.thumb.webp')
}

export async function generateCoverThumbnail(buffer: Buffer, ext?: string | null): Promise<Buffer | null> {
  const actualExt = ext || detectImageExtension(buffer)
  if (actualExt === 'svg') return buffer
  try {
    return await sharp(buffer)
      .resize({ width: 480, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()
  } catch (err) {
    log('warn', 'cover_thumbnail_failed', { error: err })
    return null
  }
}

export async function bufferFromStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/** Dedup across uploads: the personal version in this library whose CURRENT
 * content matches the candidate blob. Old revisions with the same bytes do
 * not count (content moved on). */
function findPersonalVersionByBlob(libraryId: string, blobKey: string): { versionId: string; libraryBookId: string } | null {
  const db = getDb()
  const candidates = db.select({
    versionId: libraryBookVersions.bookVersionId,
    libraryBookId: libraryBookVersions.libraryBookId,
  }).from(libraryBookVersions)
    .innerJoin(contentRevisions, eq(contentRevisions.bookVersionId, libraryBookVersions.bookVersionId))
    .where(and(
      eq(libraryBookVersions.libraryId, libraryId),
      eq(libraryBookVersions.kind, 'personal'),
      eq(contentRevisions.blobKey, blobKey),
    )).all()
  for (const candidate of candidates) {
    const latest = db.select({ blobKey: contentRevisions.blobKey }).from(contentRevisions)
      .where(eq(contentRevisions.bookVersionId, candidate.versionId))
      .orderBy(desc(contentRevisions.revisionNo)).all().at(0)
    if (latest?.blobKey === blobKey) return candidate
  }
  return null
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
  const db = getDb()
  const library = { id: ensurePrivateLibrary(db, userId) }
  const tagIds = [...new Set(membership?.tagIds ?? [])]
  if (membership?.shelfId) {
    const category = db.select({ id: libraryCategories.id }).from(libraryCategories)
      .where(and(eq(libraryCategories.id, membership.shelfId), eq(libraryCategories.libraryId, library.id))).get()
    if (!category) throw new AppError('SHELF_NOT_FOUND')
  }
  if (tagIds.length > 0) {
    const existingTags = db.select({ count: sql<number>`count(*)` }).from(libraryTags)
      .where(and(eq(libraryTags.libraryId, library.id), inArray(libraryTags.id, tagIds))).get()
    if ((existingTags?.count ?? 0) !== tagIds.length) throw new AppError('TAG_NOT_FOUND')
  }

  const contentHash = sha256(buffer)
  const fileKey = blobKey(contentHash, '.epub')
  const versionId = createId('book')
  const duplicate = findPersonalVersionByBlob(library.id, fileKey)
  if (duplicate) {
    // Tags are additive and side-effect-free, so honor the requested assignment
    // even for a duplicate. The category is deliberately not touched: it is a
    // single-value column and moving an already-shelved book silently would
    // be destructive - the UI surfaces the mismatch instead.
    if (tagIds.length > 0) {
      db.insert(libraryBookTags)
        .values(tagIds.map((tagId) => ({ libraryBookId: duplicate.libraryBookId, tagId })))
        .onConflictDoNothing()
        .run()
    }
    return { book: stripMetaChapters(await resolvePrivateBook(userId, duplicate.versionId, { allowDeleted: true })), duplicated: true }
  }

  let title = parsed.meta.title
  let author = parsed.meta.author ?? ''
  const derived = opts?.normalizeTitle ? normalizeBookTitle(fileName) : undefined
  if (!title) {
    title = derived?.title || fileName.replace(/\.[^.]+$/, '')
  }
  // File names of web-novels often carry the author where metadata has none.
  if (!author && derived?.author) author = derived.author

  let coverKey: string | null = null
  if (parsed.meta.cover) {
    const ext = detectImageExtension(parsed.meta.cover) || 'jpg'
    coverKey = blobKey(contentHash, `.cover.${ext}`)
    await storage.put(coverKey, parsed.meta.cover)
    const thumb = await generateCoverThumbnail(parsed.meta.cover, ext)
    if (thumb) {
      await storage.put(coverThumbnailKey(coverKey), thumb)
    }
  }

  const meta: Record<string, unknown> = {}
  // Persist bookmeta for every upload so book reads never need a metadata pass.
  meta.bookmeta = parsed.meta.bookmeta ?? {}
  // Keep the upload's file name for provenance: content is stored under a
  // content-hash key and the title may later be edited away from it.
  meta.fileName = fileName
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
      { title, author: author || undefined, id: versionId },
      epubChapters,
      contentFor,
    )
    await storage.put(fileKey, epubBuffer)
    size = epubBuffer.length
  } else {
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

  const now = Date.now()
  const libraryBookId = createId('lb')
  const description = typeof parsed.meta.bookmeta?.description === 'string' ? parsed.meta.bookmeta.description : ''
  const metaChapters = meta.chapters as Array<{ wordCount?: number }> | undefined
  if (metaChapters && metaChapters.length > 0) {
    meta.wordCount = metaChapters.reduce((sum, c) => sum + (c.wordCount ?? 0), 0)
  }
  const chapterCount = metaChapters?.length ?? 0
  db.transaction((tx) => {
    tx.insert(bookVersions).values({
      id: versionId, format: format as BookFormat, size, createdAt: now, updatedAt: now,
    }).run()
    tx.insert(contentRevisions).values({
      id: createId('rev'), bookVersionId: versionId, revisionNo: 1, blobKey: fileKey,
      size, wordCount: typeof meta.wordCount === 'number' ? meta.wordCount : null,
      chapterCount, meta, createdAt: now,
    }).run()
    tx.insert(blobs).values({ key: fileKey, size, kind: 'book', createdAt: now }).onConflictDoNothing().run()
    if (coverKey && parsed.meta.cover) {
      tx.insert(blobs).values({ key: coverKey, size: parsed.meta.cover.length, kind: 'cover', createdAt: now }).onConflictDoNothing().run()
    }
    tx.insert(libraryBooks).values({
      id: libraryBookId, libraryId: library.id, userId, categoryId: membership?.shelfId ?? null,
      title, author, description, coverKey, createdAt: now, updatedAt: now,
    }).run()
    tx.insert(libraryBookVersions).values({
      id: createId('lbv'), libraryId: library.id, libraryBookId, bookVersionId: versionId,
      kind: 'personal', createdAt: now, updatedAt: now,
    }).run()
    tx.insert(bookStates).values({
      userId, bookVersionId: versionId, readStatus: 'reading', percent: 0,
      cfi: null, chapter: null, lastReadAt: null, updatedAt: now,
    }).run()
    if (tagIds.length > 0) {
      tx.insert(libraryBookTags).values(tagIds.map((tagId) => ({ libraryBookId, tagId }))).run()
    }
    if (membership?.shelfId) {
      tx.update(libraryCategories).set({ updatedAt: now }).where(eq(libraryCategories.id, membership.shelfId)).run()
    }
  })
  return { book: stripMetaChapters(await resolvePrivateBook(userId, versionId, { allowDeleted: true })), duplicated: false }
}

export async function getBook(userId: string, bookId: string) {
  return resolvePrivateBook(userId, bookId, { allowDeleted: true })
}

export async function getActiveBook(userId: string, bookId: string) {
  return resolvePrivateBook(userId, bookId, { allowDeleted: false })
}

/**
 * Phase 3 read core: the private book as the legacy books row shape, assembled
 * from library/version/revision/state rows. bookId IS the version id (0.3), so
 * every existing caller keeps working: routes, Legado, AI, exports and tests
 * see the same fields. Content truth comes from the latest revision; the
 * frozen legacy books row only backs meta for not-yet-backfilled rows.
 */
export async function resolvePrivateBook(userId: string, bookId: string, opts?: { allowDeleted?: boolean }) {
  const db = getDb()
  const library = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (!library) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  const lbv = db.select().from(libraryBookVersions)
    .where(and(eq(libraryBookVersions.libraryId, library.id), eq(libraryBookVersions.bookVersionId, bookId))).get()
  if (!lbv) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  const lb = db.select().from(libraryBooks).where(eq(libraryBooks.id, lbv.libraryBookId)).get()
  if (!lb) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  if (lb.deletedAt && !opts?.allowDeleted) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  const bv = db.select().from(bookVersions).where(eq(bookVersions.id, bookId)).get()
  if (!bv) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  const revision = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  if (!revision) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  const state = db.select().from(bookStates)
    .where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()
  const legacy = db.select().from(books).where(eq(books.id, bookId)).get()
  const revisionMeta = (revision.meta ?? {}) as Record<string, unknown>
  const meta = Object.keys(revisionMeta).length > 0 ? revisionMeta : ((legacy?.meta ?? {}) as Record<string, unknown>)
  return {
    id: bookId,
    userId,
    title: lbv.title ?? lb.title,
    author: lbv.author ?? lb.author,
    format: bv.format,
    filePath: revision.blobKey,
    coverKey: lbv.coverKey ?? lb.coverKey,
    contentHash: hashFromBlobKey(revision.blobKey),
    size: bv.size,
    meta,
    createdAt: lb.createdAt,
    updatedAt: lb.updatedAt,
    readStatus: state?.readStatus ?? 'reading',
    progress: state?.percent ?? 0,
    pinnedAt: lbv.pinnedAt ?? null,
    lastReadAt: state?.lastReadAt ?? null,
    deletedAt: lb.deletedAt ?? null,
    shelfId: lb.categoryId,
  }
}

/** Content-hash namespace keys embed the hash; anything else yields null. */
function hashFromBlobKey(key: string): string | null {
  const match = /^blobs\/[0-9a-f]{2}\/([0-9a-f]{64})\.epub$/.exec(key)
  return match ? match[1]! : null
}

export function getBookMembership(userId: string, bookId: string, shelfId: string | null) {
  const db = getDb()
  const library = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  const shelfName = shelfId && library
    ? db.select({ name: libraryCategories.name })
      .from(libraryCategories)
      .where(and(eq(libraryCategories.id, shelfId), eq(libraryCategories.libraryId, library.id)))
      .get()?.name ?? null
    : null
  const tagRows = library
    ? db.select({ name: libraryTags.name })
      .from(libraryBookTags)
      .innerJoin(libraryBookVersions, eq(libraryBookTags.libraryBookId, libraryBookVersions.libraryBookId))
      .innerJoin(libraryTags, eq(libraryBookTags.tagId, libraryTags.id))
      .where(and(eq(libraryBookVersions.bookVersionId, bookId), eq(libraryBookVersions.libraryId, library.id)))
      .orderBy(asc(libraryTags.sortOrder), asc(libraryTags.name))
      .all()
    : []
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
    // Derived chapter cache lives on the latest revision now; the frozen
    // legacy books row is read-only and keeps serving only pre-backfill rows.
    const latestRevision = getDb().select({ id: contentRevisions.id }).from(contentRevisions)
      .where(eq(contentRevisions.bookVersionId, book.id)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
    if (latestRevision) {
      getDb().update(contentRevisions).set({ meta }).where(eq(contentRevisions.id, latestRevision.id)).run()
    }
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

  // New content lands as a new revision; the old revision (and its file)
  // stays readable until the pointer moves and the ref-check passes.
  const oldFilePath = book.filePath
  const updatedAt = Date.now()
  const maxRevision = db.select({ revisionNo: contentRevisions.revisionNo }).from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  const nextRevisionNo = (maxRevision?.revisionNo ?? 0) + 1
  const { libraryBookId } = resolveLibraryBook(userId, bookId)
  db.transaction((tx) => {
    tx.insert(contentRevisions).values({
      id: createId('rev'), bookVersionId: bookId, revisionNo: nextRevisionNo,
      blobKey: filePath, size: epubBuffer.length, wordCount: prepared.newWordCount,
      chapterCount: prepared.metaChapters.length, meta, createdAt: updatedAt,
    }).run()
    tx.insert(blobs).values({ key: filePath, size: epubBuffer.length, kind: 'book', createdAt: updatedAt }).onConflictDoNothing().run()
    tx.update(bookVersions).set({ size: epubBuffer.length, updatedAt }).where(eq(bookVersions.id, bookId)).run()
    tx.update(libraryBooks).set({ updatedAt }).where(eq(libraryBooks.id, libraryBookId)).run()
    tx.update(bookStates).set({ percent: newPercent, updatedAt }).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).run()
  })
  invalidateCachedNormalized(bookId)

  if (oldFilePath !== filePath) {
    const refs = db.select({ count: sql<number>`count(*)` }).from(contentRevisions).where(eq(contentRevisions.blobKey, oldFilePath)).get()
    if ((refs?.count ?? 0) === 0 && await storage.exists(oldFilePath)) {
      await storage.delete(oldFilePath)
      db.delete(blobs).where(eq(blobs.key, oldFilePath)).run()
    }
  }

  return stripMetaChapters(await resolvePrivateBook(userId, bookId, { allowDeleted: true }))
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
  const newFileKey = blobKey(sha256(epubBuffer), '.epub')
  const updatedAt = Date.now()
  if (newFileKey !== book.filePath) {
    // Content changed: the new bytes land as a new revision under their own
    // key. The old revision stays intact; its file is collected only when no
    // remaining revision references it.
    await storage.put(newFileKey, epubBuffer)
    const maxRevision = db.select({ revisionNo: contentRevisions.revisionNo }).from(contentRevisions)
      .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
    db.transaction((tx) => {
      tx.insert(contentRevisions).values({
        id: createId('rev'), bookVersionId: bookId, revisionNo: (maxRevision?.revisionNo ?? 0) + 1,
        blobKey: newFileKey, size: epubBuffer.length, wordCount, chapterCount: metaChapters.length,
        meta, createdAt: updatedAt,
      }).run()
      tx.insert(blobs).values({ key: newFileKey, size: epubBuffer.length, kind: 'book', createdAt: updatedAt }).onConflictDoNothing().run()
      tx.update(bookVersions).set({ size: epubBuffer.length, updatedAt }).where(eq(bookVersions.id, bookId)).run()
    })
    const refs = db.select({ count: sql<number>`count(*)` }).from(contentRevisions).where(eq(contentRevisions.blobKey, book.filePath)).get()
    if ((refs?.count ?? 0) === 0 && await storage.exists(book.filePath)) {
      await storage.delete(book.filePath)
      db.delete(blobs).where(eq(blobs.key, book.filePath)).run()
    }
  } else {
    const latestRevision = db.select({ id: contentRevisions.id }).from(contentRevisions)
      .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
    if (latestRevision) {
      db.update(contentRevisions).set({ meta }).where(eq(contentRevisions.id, latestRevision.id)).run()
    }
  }

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

  db.update(libraryBooks).set({ updatedAt }).where(eq(libraryBooks.id, resolveLibraryBook(userId, bookId).libraryBookId)).run()
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
  const { libraryBookId, libraryBookVersionId } = resolveLibraryBook(userId, bookId)
  const now = Date.now()
  if (data.readStatus !== undefined || data.progress !== undefined) {
    const state = db.select().from(bookStates)
      .where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()
    if (state) {
      db.update(bookStates).set({
        ...(data.readStatus !== undefined ? { readStatus: data.readStatus as typeof state.readStatus } : {}),
        ...(data.progress !== undefined ? { percent: data.progress } : {}),
        updatedAt: now,
      }).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).run()
    } else {
      db.insert(bookStates).values({
        userId, bookVersionId: bookId,
        readStatus: (data.readStatus as typeof bookStates.$inferInsert.readStatus | undefined) ?? 'reading',
        percent: data.progress ?? 0, cfi: null, chapter: null, lastReadAt: null, updatedAt: now,
      }).run()
    }
  }
  if (data.pinned !== undefined) {
    db.update(libraryBookVersions).set({ pinnedAt: data.pinned ? now : null }).where(eq(libraryBookVersions.id, libraryBookVersionId)).run()
  }
  if (data.title || data.author !== undefined) {
    db.update(libraryBooks).set({
      ...(data.title ? { title: data.title } : {}),
      ...(data.author !== undefined ? { author: data.author } : {}),
      updatedAt: now,
    }).where(eq(libraryBooks.id, libraryBookId)).run()
  }
  const latestRevision = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  const baseMeta = ((latestRevision?.meta ?? {}) as Record<string, unknown>)
  let touchedMeta = false
  if (data.bookmeta !== undefined) {
    baseMeta.bookmeta = data.bookmeta
    touchedMeta = true
  }
  if (data.viewSettings !== undefined) {
    // Diff semantics: shallow-merge into the existing per-book overrides;
    // null removes the whole override so the book falls back to global.
    if (data.viewSettings === null) {
      delete baseMeta.viewSettings
    } else {
      baseMeta.viewSettings = { ...((baseMeta.viewSettings as ViewSettings | undefined) ?? {}), ...data.viewSettings }
    }
    touchedMeta = true
  }
  if (data.boundPresetId !== undefined) {
    // Binding semantics mirror viewSettings: null removes the key so the book
    // falls back to the device resolution chain.
    if (data.boundPresetId === null) {
      delete baseMeta.boundPresetId
    } else {
      baseMeta.boundPresetId = data.boundPresetId
    }
    touchedMeta = true
  }
  if (data.tocRuleId !== undefined) {
    // Pin semantics: null removes the pin (book falls back to auto-scoring on
    // the next re-toc). A non-null id is validated against the user's rules.
    if (data.tocRuleId === null) {
      delete baseMeta.tocRuleId
      delete baseMeta.tocRuleAuto
    } else {
      const rule = db.select().from(tocRules).where(and(eq(tocRules.id, data.tocRuleId), eq(tocRules.userId, userId))).get()
      if (!rule) throw new AppError('TOC_RULE_NOT_FOUND')
      baseMeta.tocRuleId = data.tocRuleId
      baseMeta.tocRuleAuto = false
    }
    touchedMeta = true
  }
  if (data.coverPaletteId !== undefined) {
    // Decorative pin: null removes the key so the cover falls back to the id hash.
    if (data.coverPaletteId === null) {
      delete baseMeta.coverPaletteId
    } else {
      baseMeta.coverPaletteId = data.coverPaletteId
    }
    touchedMeta = true
  }
  if (touchedMeta && latestRevision) {
    db.update(contentRevisions).set({ meta: baseMeta }).where(eq(contentRevisions.id, latestRevision.id)).run()
  }
  if (data.title || data.author !== undefined || touchedMeta || data.pinned !== undefined || data.readStatus !== undefined || data.progress !== undefined) {
    db.update(libraryBooks).set({ updatedAt: now }).where(eq(libraryBooks.id, libraryBookId)).run()
  }
  return stripMetaChapters(await resolvePrivateBook(userId, bookId, { allowDeleted: true }))
}

export async function updateBookCover(userId: string, bookId: string, file: File) {
  const db = getDb()
  const { libraryBookId } = resolveLibraryBook(userId, bookId)
  const buffer = Buffer.from(await file.arrayBuffer())
  if (buffer.length > 5 * 1024 * 1024) throw new AppError('UPLOAD_TOO_LARGE')
  const ext = detectImageExtension(buffer)
  if (!ext) throw new AppError('UNSUPPORTED_FORMAT', 'Cover must be a PNG, JPEG, GIF, SVG or WebP image')
  const storage = getStorage()
  const coverKey = blobKey(sha256(buffer), `.cover.${ext}`)
  await storage.put(coverKey, buffer)
  const thumb = await generateCoverThumbnail(buffer, ext)
  if (thumb) {
    await storage.put(coverThumbnailKey(coverKey), thumb)
  }
  const now = Date.now()
  db.insert(blobs).values({ key: coverKey, size: buffer.length, kind: 'cover', createdAt: now }).onConflictDoNothing().run()
  db.update(libraryBooks).set({ coverKey, updatedAt: now }).where(eq(libraryBooks.id, libraryBookId)).run()
  const latestRevision = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  if (latestRevision) {
    const meta = { ...((latestRevision.meta ?? {}) as Record<string, unknown>) }
    delete meta.coverSuppressed
    db.update(contentRevisions).set({ meta }).where(eq(contentRevisions.id, latestRevision.id)).run()
  }
  return stripMetaChapters(await resolvePrivateBook(userId, bookId, { allowDeleted: true }))
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
    const thumb = await generateCoverThumbnail(parsed.meta.cover, ext)
    if (thumb) {
      await storage.put(coverThumbnailKey(coverKey), thumb)
    }
    const now = Date.now()
    db.insert(blobs).values({ key: coverKey, size: parsed.meta.cover.length, kind: 'cover', createdAt: now }).onConflictDoNothing().run()
    const { libraryBookId } = resolveLibraryBook(userId, book.id)
    db.update(libraryBooks).set({ coverKey, updatedAt: now }).where(eq(libraryBooks.id, libraryBookId)).run()
    return { coverKey }
  } catch {
    return null
  }
}

export async function getBookCoverContent(
  userId: string,
  bookId: string,
  opts?: { size?: 'original' | 'thumb' },
): Promise<{ data: Buffer; contentType: string; ext: string } | null> {
  const cover = await getBookCover(userId, bookId)
  if (!cover) return null
  const storage = getStorage()
  if (!(await storage.exists(cover.coverKey))) return null

  const size = opts?.size ?? 'thumb'
  const ext = cover.coverKey.split('.').pop()?.toLowerCase() || 'jpg'

  if (size === 'original' || ext === 'svg') {
    const data = await bufferFromStream(await storage.get(cover.coverKey))
    const contentType = ext === 'png'
      ? 'image/png'
      : ext === 'webp'
        ? 'image/webp'
        : ext === 'gif'
          ? 'image/gif'
          : ext === 'svg'
            ? 'image/svg+xml'
            : 'image/jpeg'
    return { data, contentType, ext }
  }

  const thumbKey = coverThumbnailKey(cover.coverKey)
  if (await storage.exists(thumbKey)) {
    const data = await bufferFromStream(await storage.get(thumbKey))
    return { data, contentType: 'image/webp', ext: 'webp' }
  }

  const original = await bufferFromStream(await storage.get(cover.coverKey))
  const thumb = await generateCoverThumbnail(original, ext)
  if (thumb) {
    await storage.put(thumbKey, thumb)
    return { data: thumb, contentType: 'image/webp', ext: 'webp' }
  }

  const contentType = ext === 'png'
    ? 'image/png'
    : ext === 'webp'
      ? 'image/webp'
      : ext === 'gif'
        ? 'image/gif'
        : 'image/jpeg'
  return { data: original, contentType, ext }
}

export async function removeBookCover(userId: string, bookId: string) {
  const db = getDb()
  const { libraryBookId } = resolveLibraryBook(userId, bookId)
  const now = Date.now()
  db.update(libraryBooks).set({ coverKey: null, updatedAt: now }).where(eq(libraryBooks.id, libraryBookId)).run()
  const latestRevision = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  if (latestRevision) {
    const meta = { ...((latestRevision.meta ?? {}) as Record<string, unknown>), coverSuppressed: true }
    db.update(contentRevisions).set({ meta }).where(eq(contentRevisions.id, latestRevision.id)).run()
  }
  return stripMetaChapters(await resolvePrivateBook(userId, bookId, { allowDeleted: true }))
}

export async function resetBookMetadata(userId: string, bookId: string, opts?: { normalizeTitle?: boolean }) {
  const db = getDb()
  const { libraryBookId } = resolveLibraryBook(userId, bookId)
  const book = await getBook(userId, bookId)
  const storage = getStorage()
  const parser = getParser(book.filePath, '')
  if (!parser) throw new AppError('UNSUPPORTED_FORMAT')
  const parsed = await parser.parse(await storage.get(book.filePath))
  const latestRevision = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  if (latestRevision) {
    const meta = { ...((latestRevision.meta ?? {}) as Record<string, unknown>), bookmeta: parsed.meta.bookmeta ?? {} }
    db.update(contentRevisions).set({ meta }).where(eq(contentRevisions.id, latestRevision.id)).run()
  }
  let title = parsed.meta.title
  let author = parsed.meta.author ?? ''
  const originalFileName = (book.meta as Record<string, unknown>).fileName
  const derived = opts?.normalizeTitle && typeof originalFileName === 'string'
    ? normalizeBookTitle(originalFileName)
    : undefined
  if (!title && derived?.title) {
    title = derived.title
  }
  if (!author && derived?.author) {
    author = derived.author
  }
  const now = Date.now()
  db.update(libraryBooks).set({
    title: title || book.title,
    author,
    updatedAt: now,
  }).where(eq(libraryBooks.id, libraryBookId)).run()
  return stripMetaChapters(await resolvePrivateBook(userId, bookId, { allowDeleted: true }))
}

export async function trashBook(userId: string, bookId: string) {
  const db = getDb()
  const { libraryBookId } = resolveLibraryBook(userId, bookId)
  const now = Date.now()
  db.update(libraryBooks).set({ deletedAt: now, updatedAt: now }).where(eq(libraryBooks.id, libraryBookId)).run()
}

export async function restoreBook(userId: string, bookId: string) {
  const db = getDb()
  const { libraryBookId } = resolveLibraryBook(userId, bookId)
  const now = Date.now()
  db.update(libraryBooks).set({ deletedAt: null, updatedAt: now }).where(eq(libraryBooks.id, libraryBookId)).run()
}

export async function emptyTrash(userId: string) {
  const db = getDb()
  const trashed = db.select({ id: libraryBooks.id }).from(libraryBooks)
    .where(and(eq(libraryBooks.userId, userId), isNotNull(libraryBooks.deletedAt))).all()
  for (const row of trashed) {
    const version = db.select({ bookVersionId: libraryBookVersions.bookVersionId }).from(libraryBookVersions)
      .where(eq(libraryBookVersions.libraryBookId, row.id)).all().at(0)
    if (version) await deleteBook(userId, version.bookVersionId)
  }
  return trashed.length
}

/** Purge trash rows whose deletedAt is older than `days`; 0 or negative disables auto-clean */
export async function purgeExpiredTrash(userId: string, days: number) {
  if (days <= 0) return 0
  const db = getDb()
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const expired = db.select({ id: libraryBooks.id }).from(libraryBooks)
    .where(and(eq(libraryBooks.userId, userId), isNotNull(libraryBooks.deletedAt), lt(libraryBooks.deletedAt, cutoff)))
    .all()
  for (const row of expired) {
    const version = db.select({ bookVersionId: libraryBookVersions.bookVersionId }).from(libraryBookVersions)
      .where(eq(libraryBookVersions.libraryBookId, row.id)).all().at(0)
    if (version) await deleteBook(userId, version.bookVersionId)
  }
  return expired.length
}

/** Evict trash oldest-deleted-first until the user's trash total is at or
 * under `maxBytes`; stops as soon as the cap is back, so rows under the cap
 * keep their full time-based grace period. `maxBytes` <= 0 disables. */
export async function purgeTrashToCapacity(userId: string, maxBytes: number) {
  if (maxBytes <= 0) return 0
  const db = getDb()
  const ownedTrash = and(eq(libraryBooks.userId, userId), isNotNull(libraryBooks.deletedAt))
  const agg = db.select({ total: sql<number>`coalesce(sum(${bookVersions.size}), 0)` })
    .from(libraryBooks)
    .innerJoin(libraryBookVersions, eq(libraryBookVersions.libraryBookId, libraryBooks.id))
    .innerJoin(bookVersions, eq(libraryBookVersions.bookVersionId, bookVersions.id))
    .where(ownedTrash).get()
  let total = agg?.total ?? 0
  if (total <= maxBytes) return 0
  const rows = db.select({ bookVersionId: libraryBookVersions.bookVersionId, size: bookVersions.size })
    .from(libraryBooks)
    .innerJoin(libraryBookVersions, eq(libraryBookVersions.libraryBookId, libraryBooks.id))
    .innerJoin(bookVersions, eq(libraryBookVersions.bookVersionId, bookVersions.id))
    .where(ownedTrash).orderBy(asc(libraryBooks.deletedAt)).all()
  let purged = 0
  for (const row of rows) {
    if (total <= maxBytes) break
    await deleteBook(userId, row.bookVersionId)
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
    const expired = db.select({ id: libraryBooks.id, userId: libraryBooks.userId }).from(libraryBooks)
      .where(and(inArray(libraryBooks.userId, userIds), isNotNull(libraryBooks.deletedAt), lt(libraryBooks.deletedAt, cutoff)))
      .all()
    for (let i = 0; i < expired.length; i++) {
      const version = db.select({ bookVersionId: libraryBookVersions.bookVersionId }).from(libraryBookVersions)
        .where(eq(libraryBookVersions.libraryBookId, expired[i].id)).all().at(0)
      if (version) await deleteBook(expired[i].userId, version.bookVersionId)
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
  const book = await resolvePrivateBook(userId, bookId, { allowDeleted: true })
  const { libraryBookId } = resolveLibraryBook(userId, bookId)

  // Legacy rows mirror the old delete path; the tables themselves freeze.
  db.delete(annotations).where(eq(annotations.bookId, bookId)).run()
  db.delete(bookTags).where(eq(bookTags.bookId, bookId)).run()

  const versionIds = db.select({ id: libraryBookVersions.bookVersionId }).from(libraryBookVersions)
    .where(eq(libraryBookVersions.libraryBookId, libraryBookId)).all().map((row) => row.id)
  const revisionKeys = versionIds.length > 0
    ? db.select({ blobKey: contentRevisions.blobKey }).from(contentRevisions)
      .where(inArray(contentRevisions.bookVersionId, versionIds)).all().map((row) => row.blobKey)
    : []
  const coverKeys = new Set(
    db.select({ coverKey: libraryBooks.coverKey }).from(libraryBooks).where(eq(libraryBooks.id, libraryBookId)).all()
      .map((row) => row.coverKey)
      .concat(
        db.select({ coverKey: libraryBookVersions.coverKey }).from(libraryBookVersions)
          .where(eq(libraryBookVersions.libraryBookId, libraryBookId)).all().map((row) => row.coverKey),
      ).filter((key): key is string => key !== null),
  )

  db.delete(libraryBookTags).where(eq(libraryBookTags.libraryBookId, libraryBookId)).run()
  db.delete(libraryBookVersions).where(eq(libraryBookVersions.libraryBookId, libraryBookId)).run()
  db.delete(libraryBooks).where(eq(libraryBooks.id, libraryBookId)).run()
  for (const versionId of versionIds) {
    // Restrict fires while other libraries reference the version; private
    // single-version deletes always clear their own references first.
    // Reading states, highlights, records and AI rows follow via cascade.
    db.delete(bookVersions).where(eq(bookVersions.id, versionId)).run()
  }

  // Content blobs are shared across versions; delete the physical file only
  // when no remaining revision references the key.
  for (const key of new Set(revisionKeys)) {
    const refs = db.select({ count: sql<number>`count(*)` }).from(contentRevisions)
      .where(eq(contentRevisions.blobKey, key)).get()
    if ((refs?.count ?? 0) === 0) {
      if (await storage.exists(key)) await storage.delete(key)
      db.delete(blobs).where(eq(blobs.key, key)).run()
    }
  }
  // Progress file
  const progressKey = `progress/${bookId}.json`
  if (await storage.exists(progressKey)) {
    await storage.delete(progressKey)
  }
  for (const coverKey of coverKeys) {
    const coverRefs = db.select({ count: sql<number>`count(*)` }).from(libraryBooks)
      .where(eq(libraryBooks.coverKey, coverKey)).get()
    const versionCoverRefs = db.select({ count: sql<number>`count(*)` }).from(libraryBookVersions)
      .where(eq(libraryBookVersions.coverKey, coverKey)).get()
    if ((coverRefs?.count ?? 0) === 0 && (versionCoverRefs?.count ?? 0) === 0) {
      if (await storage.exists(coverKey)) await storage.delete(coverKey)
      const thumbKey = coverThumbnailKey(coverKey)
      if (await storage.exists(thumbKey)) {
        await storage.delete(thumbKey)
      }
      db.delete(blobs).where(eq(blobs.key, coverKey)).run()
    }
  }
  return book
}

function resolveLibraryBook(userId: string, bookId: string): { libraryId: string; libraryBookId: string; libraryBookVersionId: string } {
  const db = getDb()
  const library = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (!library) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  const lbv = db.select({ libraryBookId: libraryBookVersions.libraryBookId, id: libraryBookVersions.id }).from(libraryBookVersions)
    .where(and(eq(libraryBookVersions.libraryId, library.id), eq(libraryBookVersions.bookVersionId, bookId))).get()
  if (!lbv) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  return { libraryId: library.id, libraryBookId: lbv.libraryBookId, libraryBookVersionId: lbv.id }
}

export async function setBookShelf(userId: string, bookId: string, shelfId: string | null) {
  const db = getDb()
  const { libraryId, libraryBookId } = resolveLibraryBook(userId, bookId)
  const now = Date.now()
  if (shelfId !== null) {
    const category = db.select({ id: libraryCategories.id }).from(libraryCategories)
      .where(and(eq(libraryCategories.id, shelfId), eq(libraryCategories.libraryId, libraryId))).get()
    if (!category) throw new AppError('SHELF_NOT_FOUND')
  }
  const previous = db.select({ categoryId: libraryBooks.categoryId }).from(libraryBooks).where(eq(libraryBooks.id, libraryBookId)).get()
  db.update(libraryBooks).set({ categoryId: shelfId, updatedAt: now }).where(eq(libraryBooks.id, libraryBookId)).run()
  // Membership-change time, mirroring the legacy trigger semantics.
  for (const touched of new Set([previous?.categoryId, shelfId])) {
    if (touched) db.update(libraryCategories).set({ updatedAt: now }).where(eq(libraryCategories.id, touched)).run()
  }
}

export async function getBookShelf(userId: string, bookId: string) {
  const db = getDb()
  const { libraryBookId } = resolveLibraryBook(userId, bookId)
  return db.select({ categoryId: libraryBooks.categoryId }).from(libraryBooks).where(eq(libraryBooks.id, libraryBookId)).get()?.categoryId ?? null
}

export async function setBookTags(userId: string, bookId: string, tagIds: string[]) {
  const db = getDb()
  const { libraryId, libraryBookId } = resolveLibraryBook(userId, bookId)
  const uniqueTagIds = [...new Set(tagIds)]
  if (uniqueTagIds.length > 0) {
    const existing = db
      .select({ count: sql<number>`count(*)` })
      .from(libraryTags)
      .where(and(eq(libraryTags.libraryId, libraryId), inArray(libraryTags.id, uniqueTagIds)))
      .get()
    if ((existing?.count ?? 0) !== uniqueTagIds.length) {
      throw new AppError('TAG_NOT_FOUND')
    }
  }
  const previous = db.select({ tagId: libraryBookTags.tagId }).from(libraryBookTags).where(eq(libraryBookTags.libraryBookId, libraryBookId)).all()
    .map((row) => row.tagId)
  db.delete(libraryBookTags).where(eq(libraryBookTags.libraryBookId, libraryBookId)).run()
  if (uniqueTagIds.length > 0) {
    db.insert(libraryBookTags).values(uniqueTagIds.map((tagId) => ({ libraryBookId, tagId }))).onConflictDoNothing().run()
  }
  const now = Date.now()
  for (const touched of new Set([...previous, ...uniqueTagIds])) {
    db.update(libraryTags).set({ updatedAt: now }).where(eq(libraryTags.id, touched)).run()
  }
}

export async function getBookTags(userId: string, bookId: string) {
  const db = getDb()
  const { libraryBookId } = resolveLibraryBook(userId, bookId)
  const rows = db
    .select({ tagId: libraryBookTags.tagId })
    .from(libraryBookTags)
    .where(eq(libraryBookTags.libraryBookId, libraryBookId))
    .all()
  return rows.map((r) => r.tagId)
}
