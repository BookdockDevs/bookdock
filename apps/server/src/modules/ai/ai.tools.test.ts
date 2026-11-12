import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getActiveBook, getBookChapters, getBookChapterContent } = vi.hoisted(() => ({
  getActiveBook: vi.fn(),
  getBookChapters: vi.fn(),
  getBookChapterContent: vi.fn(),
}))

const { searchAiBook } = vi.hoisted(() => ({ searchAiBook: vi.fn() }))
const { listAnnotations, searchAnnotations } = vi.hoisted(() => ({ listAnnotations: vi.fn(), searchAnnotations: vi.fn() }))

vi.mock('../annotations/annotations.service', () => ({ listAnnotations, searchAnnotations }))
vi.mock('../books/books.service', () => ({ getActiveBook, getBookChapters, getBookChapterContent }))
vi.mock('./ai.retrieval.service', () => ({ searchAiBook }))

import { AI_TOOL_DEFAULT_TIMEOUT_MS, AI_TOOL_MAX_ANNOTATION_RESULTS, AI_TOOL_MAX_CHAPTER_CHARS, AI_TOOL_MAX_RESULT_CHARS, AI_TOOLS, createAiToolRepeatedExecution, executeAiTool, executeAiToolWithPolicy, getAiToolDefinition } from './ai.tools'

