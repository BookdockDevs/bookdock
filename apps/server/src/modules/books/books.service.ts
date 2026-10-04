import type { Readable } from 'node:stream'

import { eq, lt, desc, asc, and, or, sql, inArray, isNull, isNotNull, type SQL } from 'drizzle-orm'
import JSZip from 'jszip'
import { getDb } from '../../db/client'
import { blobKeyReferenced, deleteBlobRowIfUnreferenced } from '../../db/blob-refs'
import {
  blobs, bookVersions, bookStates, contentRevisions, libraries, libraryBooks,
  libraryBookTags, libraryBookVersions, libraryCategories, libraryTags, settings,
  libraryMemberships, users as usersTable, tocRules,
  highlights, ideas, bookmarks, aiThreads, textReplacements,
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
import { assertCanContribute, assertLibraryBrowsable, assertMutableContent, ensurePrivateLibrary, getOwnsSourceVersionIds, isLibraryManager, sourceStillReadable, sourceStillReadableSync } from '../libraries/library-access'
import { assertUserUploadAllowed } from '../auth/auth.service'
import { libraryOrderBy, classifyWorkHidden, getWorkHiddenDetail, isWorkEffectivelyHidden, loadLibraryHiddenTaxonomy, workHiddenExclusion } from '../libraries/library-query'
import { resolveSharedVersionRead } from '../libraries/library-access'
import { convertTxtToEpub, TXT_EPUB_ARTIFACT_VERSION } from '../../lib/txt-to-epub'
import { sha256 } from '../../lib/hash'
import { normalizeBookTitle } from '../../lib/book-title'
import { countWords } from '../../lib/word-count'
import { deleteProgressFile, readProgressFile, writeProgressFile } from '../../lib/progress-file'
import { coverThumbnailKey, detectImageExtension, blobKey, generateCoverThumbnail } from '../../lib/cover'
import { log } from '../../lib/logger'
import { LibrarySearchError, normalizeAuthors, type AppendContentCandidate, type AppendContentPreviewRes, type BatchOrganizeReq, type BatchSelectionItem, type BookFormat, type BookMetadata, type CoverPaletteId, type Chapter, type HiddenReason, type LibraryVersionKind, type PublishedLinkInfo, type TocPreviewChapter, type TocPreviewRes, type TocRulePattern, type TrashSettings } from '@bookdock/shared'

import { compileSearchExpression } from '../libraries/search-expression'

import { getReaderBookSettings } from './reader-settings.service'
import { readTxtEpubCandidate, sameEpubArchive } from './txt-epub-correspondence'

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

export async function listBooks(userId: string, page: number, pageSize: number, search?: string, sortBy?: string, sortOrder?: string, shelfId?: string, tagId?: string, format?: BookFormat, readStatus?: string, trash?: boolean, author?: string, series?: string, showHidden?: boolean, expression?: string) {
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
  // Private vault: hidden works stay out of the list unless the owner reveals
  // them explicitly; trash rows are never hidden-filtered (Phase 3 owns trash).
  if (!showHidden && !trash) {
    conditions.push(workHiddenExclusion(loadLibraryHiddenTaxonomy(db, library.id)))
  }
  const searchBoundary = [...conditions]
  const textMatch = (search: string): SQL => {
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
    return sql`(
      ${effTitle} LIKE ${pattern} ESCAPE '!'
      OR ${effAuthor} LIKE ${pattern} ESCAPE '!'
      OR EXISTS (
        SELECT 1 FROM json_each(coalesce(${libraryBookVersions.authors}, ${libraryBooks.authors}, '[]'))
        WHERE value LIKE ${pattern} ESCAPE '!'
      )
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
    )`
  }
  if (search) conditions.push(textMatch(search))

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
    // A single author matches the first-author mirror or any list element,
    // so clicking one chip of a multi-author book finds the book.
    conditions.push(or(
      eq(effAuthor, author),
      sql`EXISTS (
        SELECT 1 FROM json_each(coalesce(${libraryBookVersions.authors}, ${libraryBooks.authors}, '[]'))
        WHERE value = ${author}
      )`,
    ) as SQL)
  }
  if (series) {
    conditions.push(sql`${revMeta('$.bookmeta.series')} = ${series}`)
  }
  if (expression) {
    conditions.push(compileSearchExpression(expression, library.id, false, (node) => {
      if (node.kind === 'text') return textMatch(node.value)
      if (node.field === 'tag') return sql`EXISTS (SELECT 1 FROM ${libraryBookTags} WHERE ${libraryBookTags.libraryBookId} = ${libraryBooks.id} AND ${libraryBookTags.tagId} = ${node.id})`
      if (node.field === 'shelf') return eq(libraryBooks.categoryId, node.id!)
      if (node.field === 'format') return eq(bookVersions.format, node.value as BookFormat)
      if (node.field === 'status') return eq(effReadStatus, node.value)
      const predicate = sql`(${effAuthor} = ${node.value} OR EXISTS (SELECT 1 FROM json_each(coalesce(${libraryBookVersions.authors}, ${libraryBooks.authors}, '[]')) WHERE value = ${node.value}))`
      const exists = db.select({ id: libraryBooks.id }).from(libraryBookVersions)
        .innerJoin(libraryBooks, eq(libraryBookVersions.libraryBookId, libraryBooks.id))
        .innerJoin(bookVersions, eq(libraryBookVersions.bookVersionId, bookVersions.id))
        .where(and(...searchBoundary, predicate)).limit(1).get()
      if (!exists) throw new LibrarySearchError(`author:${node.value} 名称不存在或不可访问`, node.start, node.end)
      return predicate
    }))
  }
  // Pin-first is universal (user decision 2026-08-12): pinned books lead in
  // every sort - including lastReadAt - and the pinned group itself follows
  // the chosen sort, not the pin time (reads first by last-read time, desc
  // puts NULL lastReadAt at the bottom, never-read books stay visible).
  // Shared with the shared-library catalog so both lists sort identically.
  const orderBy = libraryOrderBy(sortBy, sortOrder, {
    title: effTitle,
    author: effAuthor,
    size: bookVersions.size,
    createdAt: libraryBooks.createdAt,
    updatedAt: libraryBooks.updatedAt,
    progress: effProgress,
    lastReadAt: bookStates.lastReadAt,
    deletedAt: libraryBooks.deletedAt,
  })
  const offset = (page - 1) * pageSize
  const where = and(...conditions)
  const baseQuery = () => db.select({
    id: bookVersions.id,
    libraryBookId: libraryBooks.id,
    title: effTitle,
    author: effAuthor,
    // Effective author list for display chips; resolved in JS to keep the
    // JSON-column typing (a SQL coalesce would return the raw JSON string).
    versionAuthors: libraryBookVersions.authors,
    workAuthors: libraryBooks.authors,
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
    // Work-level hide; surfaced so the vault reveal mode can badge rows.
    hidden: libraryBooks.hidden,
    // 7.7: a B carries its single source; A/C rows resolve to null.
    sourceLibraryId: libraryBookVersions.sourceLibraryId,
    sourceLibraryBookVersionId: libraryBookVersions.sourceLibraryBookVersionId,
    kind: libraryBookVersions.kind,
    // Extracted, not the whole meta column: list payloads must stay chapter-free.
    coverPaletteId: sql<CoverPaletteId | null>`${revMeta('$.coverPaletteId')}`,
    coverPaletteKey: sql<string | null>`${revMeta('$.coverPaletteKey')}`,
  }).from(libraryBookVersions)
    .innerJoin(libraryBooks, eq(libraryBookVersions.libraryBookId, libraryBooks.id))
    .innerJoin(bookVersions, eq(libraryBookVersions.bookVersionId, bookVersions.id))
    .leftJoin(bookStates, and(eq(bookStates.bookVersionId, bookVersions.id), eq(bookStates.userId, userId)))
    .leftJoin(libraryCategories, eq(libraryBooks.categoryId, libraryCategories.id))
    .where(where)
  // Pin-first is meaningless in the trash; there the chosen sort rules alone.
  const rows = baseQuery()
    .orderBy(...(trash ? [] : [asc(sql`${libraryBookVersions.pinnedAt} IS NULL`)]), ...orderBy)
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
    ? db.select({ libraryBookId: libraryBookTags.libraryBookId, tagId: libraryBookTags.tagId, name: libraryTags.name })
      .from(libraryBookTags)
      .innerJoin(libraryTags, eq(libraryBookTags.tagId, libraryTags.id))
      .where(inArray(libraryBookTags.libraryBookId, rows.map((b) => b.libraryBookId)))
      .all()
    : []
  const tagsByBook = new Map<string, string[]>()
  const tagIdsByBook = new Map<string, string[]>()
  for (const row of tagRows) {
    const list = tagsByBook.get(row.libraryBookId) ?? []
    list.push(row.name)
    tagsByBook.set(row.libraryBookId, list)
    const ids = tagIdsByBook.get(row.libraryBookId) ?? []
    ids.push(row.tagId)
    tagIdsByBook.set(row.libraryBookId, ids)
  }
  // 7.7: mark collected cards whose source is gone so the list can say so
  // before the reader refuses the file. Batched in two queries — existence of
  // the source library and of the pinned source version, still published.
  // Losing library membership is not part of this flag; the read path stays the
  // authority for that.
  //
  // Effective-hidden marks ride the same batching: without reveal every
  // returned row is visible by construction, so taxonomy loads only then.
  // Tag matching is by id (names are display-only and can collide).
  const taxonomy = showHidden && !trash ? loadLibraryHiddenTaxonomy(db, library.id) : null
  const sourceIds = [...new Set(rows.flatMap((row) => (row.sourceLibraryId ? [row.sourceLibraryId] : [])))]
  const sourceLinkIds = [...new Set(rows.flatMap((row) => (row.sourceLibraryBookVersionId ? [row.sourceLibraryBookVersionId] : [])))]
  const sourceNameById = new Map(
    sourceIds.length === 0 ? [] : db.select({ id: libraries.id, name: libraries.name }).from(libraries)
      .where(inArray(libraries.id, sourceIds)).all().map((row) => [row.id, row.name] as const),
  )
  const liveSourceLibraries = new Set(
    sourceIds.length === 0 ? [] : db.select({ id: libraries.id }).from(libraries)
      .where(inArray(libraries.id, sourceIds)).all().map((row) => row.id),
  )
  const liveSourceLinks = new Set(
    sourceLinkIds.length === 0 ? [] : db.select({ id: libraryBookVersions.id }).from(libraryBookVersions)
      .where(and(
        inArray(libraryBookVersions.id, sourceLinkIds),
        eq(libraryBookVersions.status, 'published'),
      )).all().map((row) => row.id),
  )
  const data = rows.map(({
    libraryBookId: _libraryBookId,
    versionAuthors, workAuthors,
    sourceLibraryId, sourceLibraryBookVersionId, ...b
  }) => {
    // Effective hide for badging: without reveal every row here is visible
    // by construction, so a reason only ever fires in reveal mode.
    const detail = taxonomy
      ? classifyWorkHidden({ hidden: b.hidden, categoryId: b.shelfId }, taxonomy, tagIdsByBook.get(_libraryBookId) ?? [])
      : { reason: null as HiddenReason | null }
    return {
      ...b,
      authors: versionAuthors ?? workAuthors ?? [],
      tags: tagsByBook.get(_libraryBookId) ?? [],
      effectiveHidden: detail.reason !== null,
      hiddenReason: detail.reason,
      ...(detail.via ? { hiddenVia: detail.via } : {}),
      // 7.7: a B carries its single source; A/C rows report null.
      source: sourceLibraryId
        ? {
            libraryId: sourceLibraryId,
            libraryBookVersionId: sourceLibraryBookVersionId,
            libraryName: sourceNameById.get(sourceLibraryId) ?? null,
          }
        : null,
      sourceUnavailable: sourceLibraryId
        ? !liveSourceLibraries.has(sourceLibraryId) || !liveSourceLinks.has(sourceLibraryBookVersionId!)
        : false,
    }
  })
  return { data, page, pageSize, total: agg?.count ?? 0, totalSize: agg?.totalSize ?? 0 }
}

