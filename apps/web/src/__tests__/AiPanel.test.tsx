import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AI_DEFAULT_ASSISTANT_MODE_PROMPT } from '@bookdock/shared'

import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiStreamAiChat } from '../api/client'
import AiPanel from '../features/reader/components/AiPanel'
import { RendererContext } from '../features/reader/hooks/useReaderApi'
import { writeAiPanelMemory } from '../features/reader/lib/ai-panel-memory'
import { normalizeMarkdownParagraphLines } from '../features/reader/lib/markdown'
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
  fireEvent.click(await screen.findByRole('button', { name: 'reader.aiTools' }))
  await screen.findByTestId('ai-tools-menu')
}

async function openAttachments() {
  fireEvent.click(await screen.findByRole('button', { name: 'reader.aiAddChapterReference' }))
  await screen.findByTestId('ai-attachment-menu')
}

async function openMore() {
  fireEvent.click(await screen.findByRole('button', { name: 'reader.aiMore' }))
  await screen.findByTestId('ai-more-menu')
}

describe('AiPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ user: null })
    useUiStore.setState({ toolbarLocked: false })
    useReaderState.setState({
      aiContext: null,
      aiPendingCommand: null,
      selection: null,
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
        provider: 'openai',
        maxSelectionChars: 6_000,
        maxContextChars: 8_000,
      },
    })

    renderPanel(readerWithCorpus())

    await waitFor(() => expect(screen.getByLabelText('reader.aiSelectModel')).toBeDisabled())
    expect(screen.getByRole('textbox')).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'reader.aiSend' })).toBeDisabled()
    expect(screen.queryByText(/尚未配置|暂不可使用/)).toBeNull()
    expect(screen.queryByText('可让 AI 查看目录或章节')).toBeNull()
  })

  it('keeps the header and composer control groups responsive to the sidebar container', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })

    renderPanel()

    const assistantButton = await screen.findByRole('button', { name: 'reader.aiSelectAssistantMode' })
    const modelButton = screen.getByRole('button', { name: 'reader.aiSelectModel' })
    expect(screen.getByTestId('ai-panel')).toHaveClass('@container/ai-panel')
    expect(assistantButton).toHaveTextContent('reader.aiDefaultAssistantModeName')
    expect(assistantButton.closest('form')).toBeNull()
    expect(assistantButton.parentElement).toHaveClass('max-w-40', '@max-[320px]/ai-panel:max-w-28')
    expect(modelButton.parentElement).toHaveClass('max-w-48', '@max-[240px]/composer:max-w-none')
  })

  it('sends only the tools enabled in the AI tools drawer', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)

    renderPanel()
    await openTools()

    expect(screen.getByRole('switch', { name: 'reader.aiToolChapter' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'reader.aiToolSearchBook' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'reader.aiToolToc' })).toBeInTheDocument()
    const listAnnotationsTool = screen.getByRole('switch', { name: 'reader.aiToolListAnnotations' })
    expect(listAnnotationsTool).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(listAnnotationsTool)
    expect(listAnnotationsTool).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('ai-tools-menu')).toBeInTheDocument()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '只根据正文回答' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({
      enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book', 'search_annotations'],
    })
  })

  it('sends the selected reading scope with the thread permissions', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)

    renderPanel()
    const scopeButton = await screen.findByRole('button', { name: 'reader.aiReadingScopeToggle' })
    fireEvent.click(scopeButton)
    expect(screen.getByRole('button', { name: 'reader.aiReadingScopeToggle' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiReadingScopeToggle' }))
    expect(screen.getByRole('button', { name: 'reader.aiReadingScopeToggle' })).toHaveClass('text-amber-700')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '请完整概括这本书' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({ readingScope: 'full_book', assistantMode: '助理', assistantModePrompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT })
  })

  it('restores the draft per book while reusing the latest conversation settings', async () => {
    let latestSettings = { readingScope: 'to_here' as const, enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book', 'list_annotations', 'search_annotations'] as const, assistantModeId: 'assistant' }
    vi.mocked(apiGet).mockImplementation(async () => ({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000, lastUsedConversationSettings: latestSettings } }))
    vi.mocked(apiPatch).mockImplementation(async (_path, body) => {
      if ('lastUsedConversationSettings' in body) latestSettings = body.lastUsedConversationSettings
      return { data: { lastUsedConversationSettings: latestSettings } }
    })

    const first = renderPanel()
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: '未发送的草稿' } })
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiReadingScopeToggle' }))
    await openTools()
    fireEvent.click(screen.getByRole('switch', { name: 'reader.aiToolListAnnotations' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledTimes(2))
    expect(latestSettings).toMatchObject({ readingScope: 'current_chapter', enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book', 'search_annotations'] })
    first.unmount()

    renderPanel()
    expect(await screen.findByRole('textbox')).toHaveValue('未发送的草稿')
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiReadingScopeToggle' })).toBeInTheDocument())
    await openTools()
    expect(screen.getByRole('switch', { name: 'reader.aiToolListAnnotations' })).toHaveAttribute('aria-checked', 'false')
  })

  it('restores an active thread and saves its permission changes without sending a message', async () => {
    const threadStart = Date.now()
    const thread = { id: 'thread-1', bookId: 'book-1', title: '继续阅读', createdAt: threadStart, updatedAt: threadStart, messageCount: 1 }
    let savedScope = 'to_here' as const
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/threads?bookId=book-1') return { data: [thread] }
      if (path === '/ai/threads/thread-1') return { data: { ...thread, messages: [
        { id: 'message-1', threadId: 'thread-1', role: 'user', content: '已恢复的问题', context: null, createdAt: 1_000, aborted: false },
      ], settings: { readingScope: savedScope, enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book', 'list_annotations', 'search_annotations'] } } }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })
    vi.mocked(apiPatch).mockImplementation(async (_path, body) => {
      savedScope = body.settings?.readingScope ?? savedScope
      return { data: { ...thread, messages: [], settings: { readingScope: savedScope, enabledTools: body.settings?.enabledTools ?? ['get_book_toc', 'get_chapter_content', 'search_book', 'list_annotations', 'search_annotations'], assistantModeId: body.settings?.assistantModeId ?? 'assistant' } } }
    })
    writeAiPanelMemory('anonymous', 'book-1', {
      activeThreadId: 'thread-1',
      prompt: '',
      chapterReferences: [],
    })

    renderPanel()
    await screen.findByText('已恢复的问题')
    const scopeButton = screen.getByRole('button', { name: 'reader.aiReadingScopeToggle' })
    fireEvent.click(scopeButton)

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/ai/threads/thread-1', {
      settings: {
        readingScope: 'current_chapter',
        enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book', 'list_annotations', 'search_annotations'],
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
    expect(screen.getByRole('button', { name: 'reader.aiRetry' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'reader.aiSaveAsIdea' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiRetry' }))

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

  it('restores idea targets for every historical assistant answer', async () => {
    const thread = { id: 'thread-1', bookId: 'book-1', title: '继续阅读', createdAt: 1_000, updatedAt: 2_000, messageCount: 4 }
    const firstRetry = {
      context: { chapterIndex: 0, chapterTitle: '第一章', cfiRange: 'epubcfi(/6/2!/4/2)', selection: '第一段正文', before: '前文一' },
      readingScope: 'to_here' as const,
      enabledTools: ['get_book_toc', 'get_chapter_content'] as const,
      assistantMode: '助理',
    }
    const secondRetry = {
      context: { chapterIndex: 1, chapterTitle: '第二章', cfiRange: 'epubcfi(/6/4!/4/2)', selection: '第二段正文', before: '前文二' },
      readingScope: 'to_here' as const,
      enabledTools: ['get_book_toc', 'get_chapter_content'] as const,
      assistantMode: '助理',
    }
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/threads?bookId=book-1') return { data: [thread] }
      if (path === '/ai/threads/thread-1') return { data: { ...thread, messages: [
        { id: 'message-1', threadId: 'thread-1', role: 'user', content: '解释第一段', context: null, retry: firstRetry, citations: [], createdAt: 1_000, aborted: false },
        { id: 'message-2', threadId: 'thread-1', role: 'assistant', content: '第一段解释', context: null, retry: null, citations: [], createdAt: 1_001, aborted: false },
        { id: 'message-3', threadId: 'thread-1', role: 'user', content: '解释第二段', context: null, retry: secondRetry, citations: [], createdAt: 2_000, aborted: false },
        { id: 'message-4', threadId: 'thread-1', role: 'assistant', content: '第二段解释', context: null, retry: null, citations: [], createdAt: 2_001, aborted: false },
      ], settings: { readingScope: 'to_here', enabledTools: ['get_book_toc', 'get_chapter_content'] } } }
      if (path === '/annotations/book/book-1') return { data: [{ id: 'annotation-1', bookId: 'book-1', cfiRange: firstRetry.context.cfiRange, cfiAnchor: null, type: 'note', color: 'yellow', style: 'underline', text: firstRetry.context.selection, note: '第一段解释', chapter: '第一章', createdAt: 1_000, updatedAt: 1_000 }] }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })
    writeAiPanelMemory('anonymous', 'book-1', { activeThreadId: 'thread-1', prompt: '', chapterReferences: [] })

    renderPanel()

    expect(await screen.findByText('第二段解释')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'reader.aiIdeaSaved' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'reader.aiSaveAsIdea' })).toBeInTheDocument()
  })

  it('edits the latest user request before regenerating its answer', async () => {
    const thread = { id: 'thread-1', bookId: 'book-1', title: '继续阅读', createdAt: 1_000, updatedAt: 2_000, messageCount: 2 }
    const retry = {
      context: { chapterIndex: 0, chapterTitle: '第一章', cfiRange: 'selection', selection: '', before: '前文' },
      readingScope: 'to_here' as const,
      enabledTools: ['get_book_toc', 'get_chapter_content'] as const,
      assistantMode: '助理',
    }
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/threads?bookId=book-1') return { data: [thread] }
      if (path === '/ai/threads/thread-1') return { data: { ...thread, messages: [
        { id: 'message-1', threadId: 'thread-1', role: 'user', content: '原问题', context: null, retry, citations: [], createdAt: 1_000, aborted: false },
        { id: 'message-2', threadId: 'thread-1', role: 'assistant', content: '旧回答', context: null, retry: null, citations: [], createdAt: 2_000, aborted: false },
      ], settings: { readingScope: 'to_here', enabledTools: ['get_book_toc', 'get_chapter_content'] } } }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)
    writeAiPanelMemory('anonymous', 'book-1', { activeThreadId: 'thread-1', prompt: '', chapterReferences: [] })

    renderPanel()

    expect(await screen.findByText('旧回答')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiEditMessage' }))
    const editor = screen.getByRole('textbox', { name: 'reader.aiEditMessage' })
    expect(editor).toHaveValue('原问题')
    fireEvent.change(editor, { target: { value: '修改后的问题' } })
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiRegenerate' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({
      threadId: 'thread-1',
      regenerate: true,
      editMessageId: 'message-1',
      prompt: '修改后的问题',
      context: retry.context,
      readingScope: 'to_here',
      enabledTools: ['get_book_toc', 'get_chapter_content'],
    })
    expect(apiStreamAiChat.mock.calls[0]?.[0].history).toBeUndefined()
  })

  it('shows a compact control for returning to the latest message after scrolling up', async () => {
    const thread = { id: 'thread-1', bookId: 'book-1', title: '继续阅读', createdAt: 1_000, updatedAt: 2_000, messageCount: 2 }
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/threads?bookId=book-1') return { data: [thread] }
      if (path === '/ai/threads/thread-1') return { data: { ...thread, messages: [
        { id: 'message-1', threadId: 'thread-1', role: 'user', content: '问题', context: null, retry: null, citations: [], createdAt: 1_000, aborted: false },
        { id: 'message-2', threadId: 'thread-1', role: 'assistant', content: '回答', context: null, retry: null, citations: [], createdAt: 2_000, aborted: false },
      ] } }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })
    writeAiPanelMemory('anonymous', 'book-1', { activeThreadId: 'thread-1', prompt: '', chapterReferences: [] })

    renderPanel()

    const messages = await screen.findByTestId('ai-messages')
    Object.defineProperties(messages, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 800 },
    })
    messages.scrollTop = 0
    fireEvent.scroll(messages)

    const jumpButton = await screen.findByRole('button', { name: 'reader.aiBackToLatest' })
    expect(jumpButton).toBeInTheDocument()
    fireEvent.click(jumpButton)
    expect(messages.scrollTop).toBe(800)
  })

  it('switches between revisions of the latest assistant answer', async () => {
    const thread = { id: 'thread-1', bookId: 'book-1', title: '继续阅读', createdAt: 1_000, updatedAt: 2_000, messageCount: 2 }
    const revisions = [
      { id: 'assistant-1', revisionGroupId: 'user-1', revision: 0, content: '旧回答', citations: [], events: [], createdAt: 2_000, aborted: false, selected: false },
      { id: 'assistant-2', revisionGroupId: 'user-1', revision: 1, content: '新回答', citations: [], events: [], createdAt: 3_000, aborted: false, selected: true },
    ]
    let selectedId = 'assistant-2'
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/ai/threads?bookId=book-1') return { data: [thread] }
      if (path === '/ai/threads/thread-1') {
        const selected = revisions.find((revision) => revision.id === selectedId)!
        return { data: { ...thread, messages: [
          { id: 'user-1', threadId: 'thread-1', role: 'user', content: '解释这段', context: null, retry: null, revisionGroupId: 'user-1', revision: 0, citations: [], events: [], createdAt: 1_000, aborted: false },
          { ...selected, threadId: 'thread-1', role: 'assistant', context: null, retry: null },
        ], settings: { readingScope: 'to_here', enabledTools: ['get_book_toc', 'get_chapter_content'] } } }
      }
      if (path === `/ai/threads/thread-1/messages/${selectedId}/revisions`) {
        return { data: revisions.map((revision) => ({ ...revision, selected: revision.id === selectedId })) }
      }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })
    vi.mocked(apiPost).mockImplementation(async (path) => {
      expect(path).toBe('/ai/threads/thread-1/messages/assistant-1/revisions/select')
      selectedId = 'assistant-1'
      return { data: { ...revisions[0], selected: true } }
    })
    writeAiPanelMemory('anonymous', 'book-1', { activeThreadId: 'thread-1', prompt: '', chapterReferences: [] })

    renderPanel()

    expect(await screen.findByText('新回答')).toBeInTheDocument()
    expect(await screen.findByText('2/2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiPreviousAnswer' }))

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('旧回答')).toBeInTheDocument()
    expect(await screen.findByText('1/2')).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'reader.aiRemoveChapterReference' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '请总结引用内容' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(renderer.getAiChapterText).toHaveBeenCalledWith(2)
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({
      context: {
        chapterReferences: [{ chapterIndex: 2, chapterTitle: '第三章', text: '第3章的可见正文' }],
      },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'reader.aiQuoteJump' }))
    expect(renderer.display).toHaveBeenCalledWith('chapter:2')
    expect(screen.queryByRole('button', { name: 'reader.aiRemoveChapterReference' })).toBeNull()
  })

  it('keeps chapter references inside the attachment menu', async () => {
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/books/book-1/chapters') return { data: [{ id: 'chapter-1', title: '第一章', level: 1, startOffset: 0, endOffset: 10 }] }
      return { data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
    })

    renderPanel(readerWithChapterReferences())

    await openAttachments()
    expect(screen.getByText('reader.aiAddChapterReference')).toBeInTheDocument()
    expect(screen.queryByText('所选内容仅附加到下一条消息')).toBeNull()
    expect(screen.getByRole('button', { name: 'reader.aiAddChapterReference' })).toHaveClass('bg-stone-500/10')
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
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiCollapse 第一卷' }))
    expect(screen.queryByRole('button', { name: '第一章' })).toBeNull()
    expect(screen.getByRole('button', { name: '第二卷' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiExpand 第一卷' }))
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

    fireEvent.click(await screen.findByRole('button', { name: 'reader.aiSelectAssistantMode' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'reader.aiAddMode' }))
    fireEvent.change(screen.getByLabelText('reader.aiModeName'), { target: { value: '书评人' } })
    fireEvent.change(screen.getByLabelText('reader.aiModePrompt'), { target: { value: '用书评人的口吻回答。' } })
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSave' }))

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/ai/config', {
      modes: [{ id: expect.any(String), name: '书评人', prompt: '用书评人的口吻回答。' }],
    }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSelectAssistantMode' })).toHaveTextContent('书评人'))
    expect(screen.getByRole('button', { name: 'reader.aiSelectAssistantMode' }).closest('form')).toBeNull()
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

    fireEvent.click(await screen.findByRole('button', { name: 'reader.aiSelectAssistantMode' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'reader.aiEditMode reader.aiDefaultAssistantModeName' }))
    expect(screen.getByRole('heading', { name: 'reader.aiEditMode' })).toBeInTheDocument()
    expect(screen.getByLabelText('reader.aiModeName')).toHaveValue('助理')
    expect(screen.getByLabelText('reader.aiModePrompt')).toHaveValue(AI_DEFAULT_ASSISTANT_MODE_PROMPT)
    fireEvent.change(screen.getByLabelText('reader.aiModeName'), { target: { value: '自由助理' } })
    fireEvent.change(screen.getByLabelText('reader.aiModePrompt'), { target: { value: '按照我的要求自由回答。' } })
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSave' }))

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/ai/config', {
      modes: [],
      defaultAssistantMode: { id: 'assistant', name: '自由助理', prompt: '按照我的要求自由回答。' },
    }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSelectAssistantMode' })).toHaveTextContent('自由助理'))

    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSelectAssistantMode' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'reader.aiEditMode 自由助理' }))
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiRestoreDefault' }))
    expect(screen.getByText('reader.aiRestoreDefaultConfirm')).toBeInTheDocument()
    const restoreButtons = screen.getAllByRole('button', { name: 'reader.aiRestoreDefault' })
    fireEvent.click(restoreButtons[restoreButtons.length - 1]!)

    await waitFor(() => expect(apiPatch).toHaveBeenLastCalledWith('/ai/config', { defaultAssistantMode: null }))
    expect(screen.getByRole('button', { name: 'reader.aiSelectAssistantMode' })).toHaveTextContent('reader.aiDefaultAssistantModeName')
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
  fireEvent.click(await screen.findByRole('button', { name: 'reader.aiSelectAssistantMode' }))
   expect(screen.getByRole('menuitem', { name: 'reader.aiEditMode 书评人' })).toBeInTheDocument()
   fireEvent.click(screen.getByRole('menuitemradio', { name: '书评人' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/ai/config', expect.objectContaining({ lastUsedConversationSettings: expect.objectContaining({ assistantModeId: 'custom-reviewer' }) })))
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSelectAssistantMode' }))
   fireEvent.click(screen.getByRole('menuitem', { name: 'reader.aiEditMode 书评人' }))
    expect(screen.getByRole('heading', { name: 'reader.aiEditMode' })).toBeInTheDocument()
    expect(screen.getByLabelText('reader.aiModeName')).toHaveValue('书评人')
    expect(screen.getByLabelText('reader.aiModePrompt')).toHaveValue('用书评人的口吻回答。')
    fireEvent.change(screen.getByLabelText('reader.aiModeName'), { target: { value: '严谨书评人' } })
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSave' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/ai/config', {
      modes: [{ id: 'custom-reviewer', name: '严谨书评人', prompt: '用书评人的口吻回答。' }],
    }))
    expect(screen.getByRole('button', { name: 'reader.aiSelectAssistantMode' })).toHaveTextContent('严谨书评人')
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSelectAssistantMode' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'reader.aiEditMode 严谨书评人' }))
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiDelete' }))
    expect(screen.getByText('reader.aiModeDeleteConfirm')).toBeInTheDocument()
    const deleteButtons = screen.getAllByRole('button', { name: 'reader.aiDelete' })
    fireEvent.click(deleteButtons[deleteButtons.length - 1]!)
    await waitFor(() => expect(apiPatch).toHaveBeenLastCalledWith('/ai/config', { modes: [] }))
    expect(screen.getByRole('button', { name: 'reader.aiSelectAssistantMode' })).toHaveTextContent('reader.aiDefaultAssistantModeName')
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSelectAssistantMode' }))
    expect(screen.queryByRole('menuitem', { name: 'reader.aiEditMode 严谨书评人' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'reader.aiEditMode reader.aiDefaultAssistantModeName' })).toBeInTheDocument()
  })
  it('uses the wrench button and outside area to close the compact tools menu', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })

    renderPanel()
    await openTools()
    expect(screen.queryByText('所选工具对当前对话持续生效')).toBeNull()
    expect(screen.queryByText('阅读范围')).toBeNull()
    expect(screen.getByRole('button', { name: 'reader.aiTools' })).toHaveClass('bg-stone-500/10')

    fireEvent.click(screen.getByRole('button', { name: 'reader.aiTools' }))
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
    useReaderState.setState({ selection: { cfiRange: 'selection', text: '选区', rawText: '选区', chapterIndex: 0 }, aiContext: null })

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

  it('uses the same context-slot binding when a slash command is selected', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: {
      enabled: true,
      provider: 'ollama',
      model: 'qwen3:8b',
      prompts: [{ id: 'summarize', name: '概括', prompt: '概括：{SELTEXT}', scope: 'selection', enabled: true, order: 1, builtIn: false }],
      maxSelectionChars: 6_000,
      maxContextChars: 8_000,
    } })
    useReaderState.setState({ aiContext: { cfiRange: 'selection', text: '选区', rawText: '选区', chapterIndex: 0 } })

    renderPanel()
    const textbox = screen.getByRole('textbox')
    fireEvent.change(textbox, { target: { value: '/' } })
    fireEvent.click(await screen.findByRole('menuitem', { name: '概括' }))

    expect(textbox).toHaveValue('概括：{SELTEXT}')
    expect(apiStreamAiChat).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({
      prompt: '概括：{SELTEXT}',
      context: { selection: '选区' },
    })
    expect(screen.getByText('{SELTEXT}')).toHaveClass('font-mono')
  })

  it('binds the current chapter when a slash command contains the chapter variable', async () => {
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path === '/books/book-1/chapters') return { data: [{ id: 'chapter-1', title: '第一章', level: 1, startOffset: 0, endOffset: 10 }] }
      return { data: {
        enabled: true,
        provider: 'ollama',
        model: 'qwen3:8b',
        prompts: [{ id: 'chapter-summary', name: '概括章节', prompt: '概括：{CHAPTER}', scope: 'reading', enabled: true, order: 1, builtIn: false }],
        maxSelectionChars: 6_000,
        maxContextChars: 8_000,
      } }
    })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)
    useReaderState.setState({ currentChapter: '第一章', currentChapterIndex: 0 })

    const renderer = readerWithChapterReferences()
    renderPanel(renderer)
    const textbox = screen.getByRole('textbox')
    fireEvent.change(textbox, { target: { value: '/' } })
    fireEvent.click(await screen.findByRole('menuitem', { name: '概括章节' }))

    expect(textbox).toHaveValue('概括：{CHAPTER}')
    expect(apiStreamAiChat).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(renderer.getAiChapterText).toHaveBeenCalledWith(0)
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({
      prompt: '概括：{CHAPTER}',
      context: { chapterReferences: [{ chapterIndex: 0, chapterTitle: '第一章', text: '第1章的可见正文' }] },
    })
    const quote = await screen.findByTestId('ai-chapter-reference-chip')
    expect(quote).toHaveTextContent('第一章')
    expect(quote).toHaveClass('border-[var(--bd-read-accent)]')
    fireEvent.click(quote)
    expect(renderer.display).toHaveBeenCalledWith('chapter:0')
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
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

    const selector = await screen.findByRole('button', { name: 'reader.aiSelectModel' })
    await waitFor(() => expect(selector).not.toBeDisabled())
    fireEvent.click(selector)
    expect(selector).toHaveClass('bg-stone-500/10')
    fireEvent.click(screen.getByRole('option', { name: 'llama3.2' }))

    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/ai/profiles/profile-1', { model: 'llama3.2' }))
  })

  it('filters embedding models out of the Chat selector', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'openai', model: 'qwen3:8b', models: [
      { id: 'qwen3:8b', name: 'qwen3:8b' },
      { id: 'llama3.2', name: 'llama3.2' },
      { id: 'qwen3-embedding-8b', name: 'qwen3-embedding-8b' },
    ], maxSelectionChars: 6_000, maxContextChars: 8_000 } })

    renderPanel()

    const selector = await screen.findByRole('button', { name: 'reader.aiSelectModel' })
    await waitFor(() => expect(selector).not.toBeDisabled())
    fireEvent.click(selector)
    expect(screen.getByRole('listbox', { name: 'reader.aiSelectModel' })).toContainElement(screen.getByRole('option', { name: 'qwen3:8b' }))
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({ context: { selection: '', visibleTextVersion: 'reader-test' } })
    expect(screen.getByText('reader.aiToolReadingToc')).toBeInTheDocument()
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
    expect(screen.queryByRole('menuitem', { name: 'reader.aiQuickReadToHere' })).toBeNull()
    fireEvent.click(summary)
    expect(screen.getByRole('textbox')).toHaveValue('reader.aiQuickChapterSummaryPrompt')
    expect(apiStreamAiChat).not.toHaveBeenCalled()
  })

  it('binds selection, paragraph, and visible chapter variables as direct context once', async () => {
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(renderer.getAiChapterText).toHaveBeenCalledWith(0)
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({
      prompt: '处理 {SELTEXT}\n{SELPARA}\n{CHAPTER}',
      context: {
        selection: '选区',
        paragraph: '选区所在段落',
        chapterReferences: [{ chapterIndex: 0, text: '第1章的可见正文' }],
      },
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(renderer.getCurrentParagraphText).toHaveBeenCalled()
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({
      prompt: '{SELPARA}',
      context: { paragraph: '当前阅读段落' },
    })
  })

  it('keeps a manually entered placeholder when its context value is unavailable', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '解释：{SELTEXT}' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({
      prompt: '解释：{SELTEXT}',
      context: { selection: '' },
    })
  })

  it('sends a pending selection command as soon as the AI panel is ready', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockResolvedValue(undefined)
    useReaderState.setState({
      aiContext: { cfiRange: 'selection', text: '选区', rawText: '选区', chapterIndex: 0 },
      aiPendingCommand: { id: 'explain', name: '解释这段', prompt: '解释：{SELTEXT}' },
    })

    renderPanel()

    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0]).toMatchObject({
      prompt: '解释：{SELTEXT}',
      context: { selection: '选区' },
    })
    expect(useReaderState.getState().aiPendingCommand).toBeNull()
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    await waitFor(() => expect(renderer.getAiChapterText).toHaveBeenCalledWith(0))
    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))
    expect(apiStreamAiChat.mock.calls[0]?.[0].prompt).toBe('{CHAPTER}')
    expect(apiStreamAiChat.mock.calls[0]?.[0].context.chapterReferences?.[0]?.text).toHaveLength(8_001)
  })

  it('shows tool citations and jumps to their bounded reader range', async () => {
    const display = vi.fn().mockResolvedValue(undefined)
    const citation = { id: 'chunk-1', chapterIndex: 1, chapterId: 'ch-1', chapterTitle: '第一章', startOffset: 12, endOffset: 24, excerpt: '命中段落' }
    let streamHandlers: Parameters<typeof apiStreamAiChat>[1] | null = null
    let resolveStream: (() => void) | null = null
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      streamHandlers = handlers
      handlers.onMeta?.({ requestId: 'ai-1', model: 'qwen3:8b', receipt: { selectionChars: 0, beforeChars: 0, contextChars: 0, chapterTitle: null, sourceCfi: 'selection', readingScope: 'to_here' } })
      handlers.onTool?.({
        name: 'search_book',
        phase: 'result',
        citations: [citation],
      })
      handlers.onDelta?.('这是回答[1][9]【2】')
      await new Promise<void>((resolve) => { resolveStream = resolve })
    })

    renderPanel({ display })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '查找线索' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    await waitFor(() => expect(screen.getByText('这是回答')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /reader.aiBasisSummary/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /reader.aiCitationJump/ })).toBeNull()
    streamHandlers?.onDone?.({ content: '这是回答[1]。', citations: [citation] })
    resolveStream?.()

    const marker = await screen.findByRole('button', { name: 'reader.aiCitationJump' })
    expect(marker.parentElement).toHaveClass('whitespace-nowrap')
    expect(screen.queryByText('[9]')).toBeNull()
    expect(screen.queryByText('【2】')).toBeNull()
    fireEvent.click(marker)
    expect(display).toHaveBeenCalledWith('search-hit-chapter:1:12:24')
    const basis = await screen.findByRole('button', { name: /reader.aiBasisSummary/ })
    fireEvent.click(basis)
    const source = await screen.findByRole('button', { name: /reader.aiBasisJump/ })
    expect(source).toHaveAttribute('title', '命中段落')
    expect(screen.getByText('这是回答').parentElement?.parentElement).toHaveClass('w-fit', 'max-w-[92%]', '[text-autospace:normal]')
    expect(source.parentElement?.parentElement).toHaveClass('w-full', 'max-w-[92%]', '[text-autospace:normal]')
    fireEvent.click(source)
    expect(display).toHaveBeenCalledWith('search-hit-chapter:1:12:24')
    expect(useReaderState.getState().sidebarOpen).toBe(false)
  })

  it('keeps a pending answer visibly updating while the stream is open', async () => {
    let resolveStream: (() => void) | null = null
    let streamHandlers: Parameters<typeof apiStreamAiChat>[1] | null = null
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      streamHandlers = handlers
      await new Promise<void>((resolve) => { resolveStream = resolve })
    })

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '继续输出' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))
    await waitFor(() => expect(streamHandlers).not.toBeNull())

    streamHandlers?.onDelta?.('第一段')
    expect(await screen.findByText('第一段')).toBeInTheDocument()
    streamHandlers?.onDelta?.('，第二段')
    expect(await screen.findByText('第一段，第二段')).toBeInTheDocument()

    resolveStream?.()
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).toBeInTheDocument())
  })

  it('renders common assistant markdown with readable block spacing', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      handlers.onDelta?.('## 章节标题\n\n正文 **重点** 与 `代码`。\n\n1. 第一项\n2. 第二项\n\n> 这是引用\n\n```ts\nconst answer = true\n```\n\n| 项目 | 结果 |\n| --- | --- |\n| 命中 | 是 |')
    })

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '展示格式' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    const heading = await screen.findByRole('heading', { name: '章节标题' })
    expect(heading).toHaveClass('text-[15px]', 'leading-7')
    expect(screen.getByRole('list')).toHaveClass('list-decimal', 'space-y-1')
    expect(screen.getByText('const answer = true')).toBeInTheDocument()
    expect(screen.getByRole('table')).toHaveClass('min-w-full')
    expect(heading.closest('div')).toHaveClass('space-y-3', 'text-[13.5px]', 'leading-[1.75]')
  })

  it('keeps closing punctuation attached to the preceding markdown line', () => {
    expect(normalizeMarkdownParagraphLines(['回答内容[1]', '。'])).toEqual(['回答内容[1]。'])
  })

  it('jumps note citations through their existing annotation CFI', async () => {
    const display = vi.fn().mockResolvedValue(undefined)
    const citation = {
      id: 'annotation-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '书内笔记', startOffset: 0, endOffset: 8, excerpt: '我的想法',
      sourceType: 'annotation' as const, sourceCfi: 'epubcfi(/6/4!/4/2)',
    }
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockImplementation(async (_body, handlers) => {
      handlers.onMeta?.({ requestId: 'ai-1', model: 'qwen3:8b', receipt: { selectionChars: 0, beforeChars: 0, contextChars: 0, chapterTitle: null, sourceCfi: 'selection', readingScope: 'to_here' } })
      handlers.onTool?.({
        name: 'search_annotations',
        phase: 'result',
        citations: [citation],
      })
      handlers.onDelta?.('这是基于笔记的回答[1]')
      handlers.onDone?.({ content: '这是基于笔记的回答[1]', citations: [citation] })
    })

    renderPanel({ display })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '我记过什么' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    fireEvent.click(await screen.findByRole('button', { name: /reader.aiBasisSummary/ }))
    fireEvent.click(await screen.findByRole('button', { name: /reader.aiBasisJump/ }))
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
      handlers.onDone?.({ content: '有依据的回答【1】', citations: [{ id: 'chunk-2', chapterIndex: 1, chapterId: 'ch-1', chapterTitle: '第二章', startOffset: 12, endOffset: 24, excerpt: '命中段落' }] })
    })
    renderPanel({ display })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '解释一下' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    const basis = await screen.findByRole('button', { name: /reader.aiBasisSummary/ })
    expect(basis.parentElement).toHaveClass('mt-1')
    expect(basis.closest('.rounded-xl')).toBeNull()
    expect(screen.getByRole('button', { name: 'reader.aiCitationJump' })).toBeInTheDocument()
    fireEvent.click(basis)
    expect(screen.queryByText('书籍依据')).toBeNull()
    expect(screen.getByText('命中段落')).toBeInTheDocument()
    expect(screen.queryByText('使用摘要')).toBeNull()
    expect(screen.queryByText('回答信息')).toBeNull()
    expect(screen.queryByText(/system|reasoning|tool payload/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /reader.aiBasisJump/ }))
    expect(display).toHaveBeenCalledWith('search-hit-chapter:1:12:24')
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
      if (path === '/ai/status') return { data: { enabled: false, provider: 'openai', maxSelectionChars: 6_000, maxContextChars: 8_000 } }
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
    expect(screen.getByRole('button', { name: 'reader.aiSelectModel' })).toBeDisabled()
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

    expect(await screen.findByText('reader.aiEmbeddingBuilding')).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))
    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '第二个问题' } })
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))
    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(2))
    expect(apiStreamAiChat.mock.calls[1]?.[0]).toMatchObject({
      threadId: 'thread-1',
      prompt: '第二个问题',
    })
    expect(apiStreamAiChat.mock.calls[1]?.[0].history).toBeUndefined()
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    await waitFor(() => expect(historyRequests).toBeGreaterThanOrEqual(2))
    expect(screen.getByText('你好')).toBeInTheDocument()
    expect(screen.getByText('回答')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'reader.aiRetry' })).toBeInTheDocument()
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
      aiPendingCommand: { id: 'questions', name: '提出问题', prompt: '请围绕这段内容提出几个思考问题。' },
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
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
      aiContext: null,
      selection: { cfiRange: 'epubcfi(/6/4!/2)', text: selectedText, rawText: selectedText, chapterTitle: '第一章', chapterIndex: 0 },
    })

    renderPanel()

    const quote = await screen.findByTitle(selectedText)
    expect(quote).toHaveClass('truncate')
    expect(quote.parentElement).toHaveClass('border-[var(--bd-read-primary)]/50', 'text-[var(--bd-read-primary)]')
    expect(quote.parentElement?.parentElement?.parentElement).toHaveClass('max-h-28', 'overflow-y-auto')
    expect(screen.queryByText('reader.aiReceiptTitle')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'reader.aiRemoveSelectedText' }))
    expect(screen.queryByTitle(selectedText)).toBeNull()
    expect(useReaderState.getState().selection).toBeNull()
    expect(useReaderState.getState().aiContext).toBeNull()
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiStopGenerating' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiStopGenerating' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiRetry' })).toBeInTheDocument())
    expect(screen.getByText('reader.aiStoppedLabel')).toBeInTheDocument()
    expect(screen.queryByText('reader.aiStopped')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiRetry' }))

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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))
    await screen.findByRole('button', { name: 'reader.aiStopGenerating' })

    const textbox = screen.getByRole('textbox')
    expect(textbox).not.toBeDisabled()
    fireEvent.change(textbox, { target: { value: '下一条问题' } })
    expect(textbox).toHaveValue('下一条问题')

    const scopeButton = screen.getByRole('button', { name: 'reader.aiReadingScopeToggle' })
    expect(scopeButton).not.toBeDisabled()
    fireEvent.click(scopeButton)
    expect(screen.getByRole('button', { name: 'reader.aiReadingScopeToggle' })).toBeInTheDocument()

    await openTools()
    const annotationsTool = screen.getByRole('switch', { name: 'reader.aiToolSearchAnnotations' })
    expect(annotationsTool).not.toBeDisabled()
    fireEvent.click(annotationsTool)
    expect(annotationsTool).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'reader.aiStopGenerating' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiRetry' })).toBeInTheDocument())
    expect(textbox).toHaveValue('下一条问题')
  })

  it('keeps the prompt cleared after a provider failure while preserving retry', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: { enabled: true, provider: 'ollama', model: 'qwen3:8b', maxSelectionChars: 6_000, maxContextChars: 8_000 } })
    vi.mocked(apiStreamAiChat).mockRejectedValue(new ApiError('AI_PROVIDER_ERROR', '服务暂时不可用'))

    renderPanel()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '失败后保留这个问题' } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''))
    expect(screen.getByText('reader.aiRequestFailedWithMessage')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiRetry' }))
    await waitFor(() => expect(apiStreamAiChat).toHaveBeenCalledTimes(2))
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    const quote = await screen.findByRole('button', { name: 'reader.aiQuoteJump' })
    expect(screen.queryByText('带上下文的回答')).toBeNull()
    fireEvent.click(quote)
    expect(screen.getByText('选中的内容')).toBeInTheDocument()
    expect(screen.queryByText('前文')).toBeNull()
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    const quote = await screen.findByRole('button', { name: 'reader.aiQuoteJump' })
    fireEvent.click(quote)
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

    const copyButton = await screen.findByRole('button', { name: 'reader.aiCopy' })
    expect(copyButton.parentElement?.previousElementSibling).toHaveClass('rounded-xl')
    expect(copyButton.textContent).toBe('')
    fireEvent.click(copyButton)
    expect(writeText).toHaveBeenCalledWith('可复制回答')
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiCopied' })).toBeInTheDocument())
    const retryButton = screen.getByRole('button', { name: 'reader.aiRetry' })
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'reader.aiSend' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'reader.aiSend' }))

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

    expect(screen.queryByRole('button', { name: 'reader.aiRemoveSelectedText' })).toBeNull()
    expect(screen.queryByLabelText(/移除章节附件/)).toBeNull()
  })
})