describe('AI read-only tools', () => {
  it('declares bounded read-only tools and excludes write capabilities', () => {
    expect(AI_TOOLS.length).toBeGreaterThan(0)
    expect(AI_TOOLS.every((tool) => tool.readOnly && tool.parallelSafe && tool.timeoutMs === AI_TOOL_DEFAULT_TIMEOUT_MS && tool.maxResultChars === AI_TOOL_MAX_RESULT_CHARS)).toBe(true)
    expect(getAiToolDefinition('save_as_idea')).toBeUndefined()
  })

  it('returns a bounded stop signal for repeated identical tool calls', () => {
    const execution = createAiToolRepeatedExecution({ id: 'call-repeat', name: 'search_book', arguments: '{"query":"线索"}' }, 3)

    expect(execution.content).toContain('repeated 3 times')
    expect(execution.sourceChars).toBe(0)
    expect(execution.resultChars).toBe(execution.content.length)
  })

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
    listAnnotations.mockResolvedValue([
      { id: 'anno-1', type: 'note', chapter: '第一章', text: '标注正文', note: '我的想法', cfiRange: 'epubcfi(/6/4!/2)', cfiAnchor: null, updatedAt: 2 },
      { id: 'anno-2', type: 'highlight', chapter: '第二章', text: '未读内容', note: null, cfiRange: 'epubcfi(/6/6!/2)', cfiAnchor: null, updatedAt: 1 },
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

  it('restricts the table of contents and chapter reads to the current-chapter interval', async () => {
    const toc = await executeAiTool('user-1', 'book-1', { id: 'call-current-toc', name: 'get_book_toc', arguments: '{}' }, new AbortController().signal, 1, 1)
    expect(JSON.parse(toc.content).chapters).toEqual([{ index: 1, id: 'ch-1', title: '第一章', level: 1, wordCount: 20 }])

    const blocked = await executeAiTool('user-1', 'book-1', { id: 'call-current-chapter', name: 'get_chapter_content', arguments: '{"chapterIndex":0}' }, new AbortController().signal, 1, 1)
    expect(blocked.content).toContain('outside the current reading boundary')
    expect(getBookChapterContent).not.toHaveBeenCalled()
  })

  it('bounds one chapter result and never accepts a negative index', async () => {
    const execution = await executeAiTool('user-1', 'book-1', { id: 'call-2', name: 'get_chapter_content', arguments: '{"chapterIndex":1}' }, new AbortController().signal)
    const value = JSON.parse(execution.content) as { passages: Array<{ text: string; startOffset: number; endOffset: number }>; truncated: boolean; chapterIndex: number; endOffset: number }

    expect(value).toMatchObject({ chapterIndex: 1, truncated: true })
    expect(value.endOffset).toBeLessThanOrEqual(AI_TOOL_MAX_CHAPTER_CHARS)
    expect(value.passages.length).toBeGreaterThan(1)
    expect(execution.resultChars).toBeLessThanOrEqual(AI_TOOL_MAX_RESULT_CHARS)
    expect(execution.sourceChars).toBe(value.endOffset)
    expect(execution.citations!.every((citation) => citation.quote!.length <= 600)).toBe(true)
    expect(execution.citations!.at(-1)!.endOffset).toBe(value.endOffset)
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

  it('returns a bounded timeout result when a read is not abortable', async () => {
    const definition = getAiToolDefinition('get_book_toc')
    if (!definition) throw new Error('Expected get_book_toc definition')
    const previousTimeout = definition.timeoutMs
    definition.timeoutMs = 1
    getActiveBook.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve({ id: 'book-1', title: '测试书' }), 20)))

    try {
      const execution = await executeAiToolWithPolicy('user-1', 'book-1', { id: 'call-timeout', name: 'get_book_toc', arguments: '{}' }, new AbortController().signal)
      expect(execution.content).toContain('timed out after 1ms')
      expect(execution.resultChars).toBe(execution.content.length)
    } finally {
      definition.timeoutMs = previousTimeout
    }
  })

  it('searches through the bounded retrieval tool and forwards the spoiler boundary', async () => {
    const execution = await executeAiTool('user-1', 'book-1', { id: 'call-6', name: 'search_book', arguments: '{"query":"命中段落"}' }, new AbortController().signal, 3)

    expect(searchAiBook).toHaveBeenCalledWith('user-1', { bookId: 'book-1', query: '命中段落', limit: 5, maxChapterIndex: 3 }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(JSON.parse(execution.content)).toEqual({ query: '命中段落', results: [{ id: 'chunk-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '序章', startOffset: 10, endOffset: 30, excerpt: '命中段落', score: 2 }], truncated: false })
    expect(execution.citations).toEqual([{ id: 'chunk-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '序章', startOffset: 10, endOffset: 30, excerpt: '命中段落' }])
    expect(execution.sourceChars).toBe('命中段落'.length)
  })

  it.each([
    { bounds: { minChapterIndex: 2, maxChapterIndex: 2 }, serverMin: 0, serverMax: 8, min: 2, max: 2 },
    { bounds: { minChapterIndex: 0, maxChapterIndex: 100 }, serverMin: 3, serverMax: 6, min: 3, max: 6 },
    { bounds: { maxChapterIndex: 4 }, serverMin: 3, serverMax: 6, min: 3, max: 4 },
    { bounds: { minChapterIndex: 5 }, serverMin: 0, serverMax: -1, min: 5, max: -1 },
    { bounds: { maxChapterIndex: 4 }, serverMin: 0, serverMax: -1, min: 0, max: 4 },
  ])('intersects explicit search ranges with the server boundary: $bounds', async ({ bounds, serverMin, serverMax, min, max }) => {
    searchAiBook.mockResolvedValueOnce({ status: 'empty', results: [] })
    const execution = await executeAiTool('user-1', 'book-1', {
      id: 'range-search', name: 'search_book', arguments: JSON.stringify({ query: 'character', ...bounds }),
    }, new AbortController().signal, serverMax, serverMin)
    expect(searchAiBook).toHaveBeenCalledWith('user-1', {
      bookId: 'book-1', query: 'character', limit: 5, maxChapterIndex: max, ...(min > 0 ? { minChapterIndex: min } : {}),
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(JSON.parse(execution.content).searchRange).toEqual({ minChapterIndex: min, ...(max >= 0 ? { maxChapterIndex: max } : {}) })
  })

  it.each([
    { minChapterIndex: -1 }, { maxChapterIndex: -1 }, { minChapterIndex: 1.5 },
    { minChapterIndex: '1' }, { maxChapterIndex: null }, { maxChapterIndex: 1000001 },
    { minChapterIndex: 4, maxChapterIndex: 2 },
  ])('rejects malformed search ranges without accessing the book: %j', async (bounds) => {
    const execution = await executeAiTool('user-1', 'book-1', {
      id: 'invalid-range', name: 'search_book', arguments: JSON.stringify({ query: 'character', ...bounds }),
    }, new AbortController().signal)
    expect(execution.content).toContain('Invalid chapter range')
    expect(searchAiBook).not.toHaveBeenCalled()
    expect(getActiveBook).not.toHaveBeenCalled()
  })

  it.each([{ minChapterIndex: 7 }, { maxChapterIndex: 1 }])('rejects a search interval disjoint from the allowed range: %j', async (bounds) => {
    const execution = await executeAiTool('user-1', 'book-1', {
      id: 'hidden-range', name: 'search_book', arguments: JSON.stringify({ query: 'character', ...bounds }),
    }, new AbortController().signal, 6, 2)
    expect(execution.content).toContain('outside the current reading boundary')
    expect(searchAiBook).not.toHaveBeenCalled()
  })

  it('declares chapter range parameters in the model-facing search schema', () => {
    expect(getAiToolDefinition('search_book')?.parameters).toMatchObject({ properties: {
      minChapterIndex: { type: 'integer', minimum: 0 }, maxChapterIndex: { type: 'integer', minimum: 0 },
    } })
  })

  it('uses server source text without obsolete visible-index options', async () => {
    await executeAiTool('user-1', 'book-1', { id: 'call-visible-search', name: 'search_book', arguments: '{"query":"命中段落"}' }, new AbortController().signal, 3)
    expect(searchAiBook).toHaveBeenCalledWith('user-1', { bookId: 'book-1', query: '命中段落', limit: 5, maxChapterIndex: 3 }, expect.objectContaining({ signal: expect.any(AbortSignal) }))

    const chapterExecution = await executeAiTool('user-1', 'book-1', { id: 'call-visible-chapter', name: 'get_chapter_content', arguments: '{"chapterIndex":1}' }, new AbortController().signal, 3)
    expect(JSON.parse(chapterExecution.content)).toMatchObject({ chapterIndex: 1, chapterTitle: '第一章' })
    expect(getBookChapterContent).toHaveBeenCalledWith('user-1', 'book-1', 1)
  })

  it('searches only visible notes and turns them into direct-CFI citations', async () => {
    const execution = await executeAiTool('user-1', 'book-1', { id: 'call-7', name: 'search_annotations', arguments: '{"query":"想法"}' }, new AbortController().signal, 1)

    expect(searchAnnotations).toHaveBeenCalledWith('user-1', 'book-1', '想法', 13, expect.objectContaining({ chapterTitles: ['序章', '第一章'], limit: 13 }))
    expect(JSON.parse(execution.content)).toEqual({
      query: '想法',
      results: [{ id: 'anno-1', type: 'note', chapter: '第一章', text: '标注正文', note: '我的想法', cfi: 'epubcfi(/6/4!/2)' }],
      truncated: false,
    })
    expect(execution.citations).toEqual([expect.objectContaining({
      id: 'annotation:anno-1', sourceType: 'annotation', sourceCfi: 'epubcfi(/6/4!/2)', chapterTitle: '第一章',
    })])
    expect(execution.sourceChars).toBe('标注正文我的想法'.length)
  })

  it('lists current chapter annotations with optional type filters', async () => {
    const execution = await executeAiTool('user-1', 'book-1', { id: 'call-8', name: 'list_annotations', arguments: '{}' }, new AbortController().signal, 1, 0, 1)
    expect(JSON.parse(execution.content)).toEqual({
      chapterIndex: 1,
      results: [{ id: 'anno-1', type: 'note', chapter: '第一章', text: '标注正文', note: '我的想法', cfi: 'epubcfi(/6/4!/2)' }],
      truncated: false,
    })
    expect(execution.citations).toEqual([expect.objectContaining({ id: 'annotation:anno-1', sourceType: 'annotation' })])
    expect(execution.resultChars).toBeLessThanOrEqual(AI_TOOL_MAX_RESULT_CHARS)
    expect(AI_TOOL_MAX_ANNOTATION_RESULTS).toBeGreaterThan(0)

    const filtered = await executeAiTool('user-1', 'book-1', { id: 'call-9', name: 'list_annotations', arguments: '{"type":"highlight"}' }, new AbortController().signal, 1, 0, 1)
    expect(JSON.parse(filtered.content).results).toEqual([])
  })
  it('reads a bounded range beyond the chapter prefix and cites its actual offsets', async () => {
    const execution = await executeAiTool('user-1', 'book-1', {
      id: 'range', name: 'get_chapter_content', arguments: JSON.stringify({ chapterIndex: 1, startOffset: 10010, maxChars: 100 }),
    }, new AbortController().signal, 1)
    const value = JSON.parse(execution.content)
    expect(value).toMatchObject({ startOffset: 10010, endOffset: 10110, truncated: true })
    expect(value.passages[0].text).toHaveLength(100)
    expect(execution.citations![0]).toMatchObject({ startOffset: 10010, endOffset: 10110 })
  })

  it('rejects malformed ranges before reading content', async () => {
    for (const range of [{ startOffset: null }, { maxChars: null }, { startOffset: -1 }, { startOffset: 1.5 }, { maxChars: 10001 }, { maxChars: 0 }]) {
      const execution = await executeAiTool('user-1', 'book-1', {
        id: 'bad-range', name: 'get_chapter_content', arguments: JSON.stringify({ chapterIndex: 1, ...range }),
      }, new AbortController().signal, 1)
      expect(execution.content).toContain('Invalid chapter range')
    }
    expect(getBookChapterContent).not.toHaveBeenCalled()
  })

  it('passes keyword conditions to retrieval and rejects invalid lists', async () => {
    const args = { requiredTerms: ['林舟', '陈默'], anyTerms: ['隐瞒'] }
    await executeAiTool('user-1', 'book-1', { id: 'terms', name: 'search_book', arguments: JSON.stringify(args) }, new AbortController().signal, 1, 1)
    expect(searchAiBook).toHaveBeenCalledWith('user-1', expect.objectContaining({ ...args, minChapterIndex: 1, maxChapterIndex: 1 }), expect.anything())
    searchAiBook.mockClear()
    const invalid = await executeAiTool('user-1', 'book-1', { id: 'bad', name: 'search_book', arguments: '{"requiredTerms":"name"}' }, new AbortController().signal)
    expect(invalid.content).toContain('Invalid query')
    expect(searchAiBook).not.toHaveBeenCalled()
  })

  it('keeps escaped chapter output valid JSON with matching source bounds', async () => {
    const text = ('"\\\n').repeat(4000)
    getBookChapterContent.mockResolvedValueOnce({ id: 'ch-1', index: 1, title: 'First', content: text })
    const result = await executeAiTool('user-1', 'book-1', { id: 'escaped', name: 'get_chapter_content', arguments: '{"chapterIndex":1}' }, new AbortController().signal)
    const value = JSON.parse(result.content)
    expect(result.content.length).toBeLessThanOrEqual(AI_TOOL_MAX_RESULT_CHARS)
    expect(value.truncated).toBe(true)
    expect(value.passages.every((passage: { text: string; startOffset: number; endOffset: number }) => passage.text === text.slice(passage.startOffset, passage.endOffset))).toBe(true)
    expect(result.sourceChars).toBe(value.endOffset)
    expect(result.citations!.at(-1)!.endOffset).toBe(value.endOffset)
  })

  it('does not impose a 200-chapter TOC page and continues only at the output budget', async () => {
    getBookChapters.mockResolvedValue(Array.from({ length: 205 }, (_, index) => ({ id: String(index), title: '', level: 1 })))
    const full = await executeAiTool('user-1', 'book-1', { id: 'toc-full', name: 'get_book_toc', arguments: '{}' }, new AbortController().signal)
    expect(JSON.parse(full.content).chapters).toHaveLength(205)
    expect(JSON.parse(full.content).nextChapterIndex).toBeUndefined()
    getBookChapters.mockResolvedValue(Array.from({ length: 1000 }, (_, index) => ({ id: String(index), title: '章节'.repeat(40), level: 1 })))
    const first = JSON.parse((await executeAiTool('user-1', 'book-1', { id: 'toc-long', name: 'get_book_toc', arguments: '{}' }, new AbortController().signal)).content)
    expect(first.nextChapterIndex).toBe(first.chapters.length)
    const next = JSON.parse((await executeAiTool('user-1', 'book-1', { id: 'toc-next', name: 'get_book_toc', arguments: JSON.stringify({ startChapterIndex: first.nextChapterIndex }) }, new AbortController().signal)).content)
    expect(next.chapters[0].index).toBe(first.nextChapterIndex)
    const blocked = await executeAiTool('user-1', 'book-1', { id: 'toc-blocked', name: 'get_book_toc', arguments: '{"startChapterIndex":9}' }, new AbortController().signal, 3)
    expect(blocked.content).toContain('outside the reading boundary')
  })

  it('does not assign ambiguous title-only notes to the last matching chapter', async () => {
    getBookChapters.mockResolvedValue([{ id: 'a', title: 'Repeated', level: 1 }, { id: 'b', title: 'Repeated', level: 1 }])
    listAnnotations.mockResolvedValue([{ id: 'ambiguous', type: 'note', chapter: 'Repeated', text: 'note', note: null, updatedAt: 1 }])
    const result = await executeAiTool('user-1', 'book-1', { id: 'repeated', name: 'list_annotations', arguments: '{}' }, new AbortController().signal, 1, 0, 1)
    expect(JSON.parse(result.content).results).toEqual([])
    expect(listAnnotations).toHaveBeenCalledWith('user-1', 'book-1', expect.objectContaining({ chapterTitles: [] }))
  })

})
