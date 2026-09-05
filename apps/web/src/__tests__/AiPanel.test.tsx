import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiStreamAiChat } from '../api/client'
import AiPanel from '../features/reader/components/AiPanel'
import { RendererContext } from '../features/reader/hooks/useReaderApi'
import { useReaderState } from '../features/reader/state/reader-state'
import { useAuthStore } from '../stores/auth.store'

vi.mock('../api/client', () => ({
  apiDelete: vi.fn(),
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiStreamAiChat: vi.fn(),
  ApiError: class ApiError extends Error {
    code: string

    constructor(code: string, message: string) {
      super(message)
      this.code = code
    }
  },
}))

interface TestRenderer {
  display: ReturnType<typeof vi.fn>
  getAiCorpus?: ReturnType<typeof vi.fn>
  getAiChapterText?: ReturnType<typeof vi.fn>
  getAiCorpusVersion?: ReturnType<typeof vi.fn>
}

function readerWithCorpus(): TestRenderer {
  return {
    display: vi.fn(),
    getAiCorpus: vi.fn().mockResolvedValue({
      visibleTextVersion: 'reader-test',
      chapters: [
        { chapterIndex: 0, text: '第一章 经过阅读器变换后的文本' },
      ],
    }),
    getAiCorpusVersion: vi.fn().mockReturnValue('reader-test'),
  }
}

function readerWithChapterReferences(): TestRenderer {
  return {
    display: vi.fn(),
    getAiChapterText: vi.fn().mockImplementation(async (chapterIndex: number) => `第${chapterIndex + 1}章的可见正文`),
    getAiCorpusVersion: vi.fn().mockReturnValue('reader-test'),
  }
}

function renderPanel(renderer: TestRenderer | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RendererContext.Provider value={{ renderer: renderer as never }}>
        <AiPanel bookId="book-1" />
      </RendererContext.Provider>
    </QueryClientProvider>,
  )
  return {
    ...result,
    rerenderPanel: (bookId: string) => result.rerender(
      <QueryClientProvider client={queryClient}>
        <RendererContext.Provider value={{ renderer: renderer as never }}>
          <AiPanel bookId={bookId} />
        </RendererContext.Provider>
      </QueryClientProvider>,
    ),
  }
}

async function openTools() {
  fireEvent.click(await screen.findByRole('button', { name: 'AI 工具' }))
  await screen.findByTestId('ai-tools-drawer')
}

