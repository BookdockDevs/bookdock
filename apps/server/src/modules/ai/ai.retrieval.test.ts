import JSZip from 'jszip'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const book = {
  id: 'book-1',
  userId: 'user-1',
  title: 'Book 1',
  author: '',
  format: 'txt' as 'txt' | 'epub',
  filePath: 'books/book-1.txt',
  contentHash: 'hash-1',
  updatedAt: 1,
}
let content = '第一章 这是一个秘密关键词，第一章的正文内容。\n\n第二章 这是另一个公开词语，第二章的正文内容。'
let chapters = [
  { id: 'ch-0', title: '第一章', level: 1, startOffset: 0, endOffset: 0, contentStartOffset: 0 },
  { id: 'ch-1', title: '第二章', level: 1, startOffset: 0, endOffset: 0, contentStartOffset: 0 },
]

vi.mock('../annotations/annotations.service', () => ({ listAnnotations: vi.fn(), searchAnnotations: vi.fn() }))

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

import { createEpubChapterTextReader, extractEpubChapterText } from '../../formats/epub'
import { convertTxtToEpub } from '../../lib/txt-to-epub'
import { getActiveBook, getBookChapterContent, getBookContent, getBookEpubBuffer } from '../books/books.service'

import { searchAiBook } from './ai.retrieval.service'
import { executeAiTool } from './ai.tools'

