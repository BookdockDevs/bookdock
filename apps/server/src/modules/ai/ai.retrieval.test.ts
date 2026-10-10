import { beforeEach, describe, expect, it, vi } from 'vitest'

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
  getBookChapterContent: vi.fn(async (_userId, _bookId, index) => ({
    id: chapters[index]?.id ?? 'ch-0',
    index,
    title: chapters[index]?.title ?? '第一章',
    level: 1,
    wordCount: 100,
    content: index === 0 ? '第一章 这是一个秘密关键词，第一章的正文内容。' : '第二章 这是另一个公开词语，第二章的正文内容。',
  })),
  getBookContent: vi.fn(async () => content),
  getBookEpubBuffer: vi.fn(),
}))

import {
  cancelAiBookIndex,
  clearAiBookIndex,
  getAiIndexStatus,
  getVisibleAiChapterContent,
  indexAiBook,
  searchAiBook,
} from './ai.retrieval.service'

describe('AI on-demand retrieval service', () => {
  beforeEach(() => {
    content = '第一章 这是一个秘密关键词，第一章的正文内容。\n\n第二章 这是另一个公开词语，第二章的正文内容。'
    chapters = [
      { id: 'ch-0', title: '第一章', level: 1, startOffset: 0, endOffset: content.indexOf('\n\n'), contentStartOffset: 0 },
      { id: 'ch-1', title: '第二章', level: 1, startOffset: content.indexOf('\n\n') + 2, endOffset: content.length, contentStartOffset: content.indexOf('\n\n') + 2 },
    ]
    book.updatedAt = 1
  })

  it('reports instant ready status without pre-indexing storage', async () => {
    const status = await getAiIndexStatus('user-1', 'book-1')
    expect(status).toMatchObject({
      bookId: 'book-1',
      status: 'ready',
      embeddingStatus: 'unavailable',
      progress: 100,
      chunkCount: 0,
    })

    const indexed = await indexAiBook('user-1', { bookId: 'book-1' })
    expect(indexed).toMatchObject({
      bookId: 'book-1',
      status: 'ready',
      progress: 100,
    })
  })

  it('searches text on demand with accurate citations and excerpts', async () => {
    const result = await searchAiBook('user-1', { bookId: 'book-1', query: '秘密关键词', limit: 5 })
    expect(result.status).toBe('ready')
    expect(result.results.length).toBeGreaterThan(0)
    expect(result.results[0]).toMatchObject({
      chapterIndex: 0,
      chapterId: 'ch-0',
      chapterTitle: '第一章',
    })
    expect(result.results[0]?.excerpt).toContain('秘密关键词')
    expect(result.results[0]?.startOffset).toBe('第一章 这是一个'.length)
    expect(result.results[0]?.endOffset).toBe(result.results[0]!.startOffset + '秘密关键词'.length)
    expect(result.diagnostics).toMatchObject({
      source: 'like',
      selectedCount: 1,
    })
  })

  it('enforces the spoiler boundary (maxChapterIndex) and minChapterIndex', async () => {
    // Secret keyword is in Chapter 0, public keyword is in Chapter 1
    const hiddenByMax = await searchAiBook('user-1', { bookId: 'book-1', query: '公开词语', maxChapterIndex: 0 })
    expect(hiddenByMax.results).toEqual([])
    expect(hiddenByMax.status).toBe('empty')

    const allowed = await searchAiBook('user-1', { bookId: 'book-1', query: '公开词语', maxChapterIndex: 1 })
    expect(allowed.results).toHaveLength(1)
    expect(allowed.results[0]?.chapterIndex).toBe(1)

    const hiddenByMin = await searchAiBook('user-1', { bookId: 'book-1', query: '秘密关键词', minChapterIndex: 1, maxChapterIndex: 1 })
    expect(hiddenByMin.results).toEqual([])
    expect(hiddenByMin.status).toBe('empty')
  })

  it('handles empty or whitespace-only query gracefully', async () => {
    const result = await searchAiBook('user-1', { bookId: 'book-1', query: '   ' })
    expect(result).toMatchObject({ status: 'empty', results: [] })
  })

  it('supports multi-word query fallback', async () => {
    const result = await searchAiBook('user-1', { bookId: 'book-1', query: '正文 秘密' })
    expect(result.status).toBe('ready')
    expect(result.results[0]?.chapterIndex).toBe(0)
  })

  it('supports AbortSignal cancellation', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(searchAiBook('user-1', { bookId: 'book-1', query: '秘密' }, { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
  })

  it('provides backwards compatibility for index operations', async () => {
    expect(await cancelAiBookIndex('user-1', 'book-1')).toBe(false)
    await expect(clearAiBookIndex('user-1', 'book-1')).resolves.toBeUndefined()
  })

  it('reads visible chapter content on demand', async () => {
    const chapter = await getVisibleAiChapterContent('user-1', 'book-1', 0, 'v1', 20)
    expect(chapter).toMatchObject({
      index: 0,
      id: 'ch-0',
      title: '第一章',
      content: '第一章 这是一个秘密关键词，第一章的正文',
    })
  })
})