// Book rows returned to clients must not carry meta.chapters (huge payload);
// chapters are served by the dedicated GET /:id/chapters endpoint.
export function stripMetaChapters<T extends { meta: Record<string, unknown> }>(book: T): T {
  const meta = { ...book.meta }
  delete meta.chapters
  delete meta.viewSettings
  delete meta.boundPresetId
  return { ...book, meta }
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

/**
 * Content half of an upload (5.1): parse, cover, TXT→EPUB conversion and the
 * revision meta. Nothing is written to the database here, so both the private
 * library and a shared library can adopt the same result. `versionId` is the id
 * the caller will register the new BookVersion under; TXT generation embeds it
 * as the EPUB identifier.
 */
async function materializeUpload(userId: string, file: File, buffer: Buffer, versionId: string, opts?: { normalizeTitle?: boolean }) {
  const storage = getStorage()
  const fileName = file.name
  const mime = file.type
  const parser = getParser(fileName, mime)
  if (!parser) {
    throw new AppError('UNSUPPORTED_FORMAT', `Unsupported format: ${fileName}`)
  }

  const parsed = await parser.parse(buffer)
  const format: BookFormat = fileName.toLowerCase().endsWith('.txt') ? 'txt' : 'epub'
  const contentHash = sha256(buffer)
  const fileKey = blobKey(contentHash, '.epub')

  let title = parsed.meta.title
  let author = parsed.meta.author ?? ''
  const derived = opts?.normalizeTitle ? normalizeBookTitle(fileName) : undefined
  if (!title) {
    title = derived?.title || fileName.replace(/\.[^.]+$/, '')
  }
  // File names of web-novels often carry the author where metadata has none.
  if (!author && derived?.author) author = derived.author
  // Multi-author: parsed creators win; the file-name fallback can supply multiple names if derived.
  const parsedAuthors = (parsed.meta.authors ?? []).map((name) => name.trim()).filter(Boolean).slice(0, 10)
  const authors = parsedAuthors.length > 0
    ? parsedAuthors
    : (derived?.authors && derived.authors.length > 0)
      ? derived.authors
      : author.trim()
        ? [author.trim()]
        : []
  if (authors.length > 0) author = authors[0]!

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
      { title, author: author || undefined, authors, id: versionId },
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

  const metaChapters = meta.chapters as Array<{ wordCount?: number }> | undefined
  if (metaChapters && metaChapters.length > 0) {
    meta.wordCount = metaChapters.reduce((sum, c) => sum + (c.wordCount ?? 0), 0)
  }
  return {
    format,
    fileKey,
    size,
    meta,
    title,
    author,
    authors,
    coverKey,
    coverSize: parsed.meta.cover?.length ?? null,
    description: typeof parsed.meta.bookmeta?.description === 'string' ? parsed.meta.bookmeta.description : '',
    chapterCount: metaChapters?.length ?? 0,
    wordCount: typeof meta.wordCount === 'number' ? meta.wordCount : null,
    versionName: derived?.versionName,
  }
}

/**
 * Staged-upload compensation: materializeUpload writes files before the
 * database transaction commits, so a failed commit must not leave orphan
 * files behind. Keys that gained a blob registry row meanwhile (an identical
 * upload landing at the same time) are shared and kept; only unregistered
 * keys go. Best-effort by design — a missed delete is an orphaned blob, a
 * wrong delete would be data loss.
 */
export async function cleanupStagedUpload(upload: { fileKey: string; coverKey: string | null }): Promise<void> {
  const db = getDb()
  const storage = getStorage()
  const keys = [upload.fileKey]
  if (upload.coverKey) {
    const registered = db.select({ key: blobs.key }).from(blobs).where(eq(blobs.key, upload.coverKey)).get()
    if (!registered) keys.push(upload.coverKey, coverThumbnailKey(upload.coverKey))
  }
  for (const key of keys) {
    const registered = db.select({ key: blobs.key }).from(blobs).where(eq(blobs.key, key)).get()
    if (registered) continue
    if (await storage.exists(key)) await storage.delete(key)
  }
}

/** Cover-only counterpart: a staged cover (+ derived thumb) with no content file. */
export async function cleanupStagedCover(coverKey: string): Promise<void> {
  const db = getDb()
  const storage = getStorage()
  for (const key of [coverKey, coverThumbnailKey(coverKey)]) {
    const registered = db.select({ key: blobs.key }).from(blobs).where(eq(blobs.key, key)).get()
    if (registered) continue
    if (await storage.exists(key)) await storage.delete(key)
  }
}

export async function uploadBook(
  userId: string,
  file: File,
  membership?: { shelfId?: string | null; tagIds?: string[] },
  opts?: { normalizeTitle?: boolean; allowCorresponding?: boolean },
) {
  assertUserUploadAllowed(userId)
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

  const versionId = createId('book')
  const buffer = Buffer.from(await file.arrayBuffer())
  const duplicate = findPersonalVersionByBlob(library.id, blobKey(sha256(buffer), '.epub'))
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
    return { book: stripMetaChapters(await resolvePrivateBook(userId, duplicate.versionId, { allowDeleted: true, showHidden: true })), duplicated: true }
  }

  if (!opts?.allowCorresponding && getParser(file.name, file.type) && !file.name.toLowerCase().endsWith('.txt')) {
    const hint = await readTxtEpubCandidate(buffer)
    if (hint) {
      const { archive, sourceId } = hint
      const candidate = db.select({ versionId: bookVersions.id }).from(libraryBookVersions)
        .innerJoin(bookVersions, eq(bookVersions.id, libraryBookVersions.bookVersionId))
        .where(and(eq(libraryBookVersions.libraryId, library.id), eq(libraryBookVersions.kind, 'personal'),
          eq(bookVersions.id, sourceId), eq(bookVersions.format, 'txt'))).get()
      if (candidate) {
        const latest = db.select({ blobKey: contentRevisions.blobKey }).from(contentRevisions)
          .where(eq(contentRevisions.bookVersionId, candidate.versionId))
          .orderBy(desc(contentRevisions.revisionNo)).get()
        if (latest && await getStorage().exists(latest.blobKey)) {
          const original = await bufferFromStream(await getStorage().get(latest.blobKey))
          const existing = await resolvePrivateBook(userId, candidate.versionId, { allowDeleted: true, showHidden: true })
          let matched = await sameEpubArchive(archive, original)
          if (!matched && !existing.deletedAt) {
            const { exportEpubBook } = await import('./txt-export')
            const plain = await exportEpubBook(userId, candidate.versionId, true, { showHidden: true })
            matched = await sameEpubArchive(archive, plain.buffer)
          }
          if (matched) {
            return { book: stripMetaChapters(existing), duplicated: false, corresponding: { id: existing.id, title: existing.title } }
          }
        }
      }
    }
  }

  const upload = await materializeUpload(userId, file, buffer, versionId, opts)
  const now = Date.now()
  const libraryBookId = createId('lb')
  try {
    db.transaction((tx) => {
      tx.insert(bookVersions).values({
        id: versionId, format: upload.format, size: upload.size, createdAt: now, updatedAt: now,
      }).run()
      tx.insert(contentRevisions).values({
        id: createId('rev'), bookVersionId: versionId, revisionNo: 1, blobKey: upload.fileKey,
        size: upload.size, wordCount: upload.wordCount,
        chapterCount: upload.chapterCount, meta: upload.meta, createdAt: now,
      }).run()
      tx.insert(blobs).values({ key: upload.fileKey, size: upload.size, kind: 'book', createdAt: now }).onConflictDoNothing().run()
      if (upload.coverKey && upload.coverSize !== null) {
        tx.insert(blobs).values({ key: upload.coverKey, size: upload.coverSize, kind: 'cover', createdAt: now }).onConflictDoNothing().run()
      }
      tx.insert(libraryBooks).values({
        id: libraryBookId, libraryId: library.id, userId, categoryId: membership?.shelfId ?? null,
        title: upload.title, author: upload.author, authors: upload.authors, description: upload.description,
        coverKey: upload.coverKey, createdAt: now, updatedAt: now,
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
  } catch (err) {
    await cleanupStagedUpload(upload)
    throw err
  }
  return { book: stripMetaChapters(await resolvePrivateBook(userId, versionId, { allowDeleted: true, showHidden: true })), duplicated: false }
}

/**
 * Catalog upload (5.1): the content goes into a shared library the caller
 * manages, never into their private library. The uploader gets no reading
 * state here — reading data is created when someone actually reads, and a city
 * copy is not a private card. `kind` stays 'personal' because A/B/C describe
 * private-library entries: in a shared library this row is the library-owned
 * source that other libraries' B references point at.
 */
export async function uploadCatalogBook(
  libraryId: string,
  userId: string,
  file: File,
  opts?: {
    libraryBookId?: string
    categoryId?: string
    tagIds?: string[]
    name?: string
    title?: string
    author?: string
    authors?: string[]
    normalizeTitle?: boolean
  },
) {
  const db = getDb()
  // Owner/admin only by default; members when the library opened uploads.
  await assertCanContribute(userId, libraryId)
  const tagIds = [...new Set(opts?.tagIds ?? [])]
  if (opts?.categoryId) {
    const category = db.select({ id: libraryCategories.id }).from(libraryCategories)
      .where(and(eq(libraryCategories.id, opts.categoryId), eq(libraryCategories.libraryId, libraryId))).get()
    if (!category) throw new AppError('CATEGORY_NOT_FOUND')
  }
  if (tagIds.length > 0) {
    const existingTags = db.select({ count: sql<number>`count(*)` }).from(libraryTags)
      .where(and(eq(libraryTags.libraryId, libraryId), inArray(libraryTags.id, tagIds))).get()
    if ((existingTags?.count ?? 0) !== tagIds.length) throw new AppError('TAG_NOT_FOUND')
  }
  // Grouping into an existing work (5.2): the work must live in the same
  // library, and the version must not be there yet. Member upload rights are
  // not scoped to their own works — the owner opening the member-upload lane
  // delegates adding content to the library, and a member may already create an
  // arbitrary work outright, so filing a version under an existing one grants
  // strictly less. What stays scoped is *maintaining* it: only the uploader of
  // a version may change that version's content.
  let targetLibraryBookId = opts?.libraryBookId
  if (targetLibraryBookId) {
    const target = db.select({ id: libraryBooks.id }).from(libraryBooks)
      .where(and(eq(libraryBooks.id, targetLibraryBookId), eq(libraryBooks.libraryId, libraryId))).get()
    if (!target) throw new AppError('LIBRARY_BOOK_NOT_FOUND')
  }

  const versionId = createId('book')
  const buffer = Buffer.from(await file.arrayBuffer())
  const duplicate = findPersonalVersionByBlob(libraryId, blobKey(sha256(buffer), '.epub'))
  if (duplicate) {
    if (tagIds.length > 0) {
      db.insert(libraryBookTags)
        .values(tagIds.map((tagId) => ({ libraryBookId: duplicate.libraryBookId, tagId })))
        .onConflictDoNothing()
        .run()
    }
    return { bookVersionId: duplicate.versionId, libraryBookId: duplicate.libraryBookId, duplicated: true }
  }

  const upload = await materializeUpload(userId, file, buffer, versionId, opts)
  const now = Date.now()
  // An existing work keeps its own defaults; the new version carries the parsed
  // metadata as overrides so the upload is never silently lost.
  let libraryBookId = targetLibraryBookId ?? createId('lb')
  const linkId = createId('lbv')
  try {
    db.transaction((tx) => {
      tx.insert(bookVersions).values({
        id: versionId, format: upload.format, size: upload.size, createdAt: now, updatedAt: now,
      }).run()
      tx.insert(contentRevisions).values({
        id: createId('rev'), bookVersionId: versionId, revisionNo: 1, blobKey: upload.fileKey,
        size: upload.size, wordCount: upload.wordCount,
        chapterCount: upload.chapterCount, meta: upload.meta, createdAt: now,
      }).run()
      tx.insert(blobs).values({ key: upload.fileKey, size: upload.size, kind: 'book', createdAt: now }).onConflictDoNothing().run()
      if (upload.coverKey && upload.coverSize !== null) {
        tx.insert(blobs).values({ key: upload.coverKey, size: upload.coverSize, kind: 'cover', createdAt: now }).onConflictDoNothing().run()
      }
      if (!targetLibraryBookId) {
        // Explicit author input wins; otherwise the parsed upload stands.
        const workAuthors = opts?.authors !== undefined || opts?.author !== undefined
          ? normalizeAuthors({ author: opts?.author, authors: opts?.authors })
          : { author: upload.author, authors: upload.authors }
        tx.insert(libraryBooks).values({
          id: libraryBookId, libraryId, userId, categoryId: opts?.categoryId ?? null,
          title: opts?.title ?? upload.title, author: workAuthors.author, authors: workAuthors.authors,
          description: upload.description, coverKey: upload.coverKey, createdAt: now, updatedAt: now,
        }).run()
      }
      tx.insert(libraryBookVersions).values({
        id: linkId, libraryId, libraryBookId, bookVersionId: versionId, kind: 'personal',
        userId,
        name: opts?.name?.trim() || upload.versionName || '',
        title: targetLibraryBookId ? upload.title : null,
        author: targetLibraryBookId ? upload.author : null,
        authors: targetLibraryBookId ? (upload.authors.length > 0 ? upload.authors : null) : null,
        coverKey: targetLibraryBookId ? upload.coverKey : null,
        createdAt: now, updatedAt: now,
      }).run()
      if (tagIds.length > 0) {
        tx.insert(libraryBookTags).values(tagIds.map((tagId) => ({ libraryBookId, tagId }))).onConflictDoNothing().run()
      }
      if (opts?.categoryId) {
        tx.update(libraryCategories).set({ updatedAt: now }).where(eq(libraryCategories.id, opts.categoryId)).run()
      }
    })
  } catch (err) {
    await cleanupStagedUpload(upload)
    throw err
  }
  return { bookVersionId: versionId, libraryBookId, versionLinkId: linkId, duplicated: false }
}

/**
 * Stage 5 detail-only enrichment: city listings born from this private book,
 * for the merged publish dialog. Empty for anything that was never a publish
 * source (B/C cards, uncollected reads). File/chapter/content paths skip it.
 */
export async function attachPublishedTo<T extends { id: string }>(userId: string | null, book: T): Promise<T> {
  if (!userId) return book
  const db = getDb()
  // Scoped to the caller's relation to each library: a caller removed from a
  // city they once published to keeps their private book and its provenance,
  // but that library's name and its version names are not theirs to see. This
  // is a per-library verdict, so it reuses the browse gate rather than
  // re-deriving visibility here.
  const candidates = db.select({
    id: libraryBookVersions.id,
    libraryId: libraryBookVersions.libraryId,
    libraryBookId: libraryBookVersions.libraryBookId,
    bookVersionId: libraryBookVersions.bookVersionId,
    name: libraryBookVersions.name,
    status: libraryBookVersions.status,
    sourceBaseRevisionId: libraryBookVersions.sourceBaseRevisionId,
  }).from(libraryBookVersions)
    .where(eq(libraryBookVersions.sourceBaseVersionId, book.id)).all()
  const links: typeof candidates = []
  for (const candidate of candidates) {
    try {
      await assertLibraryBrowsable(userId, candidate.libraryId)
    } catch (err) {
      // Permission and topology denials are the verdict; anything else (a
      // database failure) must not masquerade as "never published there".
      if (err instanceof AppError) continue
      throw err
    }
    const work = db.select({ deletedAt: libraryBooks.deletedAt })
      .from(libraryBooks).where(eq(libraryBooks.id, candidate.libraryBookId)).get()
    if (!work || work.deletedAt) continue
    if (candidate.status !== 'published' && !await isLibraryManager(userId, candidate.libraryId)) continue
    links.push(candidate)
  }
  if (links.length === 0) return book
  const sourceBlob = db.select({ blobKey: contentRevisions.blobKey }).from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, book.id))
    .orderBy(desc(contentRevisions.revisionNo)).all().at(0)?.blobKey ?? null
  // Both endpoints of the comparison in one pass: the source's current bytes,
  // each city's current bytes, and each base snapshot's bytes.
  const cityVersionIds = [...new Set(links.map((link) => link.bookVersionId))]
  const baseRevisionIds = [...new Set(links.map((link) => link.sourceBaseRevisionId).filter((id): id is string => id !== null))]
  const cityBlobByVersion = latestBlobByBookVersion(cityVersionIds)
  const baseBlobByRevision = new Map(
    baseRevisionIds.length === 0
      ? []
      : db.select({ id: contentRevisions.id, blobKey: contentRevisions.blobKey }).from(contentRevisions)
          .where(inArray(contentRevisions.id, baseRevisionIds)).all().map((row) => [row.id, row.blobKey]),
  )
  const publishedTo: PublishedLinkInfo[] = []
  for (const link of links) {
    const library = db.select({ id: libraries.id, name: libraries.name }).from(libraries)
      .where(eq(libraries.id, link.libraryId)).get()
    if (!library) continue
    const cityBlob = cityBlobByVersion.get(link.bookVersionId)
    if (!cityBlob) continue
    // Three questions about the same three byte strings, none of them a row
    // count: inSync — do the two sides serve the same bytes right now; cityMoved
    // — has the library written anything since the publish snapshot;
    // sourceMoved — has this private book written anything since it. The last
    // one is what separates "the library moved on and you have not touched it"
    // from "you both edited", which read identically without it. Same-blob
    // revisions (a metadata reset) are not a move on either side.
    const baseBlob = link.sourceBaseRevisionId ? baseBlobByRevision.get(link.sourceBaseRevisionId) ?? null : null
    publishedTo.push({
      libraryId: library.id,
      libraryName: library.name,
      libraryBookId: link.libraryBookId,
      versionLinkId: link.id,
      versionName: link.name,
      inSync: sourceBlob !== null && cityBlob === sourceBlob,
      cityMoved: baseBlob === null || cityBlob !== baseBlob,
      sourceMoved: baseBlob !== null && sourceBlob !== null && sourceBlob !== baseBlob,
    })
  }
  return { ...book, publishedTo }
}

/**
 * Current blob of each requested BookVersion in one query, keyed by version.
 * Byte identity is what every "did the content actually change" verdict in
 * Stage 5 reads, so a revision that reuses the blob never counts as a change.
 */
function latestBlobByBookVersion(bookVersionIds: string[]): Map<string, string> {
  const latest = new Map<string, string>()
  if (bookVersionIds.length === 0) return latest
  for (const row of getDb().select({ bookVersionId: contentRevisions.bookVersionId, blobKey: contentRevisions.blobKey }).from(contentRevisions)
    .where(inArray(contentRevisions.bookVersionId, bookVersionIds))
    .orderBy(desc(contentRevisions.revisionNo)).all()) {
    if (!latest.has(row.bookVersionId)) latest.set(row.bookVersionId, row.blobKey)
  }
  return latest
}

/**
 * Stage 5 detail-only enrichment: an uncollected library read carries
 * ownsSource so the detail dialog renders it exactly like a collected
 * version. File/chapter/content paths skip it (hot paths, no UI need).
 */
export async function attachOwnsSource<T extends { id: string; collected?: boolean }>(userId: string | null, book: T): Promise<T> {
  if (!userId || book.collected !== false) return book
  const db = getDb()
  const links = db.select({
    bookVersionId: libraryBookVersions.bookVersionId,
    sourceBaseVersionId: libraryBookVersions.sourceBaseVersionId,
    sourceBaseRevisionId: libraryBookVersions.sourceBaseRevisionId,
  }).from(libraryBookVersions).where(eq(libraryBookVersions.bookVersionId, book.id)).all()
  if (!getOwnsSourceVersionIds(userId, links).has(book.id)) return book
  return { ...book, ownsSource: true }
}

/**
 * Detail-only: the content grew since this account last opened the reader.
 * Every holder's pin moves at once when content is appended or re-chaptered,
 * so the pin cannot separate readers who caught up from those who did not —
 * the revision recorded on the reader's own state row can. Detail only: a list
 * row has no business carrying a notice. Successful rendering acknowledges
 * the resolved revision independently of position writes.
 */
export async function attachUnreadUpdate<T extends { id: string; kind?: LibraryVersionKind }>(userId: string | null, book: T): Promise<T> {
  // Only a card that follows library content can fall behind: an A or C card
  // owns its bytes, so there is nothing else for it to be behind.
  if (!userId || book.kind !== 'shared') return book
  const db = getDb()
  const latest = db.select({ id: contentRevisions.id }).from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, book.id))
    .orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  if (!latest) return book
  const state = db.select({ readRevisionId: bookStates.readRevisionId }).from(bookStates)
    .where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, book.id))).get()
  // Never opened the reader counts as not caught up: there is no position to
  // have read from.
  if (state?.readRevisionId === latest.id) return book
  return { ...book, hasUnreadUpdate: true }
}

