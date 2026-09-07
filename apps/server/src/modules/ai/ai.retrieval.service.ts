import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'

import { AI_MAX_INDEX_CORPUS_CHARS } from '@bookdock/shared'
import type { AiEmbeddingStatus, AiIndexChapter, AiIndexReq, AiIndexRes, AiProvider, AiRetrievalCandidateSource, AiRetrievalDiagnostics, AiRetrievalFallbackReason, AiSearchReq, AiSearchRes, AiSearchResultRes } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { aiBookIndexes, aiChunkEmbeddings, aiChunks } from '../../db/schema'
import { extractEpubChapterText } from '../../formats/epub'
import { createId } from '../../lib/id'
import { AppError } from '../../middleware/error'
import { getActiveBook, getBookChapters, getBookContent, getBookEpubBuffer } from '../books/books.service'

const INDEXER_VERSION = 'lexical-v1-500-50'
const MAX_CHUNK_CHARS = 500
const CHUNK_OVERLAP_CHARS = 50
const MAX_QUERY_CHARS = 500
const MAX_SEARCH_RESULTS = 10
const MAX_CANDIDATES = 30
const EXCERPT_CHARS = 240
const RRF_K = 60
const EMBEDDING_BATCH_SIZE = 16
const QUERY_EMBEDDING_TIMEOUT_MS = 5_000

export type AiEmbeddingKind = 'document' | 'query'

export interface AiEmbeddingBatch {
  provider: AiProvider
  model: string
  vectors: number[][]
}

export type AiEmbedder = (texts: string[], signal: AbortSignal, kind: AiEmbeddingKind) => Promise<AiEmbeddingBatch>

export interface AiRetrievalOptions {
  signal?: AbortSignal
  embedder?: AiEmbedder
  /** Reader transformation fingerprint; prevents a tool call from using a raw or stale index. */
  visibleTextVersion?: string
}

interface ChunkDraft {
  chapterIndex: number
  chapterId: string
  chapterTitle: string
  startOffset: number
  endOffset: number
  text: string
}

interface FtsRow {
  id: string
  chapterIndex: number
  chapterId: string
  chapterTitle: string
  startOffset: number
  endOffset: number
  text: string
  rank: number | string
}

interface ChunkRow {
  id: string
  chapterIndex: number
  chapterId: string
  chapterTitle: string
  startOffset: number
  endOffset: number
  text: string
}

interface SemanticRow extends ChunkRow {
  score: number
}

interface RankedSearchResult {
  result: AiSearchResultRes
  lexicalRank?: number
  semanticRank?: number
}

interface AiIndexJob {
  promise: Promise<AiIndexRes>
  controller: AbortController
}

const indexJobs = new Map<string, AiIndexJob>()

function jobKey(userId: string, bookId: string) {
  return `${userId}:${bookId}`
}

function sourceVersionBase(book: { contentHash: string | null; filePath: string; updatedAt: number }) {
  return `${INDEXER_VERSION}:${book.contentHash ?? book.filePath}:${book.updatedAt}`
}

function sourceVersion(book: { contentHash: string | null; filePath: string; updatedAt: number }, visibleTextVersion?: string) {
  const base = sourceVersionBase(book)
  return visibleTextVersion ? `${base}:visible:${visibleTextVersion}` : base
}

function indexStatus(bookId: string, row: typeof aiBookIndexes.$inferSelect | undefined, version: string): AiIndexRes {
  if (!row) return { bookId, status: 'not_indexed', embeddingStatus: 'not_indexed', progress: 0, chunkCount: 0, updatedAt: null }
  const status = row.status === 'ready' && row.sourceVersion !== version && !row.sourceVersion.startsWith(`${version}:`) ? 'stale' : row.status
  const embeddingStatus: AiEmbeddingStatus = row.embeddingStatus ?? 'unavailable'
  return {
    bookId,
    sourceVersion: row.sourceVersion,
    status,
    embeddingStatus,
    ...(row.embeddingProvider ? { embeddingProvider: row.embeddingProvider as AiProvider } : {}),
    ...(row.embeddingModel ? { embeddingModel: row.embeddingModel } : {}),
    ...(row.embeddingDim === null ? {} : { embeddingDim: row.embeddingDim }),
    progress: row.progress,
    chunkCount: row.chunkCount,
    updatedAt: row.updatedAt,
    ...(row.error ? { error: row.error } : {}),
  }
}

function chunkEnd(text: string, start: number, hardEnd: number) {
  if (hardEnd >= text.length) return hardEnd
  const windowStart = Math.max(start, hardEnd - 120)
  const window = text.slice(windowStart, hardEnd)
  let boundary = -1
  for (const match of window.matchAll(/\n\s*\n|\n|[。！？!?；;](?=\s|$)|[.!?](?=\s|$)|\s+/g)) {
    boundary = match.index ?? boundary
  }
  return boundary < 0 ? hardEnd : windowStart + boundary + (window[boundary] === '\n' ? 1 : 0)
}

