import { beforeEach, describe, expect, it, vi } from 'vitest'

import { asc } from 'drizzle-orm'

import { createTestDb } from '../../__tests__/setup'
import { getDb } from '../../db/client'
import { aiChunkEmbeddings, aiChunks, books, users } from '../../db/schema'

vi.mock('../../db/client', () => ({ getDb: vi.fn() }))

const book = {
  id: 'book-1',
  userId: 'user-1',
  title: 'Book 1',
  author: '',
  format: 'txt' as const,
  filePath: 'books/book-1.txt',
  contentHash: 'hash-1',
  updatedAt: 1,
}
let content = '第一章 这是一个秘密关键词，第一章的正文内容。\n\n第二章 这是另一个公开词语，第二章的正文内容。'
let chapters = [
  { id: 'ch-0', title: '第一章', level: 1, startOffset: 0, endOffset: 0, contentStartOffset: 0 },
  { id: 'ch-1', title: '第二章', level: 1, startOffset: 0, endOffset: 0, contentStartOffset: 0 },
]

vi.mock('../books/books.service', () => ({
  getActiveBook: vi.fn(async () => book),
  getBookChapters: vi.fn(async () => chapters),
  getBookContent: vi.fn(async () => content),
  getBookEpubBuffer: vi.fn(),
}))

import { cancelAiBookIndex, clearAiBookIndex, getAiIndexStatus, getVisibleAiChapterContent, indexAiBook, searchAiBook } from './ai.retrieval.service'
import { getBookContent } from '../books/books.service'