export async function acknowledgeReadRevision(userId: string, bookId: string, revisionId: string, showHidden = false) {
  await assertReadableBook(userId, bookId, showHidden)
  const db = getDb()
  const revision = db.select({ id: contentRevisions.id, revisionNo: contentRevisions.revisionNo }).from(contentRevisions)
    .where(and(eq(contentRevisions.id, revisionId), eq(contentRevisions.bookVersionId, bookId))).get()
  if (!revision) throw new AppError('VALIDATION_ERROR', 'Invalid content revision')
  // An older tab finishing late cannot undo a newer tab's acknowledgment.
  const seen = db.select({ revisionNo: contentRevisions.revisionNo }).from(bookStates)
    .innerJoin(contentRevisions, eq(contentRevisions.id, bookStates.readRevisionId))
    .where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()
  if (seen && seen.revisionNo > revision.revisionNo) return { revisionId }
  db.insert(bookStates).values({
    userId, bookVersionId: bookId, readRevisionId: revisionId, updatedAt: Date.now(),
  }).onConflictDoUpdate({
    target: [bookStates.userId, bookStates.bookVersionId],
    set: { readRevisionId: revisionId },
  }).run()
  return { revisionId }
}

export async function getBook(userId: string | null, bookId: string, opts?: { showHidden?: boolean }) {
  return resolvePrivateBook(userId, bookId, { allowDeleted: true, showHidden: opts?.showHidden })
}

export async function getActiveBook(userId: string | null, bookId: string, opts?: { showHidden?: boolean }) {
  return resolvePrivateBook(userId, bookId, { allowDeleted: false, showHidden: opts?.showHidden })
}

/**
 * The single readability gate for user-scoped reads. Progress, annotations and
 * reading records must ask this instead of re-deriving "is this mine from my
 * private library" on their own: that duplication is exactly how a library read
 * passed the content check but was then refused by the progress endpoint, which
 * made the reader refuse to open the book at all.
 *
 * It returns how the caller reached the book, because that decides more than
 * permission: 'private' means the caller has their own card, 'library' means
 * they are only reading a library's copy.
 *
 * It deliberately does NOT fall back to the frozen legacy `books` table. That
 * table stopped tracking deletion when the library model landed - trashBook only
 * writes library_books.deletedAt - so a `books` row outlives the book it used
 * to describe. Trusting it here would report a permanently deleted book as
 * readable, and worse, writable, since callers persist whatever this allows.
 * The upgrade path runs the Phase 2 backfill, so a real instance never has a
 * book outside the new model, and resolvePrivateBook never accepted one either:
 * the gate and the content route now agree on the same model.
 *
 * It answers permission only. resolvePrivateBook answers "give me the book" and
 * so additionally needs a materialized revision; the two agree on who may read
 * what, and both live here so that stays reviewable in one place.
 */
export async function assertReadableBook(userId: string | null, bookId: string, showHidden = false): Promise<'private' | 'library'> {
  const db = getDb()
  // Anonymous guests own no private library: they only ever reach the shared
  // verdict below, which applies the guest triple gate.
  if (userId === null) {
    if (!await resolveLibraryReadGrant(null, bookId)) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
    return 'library'
  }
  const library = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  // A missing private library is not a refusal: an account that has never
  // uploaded anything may still read a library it can see.
  if (library) {
    const lbv = db.select().from(libraryBookVersions)
      .where(and(eq(libraryBookVersions.libraryId, library.id), eq(libraryBookVersions.bookVersionId, bookId))).get()
    if (lbv) {
      const lb = db.select().from(libraryBooks)
        .where(eq(libraryBooks.id, lbv.libraryBookId)).get()
      if (!lb || lb.deletedAt) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
      // Private vault: hidden works read as NOT_FOUND unless the owner
      // reveals them with showHidden (lists, detail and content agree).
      if (!showHidden && isWorkEffectivelyHidden(db, library.id, lb)) {
        throw new AppError('BOOK_NOT_FOUND', 'Book not found')
      }
      // A collected B only while its source is still readable (7.2/7.3), the
      // same rule the read core applies.
      if (lbv.kind === 'shared' && !(await sourceStillReadable(userId, bookId))) {
        throw new AppError('BOOK_NOT_FOUND', 'Book not found')
      }
      return 'private'
    }
  }
  if (!await resolveLibraryReadGrant(userId, bookId)) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  return 'library'
}

/**
 * Synchronous ownership/readability precheck for synchronous user-data flows
 * such as AI session and generation persistence. The content routes still use
 * assertReadableBook for the full visibility/source verdict.
 */
export function assertReadableBookSync(userId: string, bookId: string): void {
  const db = getDb()
  const privateLibrary = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (privateLibrary) {
    const privateLink = db.select({ libraryBookId: libraryBookVersions.libraryBookId }).from(libraryBookVersions)
      .where(and(
        eq(libraryBookVersions.libraryId, privateLibrary.id),
        eq(libraryBookVersions.bookVersionId, bookId),
      )).get()
    if (privateLink) {
      const work = db.select({ deletedAt: libraryBooks.deletedAt }).from(libraryBooks)
        .where(eq(libraryBooks.id, privateLink.libraryBookId)).get()
      if (work && !work.deletedAt && sourceStillReadableSync(userId, bookId)) return
    }
  }
  // No status filter here: a hidden version is still readable by the library's
  // managers, so the verdict belongs to resolveSharedVersionRead, which knows
  // the caller's relation. Filtering to published here refused managers too.
  const candidates = db.select({ libraryId: libraryBookVersions.libraryId }).from(libraryBookVersions)
    .where(eq(libraryBookVersions.bookVersionId, bookId)).all()
  for (const candidate of candidates) {
    const library = db.select({ id: libraries.id, userId: libraries.userId, type: libraries.type, visibility: libraries.visibility })
      .from(libraries).where(eq(libraries.id, candidate.libraryId)).get()
    if (!library || library.type === 'private') continue
    const link = db.select({ status: libraryBookVersions.status, libraryBookId: libraryBookVersions.libraryBookId }).from(libraryBookVersions)
      .where(and(
        eq(libraryBookVersions.libraryId, candidate.libraryId),
        eq(libraryBookVersions.bookVersionId, bookId),
      )).get()
    if (!link) continue
    const work = db.select({ deletedAt: libraryBooks.deletedAt }).from(libraryBooks)
      .where(eq(libraryBooks.id, link.libraryBookId)).get()
    if (!work || work.deletedAt) continue
    const membership = db.select({ role: libraryMemberships.role }).from(libraryMemberships).where(and(
      eq(libraryMemberships.libraryId, candidate.libraryId),
      eq(libraryMemberships.userId, userId),
    )).get()
    // Managers clear the hide boundary the same way owners do; a hidden version
    // is still theirs to read. Note the manager test comes first: a member of a
    // public library is not a manager, and must not inherit that exemption just
    // because the library happens to be public.
    if (library.userId === userId || membership?.role === 'admin') return
    // Everyone else is bound by visibility AND by the version status, so a
    // public member and a public outsider read the same published set.
    if (library.visibility !== 'public' && !membership) continue
    if (link?.status === 'published') return
  }
  throw new AppError('BOOK_NOT_FOUND')
}

/**
 * The shared-library read verdict for a version nobody collected, or null when
 * no library the caller may read publishes it. The verdict is the single
 * shared-library read decision, so a non-member only reaches a published version
 * of a public library, and a member only their own libraries' versions. Guests
 * are rejected by the routes before this runs (Phase 6 owns anonymous access).
 */
async function resolveLibraryReadGrant(userId: string | null, bookId: string) {
  const db = getDb()
  const candidates = db.select({ libraryId: libraryBookVersions.libraryId })
    .from(libraryBookVersions)
    .where(eq(libraryBookVersions.bookVersionId, bookId)).all()
  for (const candidate of candidates) {
    try {
      return await resolveSharedVersionRead(candidate.libraryId, bookId, userId)
    } catch (err) {
      // Not readable here; another library listing the same version may allow
      // it. Only verdict denials are swallowed — a database or system failure
      // must not masquerade as "not readable here".
      if (err instanceof AppError) continue
      throw err
    }
  }
  return null
}

/**
 * 0.4.0 read fallback for a version that lives in a shared library. There is no
 * pinned revision here on purpose: nothing was collected, so the current
 * published revision is what the library offers today.
 */
async function resolveLibraryRead(userId: string | null, bookId: string) {
  const db = getDb()
  const granted = await resolveLibraryReadGrant(userId, bookId)
  if (!granted) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  const link = granted.link
  const work = db.select().from(libraryBooks).where(eq(libraryBooks.id, link.libraryBookId)).get()
  if (!work || work.deletedAt) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  const bv = db.select().from(bookVersions).where(eq(bookVersions.id, bookId)).get()
  if (!bv) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  const revision = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  if (!revision) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  // Guests create no server-side reading state; there is nothing to load.
  const state = userId === null ? undefined : db.select().from(bookStates)
    .where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()
  const revisionMeta = (revision.meta ?? {}) as Record<string, unknown>
  const hiddenDetail = getWorkHiddenDetail(db, granted.library.id, work)
  return {
    id: bookId,
    userId,
    // Version override wins, then the work default — the same inheritance the
    // catalog shows, so a library read and the catalog card agree.
    title: link.title ?? work.title,
    author: link.author ?? work.author,
    authors: link.authors ?? work.authors ?? [],
    format: bv.format,
    filePath: revision.blobKey,
    revisionId: revision.id,
    coverKey: link.coverKey ?? work.coverKey,
    contentHash: hashFromBlobKey(revision.blobKey),
    size: bv.size,
    meta: revisionMeta,
    coverPaletteKey: typeof revisionMeta.coverPaletteKey === 'string' ? revisionMeta.coverPaletteKey : bookId,
    createdAt: work.createdAt,
    updatedAt: work.updatedAt,
    contentUpdatedAt: revision.createdAt,
    readStatus: state?.readStatus ?? 'reading',
    progress: state?.percent ?? 0,
    pinnedAt: link.pinnedAt ?? null,
    lastReadAt: state?.lastReadAt ?? null,
    deletedAt: null,
    shelfId: null,
    hidden: work.hidden,
    effectiveHidden: hiddenDetail.reason !== null,
    hiddenReason: hiddenDetail.reason,
    ...(hiddenDetail.via ? { hiddenVia: hiddenDetail.via } : {}),
    readerSettings: getReaderBookSettings(userId, bookId),
    // Present so the UI can offer "add to my library" and hide the actions
    // that would write library-owned content.
    source: {
      libraryId: granted.library.id,
      libraryBookVersionId: link.id,
      libraryName: granted.library.name,
    },
    collected: false,
  }
}

/**
 * Phase 3 read core: the private book as the legacy books row shape, assembled
 * from library/version/revision/state rows. bookId IS the version id (0.3), so
 * every existing caller keeps working: routes, Legado, AI, exports and tests
 * see the same fields. Content and metadata come from the latest revision.
 *
 * 0.4.0 adds one fallback: a version the caller has NOT collected but may read
 * in a shared library resolves here too, so browsing a library leads to the
 * existing reader with no second context. Reading is dimensioned by
 * BookVersion, so progress and annotations land in the same place either way
 * (design invariant 4/5: reading does not require collecting).
 *
 * The fallback is strictly a READ path. Every mutation goes through
 * resolveLibraryBook and still requires a private row, so a library version can
 * never be written to from here. A collected B keeps taking the private branch,
 * which is what preserves its pinned revision and source gate.
 */