function chunkChapter(text: string): Array<{ startOffset: number; endOffset: number; text: string }> {
  const chunks: Array<{ startOffset: number; endOffset: number; text: string }> = []
  let start = 0
  while (start < text.length) {
    const hardEnd = Math.min(text.length, start + MAX_CHUNK_CHARS)
    const rawEnd = chunkEnd(text, start, hardEnd)
    const chunkStart = text.slice(start, rawEnd).search(/\S|$/) + start
    let chunkEndOffset = rawEnd
    while (chunkEndOffset > chunkStart && /\s/.test(text[chunkEndOffset - 1] ?? '')) chunkEndOffset -= 1
    if (chunkEndOffset > chunkStart) {
      chunks.push({ startOffset: chunkStart, endOffset: chunkEndOffset, text: text.slice(chunkStart, chunkEndOffset) })
    }
    if (rawEnd >= text.length) break
    start = Math.max(start + 1, rawEnd - CHUNK_OVERLAP_CHARS)
  }
  return chunks
}

async function buildChunkDrafts(userId: string, bookId: string, signal: AbortSignal, report: IndexProgressReporter, visibleChapters?: AiIndexChapter[]): Promise<ChunkDraft[]> {
  const book = await getActiveBook(userId, bookId)
  const chapters = await getBookChapters(userId, bookId)
  throwIfAborted(signal)
  report(0)
  if (visibleChapters) {
    const textByIndex = new Map(visibleChapters.map((chapter) => [chapter.chapterIndex, chapter.text]))
    if (textByIndex.size !== chapters.length || chapters.some((_chapter, index) => !textByIndex.has(index))) {
      throw new AppError('VALIDATION_ERROR', 'Reader corpus does not match the current book chapters')
    }
    const totalChars = visibleChapters.reduce((total, chapter) => total + chapter.text.length, 0)
    if (totalChars > AI_MAX_INDEX_CORPUS_CHARS) throw new AppError('VALIDATION_ERROR', 'Reader corpus is too large')
    const drafts: ChunkDraft[] = []
    for (const [chapterIndex, chapter] of chapters.entries()) {
      throwIfAborted(signal)
      const content = textByIndex.get(chapterIndex) ?? ''
      for (const chunk of chunkChapter(content)) {
        drafts.push({
          chapterIndex,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          ...chunk,
        })
      }
      report(((chapterIndex + 1) / Math.max(chapters.length, 1)) * 70)
    }
    return drafts
  }
  let txtContent: string | null = null
  let epubBuffer: Buffer | null = null
  if (book.format === 'txt') txtContent = await getBookContent(userId, bookId)
  else epubBuffer = await getBookEpubBuffer(userId, bookId)

  const drafts: ChunkDraft[] = []
  for (const [chapterIndex, chapter] of chapters.entries()) {
    throwIfAborted(signal)
    const content = book.format === 'txt'
      ? txtContent?.slice(chapter.contentStartOffset ?? chapter.startOffset, chapter.endOffset).trim() ?? ''
      : await extractEpubChapterText(epubBuffer!, chapterIndex)
    for (const chunk of chunkChapter(content)) {
      drafts.push({
        chapterIndex,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        ...chunk,
      })
    }
    report(((chapterIndex + 1) / Math.max(chapters.length, 1)) * 70)
  }
  return drafts
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('The AI retrieval request was aborted', 'AbortError')
}

type IndexProgressReporter = (progress: number, embeddingStatus?: AiEmbeddingStatus) => void

interface EmbeddingVector {
  chunkId: string
  model: string
  dimension: number
  vector: Buffer
}

interface EmbeddingBuildResult {
  status: AiEmbeddingStatus
  provider: AiProvider | null
  model: string | null
  dimension: number | null
  vectors: EmbeddingVector[]
  error: string | null
}

function updateIndexProgress(userId: string, indexId: string, progress: number, embeddingStatus?: AiEmbeddingStatus) {
  getDb().update(aiBookIndexes).set({
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    updatedAt: Date.now(),
    ...(embeddingStatus ? { embeddingStatus } : {}),
  }).where(and(
    eq(aiBookIndexes.id, indexId),
    eq(aiBookIndexes.userId, userId),
  )).run()
}

function vectorBuffer(values: unknown): { buffer: Buffer; dimension: number } {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('Embedding vector is invalid')
  }
  const buffer = Buffer.alloc(values.length * 4)
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4))
  return { buffer, dimension: values.length }
}

function vectorValues(buffer: Buffer, dimension: number) {
  if (buffer.length !== dimension * 4) return null
  const values = new Array<number>(dimension)
  for (let index = 0; index < dimension; index += 1) {
    const value = buffer.readFloatLE(index * 4)
    if (!Number.isFinite(value)) return null
    values[index] = value
  }
  return values
}