describe('AI lexical retrieval service', () => {
  beforeEach(() => {
    const db = createTestDb()
    vi.mocked(getDb).mockReturnValue(db as never)
    db.insert(users).values({ id: 'user-1', username: 'user-1', createdAt: 1 }).run()
    db.insert(books).values({ id: 'book-1', userId: 'user-1', title: book.title, format: book.format, filePath: book.filePath, contentHash: book.contentHash, size: content.length, createdAt: 1, updatedAt: book.updatedAt }).run()
    content = '第一章 这是一个秘密关键词，第一章的正文内容。\n\n第二章 这是另一个公开词语，第二章的正文内容。'
    chapters = [
      { id: 'ch-0', title: '第一章', level: 1, startOffset: 0, endOffset: content.indexOf('\n\n'), contentStartOffset: 0 },
      { id: 'ch-1', title: '第二章', level: 1, startOffset: content.indexOf('\n\n') + 2, endOffset: content.length, contentStartOffset: content.indexOf('\n\n') + 2 },
    ]
    book.updatedAt = 1
  })

  it('builds a versioned per-book index and searches mixed-language chunks', async () => {
    expect(await getAiIndexStatus('user-1', 'book-1')).toMatchObject({ status: 'not_indexed', chunkCount: 0 })
    const indexed = await indexAiBook('user-1', { bookId: 'book-1' })
    expect(indexed).toMatchObject({ bookId: 'book-1', status: 'ready' })
    expect(indexed.chunkCount).toBeGreaterThan(0)

    const result = await searchAiBook('user-1', { bookId: 'book-1', query: '秘密关键词', limit: 5 })
    expect(result.status).toBe('ready')
    expect(result.results[0]).toMatchObject({ chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '第一章' })
    expect(result.results[0]?.endOffset).toBe(result.results[0]!.startOffset + '秘密关键词'.length)
    expect(result.results[0]?.startOffset).toBe(content.indexOf('秘密关键词'))
    expect(result.results[0]?.excerpt).toContain('秘密关键词')

    const shortQuery = await searchAiBook('user-1', { bookId: 'book-1', query: '秘密', limit: 5 })
    expect(shortQuery.results.length).toBeGreaterThan(0)
  })

  it('indexes the transformed Reader corpus while keeping server chapter metadata authoritative', async () => {
    const indexed = await indexAiBook('user-1', {
      bookId: 'book-1',
      visibleTextVersion: 'reader-transformed',
      chapters: [
        { chapterIndex: 0, text: '第一章 这是经过文本替换后的可见关键词。' },
        { chapterIndex: 1, text: '第二章 这是当前阅读器展示的内容。' },
      ],
    })

    expect(indexed).toMatchObject({ status: 'ready', sourceVersion: expect.stringContaining(':visible:reader-transformed') })
    expect((await searchAiBook('user-1', { bookId: 'book-1', query: '可见关键词' })).results[0]).toMatchObject({
      chapterIndex: 0,
      chapterId: 'ch-0',
      chapterTitle: '第一章',
    })
    expect((await searchAiBook('user-1', { bookId: 'book-1', query: '秘密关键词' })).results).toEqual([])

    const exactVersion = await searchAiBook('user-1', { bookId: 'book-1', query: '可见关键词' }, { visibleTextVersion: 'reader-transformed' })
    expect(exactVersion.status).toBe('ready')
    const wrongVersion = await searchAiBook('user-1', { bookId: 'book-1', query: '可见关键词' }, { visibleTextVersion: 'reader-other' })
    expect(wrongVersion).toMatchObject({ status: 'empty', results: [], reason: 'visible_index_unavailable', diagnostics: { source: 'none', embeddingFallbackReason: 'not_ready' } })

    await expect(getVisibleAiChapterContent('user-1', 'book-1', 0, 'reader-transformed', 10_000)).resolves.toMatchObject({
      index: 0,
      id: 'ch-0',
      title: '第一章',
      content: '第一章 这是经过文本替换后的可见关键词。',
    })
    await expect(getVisibleAiChapterContent('user-1', 'book-1', 0, 'reader-other', 10_000)).resolves.toBeNull()
  })

  it('rejects a Reader corpus whose chapter coverage does not match the server book', async () => {
    await expect(indexAiBook('user-1', {
      bookId: 'book-1',
      visibleTextVersion: 'reader-without-corpus',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })

    await expect(indexAiBook('user-1', {
      bookId: 'book-1',
      visibleTextVersion: 'reader-incomplete',
      chapters: [{ chapterIndex: 0, text: '第一章' }],
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('builds only the local lexical index when search is requested before explicit semantic indexing', async () => {
    const embedder = vi.fn(async (texts: string[], _signal: AbortSignal, kind: 'document' | 'query') => ({
      provider: 'openai' as const,
      model: 'test-embedding',
      vectors: texts.map(() => kind === 'query' ? [1, 0] : [0, 1]),
    }))

    const result = await searchAiBook('user-1', { bookId: 'book-1', query: '秘密关键词' }, { embedder })

    expect(result.status).toBe('ready')
    expect(result.results[0]).toMatchObject({ chapterIndex: 0, chapterTitle: '第一章' })
    expect(embedder).not.toHaveBeenCalled()
    expect(await getAiIndexStatus('user-1', 'book-1')).toMatchObject({ status: 'ready', embeddingStatus: 'unavailable' })
  })

  it('enforces the server-provided chapter boundary and rebuilds stale content', async () => {
    await indexAiBook('user-1', { bookId: 'book-1' })
    expect((await searchAiBook('user-1', { bookId: 'book-1', query: '公开词语', maxChapterIndex: 0 })).results).toEqual([])
    expect((await searchAiBook('user-1', { bookId: 'book-1', query: '公开词语', maxChapterIndex: 1 })).results[0]?.chapterIndex).toBe(1)
    expect((await searchAiBook('user-1', { bookId: 'book-1', query: '公开词语', minChapterIndex: 1, maxChapterIndex: 1 })).results[0]?.chapterIndex).toBe(1)
    expect((await searchAiBook('user-1', { bookId: 'book-1', query: '秘密关键词', minChapterIndex: 1, maxChapterIndex: 1 })).results).toEqual([])

    content = '第一章 这里是更新后的新关键词，旧内容已经失效。'
    chapters = [{ id: 'ch-0', title: '第一章', level: 1, startOffset: 0, endOffset: content.length, contentStartOffset: 0 }]
    book.updatedAt = 2
    expect((await getAiIndexStatus('user-1', 'book-1')).status).toBe('stale')

    const rebuilt = await searchAiBook('user-1', { bookId: 'book-1', query: '新关键词' })
    expect(rebuilt.results[0]).toMatchObject({ chapterIndex: 0, chapterTitle: '第一章' })
    expect((await searchAiBook('user-1', { bookId: 'book-1', query: '公开词语' })).results).toEqual([])
    expect((await getAiIndexStatus('user-1', 'book-1')).status).toBe('ready')
  })

  it('keeps long chapter chunks bounded and overlapping for later vector indexing', async () => {
    content = `第一章 ${'长文本。'.repeat(300)}`
    chapters = [{ id: 'ch-0', title: '第一章', level: 1, startOffset: 0, endOffset: content.length, contentStartOffset: 0 }]
    book.updatedAt = 3

    const indexed = await indexAiBook('user-1', { bookId: 'book-1' })
    expect(indexed.status).toBe('ready')
    expect(indexed.chunkCount).toBeGreaterThan(2)

    const chunks = getDb().select({ startOffset: aiChunks.startOffset, endOffset: aiChunks.endOffset }).from(aiChunks).orderBy(asc(aiChunks.startOffset)).all()
    expect(chunks.every((chunk) => chunk.endOffset - chunk.startOffset <= 500)).toBe(true)
    expect(chunks.some((chunk, index) => index > 0 && chunk.startOffset < chunks[index - 1]!.endOffset)).toBe(true)
  })

  it('builds optional embeddings and recalls semantic matches through hybrid search', async () => {
    const embedder = vi.fn(async (texts: string[], _signal: AbortSignal, kind: 'document' | 'query') => ({
      provider: 'openai' as const,
      model: 'test-embedding',
      vectors: texts.map((text) => kind === 'query' || text.includes('秘密') ? [1, 0] : [0, 1]),
    }))

    const indexed = await indexAiBook('user-1', { bookId: 'book-1' }, { embedder })
    expect(indexed).toMatchObject({ status: 'ready', embeddingStatus: 'ready', embeddingModel: 'test-embedding', embeddingDim: 2 })
    expect(getDb().select().from(aiChunkEmbeddings).all()).toHaveLength(indexed.chunkCount)

    const result = await searchAiBook('user-1', { bookId: 'book-1', query: '完全不会出现在正文的语义问题' }, { embedder })
    expect(result.status).toBe('ready')
    expect(result.results[0]).toMatchObject({ chapterIndex: 0, chapterTitle: '第一章' })
    expect(result.diagnostics).toMatchObject({ source: 'hybrid', embeddingAttempted: true, embeddingUsed: true, semanticCandidateCount: expect.any(Number), selectedCount: expect.any(Number) })
    expect(result.diagnostics?.topResults[0]).toMatchObject({ source: 'semantic', semanticRank: 1 })
    expect(embedder).toHaveBeenCalledWith(expect.any(Array), expect.any(AbortSignal), 'query')
  })

  it('falls back to lexical retrieval when the embedding provider changes', async () => {
    const indexEmbedder = vi.fn(async (texts: string[], _signal: AbortSignal, kind: 'document' | 'query') => ({
      provider: 'openai' as const,
      model: 'test-embedding',
      vectors: texts.map(() => kind === 'query' ? [1, 0] : [0, 1]),
    }))
    await indexAiBook('user-1', { bookId: 'book-1', force: true }, { embedder: indexEmbedder })

    const changedProviderEmbedder = vi.fn(async (texts: string[], _signal: AbortSignal, kind: 'document' | 'query') => ({
      provider: 'ollama' as const,
      model: 'test-embedding',
      vectors: texts.map(() => kind === 'query' ? [1, 0] : [0, 1]),
    }))
    const result = await searchAiBook('user-1', { bookId: 'book-1', query: '不在正文中的语义问题' }, { embedder: changedProviderEmbedder })

    expect(result).toMatchObject({ status: 'empty', results: [], diagnostics: { embeddingAttempted: true, embeddingFallbackReason: 'provider_mismatch', source: 'none' } })
    expect(changedProviderEmbedder).toHaveBeenCalledWith(['不在正文中的语义问题'], expect.any(AbortSignal), 'query')
  })

  it('falls back to lexical retrieval when query embedding exceeds its short budget', async () => {
    const indexEmbedder = vi.fn(async (texts: string[], _signal: AbortSignal, kind: 'document' | 'query') => ({
      provider: 'openai' as const,
      model: 'test-embedding',
      vectors: texts.map(() => kind === 'query' ? [1, 0] : [0, 1]),
    }))
    await indexAiBook('user-1', { bookId: 'book-1', force: true }, { embedder: indexEmbedder })

    vi.useFakeTimers()
    try {
      const slowEmbedder = vi.fn(async (_texts: string[], signal: AbortSignal, kind: 'document' | 'query') => {
        if (kind === 'query') {
          return new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Embedding timed out', 'AbortError')), { once: true }))
        }
        return { provider: 'openai' as const, model: 'test-embedding', vectors: [[1, 0]] }
      })
      const searchPromise = searchAiBook('user-1', { bookId: 'book-1', query: '秘密关键词' }, { embedder: slowEmbedder })
      await vi.advanceTimersByTimeAsync(5_000)
      const result = await searchPromise

      expect(result.status).toBe('ready')
      expect(result.results[0]).toMatchObject({ chapterIndex: 0, chapterTitle: '第一章' })
      expect(result.diagnostics).toMatchObject({ source: 'fts', embeddingAttempted: true, embeddingUsed: false, embeddingFallbackReason: 'timeout' })
      expect(slowEmbedder).toHaveBeenCalledWith(['秘密关键词'], expect.any(AbortSignal), 'query')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps user cancellation effective while query embedding is pending', async () => {
    const indexEmbedder = vi.fn(async (texts: string[], _signal: AbortSignal, kind: 'document' | 'query') => ({
      provider: 'openai' as const,
      model: 'test-embedding',
      vectors: texts.map(() => kind === 'query' ? [1, 0] : [0, 1]),
    }))
    await indexAiBook('user-1', { bookId: 'book-1', force: true }, { embedder: indexEmbedder })

    const controller = new AbortController()
    const slowEmbedder = vi.fn(async (_texts: string[], signal: AbortSignal, kind: 'document' | 'query') => {
      if (kind === 'query') {
        return new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
      }
      return { provider: 'openai' as const, model: 'test-embedding', vectors: [[1, 0]] }
    })
    const searchPromise = searchAiBook('user-1', { bookId: 'book-1', query: '秘密关键词' }, { embedder: slowEmbedder, signal: controller.signal })

    await vi.waitFor(() => expect(slowEmbedder).toHaveBeenCalledWith(['秘密关键词'], expect.any(AbortSignal), 'query'))
    controller.abort()

    await expect(searchPromise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reports embedding progress and restores the previous index when embedding is cancelled', async () => {
    await indexAiBook('user-1', { bookId: 'book-1' })
    const previous = await getAiIndexStatus('user-1', 'book-1')

    content = `第一章 ${'长文本。'.repeat(6_000)}`
    chapters = [{ id: 'ch-0', title: '第一章', level: 1, startOffset: 0, endOffset: content.length, contentStartOffset: 0 }]
    book.updatedAt = 2
    const embedder = vi.fn(async (_texts: string[], signal: AbortSignal, kind: 'document' | 'query') => {
      if (kind === 'document') {
        await new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
      }
      return { provider: 'openai' as const, model: 'test-embedding', vectors: [[1, 0]] }
    })
    const job = indexAiBook('user-1', { bookId: 'book-1', force: true }, { embedder })

    await vi.waitFor(() => expect(embedder).toHaveBeenCalledWith(expect.any(Array), expect.any(AbortSignal), 'document'))
    expect(await getAiIndexStatus('user-1', 'book-1')).toMatchObject({ status: 'indexing', embeddingStatus: 'indexing' })
    expect((await getAiIndexStatus('user-1', 'book-1')).progress).toBeGreaterThanOrEqual(70)

    await expect(cancelAiBookIndex('user-1', 'book-1')).resolves.toBe(true)
    await expect(job).rejects.toMatchObject({ name: 'AbortError' })
    expect(await getAiIndexStatus('user-1', 'book-1')).toMatchObject({ status: 'stale', progress: 100, chunkCount: previous.chunkCount })
  })

  it('keeps lexical retrieval ready when embedding fails', async () => {
    const failingEmbedder = vi.fn().mockRejectedValue(new Error('provider unavailable'))
    const indexed = await indexAiBook('user-1', { bookId: 'book-1', force: true }, { embedder: failingEmbedder })
    expect(indexed).toMatchObject({ status: 'ready', embeddingStatus: 'failed' })
    expect(getDb().select().from(aiChunkEmbeddings).all()).toEqual([])

    const result = await searchAiBook('user-1', { bookId: 'book-1', query: '公开词语' }, { embedder: failingEmbedder })
    expect(result.status).toBe('ready')
    expect(result.results[0]?.chapterIndex).toBe(1)
  })

  it('cancels a running index job and removes a new partial index', async () => {
    let release: () => void = () => undefined
    const pendingContent = new Promise<string>((resolve) => { release = () => resolve(content) })
    vi.mocked(getBookContent).mockImplementationOnce(async () => pendingContent)
    const job = indexAiBook('user-1', { bookId: 'book-1' })

    await expect(cancelAiBookIndex('user-1', 'book-1')).resolves.toBe(true)
    release()
    await expect(job).rejects.toMatchObject({ name: 'AbortError' })
    expect(await getAiIndexStatus('user-1', 'book-1')).toMatchObject({ status: 'not_indexed', chunkCount: 0 })
  })

  it('restores the previous ready index when a rebuild is cancelled', async () => {
    const previous = await indexAiBook('user-1', { bookId: 'book-1' })
    const controller = new AbortController()
    controller.abort()

    await expect(indexAiBook('user-1', { bookId: 'book-1', force: true }, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(await getAiIndexStatus('user-1', 'book-1')).toMatchObject({ status: 'ready', chunkCount: previous.chunkCount })
    expect((await searchAiBook('user-1', { bookId: 'book-1', query: '秘密关键词' })).status).toBe('ready')
  })

  it('clears the derived index without affecting the source book', async () => {
    await indexAiBook('user-1', { bookId: 'book-1' })

    await clearAiBookIndex('user-1', 'book-1')

    expect(await getAiIndexStatus('user-1', 'book-1')).toMatchObject({ status: 'not_indexed', chunkCount: 0 })
    expect((await searchAiBook('user-1', { bookId: 'book-1', query: '秘密关键词' })).status).toBe('ready')
  })
})
