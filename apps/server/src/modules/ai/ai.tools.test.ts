import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActiveBook, getBookChapters, getBookChapterContent } = vi.hoisted(() => ({
  getActiveBook: vi.fn(),
  getBookChapters: vi.fn(),
  getBookChapterContent: vi.fn(),
}))

const { searchAiBook } = vi.hoisted(() => ({ searchAiBook: vi.fn() }))
const { getVisibleAiChapterContent } = vi.hoisted(() => ({ getVisibleAiChapterContent: vi.fn() }))
const { searchAnnotations } = vi.hoisted(() => ({ searchAnnotations: vi.fn() }))

vi.mock('../annotations/annotations.service', () => ({ searchAnnotations }))
vi.mock('../books/books.service', () => ({ getActiveBook, getBookChapters, getBookChapterContent }))
vi.mock('./ai.retrieval.service', () => ({ getVisibleAiChapterContent, searchAiBook }))

import { AI_TOOL_MAX_CHAPTER_CHARS, AI_TOOL_MAX_RESULT_CHARS, executeAiTool } from './ai.tools'

describe('AI read-only tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getActiveBook.mockResolvedValue({ id: 'book-1', title: '测试书' })
    getBookChapters.mockResolvedValue([
      { id: 'ch-0', title: '序章', level: 1, wordCount: 2 },
      { id: 'ch-1', title: '第一章', level: 1, wordCount: 20 },
    ])
    getBookChapterContent.mockResolvedValue({
      id: 'ch-1', index: 1, title: '第一章', level: 1, wordCount: 20, content: '正文'.repeat(AI_TOOL_MAX_CHAPTER_CHARS + 100),
    })
    searchAiBook.mockResolvedValue({
      status: 'ready',
      results: [{ id: 'chunk-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '序章', startOffset: 10, endOffset: 30, excerpt: '命中段落', score: 2 }],
    })
    searchAnnotations.mockResolvedValue([
      { id: 'anno-1', type: 'note', chapter: '第一章', text: '标注正文', note: '我的想法', cfiRange: 'epubcfi(/6/4!/2)', cfiAnchor: null },
      { id: 'anno-2', type: 'highlight', chapter: '第二章', text: '未读内容', note: null, cfiRange: 'epubcfi(/6/6!/2)', cfiAnchor: null },
    ])
  })

  it('returns metadata only for the owned book table of contents', async () => {
    const execution = await executeAiTool('user-1', 'book-1', { id: 'call-1', name: 'get_book_toc', arguments: '{}' }, new AbortController().signal)

    expect(JSON.parse(execution.content)).toEqual({
      bookTitle: '测试书',
      chapters: [
        { index: 0, id: 'ch-0', title: '序章', level: 1, wordCount: 2 },
        { index: 1, id: 'ch-1', title: '第一章', level: 1, wordCount: 20 },
      ],
      truncated: false,
    })
    expect(getActiveBook).toHaveBeenCalledWith('user-1', 'book-1')
    expect(getBookChapters).toHaveBeenCalledWith('user-1', 'book-1')
    expect(execution.resultChars).toBeLessThanOrEqual(AI_TOOL_MAX_RESULT_CHARS)
    expect(execution.sourceChars).toBe(0)
  })

  it('does not expose future chapter titles beyond the server reading boundary', async () => {
    const execution = await executeAiTool('user-1', 'book-1', { id: 'call-boundary', name: 'get_book_toc', arguments: '{}' }, new AbortController().signal, 0)

    expect(JSON.parse(execution.content)).toEqual({
      bookTitle: '测试书',
      chapters: [{ index: 0, id: 'ch-0', title: '序章', level: 1, wordCount: 2 }],
      truncated: true,
    })
  })

  it('bounds one chapter result and never accepts a negative index', async () => {
    const execution = await executeAiTool('user-1', 'book-1', { id: 'call-2', name: 'get_chapter_content', arguments: '{"chapterIndex":1}' }, new AbortController().signal)
    const value = JSON.parse(execution.content) as { content: string; truncated: boolean; chapterIndex: number }

    expect(value).toMatchObject({ chapterIndex: 1, truncated: true })
    expect(value.content.length).toBe(AI_TOOL_MAX_CHAPTER_CHARS)
    expect(execution.resultChars).toBeLessThanOrEqual(AI_TOOL_MAX_RESULT_CHARS)
    expect(execution.sourceChars).toBe(AI_TOOL_MAX_CHAPTER_CHARS)
    expect(execution.citations).toEqual([expect.objectContaining({
      id: 'chapter:1', chapterIndex: 1, chapterId: 'ch-1', chapterTitle: '第一章', startOffset: 0, endOffset: AI_TOOL_MAX_CHAPTER_CHARS,
    })])
    expect(getBookChapterContent).toHaveBeenCalledWith('user-1', 'book-1', 1)

    const invalid = await executeAiTool('user-1', 'book-1', { id: 'call-3', name: 'get_chapter_content', arguments: '{"chapterIndex":-1}' }, new AbortController().signal)
    expect(invalid.content).toContain('non-negative integer')
    expect(getBookChapterContent).toHaveBeenCalledTimes(1)
  })

  it('rejects chapter reads beyond the server-provided spoiler boundary', async () => {
    const execution = await executeAiTool('user-1', 'book-1', { id: 'call-spoiler', name: 'get_chapter_content', arguments: '{"chapterIndex":1}' }, new AbortController().signal, 0)

    expect(execution.content).toContain('outside the current reading boundary')
    expect(execution.citations).toBeUndefined()
    expect(getBookChapterContent).not.toHaveBeenCalled()
  })

  it('returns a safe error for unknown tools and honors cancellation', async () => {
    const unknown = await executeAiTool('user-1', 'book-1', { id: 'call-4', name: 'delete_book', arguments: '{}' }, new AbortController().signal)
    expect(unknown.content).toBe('Unknown tool')

    const controller = new AbortController()
    controller.abort()
    await expect(executeAiTool('user-1', 'book-1', { id: 'call-5', name: 'get_book_toc', arguments: '{}' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('searches through the bounded retrieval tool and forwards the spoiler boundary', async () => {
    const execution = await executeAiTool('user-1', 'book-1', { id: 'call-6', name: 'search_book', arguments: '{"query":"命中段落"}' }, new AbortController().signal, 3)

    expect(searchAiBook).toHaveBeenCalledWith('user-1', { bookId: 'book-1', query: '命中段落', limit: 5, maxChapterIndex: 3 }, expect.objectContaining({ embedder: undefined }))
    expect(JSON.parse(execution.content)).toEqual({ query: '命中段落', results: [{ id: 'chunk-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '序章', startOffset: 10, endOffset: 30, excerpt: '命中段落', score: 2 }], truncated: false })
    expect(execution.citations).toEqual([{ id: 'chunk-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '序章', startOffset: 10, endOffset: 30, excerpt: '命中段落' }])
    expect(execution.sourceChars).toBe('命中段落'.length)
  })

  it('keeps Reader tool reads on the exact visible index version', async () => {
    getVisibleAiChapterContent.mockResolvedValue(null)
    await executeAiTool('user-1', 'book-1', { id: 'call-visible-search', name: 'search_book', arguments: '{"query":"命中段落"}' }, new AbortController().signal, 3, undefined, 'reader-test')
    expect(searchAiBook).toHaveBeenCalledWith('user-1', { bookId: 'book-1', query: '命中段落', limit: 5, maxChapterIndex: 3 }, expect.objectContaining({ visibleTextVersion: 'reader-test' }))

    const chapterExecution = await executeAiTool('user-1', 'book-1', { id: 'call-visible-chapter', name: 'get_chapter_content', arguments: '{"chapterIndex":1}' }, new AbortController().signal, 3, undefined, 'reader-test')
    expect(JSON.parse(chapterExecution.content)).toMatchObject({ chapterIndex: 1, error: 'visible_index_unavailable' })
    expect(getVisibleAiChapterContent).toHaveBeenCalledWith('user-1', 'book-1', 1, 'reader-test', AI_TOOL_MAX_CHAPTER_CHARS)
    expect(getBookChapterContent).not.toHaveBeenCalled()
  })

  it('searches only visible notes and turns them into direct-CFI citations', async () => {
    const execution = await executeAiTool('user-1', 'book-1', { id: 'call-7', name: 'search_notes', arguments: '{"query":"想法"}' }, new AbortController().signal, 1)

    expect(searchAnnotations).toHaveBeenCalledWith('user-1', 'book-1', '想法', 8)
    expect(JSON.parse(execution.content)).toEqual({
      query: '想法',
      results: [{ id: 'anno-1', type: 'note', chapter: '第一章', text: '标注正文', note: '我的想法' }],
      truncated: true,
    })
    expect(execution.citations).toEqual([expect.objectContaining({
      id: 'annotation:anno-1', sourceType: 'annotation', sourceCfi: 'epubcfi(/6/4!/2)', chapterTitle: '第一章',
    })])
    expect(execution.sourceChars).toBe('标注正文我的想法'.length)
  })
})