export async function resolvePrivateBook(userId: string | null, bookId: string, opts?: { allowDeleted?: boolean; skipSourceCheck?: boolean; showHidden?: boolean }) {
  const db = getDb()
  // Anonymous guests own no private rows: straight to the shared verdict,
  // which applies the guest triple gate (instance switch + public + version).
  if (userId === null) return resolveLibraryRead(null, bookId)
  const library = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (!library) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  const lbv = db.select().from(libraryBookVersions)
    .where(and(eq(libraryBookVersions.libraryId, library.id), eq(libraryBookVersions.bookVersionId, bookId))).get()
  // Not in the private library at all: the only other way in is a library the
  // caller is allowed to read. Anything unauthorized is the same NOT_FOUND.
  if (!lbv) return resolveLibraryRead(userId, bookId)
  const lb = db.select().from(libraryBooks).where(eq(libraryBooks.id, lbv.libraryBookId)).get()
  if (!lb) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  if (lb.deletedAt && !opts?.allowDeleted) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  // Private vault (same rule as assertReadableBook): owner-verified writes
  // pass showHidden explicitly; casual reads need the reveal flag.
  if (!opts?.showHidden && isWorkEffectivelyHidden(db, library.id, lb)) {
    throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  }
  const bv = db.select().from(bookVersions).where(eq(bookVersions.id, bookId)).get()
  if (!bv) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  // (7.2/7.3) A B reads its pinned revision and only while its source is still
  // readable. Both checks live in the read core so every caller — reader,
  // Legado, AI, exports — inherits them instead of re-implementing the rule.
  // The delete path passes skipSourceCheck: removing your own card must never
  // require the source to still be readable.
  if (!opts?.skipSourceCheck && lbv.kind === 'shared' && !(await sourceStillReadable(userId, bookId))) {
    throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  }
  const revision = lbv.kind === 'shared' && lbv.pinnedRevisionId
    ? db.select().from(contentRevisions)
      .where(and(
        eq(contentRevisions.id, lbv.pinnedRevisionId),
        eq(contentRevisions.bookVersionId, bookId),
      )).get()
    : db.select().from(contentRevisions)
      .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  if (!revision) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  const state = db.select().from(bookStates)
    .where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).get()
  const revisionMeta = (revision.meta ?? {}) as Record<string, unknown>
  const meta = revisionMeta
  // 7.7: the UI needs to know a card is library-owned (hide content edits) and
  // which city it came from. A deleted source keeps its id, loses its name.
  const sourceLibrary = lbv.sourceLibraryId
    ? db.select({ name: libraries.name }).from(libraries).where(eq(libraries.id, lbv.sourceLibraryId)).get()
    : null
  const hiddenDetail = getWorkHiddenDetail(db, library.id, lb)
  return {
    id: bookId,
    userId,
    kind: lbv.kind as LibraryVersionKind,
    title: lbv.title ?? lb.title,
    author: lbv.author ?? lb.author,
    authors: lbv.authors ?? lb.authors ?? [],
    format: bv.format,
    filePath: revision.blobKey,
    revisionId: revision.id,
    coverKey: lbv.coverKey ?? lb.coverKey,
    contentHash: hashFromBlobKey(revision.blobKey),
    size: bv.size,
    meta,
    coverPaletteKey: typeof revisionMeta.coverPaletteKey === 'string' ? revisionMeta.coverPaletteKey : bookId,
    createdAt: lb.createdAt,
    updatedAt: lb.updatedAt,
    // When the file behind this read last changed. Distinct from updatedAt,
    // which moves for metadata edits too, and it follows pinnedRevisionId
    // because it is the resolved revision's own timestamp.
    contentUpdatedAt: revision.createdAt,
    readStatus: state?.readStatus ?? 'reading',
    progress: state?.percent ?? 0,
    pinnedAt: lbv.pinnedAt ?? null,
    lastReadAt: state?.lastReadAt ?? null,
    deletedAt: lb.deletedAt ?? null,
    shelfId: lb.categoryId,
    // Work-level hide; surfaced so the vault reveal mode can badge the row.
    hidden: lb.hidden,
    effectiveHidden: hiddenDetail.reason !== null,
    hiddenReason: hiddenDetail.reason,
    ...(hiddenDetail.via ? { hiddenVia: hiddenDetail.via } : {}),
    readerSettings: getReaderBookSettings(userId, bookId),
    source: lbv.sourceLibraryId
      ? {
          libraryId: lbv.sourceLibraryId,
          libraryBookVersionId: lbv.sourceLibraryBookVersionId,
          libraryName: sourceLibrary?.name ?? null,
        }
      : null,
    // A private row is a collected card by definition.
    collected: true,
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

/**
 * Carry per-chapter added times across a rewrite of `meta.chapters`.
 *
 * `addedAt` means "when this chapter first appeared", and it is stored only when
 * that differs from the revision the chapter lives in — a fresh upload needs no
 * field, because every chapter then shares its revision's own timestamp. So a
 * rewrite copies the time of every chapter its predecessor already had and
 * leaves genuinely new chapters absent, which is what makes them fall back to
 * the new revision.
 *
 * A predecessor chapter without its own `addedAt` predates this field, so it
 * inherits `previousRevisionAt`: that keeps an old book behaving exactly as it
 * did before, and the moment it is appended or re-toc'd its chapters gain real
 * times.
 *
 * Identity is the join key. TXT ids are byte offsets and EPUB ids are spine
 * fragment ids, so re-reading the same file matches every chapter and replacing
 * it with a different one matches nothing. Nothing records which chapter of a
 * new file corresponds to which of the old, so treating them all as new is the
 * honest answer; matching on title or position would only guess, and a wrong
 * guess dates a chapter as someone else's.
 */
function carryChapterAddedAt<T extends { id: string }>(chapters: T[], previous: unknown, previousRevisionAt: number): T[] {
  const before = Array.isArray(previous) ? (previous as Chapter[]) : []
  if (before.length === 0) return chapters
  const times = new Map(before.map((chapter) => [chapter.id, chapter.addedAt ?? previousRevisionAt]))
  return chapters.map((chapter) => {
    const addedAt = times.get(chapter.id)
    return addedAt === undefined ? chapter : { ...chapter, addedAt }
  })
}

export async function getBookChapters(userId: string | null, bookId: string, opts?: { showHidden?: boolean }) {
  const book = await getActiveBook(userId, bookId, opts)
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
    const chapters = carryChapterAddedAt(
      parsed.chapters.map((parsedChapter, index) => {
        const existing = sameLength ? existingChapters[index] : undefined
        return {
          id: existing?.id ?? `ch-${index}`,
          title: existing?.title ?? parsedChapter.title,
          level: parsedChapter.level ?? existing?.level ?? 1,
          startOffset: existing?.startOffset ?? 0,
          endOffset: existing?.endOffset ?? 0,
          wordCount: existing?.wordCount ?? parsedChapter.wordCount ?? 0,
        }
      }),
      existingChapters,
      book.contentUpdatedAt,
    )
    const meta: Record<string, unknown> = { ...(book.meta as Record<string, unknown>), epubTocLevelVersion: EPUB_TOC_LEVEL_VERSION }
    if (chapters.length > 0) meta.chapters = chapters
    // Anonymous reads never warm that cache: persisting from a guest context
    // would be a server-side write with no owner.
    const latestRevision = userId === null ? undefined : getDb().select({ id: contentRevisions.id }).from(contentRevisions)
      .where(eq(contentRevisions.bookVersionId, book.id)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
    if (latestRevision) {
      // Derived-cache exception: recomputable from the blob, never a revision.
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

  const book = await getActiveBook(userId, bookId, { showHidden: true })
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
  // The append is a pure tail operation, so every id the previous revision
  // already had is a chapter that predates it and keeps its own time; the ones
  // that match nothing are the chapters this append just added and fall back to
  // the new revision.
  const metaChapters = carryChapterAddedAt(chapters.map((chapter) => ({
    id: txtChapterId(chapter),
    title: chapter.title,
    level: chapter.level,
    startOffset: chapter.startOffset,
    endOffset: chapter.endOffset,
    contentStartOffset: chapter.contentStartOffset,
    contentRanges: chapter.contentRanges,
    wordCount: countWords(getTxtChapterContent(mergedNormalized, chapter)),
  })), book.meta.chapters, book.contentUpdatedAt)
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
  assertUserUploadAllowed(userId)
  assertMutableContent(resolveLibraryBook(userId, bookId).kind)
  const prepared = await prepareTxtAppend(userId, bookId, appendedText, startOffset)
  const db = getDb()
  const storage = getStorage()
  const book = await getActiveBook(userId, bookId, { showHidden: true })
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

  const progress = await readProgressFile(userId, bookId)
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
    await writeProgressFile(userId, bookId, nextProgress)
  }

  // New content lands as a new revision; the old revision (and its file)
  // stays readable until the pointer moves and the ref-check passes.
  const oldFilePath = book.filePath
  const updatedAt = Date.now()
  const maxRevision = db.select({ revisionNo: contentRevisions.revisionNo }).from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  const nextRevisionNo = (maxRevision?.revisionNo ?? 0) + 1
  const newRevisionId = createId('rev')
  const { libraryBookId } = resolveLibraryBook(userId, bookId)
  try {
    db.transaction((tx) => {
      tx.insert(contentRevisions).values({
        id: newRevisionId, bookVersionId: bookId, revisionNo: nextRevisionNo,
        blobKey: filePath, size: epubBuffer.length, wordCount: prepared.newWordCount,
        chapterCount: prepared.metaChapters.length, meta, createdAt: updatedAt,
      }).run()
      tx.insert(blobs).values({ key: filePath, size: epubBuffer.length, kind: 'book', createdAt: updatedAt }).onConflictDoNothing().run()
      tx.update(bookVersions).set({ size: epubBuffer.length, updatedAt }).where(eq(bookVersions.id, bookId)).run()
      tx.update(libraryBooks).set({ updatedAt }).where(eq(libraryBooks.id, libraryBookId)).run()
      tx.update(bookStates).set({ percent: newPercent, updatedAt }).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookId))).run()
      // A collected card of this book follows the new content, same as a card
      // in a shared library: appending is a content update, not a new version.
      tx.update(libraryBookVersions).set({ pinnedRevisionId: newRevisionId })
        .where(and(
          eq(libraryBookVersions.bookVersionId, bookId),
          eq(libraryBookVersions.kind, 'shared'),
        )).run()
    })
  } catch (err) {
    await cleanupStagedUpload({ fileKey: filePath, coverKey: null })
    throw err
  }
  invalidateCachedNormalized(bookId)

  if (oldFilePath !== filePath) {
    await deleteUnreferencedRevision(oldFilePath)
  }

  return stripMetaChapters(await resolvePrivateBook(userId, bookId, { allowDeleted: true, showHidden: true }))
}

/**
 * View-pref half of a re-toc: which rule produced the split. Stored in the
 * revision meta but never worth a revision on its own (see the revision-write
 * discipline in architecture.md).
 */
function applyTocRuleSelection(
  target: Record<string, unknown>,
  sel: { customPatterns?: TocRulePattern[] | null; tocRuleId: string | null; tocRuleAuto: boolean },
) {
  if (sel.customPatterns && sel.customPatterns.length > 0) {
    target.customTocPatterns = sel.customPatterns
    target.tocRuleId = 'custom'
    target.tocRuleAuto = false
  } else if (sel.tocRuleId) {
    target.tocRuleId = sel.tocRuleId
    target.tocRuleAuto = sel.tocRuleAuto
    delete target.customTocPatterns
  } else {
    delete target.tocRuleId
    delete target.tocRuleAuto
    delete target.customTocPatterns
  }
}

/**
 * Persist a shared version's TOC selection as self-contained patterns.
 *
 * A private book pins a `toc_rules` id because its reader is its only reader.
 * A shared version is not: storing one user's rule id would make that user's
 * private rule the thing every member's chapter map depends on, and the next
 * append would re-derive it through whoever happened to run it. So the rule's
 * patterns are frozen onto the version and only its display name is kept.
 */
function applySharedTocRuleSelection(
  target: Record<string, unknown>,
  sel: { patterns: TocRulePattern[] | null; tocRuleAuto: boolean; label?: string | null },
): void {
  if (sel.patterns && sel.patterns.length > 0) {
    target.customTocPatterns = sel.patterns
    target.tocRuleId = 'custom'
  } else {
    delete target.customTocPatterns
    delete target.tocRuleId
  }
  target.tocRuleAuto = sel.tocRuleAuto
  if (sel.label) target.tocRuleLabel = sel.label
  else delete target.tocRuleLabel
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
  const book = await getBook(userId, bookId, { showHidden: true })
  if (book.format !== 'txt') throw new AppError('UNSUPPORTED_FORMAT', 'Re-TOC only supports txt books')

  const normalized = await getOrRecoverTxtNormalized(book)
  const rawChapters = scanTxtChapters(normalized, patterns ?? undefined)
  const { chapters, excludedChapterIds } = applyTxtChapterExclusions(rawChapters, requestedExcludedChapterIds)

  const db = getDb()
  const metaChapters = carryChapterAddedAt(chapters.map((c) => ({
    id: txtChapterId(c),
    title: c.title,
    level: c.level,
    startOffset: c.startOffset,
    endOffset: c.endOffset,
    contentStartOffset: c.contentStartOffset,
    contentRanges: c.contentRanges,
    wordCount: countWords(getTxtChapterContent(normalized, c)),
  })), book.meta.chapters, book.contentUpdatedAt)
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
  const oldChapters = (book.meta as { chapters?: { id?: string; title?: string; level?: number }[] } | undefined)?.chapters
  const chaptersChanged = chapterBoundariesChanged(
    oldChapters,
    metaChapters.map((c) => ({ id: c.id, title: c.title, level: c.level })),
  )
  applyTocRuleSelection(meta, { customPatterns, tocRuleId, tocRuleAuto })

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
    const newRevisionId = createId('rev')
    try {
      db.transaction((tx) => {
        tx.insert(contentRevisions).values({
          id: newRevisionId, bookVersionId: bookId, revisionNo: (maxRevision?.revisionNo ?? 0) + 1,
          blobKey: newFileKey, size: epubBuffer.length, wordCount, chapterCount: metaChapters.length,
          meta, createdAt: updatedAt,
        }).run()
        tx.insert(blobs).values({ key: newFileKey, size: epubBuffer.length, kind: 'book', createdAt: updatedAt }).onConflictDoNothing().run()
        tx.update(bookVersions).set({ size: epubBuffer.length, updatedAt }).where(eq(bookVersions.id, bookId)).run()
        // Same follow-all rule as every other content write: a new revision
        // moves every collected pin, otherwise the pin lags and the reader's
        // acknowledgment can never catch the newest revision.
        tx.update(libraryBookVersions).set({ pinnedRevisionId: newRevisionId })
          .where(and(
            eq(libraryBookVersions.bookVersionId, bookId),
            eq(libraryBookVersions.kind, 'shared'),
          )).run()
      })
    } catch (err) {
      await cleanupStagedUpload({ fileKey: newFileKey, coverKey: null })
      throw err
    }
    const refs = db.select({ count: sql<number>`count(*)` }).from(contentRevisions).where(eq(contentRevisions.blobKey, book.filePath)).get()
    if ((refs?.count ?? 0) === 0 && await storage.exists(book.filePath)) {
      await storage.delete(book.filePath)
      db.delete(blobs).where(eq(blobs.key, book.filePath)).run()
    }
  } else if (chaptersChanged) {
    // Same bytes, new chapter map: record a new revision reusing the blob.
    // Readers follow the new structure through the moved-forward pin and are
    // told about it by their own unread-update flag.
    const latestRevision = db.select({ id: contentRevisions.id, revisionNo: contentRevisions.revisionNo, size: contentRevisions.size }).from(contentRevisions)
      .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
    const newRevisionId = createId('rev')
    db.transaction((tx) => {
      tx.insert(contentRevisions).values({
        id: newRevisionId, bookVersionId: bookId, revisionNo: (latestRevision?.revisionNo ?? 0) + 1,
        blobKey: book.filePath, size: latestRevision?.size ?? 0, wordCount, chapterCount: metaChapters.length,
        meta, createdAt: updatedAt,
      }).run()
      // A new chapter map is new content for readers: collected pins follow
      // it the same way they follow new bytes.
      tx.update(libraryBookVersions).set({ pinnedRevisionId: newRevisionId })
        .where(and(
          eq(libraryBookVersions.bookVersionId, bookId),
          eq(libraryBookVersions.kind, 'shared'),
        )).run()
    })
  } else {
    // Boundaries unchanged: only the rule selection may differ. View prefs
    // stay in place; no new revision.
    const latestRevision = db.select({ id: contentRevisions.id, meta: contentRevisions.meta }).from(contentRevisions)
      .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
    if (latestRevision) {
      const base = { ...((latestRevision.meta ?? {}) as Record<string, unknown>) }
      applyTocRuleSelection(base, { customPatterns, tocRuleId, tocRuleAuto })
      db.update(contentRevisions).set({ meta: base }).where(eq(contentRevisions.id, latestRevision.id)).run()
    }
  }

  // A re-split re-indexes the EPUB's chapter files, so the saved progress CFI
  // is stale; keep the book-level percent so the reader can restore by
  // fraction. No-op when the split is unchanged (identical chapters).
  if (chaptersChanged) {
    // Re-indexing invalidates the saved CFI for the owner; the book-level percent
    // survives so the reader can restore by fraction. Per user, because a
    // collected book has a position per reader.
    const progress = await readProgressFile(userId, bookId) as { cfi?: string | null; chapter?: string | null } | null
    if (progress) {
      progress.cfi = null
      progress.chapter = null
      await writeProgressFile(userId, bookId, progress as never)
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
  assertMutableContent(resolveLibraryBook(userId, bookId).kind)
  const book = await getBook(userId, bookId, { showHidden: true })
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
  const book = await getBook(userId, bookId, { showHidden: true })
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

/**
 * TOC preview for a shared-library version (Stage 6): same derivation as the
 * private flow, resolved against the city's stored self-contained patterns
 * rather than a private card's rule. A named rule the caller passes is still
 * resolved — but only against that caller's own rules, since picking one is an
 * explicit act, while the version's *current* selection never depends on who
 * is asking.
 */
export async function previewCityToc(
  actorId: string,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
  options: PreviewBookTocOptions = {},
): Promise<TocPreviewRes> {
  const link = await getManagedVersionLink(actorId, libraryId, libraryBookId, versionLinkId)
  const db = getDb()
  const version = db.select().from(bookVersions).where(eq(bookVersions.id, link.bookVersionId)).get()
  if (!version || version.format !== 'txt') throw new AppError('UNSUPPORTED_FORMAT', 'TOC preview only supports txt books')
  const latest = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, link.bookVersionId))
    .orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  if (!latest) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  const latestMeta = (latest.meta ?? {}) as Record<string, unknown>

  const normalized = await getOrRecoverTxtNormalized({ filePath: latest.blobKey, id: link.bookVersionId, updatedAt: latest.createdAt, meta: latestMeta })
  const storedExcludedChapterIds = Array.isArray(latestMeta.tocExcludedChapterIds)
    ? (latestMeta.tocExcludedChapterIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
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
        const custom = latestMeta.customTocPatterns
        if (Array.isArray(custom) && custom.length > 0) {
          patterns = (custom as TocRulePattern[]).filter((p) => p.enabled !== false)
          ruleId = 'custom'
          ruleName = '本书专属规则'
        }
      } else {
        const rule = db.select().from(tocRules).where(and(eq(tocRules.id, options.tocRuleId), eq(tocRules.userId, actorId))).get()
        if (!rule) throw new AppError('TOC_RULE_NOT_FOUND')
        patterns = rule.patterns.filter((p) => p.enabled !== false)
        ruleId = rule.id
        ruleName = rule.name
      }
    } else {
      const scored = scoreTocRules(actorId, normalized.slice(0, TOC_SAMPLE_SIZE))
      if (scored) {
        patterns = scored.patterns.filter((p) => p.enabled !== false)
        ruleId = scored.id
        ruleName = scored.name
        autoScored = true
      }
    }
  } else {
    // No request: preview what the version actually has, which is stored
    // patterns and nothing account-scoped.
    const stored = readSharedTocSelection(latestMeta)
    patterns = stored?.patterns ?? null
    ruleId = patterns ? 'custom' : null
    ruleName = typeof latestMeta.tocRuleLabel === 'string' ? latestMeta.tocRuleLabel : undefined
    autoScored = stored?.tocRuleAuto ?? false
  }

  const outMeta: { fallback?: boolean } = {}
  const rawChapters = scanTxtChapters(normalized, patterns ?? undefined, outMeta)
  const { chapters: effectiveChapters, excludedChapterIds } = applyTxtChapterExclusions(rawChapters, requestedExcludedChapterIds)

  const currentChapters = (latestMeta.chapters ?? []) as Chapter[]
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
    currentTotalChapters: currentChapters.length,
    levelCounts,
    excludedChapterIds,
    chapters,
  }
}