async function buildEmbeddings(chunks: Array<{ id: string; text: string }>, options: AiRetrievalOptions, report: IndexProgressReporter): Promise<EmbeddingBuildResult> {
  if (!options.embedder) {
    report(100, 'unavailable')
    return { status: 'unavailable', provider: null, model: null, dimension: null, vectors: [], error: null }
  }

  const signal = options.signal ?? new AbortController().signal
  throwIfAborted(signal)
  if (chunks.length === 0) {
    report(100, 'unavailable')
    return { status: 'unavailable', provider: null, model: null, dimension: null, vectors: [], error: null }
  }

  report(70, 'indexing')
  let provider: AiProvider | null = null
  let model: string | null = null
  let dimension: number | null = null
  const vectors: EmbeddingVector[] = []
  try {
    for (let offset = 0; offset < chunks.length; offset += EMBEDDING_BATCH_SIZE) {
      throwIfAborted(signal)
      const batchChunks = chunks.slice(offset, offset + EMBEDDING_BATCH_SIZE)
      const batch = await options.embedder(batchChunks.map((chunk) => chunk.text), signal, 'document')
      if (!batch || typeof batch.provider !== 'string' || !batch.provider.trim() || typeof batch.model !== 'string' || !batch.model.trim() || !Array.isArray(batch.vectors) || batch.vectors.length !== batchChunks.length) {
        throw new Error('Embedding batch shape is invalid')
      }
      const batchProvider = batch.provider as AiProvider
      const batchVectors = batch.vectors.map(vectorBuffer)
      const batchDimension = batchVectors[0]?.dimension
      if (!batchDimension || batchVectors.some((vector) => vector.dimension !== batchDimension)) throw new Error('Embedding dimensions do not match')
      if (provider && provider !== batchProvider) throw new Error('Embedding provider changed during indexing')
      if (model && model !== batch.model.trim()) throw new Error('Embedding model changed during indexing')
      if (dimension && dimension !== batchDimension) throw new Error('Embedding dimensions changed during indexing')
      provider = batchProvider
      model = batch.model.trim()
      dimension = batchDimension
      vectors.push(...batchChunks.map((chunk, index) => ({
        chunkId: chunk.id,
        model: model!,
        dimension: dimension!,
        vector: batchVectors[index]!.buffer,
      })))
      report(70 + ((offset + batchChunks.length) / chunks.length) * 30, 'indexing')
    }
    report(100, 'ready')
    return { status: 'ready', provider, model, dimension, vectors, error: null }
  } catch (error) {
    if (isAbort(error)) {
      throw error
    }
    if (error instanceof AppError && error.code === 'AI_NOT_CONFIGURED') {
      report(100, 'unavailable')
      return { status: 'unavailable', provider: null, model: null, dimension: null, vectors: [], error: null }
    }
    report(100, 'failed')
    return { status: 'failed', provider: null, model: null, dimension: null, vectors: [], error: 'Embedding failed; lexical search remains available' }
  }
}

function embeddingRows(userId: string, bookId: string, indexId: string, vectors: EmbeddingVector[]) {
  return vectors.map((vector) => ({
    id: createId('ai-embedding'),
    userId,
    indexId,
    chunkId: vector.chunkId,
    bookId,
    model: vector.model,
    dimension: vector.dimension,
    vector: vector.vector,
    createdAt: Date.now(),
  }))
}

function restoreIndex(userId: string, indexId: string, previous: typeof aiBookIndexes.$inferSelect | undefined) {
  const db = getDb()
  if (!previous) {
    db.delete(aiBookIndexes).where(and(eq(aiBookIndexes.id, indexId), eq(aiBookIndexes.userId, userId))).run()
    return
  }
  db.update(aiBookIndexes).set({
    sourceVersion: previous.sourceVersion,
    status: previous.status,
    embeddingStatus: previous.embeddingStatus,
    embeddingProvider: previous.embeddingProvider,
    embeddingModel: previous.embeddingModel,
    embeddingDim: previous.embeddingDim,
    progress: previous.progress,
    chunkCount: previous.chunkCount,
    error: previous.error,
    updatedAt: Date.now(),
  }).where(and(eq(aiBookIndexes.id, indexId), eq(aiBookIndexes.userId, userId))).run()
}