describe('AiPanel', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null })
    useReaderState.setState({
      aiContext: null,
      currentChapter: null,
      currentChapterIndex: null,
      sidebarOpen: true,
    })
    vi.mocked(apiGet).mockReset()
    vi.mocked(apiDelete).mockReset()
    vi.mocked(apiPatch).mockReset()
    vi.mocked(apiPost).mockReset()
    vi.mocked(apiStreamAiChat).mockReset()
  })

  it('keeps the composer editable when no model is configured', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      data: {
        enabled: false,
        provider: 'custom',
        maxSelectionChars: 6_000,
        maxContextChars: 8_000,
      },
    })

    renderPanel(readerWithCorpus())

    await waitFor(() => expect(screen.getByLabelText('选择模型')).toBeDisabled())
    expect(screen.getByRole('textbox')).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    expect(screen.queryByText(/尚未配置|暂不可使用/)).toBeNull()
    expect(screen.queryByText('可让 AI 查看目录或章节')).toBeNull()
  })

  it('sends only the tools enabled in the AI tools drawer', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)

    renderPanel()
    await openTools()

    const notesTool = screen.getByRole('switch', { name: '读取我的笔记' })
    expect(notesTool).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(notesTool)
    expect(notesTool).toHaveAttribute('aria-checked', 'false')

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '只根据正文回答' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({
      enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book'],
    })
  })

  it('attaches selected chapters, including chapters after the current position, to the next AI request', async () => {
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/books/book-1/chapters') return { data: [
        { id: 'chapter-1', title: '第一章', level: 1, startOffset: 0, endOffset: 10 },
        { id: 'chapter-2', title: '第二章', level: 1, startOffset: 10, endOffset: 20 },
        { id: 'chapter-3', title: '第三章', level: 1, startOffset: 20, endOffset: 30 },
      ] }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)
    useReaderState.setState({ currentChapterIndex: 1 })
    const renderer = readerWithChapterReferences()

    renderPanel(renderer)

    fireEvent.click(await screen.findByRole('button', { name: '添加章节引用' }))
    fireEvent.click(await screen.findByRole('button', { name: '第三章' }))
    expect(screen.getByRole('button', { name: '移除章节引用 第三章' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '请总结引用内容' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(renderer.getAiChapterText).toHaveBeenCalledWith(2)
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({
      context: {
        chapterReferences: [{ chapterIndex: 2, chapterTitle: '第三章', text: '第3章的可见正文' }],
      },
    })
  })

  it('closes the chapter reference menu when the composer text area is clicked', async () => {
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/books/book-1/chapters') return { data: [{ id: 'chapter-1', title: '第一章', level: 1, startOffset: 0, endOffset: 10 }] }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })

    renderPanel(readerWithChapterReferences())

    fireEvent.click(await screen.findByRole('button', { name: '添加章节引用' }))
    expect(screen.getByRole('dialog', { name: '添加章节引用' })).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('textbox'))
    expect(screen.queryByRole('dialog', { name: '添加章节引用' })).toBeNull()
  })

  it('selects an assistant mode and persists a new mode from the composer', async () => {
    let modeSaved = false
    let savedModeId = ''
    vi.mocked(apiGet).mockImplementation(async () => ({ data: {
      enabled: true,
      provider: 'ollama',
      model: 'qwen3:8b',
      modes: modeSaved ? [
        { id: 'assistant', name: '助理', prompt: '', builtIn: true },
        { id: savedModeId, name: '书评人', prompt: '用书评人的口吻回答。', builtIn: false },
      ] : [{ id: 'assistant', name: '助理', prompt: '', builtIn: true }],
      maxSelectionChars: 6_000,
      maxContextChars: 8_000,
    } }))
    vi.mocked(apiPatch).mockImplementation(async (_path, body) => {
      modeSaved = true
      savedModeId = (body as { modes: Array<{ id: string }> }).modes[0]!.id
      return { data: {
        modes: [
          { id: 'assistant', name: '助理', prompt: '', builtIn: true },
          { id: savedModeId, name: '书评人', prompt: '用书评人的口吻回答。', builtIn: false },
        ],
      } }
    })

    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: '选择助理模式' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '添加模式' }))
    fireEvent.change(screen.getByLabelText('模式名称'), { target: { value: '书评人' } })
    fireEvent.change(screen.getByLabelText('系统提示词'), { target: { value: '用书评人的口吻回答。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/ai/config', {
      modes: [{ id: expect.any(String), name: '书评人', prompt: '用书评人的口吻回答。' }],
    }))
    await waitFor(() => expect(screen.getByRole('button', { name: '选择助理模式' })).toHaveTextContent('书评人'))
  })

  it('uses the toolbar button and outside area to close the compact tools menu', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })

    renderPanel()
    await openTools()
    expect(screen.queryByText('控制这次对话可以使用的能力')).toBeNull()
    expect(screen.queryByRole('button', { name: '关闭 AI 工具' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'AI 工具' }))
    expect(screen.queryByTestId('ai-tools-drawer')).toBeNull()

    await openTools()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('ai-tools-drawer')).toBeNull()
  })

  it('fills a selected-passage quick action without sending it', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    useReaderState.setState({ aiContext: { cfiRange: 'selection', text: '选区', rawText: '选区', chapterIndex: 0 } })

    renderPanel()
    await openTools()

    const quickAction = await screen.findByRole('button', { name: 'reader.aiQuickExplain' })
    fireEvent.click(quickAction)
    expect(screen.getByRole('textbox')).toHaveValue('reader.aiQuickExplainPrompt')
    expect(apiStreamAiChat).not.toHaveBeenCalled()
  })

  it('offers translation as a selected-passage quick action', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    useReaderState.setState({ aiContext: { cfiRange: 'selection', text: '选区', rawText: '选区', chapterIndex: 0 } })

    renderPanel()
    await openTools()

    const quickAction = await screen.findByRole('button', { name: 'reader.aiQuickTranslate' })
    fireEvent.click(quickAction)
    expect(screen.getByRole('textbox')).toHaveValue('reader.aiQuickTranslatePrompt')
    expect(apiStreamAiChat).not.toHaveBeenCalled()
  })

  it('switches between models saved on the active AI profile', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', models: [{ id: 'qwen3:8b', name: 'qwen3:8b' }, { id: 'llama3.2', name: 'llama3.2' }], activeProfileId: 'profile-1', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiPatch).mockResolvedValue({ data: {} })

    renderPanel()

    const selector = await screen.findByRole('button', { name: '选择模型' })
    await waitFor(() => expect(selector).not.toBeDisabled())
    fireEvent.click(selector)
    fireEvent.click(screen.getByRole('option', { name: 'llama3.2' }))

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/ai/config', { model: 'llama3.2' }))
  })

  it('filters embedding models out of the Chat selector', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'custom', model: 'qwen3:8b', models: [
      { id: 'qwen3:8b', name: 'qwen3:8b' },
      { id: 'llama3.2', name: 'llama3.2' },
      { id: 'qwen3-embedding-8b', name: 'qwen3-embedding-8b' },
    ], maxSelectionChars: 6_000, maxContextChars: 8_000 } })

    renderPanel()

    const selector = await screen.findByRole('button', { name: '选择模型' })
    await waitFor(() => expect(selector).not.toBeDisabled())
    fireEvent.click(selector)
    expect(screen.getByRole('listbox', { name: '选择模型' })).toContainElement(screen.getByRole('option', { name: 'qwen3:8b' }))
    expect(screen.queryByRole('option', { name: 'qwen3-embedding-8b' })).toBeNull()
  })

  it('can start a tool-assisted question without a selected passage', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    let release = () => undefined
    const pending = new Promise<void>((resolve) => { release = resolve })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      handlers.onTool?.({ name: 'get_book_toc', phase: 'start' })
      await pending
      handlers.onTool?.({ name: 'get_book_toc', phase: 'result', resultChars: 100 })
      handlers.onDelta?.('目录已读取')
    })

    renderPanel(readerWithCorpus())

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '这本书有哪些章节？' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({ context: { selection: '', visibleTextVersion: 'reader-test' } })
    expect(screen.getByText('正在查看目录…')).toBeInTheDocument()
    release()
    await waitFor(() => expect(screen.getByText('目录已读取')).toBeInTheDocument())
  })

  it('offers current-reading quick actions without a selected passage', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })

    renderPanel()
    await openTools()

    const summary = await screen.findByRole('button', { name: 'reader.aiQuickChapterSummary' })
    expect(screen.getByRole('button', { name: 'reader.aiQuickReadToHere' })).toBeInTheDocument()
    fireEvent.click(summary)
    expect(screen.getByRole('textbox')).toHaveValue('reader.aiQuickChapterSummaryPrompt')
    expect(apiStreamAiChat).not.toHaveBeenCalled()
  })

  it('shows tool citations and jumps to their bounded reader range', async () => {
    const display = vi.fn().mockResolvedValue(undefined)
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      handlers.onTool?.({
        name: 'search_book',
        phase: 'result',
        citations: [{ id: 'chunk-1', chapterIndex: 1, chapterId: 'ch-1', chapterTitle: '第一章', startOffset: 12, endOffset: 24, excerpt: '命中段落' }],
      })
      handlers.onDelta?.('这是回答')
    })

    renderPanel({ display })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '查找线索' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    const source = await screen.findByRole('button', { name: '第一章' })
    expect(source).toHaveAttribute('title', '命中段落')
    expect(screen.getByText('这是回答').parentElement?.parentElement).toHaveClass('w-fit', 'max-w-full')
    fireEvent.click(source)
    expect(display).toHaveBeenCalledWith('search-hit:1:12:24')
    expect(useReaderState.getState().sidebarOpen).toBe(false)
  })

  it('jumps note citations through their existing annotation CFI', async () => {
    const display = vi.fn().mockResolvedValue(undefined)
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      handlers.onTool?.({
        name: 'search_notes',
        phase: 'result',
        citations: [{
          id: 'annotation-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '书内笔记', startOffset: 0, endOffset: 8, excerpt: '我的想法',
          sourceType: 'annotation', sourceCfi: 'epubcfi(/6/4!/4/2)',
        }],
      })
      handlers.onDelta?.('这是基于笔记的回答')
    })

    renderPanel({ display })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '我记过什么' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    fireEvent.click(await screen.findByRole('button', { name: '书内笔记' }))
    expect(display).toHaveBeenCalledWith('epubcfi(/6/4!/4/2)')
  })

  it('can build the book index from the empty state', async () => {
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/status') return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
      if (path === '/ai/retrieval/status?bookId=book-1') return { data: { bookId: 'book-1', status: 'not_indexed', chunkCount: 0, updatedAt: null } }
      return { data: [] }
    })
    vi.mocked(apiPost).mockResolvedValue({ data: { bookId: 'book-1', status: 'ready', embeddingStatus: 'ready', chunkCount: 8, updatedAt: 123 } })

    renderPanel(readerWithCorpus())
    await openTools()

    const button = await screen.findByRole('button', { name: 'reader.aiIndexBuild' })
    fireEvent.click(button)
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/ai/retrieval/index', {
      bookId: 'book-1',
      force: false,
      visibleTextVersion: 'reader-test',
      chapters: [{ chapterIndex: 0, text: '第一章 经过阅读器变换后的文本' }],
    }, expect.any(AbortSignal)))
  })

  it('keeps lexical index controls available without a chat model', async () => {
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/status') return { data: { enabled: false, provider: 'custom', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
      if (path === '/ai/retrieval/status?bookId=book-1') return { data: { bookId: 'book-1', status: 'not_indexed', embeddingStatus: 'unavailable', chunkCount: 0, updatedAt: null } }
      return { data: [] }
    })
    vi.mocked(apiPost).mockResolvedValue({ data: { bookId: 'book-1', status: 'ready', embeddingStatus: 'unavailable', chunkCount: 8, updatedAt: 123 } })

    renderPanel(readerWithCorpus())
    await openTools()

    fireEvent.click(await screen.findByRole('button', { name: 'reader.aiIndexBuild' }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/ai/retrieval/index', {
      bookId: 'book-1',
      force: false,
      visibleTextVersion: 'reader-test',
      chapters: [{ chapterIndex: 0, text: '第一章 经过阅读器变换后的文本' }],
    }, expect.any(AbortSignal)))
    expect(screen.getByRole('button', { name: '选择模型' })).toBeDisabled()
    expect(screen.getByRole('textbox')).not.toBeDisabled()
  })

  it('requires an explicit rebuild when the configured embedding service changes', async () => {
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/status') return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small', embeddingConfigured: true, maxSelectionChars: 6_000, maxContextChars: 8_000 } }
      if (path === '/ai/retrieval/status?bookId=book-1') return { data: { bookId: 'book-1', status: 'ready', embeddingStatus: 'ready', embeddingProvider: 'ollama', embeddingModel: 'nomic-embed-text', chunkCount: 8, updatedAt: 123 } }
      return { data: [] }
    })
    vi.mocked(apiPost).mockResolvedValue({ data: { bookId: 'book-1', status: 'ready', embeddingStatus: 'ready', embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-small', chunkCount: 8, updatedAt: 123 } })

    renderPanel(readerWithCorpus())
    await openTools()

    expect(await screen.findByText('reader.aiEmbeddingStale')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiEmbeddingRebuild' }))
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/ai/retrieval/index', {
      bookId: 'book-1',
      force: true,
      visibleTextVersion: 'reader-test',
      chapters: [{ chapterIndex: 0, text: '第一章 经过阅读器变换后的文本' }],
    }, expect.any(AbortSignal)))
  })

  it('can cancel an in-flight index build', async () => {
    let indexSignal: AbortSignal | undefined
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/status') return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
      if (path === '/ai/retrieval/status?bookId=book-1') return { data: { bookId: 'book-1', status: 'not_indexed', embeddingStatus: 'not_indexed', chunkCount: 0, updatedAt: null } }
      return { data: [] }
    })
    vi.mocked(apiPost).mockImplementation(async (path, _body, signal) => {
      if (path === '/ai/retrieval/index') {
        indexSignal = signal
        return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
      }
      return { data: { bookId: 'book-1', status: 'not_indexed', embeddingStatus: 'not_indexed', chunkCount: 0, updatedAt: null } }
    })

    renderPanel(readerWithCorpus())
    await openTools()
    fireEvent.click(await screen.findByRole('button', { name: 'reader.aiIndexBuild' }))
    const cancelButton = await screen.findByRole('button', { name: 'reader.aiIndexCancel' })
    fireEvent.click(cancelButton)

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/ai/retrieval/index/cancel', { bookId: 'book-1' }))
    expect(indexSignal?.aborted).toBe(true)
  })

  it('shows the persisted index progress while indexing', async () => {
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/status') return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
      if (path === '/ai/retrieval/status?bookId=book-1') return { data: { bookId: 'book-1', status: 'indexing', embeddingStatus: 'indexing', progress: 42, chunkCount: 8, updatedAt: 123 } }
      return { data: [] }
    })

    renderPanel()
    await openTools()

    expect(await screen.findByText('reader.aiEmbeddingProgress')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
  })

  it('can clear an existing derived index after confirmation', async () => {
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/status') return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
      if (path === '/ai/retrieval/status?bookId=book-1') return { data: { bookId: 'book-1', status: 'ready', embeddingStatus: 'unavailable', chunkCount: 4, updatedAt: 123 } }
      return { data: [] }
    })
    vi.mocked(apiDelete).mockResolvedValue({ data: null })

    renderPanel()
    await openTools()
    fireEvent.click(await screen.findByRole('button', { name: 'reader.aiIndexClear' }))
    expect(screen.getByText('reader.aiIndexClearConfirm')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'settings.fontsDelete' }))

    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/ai/retrieval/index?bookId=book-1'))
  })

  it('creates a persisted thread on the first message and reuses it afterwards', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      handlers.onMeta?.({ requestId: 'ai-1', threadId: 'thread-1', model: 'qwen3:8b', receipt: { selectionChars: 0, beforeChars: 0, contextChars: 0, chapterTitle: null, sourceCfi: 'selection' } })
      handlers.onDelta?.('回答')
    })

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '第一个问题' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '第二个问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(2))
    expect(apiStreamAiChat.mock.calls[1]?.[0]).toMatchObject({ threadId: 'thread-1', prompt: '第二个问题' })
  })

  it('sends with Enter and keeps Shift+Enter available for new lines', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)

    renderPanel()
    const textbox = screen.getByRole('textbox')
    fireEvent.change(textbox, { target: { value: '第一行' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))

    fireEvent.change(textbox, { target: { value: '第一行' } })
    fireEvent.keyDown(textbox, { key: 'Enter', code: 'Enter', shiftKey: true })
    expect(apiStreamAiChat).toHaveBeenCalledTimes(1)
  })

  it('loads a selected thread from the per-book history', async () => {
    const threadStart = Date.now()
    const thread = { id: 'thread-1', bookId: 'book-1', title: '解释第一章', createdAt: threadStart, updatedAt: threadStart + 1_000, messageCount: 2 }
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/threads?bookId=book-1') return { data: [thread] }
      if (path === '/ai/threads/thread-1') return { data: { ...thread, messages: [
        { id: 'message-1', threadId: 'thread-1', role: 'user', content: '服务端问题', context: null, createdAt: 1_000, aborted: false },
        { id: 'message-2', threadId: 'thread-1', role: 'assistant', content: '服务端回答', context: null, createdAt: 1_001, aborted: false },
      ] } }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })

    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiHistory' }))
    await waitFor(() => expect(screen.getByText('解释第一章')).toBeInTheDocument())
    expect(screen.getByText(new RegExp(`${new Date(threadStart).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} · 2`))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'reader.aiRename 解释第一章' })).toHaveClass('opacity-0', 'group-hover:opacity-100')
    fireEvent.click(screen.getByText('解释第一章'))
    await waitFor(() => expect(screen.getByText('服务端问题')).toBeInTheDocument())
    expect(screen.getByText('服务端回答')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'reader.aiHistory' }))
    await waitFor(() => expect(screen.getByText('解释第一章')).toBeInTheDocument())
    fireEvent.click(screen.getByText('解释第一章'))
    expect(screen.getByText('服务端问题')).toBeInTheDocument()
    expect(screen.getByText('服务端回答')).toBeInTheDocument()
  })

  it('shows the selected text as a truncated removable context chip', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    const selectedText = '这是一段很长的引用原文，用于确认输入框上方只显示原文，而不是显示上下文统计。'
    useReaderState.setState({
      aiContext: { cfiRange: 'epubcfi(/6/4!/2)', text: selectedText, rawText: selectedText, chapterTitle: '第一章', chapterIndex: 0 },
    })

    renderPanel()

    const quote = await screen.findByTitle(selectedText)
    expect(quote).toHaveClass('truncate')
    expect(quote.parentElement).toHaveClass('border-[var(--bd-read-primary)]/60', 'text-[var(--bd-read-primary)]')
    expect(screen.queryByText('reader.aiReceiptTitle')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '移除引用原文' }))
    expect(screen.queryByTitle(selectedText)).toBeNull()
  })

  it('saves a selected answer as an idea through the existing annotation API', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiPost).mockResolvedValue({ data: {} })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      handlers.onMeta?.({ requestId: 'ai-1', model: 'qwen3:8b', receipt: { selectionChars: 2, beforeChars: 0, contextChars: 2, chapterTitle: '第一章', sourceCfi: 'epubcfi(/6/4!/2)' } })
      handlers.onDelta?.('这是回答')
    })
    useReaderState.setState({
      aiContext: { cfiRange: 'epubcfi(/6/4!/2)', text: '选区', rawText: '选区', chapterTitle: '第一章', chapterIndex: 0 },
    })

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '解释一下' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    const saveButton = await screen.findByRole('button', { name: 'reader.aiSaveAsIdea' })
    fireEvent.click(saveButton)
    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/annotations/book/book-1', expect.objectContaining({
      cfiRange: 'epubcfi(/6/4!/2)',
      type: 'note',
      text: '选区',
      chapter: '第一章',
      note: '这是回答',
    })))
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiIdeaSaved' })).toBeDisabled())
  })

  it('can stop a stream and retry the same request', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockImplementation((_body, handlers, signal) => new Promise((_resolve, reject) => {
      handlers.onMeta?.({ requestId: 'ai-1', threadId: 'thread-1', model: 'qwen3:8b', receipt: { selectionChars: 2, beforeChars: 0, contextChars: 2, chapterTitle: null, sourceCfi: 'selection' } })
      if (apiStreamAiChat.mock.calls.length > 1) {
        handlers.onDelta?.('重试成功')
        _resolve()
        return
      }
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    useReaderState.setState({ aiContext: { cfiRange: 'selection', text: '选区', rawText: '选区', chapterIndex: 0 } })

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '解释一下' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '停止生成' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(screen.getByText('重试成功')).toBeInTheDocument())
    expect(apiStreamAiChat).toHaveBeenCalledTimes(2)
    expect(apiStreamAiChat.mock.calls[1]?.[0]).toMatchObject({ threadId: 'thread-1', regenerate: true })
  })

  it('restores the prompt after a provider failure so it can be edited or retried', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockRejectedValue(new ApiError('AI_PROVIDER_ERROR', '服务暂时不可用'))

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '失败后保留这个问题' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('失败后保留这个问题'))
    expect(screen.getByText('请求失败：服务暂时不可用')).toBeInTheDocument()
  })

  it('aborts a previous book request and ignores its late callbacks after switching books', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    let aborted = false
    let staleHandlers: { onDelta?: (text: string) => void } | null = null
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers, signal) => {
      staleHandlers = handlers
      await new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => {
        aborted = true
        reject(new DOMException('Aborted', 'AbortError'))
      }, { once: true }))
    })

    const view = renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '旧书问题' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))

    view.rerenderPanel('book-2')
    await waitFor(() => expect(aborted).toBe(true))
    staleHandlers?.onDelta?.('旧书迟到回答')
    expect(screen.queryByText('旧书问题')).toBeNull()
    expect(screen.queryByText('旧书迟到回答')).toBeNull()
  })

  it('offers copy and regenerate actions for a completed answer', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      handlers.onMeta?.({ requestId: 'ai-1', threadId: 'thread-1', model: 'qwen3:8b', receipt: { selectionChars: 0, beforeChars: 0, contextChars: 0, chapterTitle: null, sourceCfi: 'selection' } })
      handlers.onDelta?.('可复制回答')
    })

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '解释一下' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    const copyButton = await screen.findByRole('button', { name: 'reader.aiCopy' })
    fireEvent.click(copyButton)
    expect(writeText).toHaveBeenCalledWith('可复制回答')
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiCopied' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(2))
    expect(apiStreamAiChat.mock.calls[1]?.[0]).toMatchObject({ threadId: 'thread-1', regenerate: true })
  })

  it('exports the visible conversation as markdown', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:ai-conversation')
    const revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      handlers.onMeta?.({ requestId: 'ai-1', threadId: 'thread-1', model: 'qwen3:8b', receipt: { selectionChars: 0, beforeChars: 0, contextChars: 0, chapterTitle: null, sourceCfi: 'selection' } })
      handlers.onDelta?.('可导出回答')
    })
    useAuthStore.setState({ user: { id: 'user-1', username: '小西', role: 'owner' } })

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '导出这个对话' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await openTools()
    const exportButton = await screen.findByRole('button', { name: 'reader.aiExport' })
    await waitFor(() => expect(exportButton).not.toBeDisabled())
    fireEvent.click(exportButton)

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalled()
    const blob = createObjectURL.mock.calls[0]?.[0] as Blob
    expect(await blob.text()).toContain('可导出回答')
    expect(await blob.text()).toContain('## 小西')
    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it('shows the selected text in the input context chip', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    const selectedText = '选区原文'
    useReaderState.setState({ aiContext: { cfiRange: 'epubcfi(/6/4!/2)', text: selectedText, rawText: selectedText, chapterTitle: '第一章', chapterIndex: 0 } })

    renderPanel()

    expect(await screen.findByTitle(selectedText)).toBeInTheDocument()
  })
})