export async function reTocCityVersion(
  actorId: string,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
  tocRuleId?: string | null,
  customPatterns?: TocRulePattern[],
  excludedChapterIds?: string[],
): Promise<{ revisionId: string; revisionNo: number; chaptersChanged: boolean }> {
  const link = await getManagedVersionLink(actorId, libraryId, libraryBookId, versionLinkId)
  const db = getDb()
  const version = db.select().from(bookVersions).where(eq(bookVersions.id, link.bookVersionId)).get()
  if (!version || version.format !== 'txt') throw new AppError('UNSUPPORTED_FORMAT', 'Re-TOC only supports txt books')
  const latest = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, link.bookVersionId))
    .orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  if (!latest) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  const latestMeta = (latest.meta ?? {}) as Record<string, unknown>
  const storedExcludedChapterIds = Array.isArray(latestMeta.tocExcludedChapterIds)
    ? (latestMeta.tocExcludedChapterIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  const effectiveExcludedChapterIds = excludedChapterIds ?? storedExcludedChapterIds

  if (customPatterns && customPatterns.length > 0) {
    const active = customPatterns.filter((p) => p.enabled !== false)
    return rebuildCityToc(actorId, link, latest, latestMeta, active, false, customPatterns, effectiveExcludedChapterIds)
  }

  if (tocRuleId !== undefined) {
    if (tocRuleId !== null) {
      const rule = db.select().from(tocRules).where(and(eq(tocRules.id, tocRuleId), eq(tocRules.userId, actorId))).get()
      if (!rule) throw new AppError('TOC_RULE_NOT_FOUND')
      // The rule's patterns freeze onto the version and only its name travels
      // as a label, so the chapter map stops depending on the rule row later.
      return rebuildCityToc(
        actorId, link, latest, latestMeta,
        rule.patterns.filter((p) => p.enabled !== false),
        false, null, effectiveExcludedChapterIds, rule.name,
      )
    }
    const normalized = await getOrRecoverTxtNormalized({ filePath: latest.blobKey, id: link.bookVersionId, updatedAt: latest.createdAt, meta: latestMeta })
    const scored = scoreTocRules(actorId, normalized.slice(0, TOC_SAMPLE_SIZE))
    if (scored) {
      return rebuildCityToc(
        actorId, link, latest, latestMeta,
        scored.patterns.filter((p) => p.enabled !== false),
        true, null, effectiveExcludedChapterIds, scored.name,
      )
    }
    return rebuildCityToc(actorId, link, latest, latestMeta, null, false, null, effectiveExcludedChapterIds)
  }

  // No request: keep whatever the version already has. Reading it back must
  // never depend on whose account is asking, so a rule another account picked
  // stays exactly as it was (see readSharedTocSelection).
  const stored = readSharedTocSelection(latestMeta)
  if (stored) {
    const label = typeof latestMeta.tocRuleLabel === 'string' ? latestMeta.tocRuleLabel : null
    return rebuildCityToc(
      actorId, link, latest, latestMeta,
      stored.patterns, stored.tocRuleAuto, stored.customPatterns, effectiveExcludedChapterIds, label,
    )
  }

  const normalized = await getOrRecoverTxtNormalized({ filePath: latest.blobKey, id: link.bookVersionId, updatedAt: latest.createdAt, meta: latestMeta })
  const scored = scoreTocRules(actorId, normalized.slice(0, TOC_SAMPLE_SIZE))
  if (scored) {
    return rebuildCityToc(
      actorId, link, latest, latestMeta,
      scored.patterns.filter((p) => p.enabled !== false),
      true, null, effectiveExcludedChapterIds, scored.name,
    )
  }
  return rebuildCityToc(actorId, link, latest, latestMeta, null, false, null, effectiveExcludedChapterIds)
}

/**
 * What a shared version's stored TOC selection actually is, in a form no
 * account can influence.
 *
 * A city version's chapter map is content every member reads, so it must not
 * depend on a per-user `toc_rules` row: resolving one through the caller would
 * silently re-split the book with the maintainer's own rules whenever they
 * differ from the rule the publisher pinned, and would write the maintainer's
 * rule id into shared metadata. So a named rule is frozen into
 * `customTocPatterns` at write time (see rebuildCityToc) and read back here
 * from the patterns alone. `tocRuleId` is accepted for a pre-freeze version but
 * is only ever treated as the label it came from.
 */
function readSharedTocSelection(meta: Record<string, unknown>): {
  patterns: TocRulePattern[] | null
  customPatterns: TocRulePattern[] | null
  tocRuleAuto: boolean
} | null {
  const custom = Array.isArray(meta.customTocPatterns) ? meta.customTocPatterns as TocRulePattern[] : null
  if (custom && custom.length > 0) {
    return { patterns: custom.filter((p) => p.enabled !== false), customPatterns: custom, tocRuleAuto: false }
  }
  // A named rule frozen before the freeze landed: its patterns are not on the
  // version, so report "nothing stored" and let the caller's fallback decide
  // rather than guessing a pattern set the version never recorded.
  if (typeof meta.tocRuleId === 'string' && meta.tocRuleId !== 'custom') return null
  return { patterns: null, customPatterns: null, tocRuleAuto: meta.tocRuleAuto === true }
}

/**
 * Rebuild core for a shared-library version (Stage 6): same derivation as
 * rebuildTocBook, resolved against the city's revision. The Stage 1 write
 * discipline applies verbatim — changed bytes append, same bytes with new
 * boundaries append reusing the blob, unchanged splits only persist the rule
 * selection.
 */
async function rebuildCityToc(
  actorId: string,
  link: { id: string; bookVersionId: string; libraryBookId: string },
  latest: { id: string; blobKey: string; revisionNo: number; meta: unknown; createdAt: number },
  latestMeta: Record<string, unknown>,
  patterns: TocRulePattern[] | null,
  tocRuleAuto: boolean,
  customPatterns: TocRulePattern[] | null,
  requestedExcludedChapterIds: string[] = [],
  tocRuleLabel: string | null = null,
): Promise<{ revisionId: string; revisionNo: number; chaptersChanged: boolean }> {
  const db = getDb()
  const storage = getStorage()
  // A shared version stores the resolved patterns, never the caller's rule id:
  // the chapter map is content every member reads, so pinning a per-user rule
  // here would make one member's rule decide what another member sees, and
  // would let a later append re-split the book differently depending on who
  // ran it. The rule's name is kept for display only.
  const frozenPatterns = customPatterns ?? patterns
  const storedCustom = Array.isArray(latestMeta.customTocPatterns) ? latestMeta.customTocPatterns : null
  const storedExcluded = Array.isArray(latestMeta.tocExcludedChapterIds) ? latestMeta.tocExcludedChapterIds : []
  const storedChapters = latestMeta.chapters
  const selectionSame = JSON.stringify(storedCustom) === JSON.stringify(frozenPatterns)
    && (latestMeta.tocRuleAuto ?? false) === tocRuleAuto
    && JSON.stringify(storedExcluded) === JSON.stringify(requestedExcludedChapterIds)
  if (selectionSame && Array.isArray(storedChapters) && storedChapters.length > 0) {
    return { revisionId: latest.id, revisionNo: latest.revisionNo, chaptersChanged: false }
  }
  const normalized = await getOrRecoverTxtNormalized({ filePath: latest.blobKey, id: link.bookVersionId, updatedAt: latest.createdAt, meta: latestMeta })
  const rawChapters = scanTxtChapters(normalized, patterns ?? undefined)
  const { chapters, excludedChapterIds } = applyTxtChapterExclusions(rawChapters, requestedExcludedChapterIds)

  const metaChapters = carryChapterAddedAt(chapters.map((c) => ({
    id: txtChapterId(c),
    title: c.title,
    level: c.level,
    startOffset: c.startOffset,
    endOffset: c.endOffset,
    contentStartOffset: c.contentStartOffset,
    contentRanges: c.contentRanges,
    wordCount: countWords(getTxtChapterContent(normalized, c)),
  })), (latestMeta.chapters ?? []) as Array<{ id?: string }>, latest.createdAt)
  const wordCount = metaChapters.reduce((sum, c) => sum + c.wordCount, 0)
  const meta: Record<string, unknown> = {
    ...latestMeta,
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
  const oldChapters = (latestMeta.chapters ?? []) as Array<{ id?: string; title?: string; level?: number; wordCount?: number }>
  const chaptersChanged = chapterBoundariesChanged(oldChapters, metaChapters.map((c) => ({ id: c.id, title: c.title, level: c.level })))
  applySharedTocRuleSelection(meta, { patterns: frozenPatterns, tocRuleAuto, label: tocRuleLabel })

  const work = db.select({ title: libraryBooks.title, author: libraryBooks.author }).from(libraryBooks)
    .where(eq(libraryBooks.id, link.libraryBookId)).get()!
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
    { title: work.title, author: work.author || undefined, id: link.bookVersionId },
    epubChapters,
    contentFor,
  )
  const newFileKey = blobKey(sha256(epubBuffer), '.epub')
  const updatedAt = Date.now()
  const oldWordCount = oldChapters.reduce((sum, c) => sum + (c.wordCount ?? 0), 0)

  if (newFileKey !== latest.blobKey) {
    await storage.put(newFileKey, epubBuffer)
    const nextRevisionNo = latest.revisionNo + 1
    const newRevisionId = createId('rev')
    try {
      db.transaction((tx) => {
        tx.insert(contentRevisions).values({
          id: newRevisionId, bookVersionId: link.bookVersionId, revisionNo: nextRevisionNo,
          blobKey: newFileKey, size: epubBuffer.length, wordCount, chapterCount: metaChapters.length,
          meta, createdAt: updatedAt,
        }).run()
        tx.insert(blobs).values({ key: newFileKey, size: epubBuffer.length, kind: 'book', createdAt: updatedAt }).onConflictDoNothing().run()
        tx.update(bookVersions).set({ size: epubBuffer.length, updatedAt }).where(eq(bookVersions.id, link.bookVersionId)).run()
        tx.update(libraryBooks).set({ updatedAt }).where(eq(libraryBooks.id, link.libraryBookId)).run()
        // Every holder follows the new content: a pin left behind would keep
        // serving bytes this write just replaced, the state the old repin button
        // existed to resolve one reader at a time. Readers are told through
        // their own unread-update flag instead.
        tx.update(libraryBookVersions).set({ pinnedRevisionId: newRevisionId })
          .where(and(
            eq(libraryBookVersions.bookVersionId, link.bookVersionId),
            eq(libraryBookVersions.kind, 'shared'),
          )).run()
      })
    } catch (err) {
      await cleanupStagedUpload({ fileKey: newFileKey, coverKey: null })
      throw err
    }
    await refreshCityProgress(actorId, link.bookVersionId, {
      oldWordCount,
      newWordCount: wordCount,
      chaptersChanged,
      scaleActorPercent: false,
    })
    invalidateCachedNormalized(link.bookVersionId)
    await deleteUnreferencedRevision(latest.blobKey)
    return { revisionId: newRevisionId, revisionNo: nextRevisionNo, chaptersChanged }
  }

  if (chaptersChanged) {
    const nextRevisionNo = latest.revisionNo + 1
    const newRevisionId = createId('rev')
    db.transaction((tx) => {
      tx.insert(contentRevisions).values({
        id: newRevisionId, bookVersionId: link.bookVersionId, revisionNo: nextRevisionNo,
        blobKey: latest.blobKey, size: epubBuffer.length, wordCount, chapterCount: metaChapters.length,
        meta, createdAt: updatedAt,
      }).run()
      // Same bytes, new chapter map: readers follow the new structure.
      tx.update(libraryBookVersions).set({ pinnedRevisionId: newRevisionId })
        .where(and(
          eq(libraryBookVersions.bookVersionId, link.bookVersionId),
          eq(libraryBookVersions.kind, 'shared'),
        )).run()
    })
    await refreshCityProgress(actorId, link.bookVersionId, {
      oldWordCount,
      newWordCount: wordCount,
      chaptersChanged,
      scaleActorPercent: false,
    })
    invalidateCachedNormalized(link.bookVersionId)
    return { revisionId: newRevisionId, revisionNo: nextRevisionNo, chaptersChanged }
  }

  const base = { ...(latest.meta as Record<string, unknown> | null ?? {}) }
  applySharedTocRuleSelection(base, { patterns: frozenPatterns, tocRuleAuto, label: tocRuleLabel })
  db.update(contentRevisions).set({ meta: base }).where(eq(contentRevisions.id, latest.id)).run()
  return { revisionId: latest.id, revisionNo: latest.revisionNo, chaptersChanged }
}

/**
 * TOC baseline for the city picker UI (Stage 6): the version's stored rule
 * state plus chapter summaries, without touching list payloads. Gated exactly
 * like chapter reads — whoever may read the version may see its outline.
 *
 * A shared version's selection is self-contained patterns, so the picker reads
 * it back as "the book's own rule" whatever account asks; `tocRuleLabel` is
 * the name to show and nothing else resolves a `toc_rules` row.
 */