async function buildIndex(userId: string, input: AiIndexReq, options: AiRetrievalOptions): Promise<AiIndexRes> {
  const signal = options.signal ?? new AbortController().signal
  if (input.visibleTextVersion && !input.chapters) {
    throw new AppError('VALIDATION_ERROR', 'Reader corpus is required with visibleTextVersion')
  }
  const book = await getActiveBook(userId, input.bookId)
  const baseVersion = sourceVersionBase(book)
  const version = sourceVersion(book, input.visibleTextVersion)
  const db = getDb()
  const existing = db.select().from(aiBookIndexes).where(and(
    eq(aiBookIndexes.userId, userId),
    eq(aiBookIndexes.bookId, input.bookId),
  )).get()
  const existingMatches = input.visibleTextVersion
    ? existing?.sourceVersion === version
    : existing?.sourceVersion === baseVersion || existing?.sourceVersion.startsWith(`${baseVersion}:`)
  if (!input.force && existing?.status === 'ready' && existingMatches) {
    if (options.embedder && existing.embeddingStatus !== 'ready') {
      const indexId = existing.id
      const report = (progress: number, embeddingStatus?: AiEmbeddingStatus) => updateIndexProgress(userId, indexId, progress, embeddingStatus)
      db.update(aiBookIndexes).set({ embeddingStatus: 'indexing', progress: 70, error: null, updatedAt: Date.now() }).where(and(
        eq(aiBookIndexes.id, indexId),
        eq(aiBookIndexes.userId, userId),
      )).run()
      try {
        const chunks = db.select({ id: aiChunks.id, text: aiChunks.text })
          .from(aiChunks)
          .where(and(eq(aiChunks.userId, userId), eq(aiChunks.bookId, input.bookId), eq(aiChunks.indexId, indexId)))
          .orderBy(asc(aiChunks.createdAt), asc(aiChunks.startOffset))
          .all()
        const result = await buildEmbeddings(chunks, options, report)
        throwIfAborted(signal)
        const rows = embeddingRows(userId, input.bookId, indexId, result.vectors)
        db.transaction((tx) => {
          tx.delete(aiChunkEmbeddings).where(and(
            eq(aiChunkEmbeddings.userId, userId),
            eq(aiChunkEmbeddings.indexId, indexId),
          )).run()
          if (rows.length > 0) tx.insert(aiChunkEmbeddings).values(rows).run()
          tx.update(aiBookIndexes).set({
            embeddingStatus: result.status,
            embeddingProvider: result.provider,
            embeddingModel: result.model,
            embeddingDim: result.dimension,
            progress: 100,
            error: result.error,
            updatedAt: Date.now(),
          }).where(and(eq(aiBookIndexes.id, indexId), eq(aiBookIndexes.userId, userId))).run()
        })
        const refreshed = db.select().from(aiBookIndexes).where(and(eq(aiBookIndexes.id, indexId), eq(aiBookIndexes.userId, userId))).get()
        return indexStatus(input.bookId, refreshed, baseVersion)
      } catch (error) {
        if (isAbort(error)) restoreIndex(userId, indexId, existing)
        else updateIndexProgress(userId, indexId, 100, 'failed')
        throw error
      }
    }
    return indexStatus(input.bookId, existing, version)
  }

  const indexId = existing?.id ?? createId('ai-index')
  const now = Date.now()
  if (existing) {
    db.update(aiBookIndexes).set({
      sourceVersion: version,
      status: 'indexing',
      embeddingStatus: 'not_indexed',
      embeddingProvider: null,
      embeddingModel: null,
      embeddingDim: null,
      progress: 0,
      error: null,
      updatedAt: now,
    }).where(and(eq(aiBookIndexes.id, existing.id), eq(aiBookIndexes.userId, userId))).run()
  } else {
    db.insert(aiBookIndexes).values({
      id: indexId,
      userId,
      bookId: input.bookId,
      sourceVersion: version,
      status: 'indexing',
      embeddingStatus: 'not_indexed',
      embeddingProvider: null,
      progress: 0,
      chunkCount: 0,
      createdAt: now,
      updatedAt: now,
    }).run()
  }

  const report = (progress: number, embeddingStatus?: AiEmbeddingStatus) => updateIndexProgress(userId, indexId, progress, embeddingStatus)
  try {
    const drafts = await buildChunkDrafts(userId, input.bookId, signal, report, input.chapters)
    throwIfAborted(signal)
    const chunkRows = drafts.map((draft) => ({
      id: createId('ai-chunk'),
      userId,
      indexId,
      bookId: input.bookId,
      ...draft,
      createdAt: now,
    }))
    const embedding = await buildEmbeddings(chunkRows, options, report)
    throwIfAborted(signal)
    const rows = embeddingRows(userId, input.bookId, indexId, embedding.vectors)
    db.transaction((tx) => {
      tx.delete(aiChunks).where(and(
        eq(aiChunks.userId, userId),
        eq(aiChunks.indexId, indexId),
      )).run()
      for (let offset = 0; offset < chunkRows.length; offset += 50) {
        const batch = chunkRows.slice(offset, offset + 50)
        if (batch.length > 0) tx.insert(aiChunks).values(batch).run()
      }
      if (rows.length > 0) tx.insert(aiChunkEmbeddings).values(rows).run()
      tx.update(aiBookIndexes).set({
        status: 'ready',
        progress: 100,
        chunkCount: chunkRows.length,
        embeddingStatus: embedding.status,
        embeddingProvider: embedding.provider,
        embeddingModel: embedding.model,
        embeddingDim: embedding.dimension,
        error: embedding.error,
        updatedAt: Date.now(),
      }).where(and(
        eq(aiBookIndexes.id, indexId),
        eq(aiBookIndexes.userId, userId),
      )).run()
    })
  } catch (error) {
    if (isAbort(error)) {
      restoreIndex(userId, indexId, existing)
      throw error
    }
    db.update(aiBookIndexes).set({ status: 'failed', progress: 100, error: 'Index build failed', updatedAt: Date.now() }).where(and(
      eq(aiBookIndexes.id, indexId),
      eq(aiBookIndexes.userId, userId),
    )).run()
    if (error instanceof AppError) throw error
    throw new AppError('AI_INDEX_FAILED', 'Unable to build the book search index')
  }

  const ready = db.select().from(aiBookIndexes).where(and(eq(aiBookIndexes.id, indexId), eq(aiBookIndexes.userId, userId))).get()
  return indexStatus(input.bookId, ready, baseVersion)
}

