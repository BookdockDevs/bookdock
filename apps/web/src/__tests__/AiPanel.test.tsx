import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AI_DEFAULT_ASSISTANT_MODE_PROMPT } from '@bookdock/shared'

import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiStreamAiChat } from '../api/client'
import AiPanel from '../features/reader/components/AiPanel'
import { RendererContext } from '../features/reader/hooks/useReaderApi'
import { writeAiPanelMemory } from '../features/reader/lib/ai-panel-memory'
import { useReaderState } from '../features/reader/state/reader-state'
import { useAuthStore } from '../stores/auth.store'
import { useUiStore } from '../stores/ui.store'

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
  getCurrentParagraphText?: ReturnType<typeof vi.fn>
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
  fireEvent.click(await screen.findByRole('button', { name: '工具' }))
  await screen.findByTestId('ai-tools-menu')
}

async function openAttachments() {
  fireEvent.click(await screen.findByRole('button', { name: '添加章节引用' }))
  await screen.findByTestId('ai-attachment-menu')
}

async function openMore() {
  fireEvent.click(await screen.findByRole('button', { name: '更多' }))
  await screen.findByTestId('ai-more-menu')
}

describe('AiPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ user: null })
    useUiStore.setState({ toolbarLocked: false })
    useReaderState.setState({
      aiContext: null,
      aiPendingPrompt: null,
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

  it('keeps the header and composer control groups responsive to the sidebar container', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })

    renderPanel()

    const assistantButton = await screen.findByRole('button', { name: '选择助理模式' })
    const modelButton = screen.getByRole('button', { name: '选择模型' })
    expect(screen.getByTestId('ai-panel')).toHaveClass('@container/ai-panel')
    expect(assistantButton).toHaveTextContent('助理')
    expect(assistantButton.closest('form')).toBeNull()
    expect(assistantButton.parentElement).toHaveClass('max-w-40', '@max-[320px]/ai-panel:max-w-28')
    expect(modelButton.parentElement).toHaveClass('max-w-48', '@max-[240px]/composer:max-w-none')
  })

  it('sends only the tools enabled in the AI tools drawer', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)

    renderPanel()
    await openTools()

    expect(screen.getByRole('switch', { name: '阅读与搜索正文' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: '查看书籍目录' })).toBeInTheDocument()
    const notesTool = screen.getByRole('switch', { name: '搜索笔记与划线' })
    expect(notesTool).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(notesTool)
    expect(notesTool).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('ai-tools-menu')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '只根据正文回答' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({
      enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book'],
    })
  })

  it('sends the selected reading scope with the thread permissions', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)

    renderPanel()
    const scopeButton = await screen.findByRole('button', { name: '阅读范围：读到这里，点击切换' })
    fireEvent.click(scopeButton)
    expect(screen.getByRole('button', { name: '阅读范围：当前章节，点击切换' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '阅读范围：当前章节，点击切换' }))
    expect(screen.getByRole('button', { name: '阅读范围：全书，点击切换' })).toHaveClass('text-amber-700')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '请完整概括这本书' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({ readingScope: 'full_book', assistantMode: '助理', assistantModePrompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT })
  })

  it('restores the draft per book while reusing the latest conversation settings', async () => {
    let latestSettings = { readingScope: 'to_here' as const, enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book', 'search_notes'] as const, assistantModeId: 'assistant' }
    vi.mocked(apiGet).mockImplementation(async () => ({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000, lastUsedConversationSettings: latestSettings } }))
    vi.mocked(apiPatch).mockImplementation(async (_path, body) => {
      if ('lastUsedConversationSettings' in body) latestSettings = body.lastUsedConversationSettings
      return { data: { lastUsedConversationSettings: latestSettings } }
    })

    const first = renderPanel()
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: '未发送的草稿' } })
    fireEvent.click(screen.getByRole('button', { name: '阅读范围：读到这里，点击切换' }))
    await openTools()
    fireEvent.click(screen.getByRole('switch', { name: '搜索笔记与划线' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(2))
    expect(latestSettings).toMatchObject({ readingScope: 'current_chapter', enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book'] })
    first.unmount()

    renderPanel()
    expect(await screen.findByRole('textbox')).toHaveValue('未发送的草稿')
    await waitFor(() => expect(screen.getByRole('button', { name: '阅读范围：当前章节，点击切换' })).toBeInTheDocument())
    await openTools()
    expect(screen.getByRole('switch', { name: '搜索笔记与划线' })).toHaveAttribute('aria-checked', 'false')
  })

  it('restores an active thread and saves its permission changes without sending a message', async () => {
    const threadStart = Date.now()
    const thread = { id: 'thread-1', bookId: 'book-1', title: '继续阅读', createdAt: threadStart, updatedAt: threadStart, messageCount: 1 }
    let savedScope = 'to_here' as const
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/threads?bookId=book-1') return { data: [thread] }
      if (path === '/ai/threads/thread-1') return { data: { ...thread, messages: [
        { id: 'message-1', threadId: 'thread-1', role: 'user', content: '已恢复的问题', context: null, createdAt: 1_000, aborted: false },
      ], settings: { readingScope: savedScope, enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book', 'search_notes'] } } }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })
    vi.mocked(apiPatch).mockImplementation(async (_path, body) => {
      savedScope = body.settings?.readingScope ?? savedScope
      return { data: { ...thread, messages: [], settings: { readingScope: savedScope, enabledTools: body.settings?.enabledTools ?? ['get_book_toc', 'get_chapter_content', 'search_book', 'search_notes'], assistantModeId: body.settings?.assistantModeId ?? 'assistant' } } }
    })
    writeAiPanelMemory('anonymous', 'book-1', {
      activeThreadId: 'thread-1',
      prompt: '',
      chapterReferences: [],
    })

    renderPanel()
    await screen.findByText('已恢复的问题')
    const scopeButton = screen.getByRole('button', { name: '阅读范围：读到这里，点击切换' })
    fireEvent.click(scopeButton)

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/ai/threads/thread-1', {
      settings: {
        readingScope: 'current_chapter',
        enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book', 'search_notes'],
        assistantModeId: 'assistant',
      },
    }))
  })

  it('restores the latest retry recipe and idea target from a historical thread', async () => {
    const threadStart = Date.now()
    const thread = { id: 'thread-1', bookId: 'book-1', title: '继续阅读', createdAt: threadStart, updatedAt: threadStart, messageCount: 2 }
    const retry = {
      context: { chapterIndex: 0, chapterTitle: '第一章', cfiRange: 'epubcfi(/6/2!/4/2)', selection: '选中的正文', before: '前文' },
      readingScope: 'to_here' as const,
      enabledTools: ['get_book_toc', 'get_chapter_content'] as const,
      assistantMode: '助理',
    }
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/threads?bookId=book-1') return { data: [thread] }
      if (path === '/ai/threads/thread-1') return { data: { ...thread, messages: [
        { id: 'message-1', threadId: 'thread-1', role: 'user', content: '解释这段', context: { selectionChars: 5, beforeChars: 2, contextChars: 7, chapterTitle: '第一章', sourceCfi: retry.context.cfiRange }, retry, citations: [], createdAt: 1_000, aborted: false },
        { id: 'message-2', threadId: 'thread-1', role: 'assistant', content: '这是解释', context: null, retry: null, citations: [], createdAt: 2_000, aborted: false },
      ], settings: { readingScope: 'to_here', enabledTools: ['get_book_toc', 'get_chapter_content'] } } }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)
    writeAiPanelMemory('anonymous', 'book-1', {
      activeThreadId: 'thread-1',
      prompt: '',
      chapterReferences: [],
    })

    renderPanel()

    expect(await screen.findByText('这是解释')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'reader.aiSaveAsIdea' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({
      threadId: 'thread-1',
      regenerate: true,
      prompt: '解释这段',
      context: retry.context,
      readingScope: 'to_here',
      enabledTools: ['get_book_toc', 'get_chapter_content'],
      assistantMode: '助理',
      assistantModePrompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT,
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

    await openAttachments()
    fireEvent.click(await screen.findByRole('button', { name: '第三章' }))
    expect(screen.getByRole('button', { name: '第三章' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '移除章节附件 第三章' })).toBeInTheDocument()
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
    fireEvent.click(await screen.findByRole('button', { name: /引用 · 1 条/ }))
    fireEvent.click(await screen.findByRole('button', { name: /跳转到引用 1: 第三章/ }))
    expect(renderer.display).toHaveBeenCalledWith('chapter:2')
    expect(screen.queryByRole('button', { name: '移除章节附件 第三章' })).toBeNull()
  })

  it('keeps chapter references inside the attachment menu', async () => {
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/books/book-1/chapters') return { data: [{ id: 'chapter-1', title: '第一章', level: 1, startOffset: 0, endOffset: 10 }] }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })

    renderPanel(readerWithChapterReferences())

    await openAttachments()
    expect(screen.getByText('添加章节引用')).toBeInTheDocument()
    expect(screen.queryByText('所选内容仅附加到下一条消息')).toBeNull()
    expect(screen.getByRole('button', { name: '添加章节引用' })).toHaveClass('bg-stone-500/10')
  })

  it('preserves TOC nesting and collapses chapter-reference groups', async () => {
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/books/book-1/chapters') return { data: [
        { id: 'volume-1', title: '第一卷', level: 1, startOffset: 0, endOffset: 10 },
        { id: 'chapter-1', title: '第一章', level: 2, startOffset: 10, endOffset: 20 },
        { id: 'chapter-2', title: '第二章', level: 2, startOffset: 20, endOffset: 30 },
        { id: 'volume-2', title: '第二卷', level: 1, startOffset: 30, endOffset: 40 },
        { id: 'chapter-3', title: '第三章', level: 2, startOffset: 40, endOffset: 50 },
      ] }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })

    renderPanel(readerWithChapterReferences())

    await openAttachments()
    expect(screen.getByRole('button', { name: '第一章' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '折叠 第一卷' }))
    expect(screen.queryByRole('button', { name: '第一章' })).toBeNull()
    expect(screen.getByRole('button', { name: '第二卷' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '展开 第一卷' }))
    expect(screen.getByRole('button', { name: '第一章' })).toBeInTheDocument()
  })

  it('selects an assistant mode and persists a new mode from the header', async () => {
    let modeSaved = false
    let savedModeId = ''
    vi.mocked(apiGet).mockImplementation(async () => ({ data: {
      enabled: true,
      provider: 'ollama',
      model: 'qwen3:8b',
      modes: modeSaved ? [
        { id: 'assistant', name: '助理', prompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT, builtIn: true },
        { id: savedModeId, name: '书评人', prompt: '用书评人的口吻回答。', builtIn: false },
      ] : [{ id: 'assistant', name: '助理', prompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT, builtIn: true }],
      maxSelectionChars: 6_000,
      maxContextChars: 8_000,
    } }))
    vi.mocked(apiPatch).mockImplementation(async (_path, body) => {
      modeSaved = true
      savedModeId = (body as { modes: Array<{ id: string }> }).modes[0]!.id
      return { data: {
        modes: [
          { id: 'assistant', name: '助理', prompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT, builtIn: true },
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
    expect(screen.getByRole('button', { name: '选择助理模式' }).closest('form')).toBeNull()
  })

  it('edits and restores the built-in assistant mode from its menu action', async () => {
    let defaultMode = { id: 'assistant', name: '助理', prompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT, builtIn: true }
    vi.mocked(apiGet).mockResolvedValue({ data: {
      enabled: true,
      provider: 'ollama',
      model: 'qwen3:8b',
      modes: [defaultMode],
      maxSelectionChars: 6_000,
      maxContextChars: 8_000,
    } })
    vi.mocked(apiPatch).mockImplementation(async (_path, body) => {
      const request = body as { defaultAssistantMode?: { id: string; name: string; prompt: string } | null }
      defaultMode = request.defaultAssistantMode === null
        ? { id: 'assistant', name: '助理', prompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT, builtIn: true }
        : { ...defaultMode, ...(request.defaultAssistantMode ?? {}) }
      return { data: { modes: [defaultMode] } }
    })

    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: '选择助理模式' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑模式 助理' }))
    expect(screen.getByRole('heading', { name: '编辑模式' })).toBeInTheDocument()
    expect(screen.getByLabelText('模式名称')).toHaveValue('助理')
    expect(screen.getByLabelText('系统提示词')).toHaveValue(AI_DEFAULT_ASSISTANT_MODE_PROMPT)
    fireEvent.change(screen.getByLabelText('模式名称'), { target: { value: '自由助理' } })
    fireEvent.change(screen.getByLabelText('系统提示词'), { target: { value: '按照我的要求自由回答。' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/ai/config', {
      modes: [],
      defaultAssistantMode: { id: 'assistant', name: '自由助理', prompt: '按照我的要求自由回答。' },
    }))
    await waitFor(() => expect(screen.getByRole('button', { name: '选择助理模式' })).toHaveTextContent('自由助理'))

    fireEvent.click(screen.getByRole('button', { name: '选择助理模式' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑模式 自由助理' }))
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(screen.getByText('确定恢复默认助理模式吗？')).toBeInTheDocument()
    const restoreButtons = screen.getAllByRole('button', { name: '恢复默认' })
    fireEvent.click(restoreButtons[restoreButtons.length - 1]!)

    await waitFor(() => expect(apiPatch).toHaveBeenLastCalledWith('/ai/config', { defaultAssistantMode: null }))
    expect(screen.getByRole('button', { name: '选择助理模式' })).toHaveTextContent('助理')
  })

  it('edits and deletes a custom assistant mode from its compact menu action', async () => {
    const defaultMode = { id: 'assistant', name: '助理', prompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT, builtIn: true }
    let modes = [defaultMode, { id: 'custom-reviewer', name: '书评人', prompt: '用书评人的口吻回答。', builtIn: false }]
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/annotations/book/book-1') return { data: [] }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', modes, maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })
    vi.mocked(apiPatch).mockImplementation(async (_path, body) => {
      if ('lastUsedConversationSettings' in body) return { data: { modes } }
      const nextModes = (body as { modes: Array<{ id: string; name: string; prompt: string }> }).modes
      modes = [defaultMode, ...nextModes.map((mode) => ({ ...mode, builtIn: false }))]
      return { data: { modes } }
    })
   renderPanel()
  fireEvent.click(await screen.findByRole('button', { name: '选择助理模式' }))
   expect(screen.getByRole('menuitem', { name: '编辑模式 书评人' })).toBeInTheDocument()
   fireEvent.click(screen.getByRole('menuitemradio', { name: '书评人' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/ai/config', expect.objectContaining({ lastUsedConversationSettings: expect.objectContaining({ assistantModeId: 'custom-reviewer' }) })))
    fireEvent.click(screen.getByRole('button', { name: '选择助理模式' }))
   fireEvent.click(screen.getByRole('menuitem', { name: '编辑模式 书评人' }))
    expect(screen.getByRole('heading', { name: '编辑模式' })).toBeInTheDocument()
    expect(screen.getByLabelText('模式名称')).toHaveValue('书评人')
    expect(screen.getByLabelText('系统提示词')).toHaveValue('用书评人的口吻回答。')
    fireEvent.change(screen.getByLabelText('模式名称'), { target: { value: '严谨书评人' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/ai/config', {
      modes: [{ id: 'custom-reviewer', name: '严谨书评人', prompt: '用书评人的口吻回答。' }],
    }))
    expect(screen.getByRole('button', { name: '选择助理模式' })).toHaveTextContent('严谨书评人')
    fireEvent.click(screen.getByRole('button', { name: '选择助理模式' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑模式 严谨书评人' }))
    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(screen.getByText('确定删除助理模式“严谨书评人”吗？')).toBeInTheDocument()
    const deleteButtons = screen.getAllByRole('button', { name: '删除' })
    fireEvent.click(deleteButtons[deleteButtons.length - 1]!)
    await waitFor(() => expect(apiPatch).toHaveBeenLastCalledWith('/ai/config', { modes: [] }))
    expect(screen.getByRole('button', { name: '选择助理模式' })).toHaveTextContent('助理')
    fireEvent.click(screen.getByRole('button', { name: '选择助理模式' }))
    expect(screen.queryByRole('menuitem', { name: '编辑模式 严谨书评人' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: '编辑模式 助理' })).toBeInTheDocument()
  })
  it('uses the wrench button and outside area to close the compact tools menu', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })

    renderPanel()
    await openTools()
    expect(screen.queryByText('所选工具对当前对话持续生效')).toBeNull()
    expect(screen.queryByText('阅读范围')).toBeNull()
    expect(screen.getByRole('button', { name: '工具' })).toHaveClass('bg-stone-500/10')

    fireEvent.click(screen.getByRole('button', { name: '工具' }))
    expect(screen.queryByTestId('ai-tools-menu')).toBeNull()

    await openTools()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('ai-tools-menu')).toBeNull()
  })

  it('warms the thread list before history opens without refetching on every click', async () => {
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/threads?bookId=book-1') return { data: [] }
      if (path === '/books/book-1/chapters') return { data: [] }
      if (path === '/ai/retrieval/status?bookId=book-1') return { data: { bookId: 'book-1', status: 'not_indexed', embeddingStatus: 'not_indexed', progress: 0, chunkCount: 0, updatedAt: null } }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', models: [], modes: [], maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })

    renderPanel()

    await waitFor(() => expect(apiGet.mock.calls.filter(([path]) => path === '/ai/threads?bookId=book-1')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiHistory' }))
    expect(await screen.findByText('reader.aiHistoryEmpty')).toBeInTheDocument()
    expect(apiGet.mock.calls.filter(([path]) => path === '/ai/threads?bookId=book-1')).toHaveLength(1)
  })

  it('fills a selected-passage quick action from the slash menu without sending it', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    useReaderState.setState({ aiContext: { cfiRange: 'selection', text: '选区', rawText: '选区', chapterIndex: 0 } })

    renderPanel()
    const textbox = screen.getByRole('textbox')
    expect(screen.queryByRole('button', { name: '快捷指令' })).toBeNull()
    fireEvent.change(textbox, { target: { value: '/' } })

    const quickAction = await screen.findByRole('menuitem', { name: 'reader.aiQuickExplain' })
    fireEvent.click(quickAction)
    expect(textbox).toHaveValue('reader.aiQuickExplainPrompt')
    expect(apiStreamAiChat).not.toHaveBeenCalled()
  })

  it('offers translation as a selected-passage quick action', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    useReaderState.setState({ aiContext: { cfiRange: 'selection', text: '选区', rawText: '选区', chapterIndex: 0 } })

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/translate' } })

    const quickAction = await screen.findByRole('menuitem', { name: 'reader.aiQuickTranslate' })
    expect(screen.queryByRole('menuitem', { name: 'reader.aiQuickExplain' })).toBeNull()
    fireEvent.click(quickAction)
    expect(screen.getByRole('textbox')).toHaveValue('reader.aiQuickTranslatePrompt')
    expect(apiStreamAiChat).not.toHaveBeenCalled()
  })

  it('applies slash commands with keyboard navigation without sending', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })

    renderPanel()
    const textbox = screen.getByRole('textbox')
    fireEvent.change(textbox, { target: { value: '/' } })
    await screen.findByRole('menuitem', { name: 'reader.aiQuickExplain' })
    fireEvent.keyDown(textbox, { key: 'ArrowDown' })
    await waitFor(() => expect(screen.getAllByRole('menuitem')[1]).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getAllByRole('menuitem')[1]).toHaveTextContent('reader.aiQuickTranslate')
    fireEvent.keyDown(textbox, { key: 'Enter' })

    expect(textbox).toHaveValue('reader.aiQuickTranslatePrompt')
    expect(apiStreamAiChat).not.toHaveBeenCalled()
  })

  it('shows a compact slash-command no-result state and keeps the text sendable', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)

    renderPanel()
    const textbox = screen.getByRole('textbox')
    fireEvent.change(textbox, { target: { value: '/aaa' } })

    expect(await screen.findByText('reader.aiQuickCommandsNoMatch')).toBeInTheDocument()
    expect(screen.getByText('reader.aiQuickCommandsNoMatchHint')).toBeInTheDocument()
    expect(screen.queryByText('reader.aiPromptsEmpty')).toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.keyDown(textbox, { key: 'Enter' })

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({ prompt: '/aaa' })
  })

  it('distinguishes having no enabled quick commands from a search miss', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', prompts: [], maxSelectionChars: 6_000, maxContextChars: 8_000 } })

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/' } })

    expect(await screen.findByText('reader.aiQuickCommandsEmpty')).toBeInTheDocument()
    expect(screen.queryByText('reader.aiQuickCommandsNoMatch')).toBeNull()
    expect(screen.queryByText('reader.aiQuickCommandsNoMatchHint')).toBeNull()
  })

  it('switches between models saved on the active AI profile', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', models: [{ id: 'qwen3:8b', name: 'qwen3:8b' }, { id: 'llama3.2', name: 'llama3.2' }], activeProfileId: 'profile-1', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiPatch).mockResolvedValue({ data: {} })

    renderPanel()

    const selector = await screen.findByRole('button', { name: '选择模型' })
    await waitFor(() => expect(selector).not.toBeDisabled())
    fireEvent.click(selector)
    expect(selector).toHaveClass('bg-stone-500/10')
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

  it('offers every enabled quick action without a selected passage', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/' } })

    const summary = await screen.findByRole('menuitem', { name: 'reader.aiQuickChapterSummary' })
    expect(screen.getByRole('menuitem', { name: 'reader.aiQuickExplain' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'reader.aiQuickTranslate' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'reader.aiQuickSummarize' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'reader.aiQuickQuestions' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'reader.aiQuickReadToHere' })).toBeInTheDocument()
    fireEvent.click(summary)
    expect(screen.getByRole('textbox')).toHaveValue('reader.aiQuickChapterSummaryPrompt')
    expect(apiStreamAiChat).not.toHaveBeenCalled()
  })

  it('expands selection, paragraph, and visible chapter variables before sending', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)
    useReaderState.setState({
      aiContext: {
        cfiRange: 'epubcfi(/6/4!/2)',
        text: '选区',
        rawText: '选区',
        paragraphText: '选区所在段落',
        beforeText: '前文',
        chapterIndex: 0,
      },
    })

    const renderer = readerWithChapterReferences()
    renderPanel(renderer)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '处理 {SELTEXT}\n{SELPARA}\n{CHAPTER}' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(renderer.getAiChapterText).toHaveBeenCalledWith(0)
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({
      prompt: '处理 选区\n选区所在段落\n第1章的可见正文',
      context: { selection: '选区' },
    })
  })

  it('sends a selection larger than the former fixed limit without truncating it', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)
    useReaderState.setState({ aiContext: {
      cfiRange: 'epubcfi(/6/4!/2)',
      text: '选区预览',
      rawText: '字'.repeat(6_001),
      chapterIndex: 0,
    } })

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '解释这段' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0].context.selection).toHaveLength(6_001)
  })

  it('uses the current visible paragraph when no selection exists', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)
    const renderer = {
      ...readerWithChapterReferences(),
      getCurrentParagraphText: vi.fn().mockReturnValue('当前阅读段落'),
    }

    renderPanel(renderer)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{SELPARA}' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(renderer.getCurrentParagraphText).toHaveBeenCalled()
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({ prompt: '当前阅读段落' })
  })

  it('sends a pending selection command as soon as the AI panel is ready', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)
    useReaderState.setState({
      aiContext: { cfiRange: 'selection', text: '选区', rawText: '选区', chapterIndex: 0 },
      aiPendingPrompt: '解释：{SELTEXT}',
    })

    renderPanel()

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({ prompt: '解释：选区' })
    expect(useReaderState.getState().aiPendingPrompt).toBeNull()
  })

  it('sends a chapter variable larger than the former context limit without truncating it', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)
    useReaderState.setState({ aiContext: { cfiRange: 'selection', text: '', rawText: '', chapterIndex: 0 } })
    const renderer = {
      ...readerWithChapterReferences(),
      getAiChapterText: vi.fn().mockResolvedValue('x'.repeat(8_001)),
    }

    renderPanel(renderer)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '{CHAPTER}' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(renderer.getAiChapterText).toHaveBeenCalledWith(0))
    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0].prompt).toHaveLength(8_001)
  })

  it('shows tool citations and jumps to their bounded reader range', async () => {
    const display = vi.fn().mockResolvedValue(undefined)
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      handlers.onMeta?.({ requestId: 'ai-1', model: 'qwen3:8b', receipt: { selectionChars: 0, beforeChars: 0, contextChars: 0, chapterTitle: null, sourceCfi: 'selection', readingScope: 'to_here' } })
      handlers.onTool?.({
        name: 'search_book',
        phase: 'result',
        citations: [{ id: 'chunk-1', chapterIndex: 1, chapterId: 'ch-1', chapterTitle: '第一章', startOffset: 12, endOffset: 24, excerpt: '命中段落' }],
      })
      handlers.onDelta?.('这是回答[1]')
    })

    renderPanel({ display })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '查找线索' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    const marker = await screen.findByRole('button', { name: '跳转到依据 1' })
    fireEvent.click(marker)
    expect(display).toHaveBeenCalledWith('search-hit:1:12:24')
    const basis = await screen.findByRole('button', { name: /依据 · 1 条/ })
    fireEvent.click(basis)
    const source = await screen.findByRole('button', { name: /第一章/ })
    expect(source).toHaveAttribute('title', '命中段落')
    expect(screen.getByText('这是回答').parentElement?.parentElement).toHaveClass('w-fit', 'max-w-[92%]')
    fireEvent.click(source)
    expect(display).toHaveBeenCalledWith('search-hit:1:12:24')
    expect(useReaderState.getState().sidebarOpen).toBe(false)
  })

  it('jumps note citations through their existing annotation CFI', async () => {
    const display = vi.fn().mockResolvedValue(undefined)
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      handlers.onMeta?.({ requestId: 'ai-1', model: 'qwen3:8b', receipt: { selectionChars: 0, beforeChars: 0, contextChars: 0, chapterTitle: null, sourceCfi: 'selection', readingScope: 'to_here' } })
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

    fireEvent.click(await screen.findByRole('button', { name: /依据 · 1 条/ }))
    fireEvent.click(await screen.findByRole('button', { name: /书内笔记/ }))
    expect(display).toHaveBeenCalledWith('epubcfi(/6/4!/4/2)')
  })

  it('shows only actionable book evidence instead of request receipt details', async () => {
    const display = vi.fn().mockResolvedValue(undefined)
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      handlers.onMeta?.({ requestId: 'ai-1', model: 'qwen3:8b', receipt: {
        selectionChars: 2,
        beforeChars: 3,
        chapterChars: 4,
        ragChars: 5,
        notesChars: 6,
        contextChars: 20,
        chapterTitle: '第二章',
        sourceCfi: 'epubcfi(/6/4!/2)',
        readingScope: 'current_chapter',
        model: 'qwen3:8b',
        assistantMode: '书评人',
      } })
      handlers.onTool?.({
        name: 'search_book',
        phase: 'result',
        citations: [{ id: 'chunk-2', chapterIndex: 1, chapterId: 'ch-1', chapterTitle: '第二章', startOffset: 12, endOffset: 24, excerpt: '命中段落' }],
      })
      handlers.onDelta?.('有依据的回答【1】')
    })
    renderPanel({ display })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '解释一下' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    const basis = await screen.findByRole('button', { name: /依据 · 1 条/ })
    expect(screen.getByRole('button', { name: '跳转到依据 1' })).toBeInTheDocument()
    fireEvent.click(basis)
    expect(screen.getByText('书籍依据')).toBeInTheDocument()
    expect(screen.getByText('命中段落')).toBeInTheDocument()
    expect(screen.queryByText('使用摘要')).toBeNull()
    expect(screen.queryByText('回答信息')).toBeNull()
    expect(screen.queryByText(/system|reasoning|tool payload/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /第二章/ }))
    expect(display).toHaveBeenCalledWith('search-hit:1:12:24')
  })

  it('can build the book index from the empty state', async () => {
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/status') return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
      if (path === '/ai/retrieval/status?bookId=book-1') return { data: { bookId: 'book-1', status: 'not_indexed', chunkCount: 0, updatedAt: null } }
      return { data: [] }
    })
    vi.mocked(apiPost).mockResolvedValue({ data: { bookId: 'book-1', status: 'ready', embeddingStatus: 'ready', chunkCount: 8, updatedAt: 123 } })

    renderPanel(readerWithCorpus())
    await openMore()

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
    await openMore()

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
    await openMore()

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
    await openMore()
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
    await openMore()

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
    await openMore()
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
    useReaderState.setState({ aiContext: { cfiRange: 'epubcfi(/6/4!/2)', text: '选中的原文', rawText: '选中的原文', beforeText: '前文', chapterTitle: '第一章', chapterIndex: 0 } })

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '第一个问题' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '第二个问题' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(2))
    expect(apiStreamAiChat.mock.calls[1]?.[0]).toMatchObject({
      threadId: 'thread-1',
      prompt: '第二个问题',
      history: expect.arrayContaining([expect.objectContaining({
        role: 'user',
        content: '第一个问题',
        context: expect.objectContaining({ selection: '选中的原文' }),
      })]),
    })
  })

  it('keeps the first answer visible while the new thread is added to history', async () => {
    const thread = { id: 'thread-1', bookId: 'book-1', title: '你好', createdAt: 1_000, updatedAt: 2_000, messageCount: 2 }
    let historyRequests = 0
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/threads?bookId=book-1') {
        historyRequests += 1
        return { data: historyRequests === 1 ? [] : [thread] }
      }
      if (path === '/ai/threads/thread-1') return { data: { ...thread, messages: [
        { id: 'message-1', threadId: 'thread-1', role: 'user', content: '你好', context: null, createdAt: 1_000, aborted: false },
        { id: 'message-2', threadId: 'thread-1', role: 'assistant', content: '回答', context: null, createdAt: 2_000, aborted: false },
      ] } }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      handlers.onMeta?.({ requestId: 'ai-1', threadId: 'thread-1', model: 'qwen3:8b', receipt: { selectionChars: 0, beforeChars: 0, contextChars: 0, chapterTitle: null, sourceCfi: 'selection' } })
      handlers.onDelta?.('回答')
    })

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '你好' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() => expect(historyRequests).toBeGreaterThanOrEqual(2))
    expect(screen.getByText('你好')).toBeInTheDocument()
    expect(screen.getByText('回答')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('does not replace a streamed quick-command answer with an incomplete thread refresh', async () => {
    const thread = { id: 'thread-1', bookId: 'book-1', title: '思考问题', createdAt: 1_000, updatedAt: 2_000, messageCount: 1 }
    let historyRequests = 0
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/threads?bookId=book-1') {
        historyRequests += 1
        return { data: historyRequests === 1 ? [] : [thread] }
      }
      if (path === '/ai/threads/thread-1') return { data: { ...thread, messages: [
        { id: 'message-1', threadId: 'thread-1', role: 'user', content: '请围绕这段内容提出几个思考问题。', context: null, createdAt: 1_000, aborted: false },
      ] } }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      handlers.onMeta?.({ requestId: 'ai-1', threadId: 'thread-1', model: 'qwen3:8b', receipt: { selectionChars: 105, beforeChars: 166, contextChars: 271, chapterTitle: '第1章 徐福', sourceCfi: 'selection' } })
      handlers.onTool?.({ name: 'search_book', phase: 'result', citations: [{ id: 'citation-1', chapterIndex: 0, chapterId: 'chapter-1', chapterTitle: '第1章 徐福', startOffset: 0, endOffset: 10, excerpt: '引用内容' }] })
      handlers.onDelta?.('这是快捷指令生成的回答')
    })

    useReaderState.setState({
      aiContext: { cfiRange: 'epubcfi(/6/8!/4/8,/1:0,/1:105)', text: '选中的内容', rawText: '选中的内容', beforeText: '前文', chapterTitle: '第1章 徐福', chapterIndex: 0 },
      aiPendingPrompt: '请围绕这段内容提出几个思考问题。',
    })
    renderPanel()

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(historyRequests).toBeGreaterThanOrEqual(2))
    await waitFor(() => expect(apiGet.mock.calls.some(([path]) => path === '/ai/threads/thread-1')).toBe(true))
    expect(screen.getByText('这是快捷指令生成的回答')).toBeInTheDocument()
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

  it('shows selected text as a removable next-message attachment', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    const selectedText = '这是一段很长的引用原文，用于确认输入框上方只显示原文，而不是显示上下文统计。'
    useReaderState.setState({
      aiContext: { cfiRange: 'epubcfi(/6/4!/2)', text: selectedText, rawText: selectedText, chapterTitle: '第一章', chapterIndex: 0 },
    })

    renderPanel()

    const quote = await screen.findByTitle(selectedText)
    expect(quote).toHaveClass('truncate')
    expect(quote.parentElement).toHaveClass('border-[var(--bd-read-primary)]/50', 'text-[var(--bd-read-primary)]')
    expect(screen.queryByText('reader.aiReceiptTitle')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '移除选中文本' }))
    expect(screen.queryByTitle(selectedText)).toBeNull()
  })

  it('saves a selected answer as an idea through the existing annotation API', async () => {
    vi.mocked(apiGet).mockImplementation(async (path) => path === '/annotations/book/book-1'
      ? { data: [] }
      : { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
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

  it('keeps next-request controls interactive while a request is streaming', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockImplementation((_body, handlers, signal) => new Promise((_resolve, reject) => {
      handlers.onMeta?.({ requestId: 'ai-1', threadId: 'thread-1', model: 'qwen3:8b', receipt: { selectionChars: 0, beforeChars: 0, contextChars: 0, chapterTitle: null, sourceCfi: 'selection' } })
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '正在处理的问题' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await screen.findByRole('button', { name: '停止生成' })

    const textbox = screen.getByRole('textbox')
    expect(textbox).not.toBeDisabled()
    fireEvent.change(textbox, { target: { value: '下一条问题' } })
    expect(textbox).toHaveValue('下一条问题')

    const scopeButton = screen.getByRole('button', { name: '阅读范围：读到这里，点击切换' })
    expect(scopeButton).not.toBeDisabled()
    fireEvent.click(scopeButton)
    expect(screen.getByRole('button', { name: '阅读范围：当前章节，点击切换' })).toBeInTheDocument()

    await openTools()
    const notesTool = screen.getByRole('switch', { name: '搜索笔记与划线' })
    expect(notesTool).not.toBeDisabled()
    fireEvent.click(notesTool)
    expect(notesTool).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByRole('button', { name: '停止生成' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument())
    expect(textbox).toHaveValue('下一条问题')
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

  it('shows the actionable quote immediately on the user message', async () => {
    const display = vi.fn().mockResolvedValue(undefined)
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    let release!: () => void
    const responseReady = new Promise<void>((resolve) => { release = resolve })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      await responseReady
      handlers.onMeta?.({ requestId: 'ai-1', model: 'qwen3:8b', receipt: {
        selectionChars: 8,
        beforeChars: 3,
        contextChars: 11,
        chapterTitle: '第一章',
        sourceCfi: 'epubcfi(/6/4!/2)',
      } })
      handlers.onDelta?.('带上下文的回答')
    })
    useReaderState.setState({ aiContext: { cfiRange: 'epubcfi(/6/4!/2)', text: '选中的内容', rawText: '选中的内容', beforeText: '前文', chapterTitle: '第一章', chapterIndex: 0 } })

    renderPanel({ display })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '解释一下' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    const quote = await screen.findByRole('button', { name: /引用 · 1 条/ })
    expect(screen.queryByText('带上下文的回答')).toBeNull()
    fireEvent.click(quote)
    expect(screen.getByText('选中的内容')).toBeInTheDocument()
    expect(screen.queryByText('前文')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /第一章 · 选中文本/ }))
    expect(display).toHaveBeenCalledWith('epubcfi(/6/4!/2)')
    release()
    await waitFor(() => expect(screen.getByText('带上下文的回答')).toBeInTheDocument())
  })

  it('keeps the reader sidebar open when a locked sidebar jumps to a quote', async () => {
    const display = vi.fn().mockResolvedValue(undefined)
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      handlers.onDelta?.('回答')
    })
    useUiStore.setState({ toolbarLocked: true })
    useReaderState.setState({ aiContext: { cfiRange: 'epubcfi(/6/4!/2)', text: '选中的内容', rawText: '选中的内容', chapterTitle: '第一章', chapterIndex: 0 } })

    renderPanel({ display })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '解释一下' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '发送' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    const quote = await screen.findByRole('button', { name: /引用 · 1 条/ })
    fireEvent.click(quote)
    fireEvent.click(await screen.findByRole('button', { name: /第一章 · 选中文本/ }))
    expect(display).toHaveBeenCalledWith('epubcfi(/6/4!/2)')
    expect(useReaderState.getState().sidebarOpen).toBe(true)
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
    expect(copyButton.parentElement?.previousElementSibling).toHaveClass('rounded-xl')
    expect(copyButton.textContent).toBe('')
    fireEvent.click(copyButton)
    expect(writeText).toHaveBeenCalledWith('可复制回答')
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiCopied' })).toBeInTheDocument())
    const retryButton = screen.getByRole('button', { name: '重试' })
    expect(retryButton.textContent).toBe('')
    fireEvent.click(retryButton)
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

    await openMore()
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

  it('keeps the attachment row hidden when no temporary context exists', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })

    renderPanel()

    expect(screen.queryByRole('button', { name: '移除选中文本' })).toBeNull()
    expect(screen.queryByLabelText(/移除章节附件/)).toBeNull()
  })
})