export interface VersionTocState {
  /** Always 'custom' when the version carries patterns; the picker edits them as such. */
  tocRuleId: string | null
  tocRuleAuto: boolean
  customPatterns: TocRulePattern[]
  /** Display-only name of the rule the patterns came from, if it had one. */
  tocRuleLabel: string | null
  excludedChapterIds: string[]
  chapters: Array<{ id: string; title: string; level: number; wordCount: number }>
}

export async function getVersionTocState(
  userId: string | null,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
): Promise<VersionTocState> {
  const db = getDb()
  const link = db.select().from(libraryBookVersions)
    .where(and(
      eq(libraryBookVersions.id, versionLinkId),
      eq(libraryBookVersions.libraryId, libraryId),
      eq(libraryBookVersions.libraryBookId, libraryBookId),
    )).get()
  if (!link) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
  await assertReadableBook(userId, link.bookVersionId)
  const latest = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, link.bookVersionId))
    .orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  if (!latest) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  const meta = (latest.meta ?? {}) as Record<string, unknown>
  const chapters = ((meta.chapters ?? []) as Array<{ id?: string; title?: string; level?: number; wordCount?: number }>)
    .filter((c) => typeof c.id === 'string')
    .map((c) => ({ id: c.id as string, title: c.title ?? '', level: c.level ?? 1, wordCount: c.wordCount ?? 0 }))
  const stored = readSharedTocSelection(meta)
  const patterns = Array.isArray(meta.customTocPatterns) ? meta.customTocPatterns as TocRulePattern[] : []
  return {
    tocRuleId: patterns.length > 0 ? 'custom' : null,
    tocRuleAuto: stored?.tocRuleAuto ?? false,
    customPatterns: patterns,
    tocRuleLabel: typeof meta.tocRuleLabel === 'string' ? meta.tocRuleLabel : null,
    excludedChapterIds: Array.isArray(meta.tocExcludedChapterIds)
      ? (meta.tocExcludedChapterIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : [],
    chapters,
  }
}

export async function getBookContent(userId: string | null, bookId: string, opts?: { showHidden?: boolean }): Promise<string> {
  const book = await getActiveBook(userId, bookId, opts)
  if (book.format !== 'txt') {
    throw new AppError('UNSUPPORTED_FORMAT', 'Content endpoint only supports txt')
  }
  return getOrRecoverTxtNormalized(book)
}

export async function getBookChapterContent(userId: string | null, bookId: string, chapterIndex: number, opts?: { showHidden?: boolean }) {
  const book = await getActiveBook(userId, bookId, opts)
  const chapters = await getBookChapters(userId, bookId, opts)
  const chapter = chapters[chapterIndex]
  if (!chapter) throw new AppError('VALIDATION_ERROR', 'Chapter index is out of range')

  const content = book.format === 'txt'
    ? getTxtChapterContent(await getBookContent(userId, bookId, opts), chapter).trim()
    : await extractEpubChapterText(await getBookEpubBuffer(userId, bookId, opts), chapterIndex)

  return {
    id: chapter.id,
    index: chapterIndex,
    title: chapter.title,
    level: chapter.level,
    wordCount: chapter.wordCount,
    content,
  }
}

export async function getBookEpubBuffer(userId: string | null, bookId: string, opts?: { showHidden?: boolean }): Promise<Buffer> {
  const storage = getStorage()
  const book = await getActiveBook(userId, bookId, opts)
  if (!(await storage.exists(book.filePath))) throw new AppError('BOOK_FILE_MISSING')
  return bufferFromStream(await storage.get(book.filePath))
}

export async function updateBook(userId: string, bookId: string, data: { readStatus?: string; progress?: number; pinned?: boolean; title?: string; author?: string; authors?: string[]; hidden?: boolean; bookmeta?: BookMetadata; tocRuleId?: string | null; coverPaletteId?: CoverPaletteId | null }) {
  const db = getDb()
  const { libraryBookId, libraryBookVersionId, kind } = resolveLibraryBook(userId, bookId)
  const now = Date.now()
  // Revision-bound display fields live on the shared BookVersion: a B may only
  // touch its own card (status, pin, title, author). The content-immutable
  // boundary is the same one append/re-toc obey.
  if (kind === 'shared' && (
    data.bookmeta !== undefined || data.tocRuleId !== undefined || data.coverPaletteId !== undefined
  )) {
    assertMutableContent(kind)
  }
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
  if (data.title || data.author !== undefined || data.authors !== undefined || data.hidden !== undefined) {
    const normalized = data.authors !== undefined || data.author !== undefined
      ? normalizeAuthors({ author: data.author, authors: data.authors })
      : null
    db.update(libraryBooks).set({
      ...(data.title ? { title: data.title } : {}),
      ...(normalized ? { author: normalized.author, authors: normalized.authors } : {}),
      // Card-local vault flag: hiding a collected B only hides the caller's
      // own card, never the shared source (same boundary as title/pin).
      ...(data.hidden !== undefined ? { hidden: data.hidden } : {}),
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
    // Curation class: hand-filled bookmeta and view prefs refresh in place by
    // design (same as title/author on the card); never a new revision.
    db.update(contentRevisions).set({ meta: baseMeta }).where(eq(contentRevisions.id, latestRevision.id)).run()
  }
  if (data.title || data.author !== undefined || data.authors !== undefined || data.hidden !== undefined || touchedMeta || data.pinned !== undefined || data.readStatus !== undefined || data.progress !== undefined) {
    db.update(libraryBooks).set({ updatedAt: now }).where(eq(libraryBooks.id, libraryBookId)).run()
  }
  // Card-local fields stay editable on a B whose source died (title, pin,
  // state): the card is retained by design, only its content reads are
  // blocked. skipSourceCheck keeps the write-then-throw split from turning an
  // applied edit into a NOT_FOUND.
  return stripMetaChapters(await resolvePrivateBook(userId, bookId, { allowDeleted: true, skipSourceCheck: true, showHidden: true }))
}

export async function updateBookCover(userId: string, bookId: string, file: File) {
  const db = getDb()
  const { libraryBookId, kind } = resolveLibraryBook(userId, bookId)
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
  try {
    db.insert(blobs).values({ key: coverKey, size: buffer.length, kind: 'cover', createdAt: now }).onConflictDoNothing().run()
    db.update(libraryBooks).set({ coverKey, updatedAt: now }).where(eq(libraryBooks.id, libraryBookId)).run()
  } catch (err) {
    await cleanupStagedCover(coverKey)
    throw err
  }
  // A private cover always wins over the inherited one, so a B needs no
  // shared-meta change to show it; touching the shared revision here would
  // un-suppress the cover for every library at once.
  // Card-local cover override: allowed on a dead-source B for the same reason
  // as updateBook — the card survives, only content reads are blocked.
  if (kind !== 'shared') {
    const latestRevision = db.select().from(contentRevisions)
      .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
    if (latestRevision) {
      const meta = { ...((latestRevision.meta ?? {}) as Record<string, unknown>) }
      delete meta.coverSuppressed
      db.update(contentRevisions).set({ meta }).where(eq(contentRevisions.id, latestRevision.id)).run()
    }
  }
  return stripMetaChapters(await resolvePrivateBook(userId, bookId, { allowDeleted: true, skipSourceCheck: true, showHidden: true }))
}

export async function getBookCover(userId: string | null, bookId: string): Promise<{ coverKey: string } | null> {
  const db = getDb()
  // Deleted rows stay cover-readable on purpose: the trash list renders
  // covers (greyed out). Chapters/content/epub stay active-gated.
  const book = await getBook(userId, bookId, { showHidden: true })
  const storage = getStorage()
  if (book.coverKey && await storage.exists(book.coverKey)) return { coverKey: book.coverKey }
  if (book.format !== 'epub' || book.meta?.coverSuppressed === true) return null
  if (!(await storage.exists(book.filePath))) return null
  const parser = getParser(book.filePath, '')
  if (!parser) return null
  if (!book.contentHash) return null
  try {
    const parsed = await parser.parse(await storage.get(book.filePath))
    if (!parsed.meta.cover) {
      // "This package has no artwork" is a stable fact about immutable bytes,
      // so record it. Without this every card render re-reads and re-parses the
      // whole epub just to answer 404. Same guard as removeBookCover: only a
      // private version writes the flag, because a shared revision's meta is
      // read by every library and its owner records the fact once for all.
      if (userId !== null) {
        const { kind } = resolveLibraryBook(userId, book.id)
        if (kind !== 'shared') {
          const latestRevision = db.select().from(contentRevisions)
            .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
          if (latestRevision) {
            const meta = { ...((latestRevision.meta ?? {}) as Record<string, unknown>), coverSuppressed: true }
            db.update(contentRevisions).set({ meta }).where(eq(contentRevisions.id, latestRevision.id)).run()
          }
        }
      }
      return null
    }
    const ext = detectImageExtension(parsed.meta.cover)
    if (!ext) return null
    const coverKey = blobKey(book.contentHash, `.cover.${ext}`)
    // Anonymous reads never materialize covers: persisting a repair needs a
    // private library row the guest does not have, and the put below would
    // orphan files before the row lookup below can fail.
    if (userId === null) return null
    await storage.put(coverKey, parsed.meta.cover)
    const thumb = await generateCoverThumbnail(parsed.meta.cover, ext)
    if (thumb) {
      await storage.put(coverThumbnailKey(coverKey), thumb)
    }
    const now = Date.now()
    try {
      db.insert(blobs).values({ key: coverKey, size: parsed.meta.cover.length, kind: 'cover', createdAt: now }).onConflictDoNothing().run()
      const { libraryBookId } = resolveLibraryBook(userId, book.id)
      db.update(libraryBooks).set({ coverKey, updatedAt: now }).where(eq(libraryBooks.id, libraryBookId)).run()
    } catch (err) {
      // resolveLibraryBook throws for direct (uncollected) reads after the
      // puts already landed: clean the staged files instead of orphaning them.
      await cleanupStagedCover(coverKey)
      throw err
    }
    return { coverKey }
  } catch {
    return null
  }
}

export async function getBookCoverContent(
  userId: string | null,
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
  const { libraryBookId, kind } = resolveLibraryBook(userId, bookId)
  const now = Date.now()
  db.update(libraryBooks).set({ coverKey: null, updatedAt: now }).where(eq(libraryBooks.id, libraryBookId)).run()
  // Clearing the private override reveals the inherited cover; writing the
  // suppression flag would hide it for every library sharing this revision.
  // Same card-local allowance as updateBookCover: a dead-source B keeps an
  // editable card, only its content reads are blocked.
  if (kind !== 'shared') {
    const latestRevision = db.select().from(contentRevisions)
      .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
    if (latestRevision) {
      const meta = { ...((latestRevision.meta ?? {}) as Record<string, unknown>), coverSuppressed: true }
      db.update(contentRevisions).set({ meta }).where(eq(contentRevisions.id, latestRevision.id)).run()
    }
  }
  return stripMetaChapters(await resolvePrivateBook(userId, bookId, { allowDeleted: true, skipSourceCheck: true, showHidden: true }))
}

export async function resetBookMetadata(userId: string, bookId: string, opts?: { normalizeTitle?: boolean }) {
  const db = getDb()
  // Rewrites the revision's derived metadata in place, which for a B is the
  // city's own revision.
  const { libraryBookId, kind } = resolveLibraryBook(userId, bookId)
  assertMutableContent(kind)
  const book = await getBook(userId, bookId, { showHidden: true })
  const storage = getStorage()
  const parser = getParser(book.filePath, '')
  if (!parser) throw new AppError('UNSUPPORTED_FORMAT')
  const parsed = await parser.parse(await storage.get(book.filePath))
  const latestRevision = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, bookId)).orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  const parsedBookmeta = parsed.meta.bookmeta ?? {}
  const storedBookmeta = ((latestRevision?.meta ?? {}) as Record<string, unknown>).bookmeta ?? {}
  if (latestRevision && JSON.stringify(parsedBookmeta) !== JSON.stringify(storedBookmeta)) {
    // Derived metadata changed: append a revision reusing the blob so the
    // previous description stays readable; an identical parse is a no-op.
    // A new revision id still moves collected pins, keeping the pin == newest
    // invariant the unread-update flag assumes.
    const newRevisionId = createId('rev')
    db.transaction((tx) => {
      tx.insert(contentRevisions).values({
        id: newRevisionId, bookVersionId: bookId, revisionNo: latestRevision.revisionNo + 1,
        blobKey: latestRevision.blobKey, size: latestRevision.size,
        wordCount: latestRevision.wordCount, chapterCount: latestRevision.chapterCount,
        meta: { ...((latestRevision.meta ?? {}) as Record<string, unknown>), bookmeta: parsedBookmeta },
        createdAt: Date.now(),
      }).run()
      tx.update(libraryBookVersions).set({ pinnedRevisionId: newRevisionId })
        .where(and(
          eq(libraryBookVersions.bookVersionId, bookId),
          eq(libraryBookVersions.kind, 'shared'),
        )).run()
    })
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
  const resetAuthors = normalizeAuthors({
    authors: parsed.meta.authors?.length
      ? parsed.meta.authors
      : derived?.authors?.length
        ? derived.authors
        : undefined,
    author,
  })
  const now = Date.now()
  db.update(libraryBooks).set({
    title: title || book.title,
    author: resetAuthors.author,
    authors: resetAuthors.authors,
    updatedAt: now,
  }).where(eq(libraryBooks.id, libraryBookId)).run()
  return stripMetaChapters(await resolvePrivateBook(userId, bookId, { allowDeleted: true, showHidden: true }))
}

/**
 * Managed version lookup shared by the city content writers (push/append/
 * re-toc): contributor gate plus link/work existence. B writers never reach
 * it — their guard rejects shared links first.
 */
async function getManagedVersionLink(actorId: string, libraryId: string, libraryBookId: string, versionLinkId: string) {
  await assertCanContribute(actorId, libraryId, versionLinkId)
  const db = getDb()
  const link = db.select().from(libraryBookVersions)
    .where(and(
      eq(libraryBookVersions.id, versionLinkId),
      eq(libraryBookVersions.libraryId, libraryId),
      eq(libraryBookVersions.libraryBookId, libraryBookId),
    )).get()
  if (!link) throw new AppError('LIBRARY_VERSION_NOT_FOUND', 'Library version not found')
  const work = db.select({ deletedAt: libraryBooks.deletedAt }).from(libraryBooks)
    .where(and(eq(libraryBooks.id, libraryBookId), eq(libraryBooks.libraryId, libraryId))).get()
  if (!work || work.deletedAt) throw new AppError('LIBRARY_BOOK_NOT_FOUND', 'Library book not found')
  return link
}

/**
 * Chapter-split comparison shared by every revision writer: title+level
 * sequences decide staleness, not byte offsets — offsets drift through EPUB
 * recovery serialization while the split stays identical, and CFIs address
 * chapter files, not meta offsets. Title renames still count: readers see
 * them in the TOC.
 */
function chapterBoundariesChanged(
  oldChapters: Array<{ id?: string; title?: string; level?: number }> | undefined,
  newChapters: Array<{ id?: string; title?: string; level?: number }>,
): boolean {
  if (!oldChapters) return true
  if (oldChapters.length !== newChapters.length) return true
  return oldChapters.some((c, i) => (c.title ?? '') !== (newChapters[i]?.title ?? '')
    || (c.level ?? 1) !== (newChapters[i]?.level ?? 1))
}

/**
 * Drop a content blob once no revision points at it. A pin that outlived its
 * revision would keep serving deleted bytes, so pins are cleared together with
 * the row they referenced; anything still reading a pinned revision therefore
 * keeps that revision alive.
 */
async function deleteUnreferencedRevision(blobKey: string): Promise<void> {
  const db = getDb()
  const refs = db.select({ count: sql<number>`count(*)` }).from(contentRevisions).where(eq(contentRevisions.blobKey, blobKey)).get()
  if ((refs?.count ?? 0) > 0 || !await getStorage().exists(blobKey)) return
  await getStorage().delete(blobKey)
  db.delete(blobs).where(eq(blobs.key, blobKey)).run()
}

/**
 * Revision retention: reads only ever resolve the latest revision (private)
 * or the moved-forward pin (shared), so older revisions are pure disk cost
 * with no product use. Keeps the latest revision per BookVersion plus any
 * revision still pinned by a library card (FK + stale-pin safety), then
 * collects blobs nothing references anymore. Runs in the boot/periodic
 * sweep, never inside a content-write transaction.
 */
export async function pruneOldContentRevisions(): Promise<{ prunedRevisions: number; deletedBlobs: number }> {
  const db = getDb()
  const storage = getStorage()
  const pinned = new Set(
    db.select({ id: libraryBookVersions.pinnedRevisionId }).from(libraryBookVersions)
      .where(isNotNull(libraryBookVersions.pinnedRevisionId)).all()
      .map((row) => row.id).filter((id): id is string => id !== null),
  )
  const latestByVersion = new Map<string, string>()
  for (const row of db.select({
    id: contentRevisions.id,
    bookVersionId: contentRevisions.bookVersionId,
    revisionNo: contentRevisions.revisionNo,
  }).from(contentRevisions).orderBy(desc(contentRevisions.revisionNo)).all()) {
    if (!latestByVersion.has(row.bookVersionId)) latestByVersion.set(row.bookVersionId, row.id)
  }
  const keep = new Set([...pinned, ...latestByVersion.values()])
  const doomed = db.select({ id: contentRevisions.id, blobKey: contentRevisions.blobKey })
    .from(contentRevisions).all().filter((row) => !keep.has(row.id))
  for (let i = 0; i < doomed.length; i += 500) {
    db.delete(contentRevisions)
      .where(inArray(contentRevisions.id, doomed.slice(i, i + 500).map((row) => row.id))).run()
  }
  let deletedBlobs = 0
  for (const key of new Set(doomed.map((row) => row.blobKey))) {
    if (blobKeyReferenced(key)) continue
    try {
      if (await storage.exists(key)) await storage.delete(key)
      if (deleteBlobRowIfUnreferenced(key)) deletedBlobs++
    } catch (err) {
      log('warn', 'books.revision_prune_blob_failed', { error: err, meta: { key } })
    }
  }
  return { prunedRevisions: doomed.length, deletedBlobs }
}

async function refreshCityProgress(
  actorId: string,
  bookVersionId: string,
  opts: { oldWordCount: number; newWordCount: number; chaptersChanged: boolean; scaleActorPercent: boolean },
): Promise<void> {
  const db = getDb()
  // Position maintenance is best-effort: a broken progress file must never
  // fail the content update it rides along with.
  const refreshOne = async (uid: string, scale: boolean) => {
    try {
      const progress = await readProgressFile(uid, bookVersionId)
      if (!progress) return
      if (!scale && !opts.chaptersChanged) return
      if (!scale && !progress.cfi && !progress.chapter) return
      const nextProgress = { ...progress }
      if (scale) {
        const scaleFraction = (value: number) => Math.max(0, Math.min(1, value * scaleFactor))
        nextProgress.percent = Math.min(100, Math.round((progress.percent ?? 0) * scaleFactor))
        nextProgress.fraction = typeof progress.fraction === 'number' ? scaleFraction(progress.fraction) : progress.fraction
        nextProgress.intervals = (progress.intervals ?? []).map(([start, end]) => [scaleFraction(start), scaleFraction(end)] as [number, number])
        nextProgress.updatedAt = Date.now()
      }
      if (opts.chaptersChanged) {
        nextProgress.cfi = null
        nextProgress.chapter = null
      }
      await writeProgressFile(uid, bookVersionId, nextProgress as never)
      if (scale) {
        db.update(bookStates).set({ percent: nextProgress.percent, updatedAt: Date.now() })
          .where(and(eq(bookStates.userId, uid), eq(bookStates.bookVersionId, bookVersionId))).run()
      }
    } catch (err) {
      log('warn', 'books.city_progress_refresh_failed', { error: err, meta: { bookVersionId } })
    }
  }
  const scaleFactor = opts.scaleActorPercent && opts.newWordCount > 0 ? opts.oldWordCount / opts.newWordCount : 1
  await refreshOne(actorId, opts.scaleActorPercent)
  if (!opts.chaptersChanged) return
  // Every holder's pin moved to the new revision in the same transaction, so
  // everyone is now reading content this update just produced and every stored
  // CFI describes the old chapter map. Drop them all; the reader falls back to
  // the book fraction, which still lands in the right neighbourhood.
  const holders = db.select({ userId: bookStates.userId }).from(bookStates)
    .where(eq(bookStates.bookVersionId, bookVersionId)).all()
  for (const { userId } of holders) {
    if (userId === actorId) continue
    await refreshOne(userId, false)
  }
}

/**
 * One-click push of a private draft to its published library version (Stage 5):
 * appends the source's CURRENT bytes as the new revision, no file round-trip.
 * Defaults to the publish-time base; an explicit source overrides it. The
 * source must lead alone - a library that moved on since publishing is refused
 * rather than overwritten (see the guard below). The source must be the
 * caller's own non-shared book (no laundering B content upward).
 */
export async function pushPrivateToVersion(
  actorId: string,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
  sourceBookVersionId?: string,
): Promise<{ revisionId: string; revisionNo: number; alreadyUpToDate: boolean; diverged: boolean }> {
  const link = await getManagedVersionLink(actorId, libraryId, libraryBookId, versionLinkId)
  const db = getDb()
  const sourceId = sourceBookVersionId ?? link.sourceBaseVersionId
  if (!sourceId) {
    throw new AppError('VALIDATION_ERROR', 'No linked source book; pass sourceBookVersionId or upload a file')
  }
  const sourceLink = resolveLibraryBook(actorId, sourceId)
  assertMutableContent(sourceLink.kind)
  const sourceLatest = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, sourceId))
    .orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  if (!sourceLatest) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  // A version's declared format is part of its content identity: every reader
  // branches on it (TXT export, which bytes the reader loads, whether recovery
  // rebuilds from the artifact), and no migration can restore the meaning of a
  // history whose format changed under it. So a push may only ever refresh a
  // version of the same format — switching format is what uploading a new
  // version is for, and a work can hold both formats side by side. The default
  // source (the publish-time base) is same-format by construction, so this only
  // guards an explicitly chosen source.
  const targetVersion = db.select().from(bookVersions).where(eq(bookVersions.id, link.bookVersionId)).get()
  const sourceVersion = db.select().from(bookVersions).where(eq(bookVersions.id, sourceId)).get()
  if (targetVersion && sourceVersion && targetVersion.format !== sourceVersion.format) {
    throw new AppError(
      'UNSUPPORTED_FORMAT',
      `Source is ${sourceVersion.format} and the target version is ${targetVersion.format}; upload it as a new version instead`,
    )
  }
  const targetLatest = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, link.bookVersionId))
    .orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  // Byte identity against the publish snapshot, never a revision count: a
  // same-blob revision (a metadata reset) appends history without moving the
  // content, and counting it as divergence would cry wolf about a book nobody
  // changed. An unknown base counts as diverged - there is nothing to compare
  // against, so nothing may be overwritten on that guess.
  const baseBlob = link.sourceBaseRevisionId
    ? db.select({ blobKey: contentRevisions.blobKey }).from(contentRevisions)
        .where(eq(contentRevisions.id, link.sourceBaseRevisionId)).get()?.blobKey ?? null
    : null
  const diverged = baseBlob === null || targetLatest?.blobKey !== baseBlob
  if (targetLatest && sourceLatest.blobKey === targetLatest.blobKey) {
    return { revisionId: targetLatest.id, revisionNo: targetLatest.revisionNo, alreadyUpToDate: true, diverged }
  }
  // Only a source that leads alone may push. Once the library wrote anything
  // since the publish snapshot, this push would discard it with no way back:
  // the pin follows the newest revision, so members following the library read
  // the overwritten bytes, and no reader surface exposes an older one. Rather
  // than silently resolve a two-sided edit by picking a winner, refuse and let
  // the owner publish the intended content as a new version, where both sides
  // stay intact.
  if (diverged) {
    throw new AppError(
      'VALIDATION_ERROR',
      'The library version changed after publishing; publish the intended content as a new version instead',
    )
  }
  const baseMeta = ((targetLatest?.meta ?? {}) as Record<string, unknown>)
  const meta: Record<string, unknown> = {
    ...(sourceLatest.meta as Record<string, unknown> | null ?? {}),
  }
  for (const key of ['coverPaletteId', 'coverSuppressed'] as const) {
    if (baseMeta[key] !== undefined) meta[key] = baseMeta[key]
  }
  const updatedAt = Date.now()
  const nextRevisionNo = (targetLatest?.revisionNo ?? 0) + 1
  const newRevisionId = createId('rev')
  db.transaction((tx) => {
    tx.insert(contentRevisions).values({
      id: newRevisionId, bookVersionId: link.bookVersionId, revisionNo: nextRevisionNo,
      blobKey: sourceLatest.blobKey, size: sourceLatest.size,
      wordCount: sourceLatest.wordCount, chapterCount: sourceLatest.chapterCount,
      meta, createdAt: updatedAt,
    }).run()
    tx.insert(blobs).values({ key: sourceLatest.blobKey, size: sourceLatest.size, kind: 'book', createdAt: updatedAt }).onConflictDoNothing().run()
    tx.update(bookVersions).set({ size: sourceLatest.size, updatedAt }).where(eq(bookVersions.id, link.bookVersionId)).run()
    tx.update(libraryBooks).set({ updatedAt }).where(eq(libraryBooks.id, libraryBookId)).run()
    tx.update(libraryBookVersions).set({
      sourceBaseVersionId: sourceId,
      sourceBaseRevisionId: newRevisionId,
      updatedAt,
    }).where(eq(libraryBookVersions.id, link.id)).run()
    // Holders follow the pushed content, same as any other content write.
    tx.update(libraryBookVersions).set({ pinnedRevisionId: newRevisionId })
      .where(and(
        eq(libraryBookVersions.bookVersionId, link.bookVersionId),
        eq(libraryBookVersions.kind, 'shared'),
      )).run()
  })
  await refreshCityProgress(actorId, link.bookVersionId, {
    oldWordCount: targetLatest?.wordCount ?? 0,
    newWordCount: sourceLatest.wordCount ?? 0,
    chaptersChanged: chapterBoundariesChanged(
      ((targetLatest?.meta ?? {}) as Record<string, unknown>).chapters as Array<{ id?: string; title?: string; level?: number }> | undefined,
      (((sourceLatest.meta ?? {}) as Record<string, unknown>).chapters as Array<{ id?: string; title?: string; level?: number }> | undefined) ?? [],
    ),
    scaleActorPercent: true,
  })
  const oldBlobKey = targetLatest?.blobKey
  if (oldBlobKey && oldBlobKey !== sourceLatest.blobKey) {
    await deleteUnreferencedRevision(oldBlobKey)
  }
  const inserted = db.select({ id: contentRevisions.id }).from(contentRevisions)
    .where(and(eq(contentRevisions.bookVersionId, link.bookVersionId), eq(contentRevisions.revisionNo, nextRevisionNo))).get()!
  // Unreachable as diverged: the guard above refuses that case outright.
  return { revisionId: inserted.id, revisionNo: nextRevisionNo, alreadyUpToDate: false, diverged: false }
}