export async function indexAiBook(userId: string, input: AiIndexReq, options: AiRetrievalOptions = {}): Promise<AiIndexRes> {
  const key = jobKey(userId, input.bookId)
  const running = indexJobs.get(key)
  if (running) return running.promise
  const controller = new AbortController()
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
  const job = buildIndex(userId, input, { ...options, signal })
  const entry = { promise: job, controller }
  indexJobs.set(key, entry)
  try {
    return await job
  } finally {
    if (indexJobs.get(key) === entry) indexJobs.delete(key)
  }
}

export async function cancelAiBookIndex(userId: string, bookId: string) {
  const job = indexJobs.get(jobKey(userId, bookId))
  if (!job) return false
  job.controller.abort()
  try {
    await job.promise
  } catch { }
  return true
}

export async function clearAiBookIndex(userId: string, bookId: string) {
  const running = indexJobs.get(jobKey(userId, bookId))
  if (running) {
    running.controller.abort()
    try {
      await running.promise
    } catch { }
  }
  await getActiveBook(userId, bookId)
  getDb().delete(aiBookIndexes).where(and(
    eq(aiBookIndexes.userId, userId),
    eq(aiBookIndexes.bookId, bookId),
  )).run()
}

function getIndexRow(userId: string, bookId: string) {
  return getDb().select().from(aiBookIndexes).where(and(
    eq(aiBookIndexes.userId, userId),
    eq(aiBookIndexes.bookId, bookId),
  )).get()
}

export async function getAiIndexStatus(userId: string, bookId: string): Promise<AiIndexRes> {
  const book = await getActiveBook(userId, bookId)
  return indexStatus(bookId, getIndexRow(userId, bookId), sourceVersionBase(book))
}

interface EnsuredIndex {
  status: AiIndexRes
  row?: typeof aiBookIndexes.$inferSelect
}

async function ensureIndex(userId: string, bookId: string, options: AiRetrievalOptions): Promise<EnsuredIndex> {
  if (options.visibleTextVersion) {
    const book = await getActiveBook(userId, bookId)
    const row = getIndexRow(userId, bookId)
    const version = sourceVersion(book, options.visibleTextVersion)
    if (row?.status === 'ready' && row.sourceVersion === version) {
      return { status: indexStatus(bookId, row, version), row }
    }
    return { status: indexStatus(bookId, row, version) }
  }
  const status = await getAiIndexStatus(userId, bookId)
  if (status.status === 'ready') return { status, row: getIndexRow(userId, bookId) }
  const built = await indexAiBook(userId, { bookId }, { signal: options.signal })
  return { status: built, row: getIndexRow(userId, bookId) }
}

function ftsQuery(query: string) {
  return query.trim().split(/\s+/).filter(Boolean).map((term) => `"${term.replaceAll('"', '""')}"`).join(' ')
}

function escapeLike(value: string) {
  return `%${value.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_')}%`
}

function excerpt(text: string, query: string) {
  const lowerText = text.toLocaleLowerCase()
  const lowerQuery = query.toLocaleLowerCase()
  const matchIndex = lowerText.indexOf(lowerQuery)
  const start = matchIndex < 0 ? 0 : Math.max(0, matchIndex - Math.floor(EXCERPT_CHARS / 3))
  const end = Math.min(text.length, start + EXCERPT_CHARS)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

function citationOffsets(row: ChunkRow, query: string): { startOffset: number; endOffset: number } {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) return { startOffset: row.startOffset, endOffset: row.endOffset }
  const lowerText = row.text.toLocaleLowerCase()
  const exactIndex = lowerText.indexOf(normalizedQuery.toLocaleLowerCase())
  if (exactIndex >= 0) {
    return {
      startOffset: row.startOffset + exactIndex,
      endOffset: row.startOffset + exactIndex + normalizedQuery.length,
    }
  }
  for (const term of normalizedQuery.split(/\s+/).filter(Boolean)) {
    const termIndex = lowerText.indexOf(term.toLocaleLowerCase())
    if (termIndex >= 0) {
      return {
        startOffset: row.startOffset + termIndex,
        endOffset: row.startOffset + termIndex + term.length,
      }
    }
  }
  return { startOffset: row.startOffset, endOffset: row.endOffset }
}