describe('AI on-demand retrieval service', () => {
  beforeEach(() => {
    content = '第一章 这是一个秘密关键词，第一章的正文内容。\n\n第二章 这是另一个公开词语，第二章的正文内容。'
    chapters = [
      { id: 'ch-0', title: '第一章', level: 1, startOffset: 0, endOffset: content.indexOf('\n\n'), contentStartOffset: 0 },
      { id: 'ch-1', title: '第二章', level: 1, startOffset: content.indexOf('\n\n') + 2, endOffset: content.length, contentStartOffset: content.indexOf('\n\n') + 2 },
    ]
    book.updatedAt = 1
    book.format = 'txt'
    vi.clearAllMocks()
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

  it('requires names and an alternative clue within a bounded passage', async () => {
    content = '林舟见到了陈默。' + '无关内容。'.repeat(150) + '林舟开始怀疑陈默隐瞒了真相。'
    chapters = [{ ...chapters[0]!, startOffset: 0, endOffset: content.length, contentStartOffset: 0 }]
    const result = await searchAiBook('user-1', { bookId: 'book-1', requiredTerms: ['林舟', '陈默'], anyTerms: ['隐瞒', '背叛'] })
    expect(result.results).toHaveLength(1)
    expect(result.results[0]!.startOffset).toBeGreaterThan(600)
    expect(result.results[0]!.excerpt).toContain('隐瞒')
    expect((await searchAiBook('user-1', { bookId: 'book-1', requiredTerms: ['林舟', '不存在'] })).results).toEqual([])
    expect((await searchAiBook('user-1', { bookId: 'book-1', requiredTerms: ['林舟'], anyTerms: ['背叛'] })).results).toEqual([])
  })

  it('does not combine distant words into a match', async () => {
    content = '林舟' + '甲'.repeat(800) + '陈默隐瞒真相'
    chapters = [{ ...chapters[0]!, startOffset: 0, endOffset: content.length, contentStartOffset: 0 }]
    const result = await searchAiBook('user-1', { bookId: 'book-1', requiredTerms: ['林舟', '陈默'], anyTerms: ['隐瞒'] })
    expect(result.results).toEqual([])
  })

  it('ranks phrase matches above partial words and closer terms above distant terms', async () => {
    content = '秘密' + '甲'.repeat(100) + '正文' + '乙'.repeat(800) + '秘密 正文' + '丙'.repeat(800) + '秘密与正文'
    chapters = [{ ...chapters[0]!, startOffset: 0, endOffset: content.length, contentStartOffset: 0 }]
    const result = await searchAiBook('user-1', { bookId: 'book-1', query: '秘密 正文' })
    expect(content.slice(result.results[0]!.startOffset, result.results[0]!.endOffset)).toBe('秘密 正文')
    const grouped = await searchAiBook('user-1', { bookId: 'book-1', requiredTerms: ['秘密', '正文'] })
    expect(grouped.results[0]!.endOffset - grouped.results[0]!.startOffset).toBeLessThan(10)
  })

  it('preserves literal punctuation and original offsets for case-insensitive matches', async () => {
    content = 'İx A+B [name] SECRET'
    chapters = [{ ...chapters[0]!, startOffset: 0, endOffset: content.length, contentStartOffset: 0 }]
    for (const query of ['A+B', '[name]', 'secret']) {
      const result = await searchAiBook('user-1', { bookId: 'book-1', query })
      const hit = result.results[0]!
      expect(content.slice(hit.startOffset, hit.endOffset).toLowerCase()).toBe(query.toLowerCase())
    }
  })

  it('bounds a million-character scan while retaining later better passages', async () => {
    content = ('秘密' + '甲'.repeat(800)).repeat(1500) + '秘密 正文'
    chapters = [{ ...chapters[0]!, startOffset: 0, endOffset: content.length, contentStartOffset: 0 }]
    const result = await searchAiBook('user-1', { bookId: 'book-1', query: '秘密 正文', limit: 5 })
    expect(result.results).toHaveLength(5)
    expect(result.results[0]!.excerpt).toContain('秘密 正文')
    expect(result.diagnostics!.fusedCandidateCount).toBeLessThanOrEqual(30)
    expect(new Set(result.results.map((hit) => hit.id)).size).toBe(5)
  })
  it('opens the EPUB archive a constant number of times while reading all chapters', async () => {
    const sections = Array.from({ length: 8 }, (_, index) => ({ id: `chapter-${index}`, title: `Chapter ${index}`, level: 0 }))
    const buffer = await convertTxtToEpub({ title: 'Reusable reader', id: 'reusable' }, sections, (index) => `Unique text for chapter ${index}.`)
    const open = vi.spyOn(JSZip, 'loadAsync')
    try {
      const reader = await createEpubChapterTextReader(buffer)
      const initialOpens = open.mock.calls.length
      expect(initialOpens).toBe(2)
      for (let index = 0; index < sections.length; index++) {
        expect(await reader.readChapterText(index)).toContain(`Unique text for chapter ${index}.`)
      }
      expect(await reader.readChapterText(99)).toBe('')
      expect(open).toHaveBeenCalledTimes(initialOpens)
    } finally {
      open.mockRestore()
    }
  })

  it('searches one requested chapter through the real tool and cannot cross the reading boundary', async () => {
    const signal = new AbortController().signal
    const call = { id: 'scoped-search', name: 'search_book', arguments: JSON.stringify({ query: '正文', minChapterIndex: 1, maxChapterIndex: 1 }) }
    const scoped = JSON.parse((await executeAiTool('user-1', 'book-1', call, signal, 1)).content)
    expect(scoped.results).toHaveLength(1)
    expect(scoped.results[0].chapterIndex).toBe(1)
    expect(scoped.searchRange).toEqual({ minChapterIndex: 1, maxChapterIndex: 1 })
    const denied = await executeAiTool('user-1', 'book-1', call, signal, 0)
    expect(denied.content).toContain('outside the current reading boundary')
    const intersected = JSON.parse((await executeAiTool('user-1', 'book-1', {
      ...call, arguments: JSON.stringify({ query: '正文', minChapterIndex: 0, maxChapterIndex: 10 }),
    }, signal, 1, 1)).content)
    expect(intersected.results.map((hit: { chapterIndex: number }) => hit.chapterIndex)).toEqual([1])
  })

  it('searches real EPUB text using the same offsets as chapter reads', async () => {
    const buffer = await convertTxtToEpub({ title: 'Test', id: 'test' }, [
      { id: 'one', title: 'One', level: 0 }, { id: 'two', title: 'Two', level: 0 },
    ], (index) => index === 0 ? '林舟看见陈默。' : '林舟怀疑陈默隐瞒真相。')
    book.format = 'epub'
    vi.mocked(getBookEpubBuffer).mockResolvedValueOnce(buffer)
    const result = await searchAiBook('user-1', { bookId: 'book-1', requiredTerms: ['林舟', '陈默'], anyTerms: ['隐瞒'] })
    expect(result.results).toHaveLength(1)
    const hit = result.results[0]!
    const text = await extractEpubChapterText(buffer, hit.chapterIndex)
    expect(text.slice(hit.startOffset, hit.endOffset)).toContain('隐瞒')
    expect(hit.chapterIndex).toBe(1)
  })

  it('cancels a busy scan after it starts', async () => {
    content = '秘密'.repeat(10000)
    chapters = [{ ...chapters[0]!, startOffset: 0, endOffset: content.length, contentStartOffset: 0 }]
    const controller = new AbortController()
    const pending = searchAiBook('user-1', { bookId: 'book-1', query: '秘密' }, { signal: controller.signal })
    setTimeout(() => controller.abort(), 0)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('does not read book content after access is denied', async () => {
    vi.mocked(getActiveBook).mockRejectedValueOnce(new Error('Forbidden'))
    await expect(searchAiBook('other-user', { bookId: 'book-1', query: '秘密' })).rejects.toThrow('Forbidden')
    expect(getBookContent).not.toHaveBeenCalled()
    expect(getBookEpubBuffer).not.toHaveBeenCalled()
  })

  it('searches and reads a late passage through real tools with matching source offsets', async () => {
    content = '无关正文。'.repeat(2500) + '林舟终于发现陈默隐瞒了真相。' + '后文。'.repeat(200)
    chapters = [{ ...chapters[0]!, startOffset: 0, endOffset: content.length, contentStartOffset: 0 }]
    const signal = new AbortController().signal
    const found = await executeAiTool('user-1', 'book-1', {
      id: 'find', name: 'search_book', arguments: JSON.stringify({ requiredTerms: ['林舟', '陈默'], anyTerms: ['隐瞒'] }),
    }, signal, 0)
    const hit = JSON.parse(found.content).results[0]
    expect(hit.startOffset).toBeGreaterThan(10000)
    vi.mocked(getBookChapterContent).mockResolvedValueOnce({ id: 'ch-0', index: 0, title: '第一章', level: 1, wordCount: content.length, content } as never)
    const read = await executeAiTool('user-1', 'book-1', {
      id: 'read', name: 'get_chapter_content', arguments: JSON.stringify({ chapterIndex: hit.chapterIndex, startOffset: hit.startOffset, maxChars: 100 }),
    }, signal, 0)
    const excerpt = JSON.parse(read.content)
    expect(excerpt.passages.map((passage: { text: string }) => passage.text).join('')).toContain('陈默隐瞒了真相')
    expect(excerpt.passages[0].text).toBe(content.slice(excerpt.passages[0].startOffset, excerpt.passages[0].endOffset))
    expect(read.citations![0]).toMatchObject({ startOffset: excerpt.startOffset, endOffset: excerpt.endOffset })
  })

})