/**
 * Incremental append for a shared-library version (Stage 6): same derivation
 * as the private flow, resolved against the city's revision (stored rule
 * first, actor-scoped fallback) instead of a private card. Managers, or the
 * uploading member when the library opened uploads.
 */
export async function previewCityAppend(
  actorId: string,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
  appendedText: string,
  startOffset?: number,
): Promise<AppendContentPreviewRes> {
  const prepared = await prepareCityAppend(actorId, libraryId, libraryBookId, versionLinkId, appendedText, startOffset)
  return prepared.preview
}

async function prepareCityAppend(
  actorId: string,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
  appendedText: string,
  requestedStartOffset?: number,
) {
  if (!appendedText.trim()) throw new AppError('VALIDATION_ERROR', 'Append content is required')
  const link = await getManagedVersionLink(actorId, libraryId, libraryBookId, versionLinkId)
  const db = getDb()
  const version = db.select().from(bookVersions).where(eq(bookVersions.id, link.bookVersionId)).get()
  if (!version || version.format !== 'txt') throw new AppError('UNSUPPORTED_FORMAT', 'Appending content only supports txt books')
  const latest = db.select().from(contentRevisions)
    .where(eq(contentRevisions.bookVersionId, link.bookVersionId))
    .orderBy(desc(contentRevisions.revisionNo)).all().at(0)
  if (!latest) throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  const latestMeta = (latest.meta ?? {}) as Record<string, unknown>

  const normalized = await getOrRecoverTxtNormalized({ filePath: latest.blobKey, id: link.bookVersionId, updatedAt: latest.createdAt, meta: latestMeta })
  const appendedNormalized = normalizeText(appendedText)
  if (!appendedNormalized) throw new AppError('VALIDATION_ERROR', 'Append content is required')
  // The version's own stored patterns decide the split. Falling back to the
  // actor's rules here would make an append re-chapter the book differently
  // depending on who ran it, and would write that user's rule id into content
  // every other member reads.
  const stored = readSharedTocSelection(latestMeta)
  const patterns = stored?.patterns ?? null
  const storedExcludedChapterIds = Array.isArray(latestMeta.tocExcludedChapterIds)
    ? (latestMeta.tocExcludedChapterIds as unknown[]).filter((id): id is string => typeof id === 'string')
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

  const oldMetaChapters = ((latestMeta.chapters ?? []) as Array<{ id?: string }>)
  const metaChapters = carryChapterAddedAt(chapters.map((chapter) => ({
    id: txtChapterId(chapter),
    title: chapter.title,
    level: chapter.level,
    startOffset: chapter.startOffset,
    endOffset: chapter.endOffset,
    contentStartOffset: chapter.contentStartOffset,
    contentRanges: chapter.contentRanges,
    wordCount: countWords(getTxtChapterContent(mergedNormalized, chapter)),
  })), oldMetaChapters, latest.createdAt)
  const newWordCount = metaChapters.reduce((sum, chapter) => sum + chapter.wordCount, 0)
  const addedChapterCount = Math.max(0, metaChapters.length - oldMetaChapters.length)
  const preview: AppendContentPreviewRes = {
    originalChapterCount: oldMetaChapters.length,
    originalWordCount,
    newChapterCount: metaChapters.length,
    newWordCount,
    addedChapterCount,
    addedWordCount: Math.max(0, newWordCount - originalWordCount),
    candidateTextLength: appendedNormalized.length,
    candidateChapters,
    predictedStartIndex,
    addedChapters: metaChapters.slice(oldMetaChapters.length).map((chapter) => ({
      title: chapter.title,
      level: chapter.level,
      wordCount: chapter.wordCount,
    })),
    appendedToLastChapter: addedChapterCount === 0,
    ...(addedChapterCount === 0 && metaChapters.length > 0 ? { lastChapterTitle: metaChapters[metaChapters.length - 1]!.title } : {}),
  }

  return {
    link,
    version,
    latest,
    latestMeta,
    normalized,
    mergedNormalized,
    mergedRawChapters,
    chapters,
    excludedChapterIds,
    metaChapters,
    originalWordCount,
    newWordCount,
    chaptersChanged: chapterBoundariesChanged(
      oldMetaChapters,
      metaChapters.map((c) => ({ id: c.id, title: c.title, level: c.level })),
    ),
    preview,
  }
}