function toSearchResult(row: ChunkRow, query: string, score = 0): AiSearchResultRes {
  return {
    id: row.id,
    chapterIndex: row.chapterIndex,
    chapterId: row.chapterId,
    chapterTitle: row.chapterTitle,
    ...citationOffsets(row, query),
    excerpt: excerpt(row.text, query),
    score,
  }
}

function likeScore(text: string, query: string) {
  const lowerText = text.toLocaleLowerCase()
  const lowerQuery = query.toLocaleLowerCase()
  if (!lowerQuery) return 0
  let count = 0
  let offset = 0
  while (true) {
    const match = lowerText.indexOf(lowerQuery, offset)
    if (match < 0) break
    count += 1
    offset = match + lowerQuery.length
  }
  return count
}

function ftsSearch(userId: string, input: AiSearchReq): FtsRow[] {
  const query = ftsQuery(input.query)
  if (!query) return []
  const chapterMin = input.minChapterIndex !== undefined && input.minChapterIndex >= 0
    ? sql` AND chunks.chapter_index >= ${input.minChapterIndex}`
    : sql``
  const chapterMax = input.maxChapterIndex !== undefined && input.maxChapterIndex >= 0
    ? sql` AND chunks.chapter_index <= ${input.maxChapterIndex}`
    : sql``
  try {
    return getDb().all(sql`
      SELECT chunks.id AS id,
             chunks.chapter_index AS chapterIndex,
             chunks.chapter_id AS chapterId,
             chunks.chapter_title AS chapterTitle,
             chunks.start_offset AS startOffset,
             chunks.end_offset AS endOffset,
             chunks.text AS text,
             bm25(ai_chunks_fts) AS rank
      FROM ai_chunks_fts
      INNER JOIN ai_chunks AS chunks ON chunks.id = ai_chunks_fts.chunk_id
      WHERE ai_chunks_fts MATCH ${query}
        AND ai_chunks_fts.user_id = ${userId}
        AND ai_chunks_fts.book_id = ${input.bookId}
        AND chunks.user_id = ${userId}
        AND chunks.book_id = ${input.bookId}
        ${chapterMin}
        ${chapterMax}
      ORDER BY rank ASC
      LIMIT ${input.limit ?? MAX_CANDIDATES}
    `) as unknown as FtsRow[]
  } catch {
    return []
  }
}

function likeSearch(userId: string, input: AiSearchReq): ChunkRow[] {
  const chapterMin = input.minChapterIndex !== undefined && input.minChapterIndex >= 0
    ? gte(aiChunks.chapterIndex, input.minChapterIndex)
    : undefined
  const chapterMax = input.maxChapterIndex !== undefined && input.maxChapterIndex >= 0
    ? lte(aiChunks.chapterIndex, input.maxChapterIndex)
    : undefined
  const conditions = [
    eq(aiChunks.userId, userId),
    eq(aiChunks.bookId, input.bookId),
    sql`${aiChunks.text} LIKE ${escapeLike(input.query)} ESCAPE '!'`,
  ]
  if (chapterMin) conditions.push(chapterMin)
  if (chapterMax) conditions.push(chapterMax)
  return getDb().select({
    id: aiChunks.id,
    chapterIndex: aiChunks.chapterIndex,
    chapterId: aiChunks.chapterId,
    chapterTitle: aiChunks.chapterTitle,
    startOffset: aiChunks.startOffset,
    endOffset: aiChunks.endOffset,
    text: aiChunks.text,
  }).from(aiChunks).where(and(...conditions)).orderBy(asc(aiChunks.chapterIndex), asc(aiChunks.startOffset)).limit(input.limit ?? MAX_CANDIDATES).all()
}

function cosine(left: number[], right: number[]) {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!
    leftNorm += left[index]! * left[index]!
    rightNorm += right[index]! * right[index]!
  }
  if (leftNorm <= 0 || rightNorm <= 0) return null
  return dot / Math.sqrt(leftNorm * rightNorm)
}

async function vectorSearch(userId: string, input: AiSearchReq, indexRow: typeof aiBookIndexes.$inferSelect, options: AiRetrievalOptions): Promise<{ rows: SemanticRow[]; reason?: AiRetrievalFallbackReason }> {
  if (!options.embedder || indexRow.embeddingStatus !== 'ready' || !indexRow.embeddingModel || !indexRow.embeddingDim) return { rows: [], reason: 'not_ready' }
  const signal = options.signal ?? new AbortController().signal
  const queryBatch = await options.embedder([input.query], signal, 'query')
  if (!indexRow.embeddingProvider || queryBatch.provider !== indexRow.embeddingProvider || queryBatch.model.trim() !== indexRow.embeddingModel) return { rows: [], reason: 'provider_mismatch' }
  if (queryBatch.vectors.length !== 1) return { rows: [], reason: 'invalid_response' }
  const queryVector = vectorBuffer(queryBatch.vectors[0]).buffer
  const queryValues = vectorValues(queryVector, indexRow.embeddingDim)
  if (!queryValues) return { rows: [], reason: 'invalid_response' }
  const chapterMin = input.minChapterIndex !== undefined && input.minChapterIndex >= 0
    ? gte(aiChunks.chapterIndex, input.minChapterIndex)
    : undefined
  const chapterMax = input.maxChapterIndex !== undefined && input.maxChapterIndex >= 0
    ? lte(aiChunks.chapterIndex, input.maxChapterIndex)
    : undefined
  const conditions = [
    eq(aiChunkEmbeddings.userId, userId),
    eq(aiChunkEmbeddings.bookId, input.bookId),
    eq(aiChunkEmbeddings.indexId, indexRow.id),
    eq(aiChunkEmbeddings.model, indexRow.embeddingModel),
    eq(aiChunkEmbeddings.dimension, indexRow.embeddingDim),
  ]
  if (chapterMin) conditions.push(chapterMin)
  if (chapterMax) conditions.push(chapterMax)
  const rows = getDb().select({
    id: aiChunks.id,
    chapterIndex: aiChunks.chapterIndex,
    chapterId: aiChunks.chapterId,
    chapterTitle: aiChunks.chapterTitle,
    startOffset: aiChunks.startOffset,
    endOffset: aiChunks.endOffset,
    text: aiChunks.text,
    vector: aiChunkEmbeddings.vector,
  }).from(aiChunkEmbeddings).innerJoin(aiChunks, eq(aiChunkEmbeddings.chunkId, aiChunks.id)).where(and(...conditions)).all()
  return { rows: rows.flatMap((row) => {
    const values = vectorValues(row.vector, indexRow.embeddingDim!)
    const score = values ? cosine(queryValues, values) : null
    return score === null ? [] : [{ ...row, score }]
  }).sort((left, right) => right.score - left.score).slice(0, input.limit ?? MAX_CANDIDATES) }
}

function lexicalResults(rows: FtsRow[] | ChunkRow[], query: string): AiSearchResultRes[] {
  const results = rows.map((row) => toSearchResult(row, query, 'rank' in row ? Math.max(0, -Number(row.rank) || 0) : likeScore(row.text, query)))
  if (rows.length === 0 || 'rank' in rows[0]!) return results
  return results.sort((left, right) => right.score - left.score || left.chapterIndex - right.chapterIndex || left.startOffset - right.startOffset)
}

function fuseResults(lexical: AiSearchResultRes[], semantic: AiSearchResultRes[], limit: number): RankedSearchResult[] {
  const fused = new Map<string, RankedSearchResult>()
  lexical.forEach((result, index) => {
    fused.set(result.id, { result: { ...result, score: 1 / (RRF_K + index + 1) }, lexicalRank: index + 1 })
  })
  semantic.forEach((result, index) => {
    const current = fused.get(result.id)
    const score = 1 / (RRF_K + index + 1)
    fused.set(result.id, {
      result: { ...(current?.result ?? result), score: (current?.result.score ?? 0) + score },
      ...(current?.lexicalRank === undefined ? {} : { lexicalRank: current.lexicalRank }),
      semanticRank: index + 1,
    })
  })
  return [...fused.values()]
    .sort((left, right) => right.result.score - left.result.score || left.result.id.localeCompare(right.result.id))
    .slice(0, limit)
}

function lexicalRankedResults(results: AiSearchResultRes[], limit: number): RankedSearchResult[] {
  return results.slice(0, limit).map((result, index) => ({ result, lexicalRank: index + 1 }))
}

function emptyRetrievalDiagnostics(embeddingFallbackReason?: AiRetrievalFallbackReason): AiRetrievalDiagnostics {
  return {
    source: 'none',
    lexicalCandidateCount: 0,
    semanticCandidateCount: 0,
    fusedCandidateCount: 0,
    selectedCount: 0,
    embeddingAttempted: false,
    embeddingUsed: false,
    ...(embeddingFallbackReason ? { embeddingFallbackReason } : {}),
    topResults: [],
  }
}

function retrievalDiagnostics(
  lexical: AiSearchResultRes[],
  semantic: AiSearchResultRes[],
  ranked: RankedSearchResult[],
  source: AiRetrievalDiagnostics['source'],
  embeddingAttempted: boolean,
  embeddingFallbackReason?: AiRetrievalFallbackReason,
): AiRetrievalDiagnostics {
  const ids = new Set([...lexical, ...semantic].map((result) => result.id))
  return {
    source,
    lexicalCandidateCount: lexical.length,
    semanticCandidateCount: semantic.length,
    fusedCandidateCount: ids.size,
    selectedCount: ranked.length,
    embeddingAttempted,
    embeddingUsed: semantic.length > 0,
    ...(embeddingFallbackReason && semantic.length === 0 ? { embeddingFallbackReason } : {}),
    topResults: ranked.slice(0, 5).map(({ result, lexicalRank, semanticRank }) => {
      const candidateSource: AiRetrievalCandidateSource = lexicalRank !== undefined && semanticRank !== undefined
        ? 'hybrid'
        : semanticRank !== undefined
          ? 'semantic'
          : 'lexical'
      return {
        id: result.id,
        source: candidateSource,
        score: result.score,
        ...(lexicalRank === undefined ? {} : { lexicalRank }),
        ...(semanticRank === undefined ? {} : { semanticRank }),
      }
    }),
  }
}