export async function appendCityVersionContent(
  actorId: string,
  libraryId: string,
  libraryBookId: string,
  versionLinkId: string,
  appendedText: string,
  startOffset?: number,
): Promise<{ revisionId: string; revisionNo: number }> {
  const prepared = await prepareCityAppend(actorId, libraryId, libraryBookId, versionLinkId, appendedText, startOffset)
  const db = getDb()
  const storage = getStorage()
  const { link, latest, latestMeta, mergedNormalized, mergedRawChapters, chapters, excludedChapterIds, metaChapters, originalWordCount, newWordCount, chaptersChanged } = prepared
  const work = db.select({ title: libraryBooks.title, author: libraryBooks.author }).from(libraryBooks)
    .where(eq(libraryBooks.id, libraryBookId)).get()!
  const meta: Record<string, unknown> = {
    ...latestMeta,
    chapters: metaChapters,
    wordCount: newWordCount,
    txtArtifactVersion: TXT_EPUB_ARTIFACT_VERSION,
  }
  const leadingExcludedId = mergedRawChapters[0] ? txtChapterId(mergedRawChapters[0]) : null
  if (excludedChapterIds.length > 0) meta.tocExcludedChapterIds = excludedChapterIds
  else delete meta.tocExcludedChapterIds
  if (mergedRawChapters[0]?.synthetic && leadingExcludedId && excludedChapterIds.includes(leadingExcludedId)) {
    const leadingText = getTxtChapterContent(mergedNormalized, mergedRawChapters[0]).trim()
    if (leadingText) meta.tocExcludedLeadingText = leadingText
  } else {
    delete meta.tocExcludedLeadingText
  }

  const epubChapters = chapters.map((chapter) => ({
    id: txtChapterId(chapter),
    title: chapter.title,
    level: chapter.level,
  }))
  const contentFor = (index: number) => getTxtChapterContent(mergedNormalized, chapters[index]!)
  const epubBuffer = await convertTxtToEpub(
    { title: work.title, author: work.author || undefined, id: link.bookVersionId },
    epubChapters,
    contentFor,
  )
  const fileKey = blobKey(sha256(epubBuffer), '.epub')
  await storage.put(fileKey, epubBuffer)

  const updatedAt = Date.now()
  const nextRevisionNo = latest.revisionNo + 1
  const newRevisionId = createId('rev')
  try {
    db.transaction((tx) => {
      tx.insert(contentRevisions).values({
        id: newRevisionId, bookVersionId: link.bookVersionId, revisionNo: nextRevisionNo,
        blobKey: fileKey, size: epubBuffer.length, wordCount: newWordCount,
        chapterCount: metaChapters.length, meta, createdAt: updatedAt,
      }).run()
      tx.insert(blobs).values({ key: fileKey, size: epubBuffer.length, kind: 'book', createdAt: updatedAt }).onConflictDoNothing().run()
      tx.update(bookVersions).set({ size: epubBuffer.length, updatedAt }).where(eq(bookVersions.id, link.bookVersionId)).run()
      tx.update(libraryBooks).set({ updatedAt }).where(eq(libraryBooks.id, libraryBookId)).run()
      // Every holder follows the new content: a pin that stayed behind would
      // keep serving bytes this write just replaced, which is the state the
      // old repin button existed to resolve one reader at a time. Readers learn
      // about it from their own "unread update" flag, not by acting on a pin.
      tx.update(libraryBookVersions).set({ pinnedRevisionId: newRevisionId })
        .where(and(
          eq(libraryBookVersions.bookVersionId, link.bookVersionId),
          eq(libraryBookVersions.kind, 'shared'),
        )).run()
    })
  } catch (err) {
    await cleanupStagedUpload({ fileKey, coverKey: null })
    throw err
  }
  // After the commit, never before: a failed write must not leave a reader
  // positioned for content that was never published.
  await refreshCityProgress(actorId, link.bookVersionId, {
    oldWordCount: originalWordCount,
    newWordCount,
    chaptersChanged,
    scaleActorPercent: true,
  })
  invalidateCachedNormalized(link.bookVersionId)
  const oldBlobKey = latest.blobKey
  if (oldBlobKey !== fileKey) {
    await deleteUnreferencedRevision(oldBlobKey)
  }
  return { revisionId: newRevisionId, revisionNo: nextRevisionNo }
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
    // Every version, not just the first: deleteBook removes the whole work on
    // the first call, and later versions of an already-gone work read as
    // NOT_FOUND instead of failing the sweep.
    const versions = db.select({ bookVersionId: libraryBookVersions.bookVersionId }).from(libraryBookVersions)
      .where(eq(libraryBookVersions.libraryBookId, row.id)).all()
    for (const version of versions) {
      await deleteBookLenient(userId, version.bookVersionId)
    }
  }
  return trashed.length
}

/** deleteBook that tolerates an already-removed work: purges iterate versions
 * of a work the first delete already took with it. Returns whether anything
 * was actually deleted, so capacity accounting stays honest. */
async function deleteBookLenient(userId: string, bookId: string): Promise<boolean> {
  try {
    await deleteBook(userId, bookId)
    return true
  } catch (err) {
    if (err instanceof AppError && err.code === 'BOOK_NOT_FOUND') return false
    throw err
  }
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
    const versions = db.select({ bookVersionId: libraryBookVersions.bookVersionId }).from(libraryBookVersions)
      .where(eq(libraryBookVersions.libraryBookId, row.id)).all()
    for (const version of versions) {
      await deleteBookLenient(userId, version.bookVersionId)
    }
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
    if (await deleteBookLenient(userId, row.bookVersionId)) {
      total -= row.size
      purged++
    }
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
      const versions = db.select({ bookVersionId: libraryBookVersions.bookVersionId }).from(libraryBookVersions)
        .where(eq(libraryBookVersions.libraryBookId, expired[i].id)).all()
      for (const version of versions) {
        await deleteBookLenient(expired[i].userId, version.bookVersionId)
      }
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

export async function deleteBook(userId: string, bookId: string, opts?: { deleteUserData?: boolean }) {
  const db = getDb()
  const storage = getStorage()
  // Removing your own card never requires the source to still be readable:
  // an unreadable B (unlisted source, lost membership, deleted library) is
  // exactly the card you most need to remove. The route discards this value.
  const book = await resolvePrivateBook(userId, bookId, { allowDeleted: true, skipSourceCheck: true, showHidden: true })
  const { libraryBookId } = resolveLibraryBook(userId, bookId)

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

  // One transaction for the whole removal. Deleting the private rows first
  // and the shared version afterwards used to leave "card gone but 500"
  // whenever another library still listed the version (restrict FK): a
  // version with any remaining library entry is kept, and only a version no
  // library lists anymore goes with its revisions (dependents cascade).
  const removedVersionIds: string[] = []
  db.transaction((tx) => {
    tx.delete(libraryBookTags).where(eq(libraryBookTags.libraryBookId, libraryBookId)).run()
    tx.delete(libraryBookVersions).where(eq(libraryBookVersions.libraryBookId, libraryBookId)).run()
    tx.delete(libraryBooks).where(eq(libraryBooks.id, libraryBookId)).run()
    if (opts?.deleteUserData) {
      for (const versionId of versionIds) {
        tx.delete(highlights).where(and(eq(highlights.userId, userId), eq(highlights.bookVersionId, versionId))).run()
        tx.delete(ideas).where(and(eq(ideas.userId, userId), eq(ideas.bookVersionId, versionId))).run()
        tx.delete(bookmarks).where(and(eq(bookmarks.userId, userId), eq(bookmarks.bookVersionId, versionId))).run()
        tx.delete(bookStates).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, versionId))).run()
        tx.delete(aiThreads).where(and(eq(aiThreads.userId, userId), or(eq(aiThreads.bookVersionId, versionId), eq(aiThreads.bookId, versionId)))).run()
        tx.delete(textReplacements).where(and(eq(textReplacements.userId, userId), or(eq(textReplacements.bookVersionId, versionId), eq(textReplacements.bookId, versionId)))).run()
        tx.delete(settings).where(and(eq(settings.userId, userId), eq(settings.key, `reader.book:${versionId}`))).run()
      }
    }
    for (const versionId of versionIds) {
      const stillListed = tx.select({ id: libraryBookVersions.id }).from(libraryBookVersions)
        .where(eq(libraryBookVersions.bookVersionId, versionId)).get()
      if (stillListed) continue
      // Defensive: a pin is owned by a library entry, so no live row can
      // still point at these revisions — but a stray pin must not trip the
      // NO ACTION reference on the revision delete below.
      const doomed = tx.select({ id: contentRevisions.id }).from(contentRevisions)
        .where(eq(contentRevisions.bookVersionId, versionId)).all()
      for (const row of doomed) {
        tx.update(libraryBookVersions).set({ pinnedRevisionId: null })
          .where(eq(libraryBookVersions.pinnedRevisionId, row.id)).run()
      }
      // Reading states, highlights, records and AI rows follow via cascade.
      tx.delete(bookVersions).where(eq(bookVersions.id, versionId)).run()
      removedVersionIds.push(versionId)
    }
  })

  // Content blobs are shared across versions; delete the physical file only
  // when no remaining revision references the key. Kept versions retain their
  // references even when the caller removes its own card.
  for (const key of new Set(revisionKeys)) {
    const refs = db.select({ count: sql<number>`count(*)` }).from(contentRevisions)
      .where(eq(contentRevisions.blobKey, key)).get()
    if ((refs?.count ?? 0) === 0) {
      if (await storage.exists(key)) await storage.delete(key)
      db.delete(blobs).where(eq(blobs.key, key)).run()
    }
  }
  // Progress file follows the version, not the card: deleting a B whose
  // version survives elsewhere keeps the caller's position (like the reading
  // rows the cascade keeps), and only a dying version takes it. Other
  // readers' slots are never touched either way.
  for (const versionId of removedVersionIds) {
    await deleteProgressFile(userId, versionId)
  }
  if (opts?.deleteUserData) {
    for (const versionId of versionIds) {
      if (!removedVersionIds.includes(versionId)) {
        await deleteProgressFile(userId, versionId).catch(() => undefined)
      }
    }
  }
  for (const coverKey of coverKeys) {
    // Covers are only referenced from the new model; legacy rows freeze.
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

export function resolveLibraryBook(userId: string, bookId: string): { libraryId: string; libraryBookId: string; libraryBookVersionId: string; kind: string } {
  const db = getDb()
  const library = db.select({ id: libraries.id }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  if (!library) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  const lbv = db.select({
    libraryBookId: libraryBookVersions.libraryBookId,
    id: libraryBookVersions.id,
    kind: libraryBookVersions.kind,
  }).from(libraryBookVersions)
    .where(and(eq(libraryBookVersions.libraryId, library.id), eq(libraryBookVersions.bookVersionId, bookId))).get()
  if (!lbv) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  return { libraryId: library.id, libraryBookId: lbv.libraryBookId, libraryBookVersionId: lbv.id, kind: lbv.kind }
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

export function getPrivateBatchSelection(userId: string, ids: string[]): BatchSelectionItem[] {
  const db = getDb()
  const libraryId = ensurePrivateLibrary(db, userId)
  const uniqueIds = [...new Set(ids)]
  const rows = db.select({
    id: libraryBookVersions.bookVersionId,
    libraryBookId: libraryBooks.id,
    categoryId: libraryBooks.categoryId,
    hidden: libraryBooks.hidden,
    pinnedAt: libraryBookVersions.pinnedAt,
    kind: libraryBookVersions.kind,
  }).from(libraryBookVersions)
    .innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
    .where(and(eq(libraryBooks.libraryId, libraryId), inArray(libraryBookVersions.bookVersionId, uniqueIds))).all()
  if (rows.length !== uniqueIds.length) throw new AppError('BOOK_NOT_FOUND')
  const tags = db.select().from(libraryBookTags)
    .where(inArray(libraryBookTags.libraryBookId, rows.map((row) => row.libraryBookId))).all()
  const tagIdsByWork = new Map<string, string[]>()
  for (const tag of tags) {
    const tagIds = tagIdsByWork.get(tag.libraryBookId) ?? []
    tagIds.push(tag.tagId)
    tagIdsByWork.set(tag.libraryBookId, tagIds)
  }
  const byId = new Map(rows.map((row) => [row.id, {
    id: row.id,
    categoryId: row.categoryId,
    tagIds: tagIdsByWork.get(row.libraryBookId) ?? [],
    hidden: row.hidden,
    pinnedAt: row.pinnedAt,
    versionCount: 1,
    kind: row.kind as LibraryVersionKind,
  }]))
  return ids.map((id) => byId.get(id)!).filter(Boolean)
}

export function organizePrivateBatch(userId: string, input: BatchOrganizeReq) {
  const db = getDb()
  const libraryId = ensurePrivateLibrary(db, userId)
  const ids = [...new Set(input.ids)]
  const rows = db.select({ id: libraryBookVersions.bookVersionId, libraryBookId: libraryBooks.id })
    .from(libraryBookVersions).innerJoin(libraryBooks, eq(libraryBooks.id, libraryBookVersions.libraryBookId))
    .where(and(eq(libraryBooks.libraryId, libraryId), inArray(libraryBookVersions.bookVersionId, ids))).all()
  if (rows.length !== ids.length) throw new AppError('BOOK_NOT_FOUND', 'Book not found')
  if (input.categoryId !== undefined && input.categoryId !== null && !db.select({ id: libraryCategories.id }).from(libraryCategories)
    .where(and(eq(libraryCategories.id, input.categoryId), eq(libraryCategories.libraryId, libraryId))).get()) throw new AppError('SHELF_NOT_FOUND')
  const addTagIds = [...new Set(input.addTagIds)]
  const removeTagIds = [...new Set(input.removeTagIds)]
  if (addTagIds.some((id) => removeTagIds.includes(id))) throw new AppError('VALIDATION_ERROR', 'Conflicting tag changes')
  const touchedTagIds = [...addTagIds, ...removeTagIds]
  if (touchedTagIds.length > 0) {
    const found = db.select({ id: libraryTags.id }).from(libraryTags)
      .where(and(eq(libraryTags.libraryId, libraryId), inArray(libraryTags.id, touchedTagIds))).all()
    if (found.length !== touchedTagIds.length) throw new AppError('TAG_NOT_FOUND')
  }
  const workIds = rows.map((row) => row.libraryBookId)
  const now = Date.now()
  db.transaction((tx) => {
    if (input.categoryId !== undefined) tx.update(libraryBooks)
      .set({ categoryId: input.categoryId, updatedAt: now })
      .where(inArray(libraryBooks.id, workIds)).run()
    for (const tagId of removeTagIds) tx.delete(libraryBookTags)
      .where(and(inArray(libraryBookTags.libraryBookId, workIds), eq(libraryBookTags.tagId, tagId))).run()
    for (const tagId of addTagIds) tx.insert(libraryBookTags)
      .values(workIds.map((libraryBookId) => ({ libraryBookId, tagId }))).onConflictDoNothing().run()
    for (const tagId of touchedTagIds) tx.update(libraryTags).set({ updatedAt: now }).where(eq(libraryTags.id, tagId)).run()
  })
  return { count: ids.length }
}