export async function searchAiBook(userId: string, input: AiSearchReq, options: AiRetrievalOptions = {}): Promise<AiSearchRes> {
  const query = input.query.trim().slice(0, MAX_QUERY_CHARS)
  if (!query) return { status: 'empty', results: [] }
  const ensured = await ensureIndex(userId, input.bookId, options)
  if (options.visibleTextVersion && ensured.status.status !== 'ready') {
    return { status: 'empty', results: [], reason: 'visible_index_unavailable', diagnostics: emptyRetrievalDiagnostics('not_ready') }
  }
  const limit = Math.min(input.limit ?? 5, MAX_SEARCH_RESULTS)
  const candidateInput = { ...input, query, limit: MAX_CANDIDATES }
  const ftsRows = ftsSearch(userId, candidateInput)
  const lexicalRows = ftsRows.length > 0 ? ftsRows : likeSearch(userId, candidateInput)
  const lexical = lexicalResults(lexicalRows, query)
  let semantic: AiSearchResultRes[] = []
  let embeddingAttempted = false
  let embeddingFallbackReason: AiRetrievalFallbackReason | undefined
  if (ensured.status.status === 'ready' && ensured.status.embeddingStatus === 'ready' && options.embedder) {
    embeddingAttempted = true
    const semanticController = new AbortController()
    const semanticSignal = options.signal ? AbortSignal.any([options.signal, semanticController.signal]) : semanticController.signal
    const semanticTimer = setTimeout(() => semanticController.abort(), QUERY_EMBEDDING_TIMEOUT_MS)
    try {
      const row = ensured.row ?? getIndexRow(userId, input.bookId)
      if (row) {
        const semanticResult = await vectorSearch(userId, candidateInput, row, { ...options, signal: semanticSignal })
        embeddingFallbackReason = semanticResult.reason
        semantic = semanticResult.rows.map((result) => toSearchResult(result, query, result.score))
      } else {
        embeddingFallbackReason = 'not_ready'
      }
    } catch (error) {
      if (options.signal?.aborted || (!semanticController.signal.aborted && isAbort(error))) throw error
      embeddingFallbackReason = semanticController.signal.aborted ? 'timeout' : 'error'
    } finally {
      clearTimeout(semanticTimer)
    }
  } else {
    embeddingFallbackReason = options.embedder ? 'not_ready' : 'not_configured'
  }
  const source: AiRetrievalDiagnostics['source'] = semantic.length > 0
    ? 'hybrid'
    : lexicalRows.length > 0
      ? (ftsRows.length > 0 ? 'fts' : 'like')
      : 'none'
  const ranked = semantic.length > 0 ? fuseResults(lexical, semantic, limit) : lexicalRankedResults(lexical, limit)
  const diagnostics = retrievalDiagnostics(lexical, semantic, ranked, source, embeddingAttempted, embeddingFallbackReason)
  const rows = ranked.map(({ result }) => result)
  return { status: rows.length > 0 ? 'ready' : 'empty', results: rows, diagnostics }
}

export async function getVisibleAiChapterContent(userId: string, bookId: string, chapterIndex: number, visibleTextVersion: string, maxChars: number): Promise<{ index: number; id: string; title: string; content: string } | null> {
  const book = await getActiveBook(userId, bookId)
  const chapters = await getBookChapters(userId, bookId)
  const chapter = chapters[chapterIndex]
  if (!chapter) throw new Error('Chapter index is out of range')
  const row = getIndexRow(userId, bookId)
  if (!row || row.status !== 'ready' || row.sourceVersion !== sourceVersion(book, visibleTextVersion)) return null
  const chunks = getDb().select({
    startOffset: aiChunks.startOffset,
    endOffset: aiChunks.endOffset,
    text: aiChunks.text,
  }).from(aiChunks).where(and(
    eq(aiChunks.userId, userId),
    eq(aiChunks.bookId, bookId),
    eq(aiChunks.indexId, row.id),
    eq(aiChunks.chapterIndex, chapterIndex),
  )).orderBy(asc(aiChunks.startOffset), asc(aiChunks.endOffset)).all()
  const limit = Math.max(0, Math.min(maxChars, AI_MAX_INDEX_CORPUS_CHARS))
  let content = ''
  let coveredEnd = chunks[0]?.startOffset ?? 0
  for (const chunk of chunks) {
    if (content && chunk.startOffset > coveredEnd) content += '\n\n'
    const overlap = Math.max(0, coveredEnd - chunk.startOffset)
    content += chunk.text.slice(overlap)
    coveredEnd = Math.max(coveredEnd, chunk.endOffset)
    if (content.length >= limit) break
  }
  return { index: chapterIndex, id: chapter.id, title: chapter.title, content: content.slice(0, limit) }
}
