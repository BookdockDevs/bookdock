import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiChatReq } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { errorHandler } from '../../middleware/error'
import { getProgress } from '../progress/progress.service'
import { AI_TOOL_MAX_TOTAL_RESULT_CHARS } from './ai.tools'

vi.mock('../../config', () => ({
  config: {
    aiBaseUrl: 'https://ai.example.test/v1',
    aiApiKey: 'test-secret',
    aiModel: 'test-model',
    aiProvider: 'openai',
    jwtSecret: 'test-jwt-secret',
    aiMaxOutputTokens: 128,
    aiRpm: 1000,
    aiTimeoutMs: 2000,
  },
}))

vi.mock('../books/books.service', () => ({
  getActiveBook: vi.fn().mockResolvedValue({ id: 'book-1' }),
  getBookChapters: vi.fn().mockResolvedValue([
    { id: 'ch-0', title: '第一章', level: 1, startOffset: 0, endOffset: 10, wordCount: 4 },
    { id: 'ch-1', title: '第二章', level: 1, startOffset: 10, endOffset: 20, wordCount: 5 },
  ]),
  getBookChapterContent: vi.fn().mockResolvedValue({
    id: 'ch-1', index: 1, title: '第二章', level: 1, wordCount: 5, content: '第二章正文',
  }),
}))

vi.mock('../progress/progress.service', () => ({
  getProgress: vi.fn().mockResolvedValue(null),
}))

vi.mock('../../db/client', () => ({ getDb: vi.fn() }))

vi.mock('./ai.sessions.service', () => ({
  prepareAiThread: vi.fn().mockReturnValue({ threadId: 'ai-thread-test', history: [] }),
  saveAiMessage: vi.fn(),
  updateAiMessageContext: vi.fn(),
  createAiThread: vi.fn(),
  deleteAiThread: vi.fn(),
  getAiThread: vi.fn(),
  listAiThreads: vi.fn().mockReturnValue([]),
  updateAiThread: vi.fn(),
}))

const { cancelAiBookIndex, clearAiBookIndex, getAiIndexStatus, indexAiBook, searchAiBook } = vi.hoisted(() => ({
  getAiIndexStatus: vi.fn(),
  indexAiBook: vi.fn(),
  searchAiBook: vi.fn(),
  cancelAiBookIndex: vi.fn(),
  clearAiBookIndex: vi.fn(),
}))

vi.mock('./ai.retrieval.service', () => ({ getAiIndexStatus, indexAiBook, searchAiBook, cancelAiBookIndex, clearAiBookIndex }))

import aiRoutes from './ai.routes'
import { config } from '../../config'
import { getAiIndexStatus, indexAiBook, searchAiBook } from './ai.retrieval.service'
import { createAiThread, deleteAiThread, getAiThread, listAiThreads, saveAiMessage, updateAiMessageContext, updateAiThread } from './ai.sessions.service'

interface TestUser {
  id: string
  role: 'owner' | 'member' | 'guest'
}

interface StoredSetting {
  id: string
  userId: string
  key: string
  value: unknown
}

const requestBody: AiChatReq = {
  bookId: 'book-1',
  prompt: '请解释这段文字',
  context: {
    chapterIndex: 2,
    chapterTitle: '第三章',
    cfiRange: 'epubcfi(/6/4!/4/2)',
    selection: '这是<需要分析>的内容',
    before: '前文',
  },
}

const settings = new Map<string, StoredSetting>()
const testDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        get: () => [...settings.values()][0],
      }),
    }),
  }),
  insert: () => ({
    values: (value: StoredSetting) => ({
      run: () => settings.set(value.userId, value),
    }),
  }),
  update: () => ({
    set: (value: { value: unknown }) => ({
      where: () => ({
        run: () => {
          const current = [...settings.values()][0]
          if (current) settings.set(current.userId, { ...current, ...value })
        },
      }),
    }),
  }),
  delete: () => ({
    where: () => ({ run: vi.fn() }),
  }),
}

function createApp(user: TestUser) {
  const app = new Hono()
  app.onError(errorHandler)

  app.use('/api/v1/ai/*', async (c, next) => {
    c.set('user', { ...user, username: user.role, avatarKey: null })
    return next()
  })
  app.route('/api/v1/ai', aiRoutes)
  return app
}

describe('ai routes', () => {
  beforeEach(() => {
    settings.clear()
    vi.mocked(getDb).mockReturnValue(testDb as never)
    vi.stubGlobal('fetch', vi.fn())
  })

  it('lists native and OpenAI-compatible providers', async () => {
    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/providers')

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'openai', name: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: null }),
      expect.objectContaining({ id: 'anthropic', protocol: 'anthropic', requiresApiKey: true }),
      expect.objectContaining({ id: 'gemini', protocol: 'gemini', requiresApiKey: true }),
      expect.objectContaining({ id: 'ollama', protocol: 'ollama', requiresApiKey: false }),
      expect.objectContaining({ id: 'deepseek', protocol: 'openai-compatible', requiresApiKey: true }),
    ]))
    expect(body.data).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'custom' })]))
  })

  it('exposes per-book thread CRUD through the AI route', async () => {
    vi.mocked(listAiThreads).mockReturnValue([{ id: 'thread-1', bookId: 'book-1', title: '第一章', createdAt: 1, updatedAt: 2, messageCount: 2 }])
    vi.mocked(createAiThread).mockReturnValue({ id: 'thread-2', bookId: 'book-1', title: '新对话', createdAt: 3, updatedAt: 3, messageCount: 0 })
    vi.mocked(getAiThread).mockReturnValue({ id: 'thread-1', bookId: 'book-1', title: '第一章', createdAt: 1, updatedAt: 2, messageCount: 2, messages: [] })
    vi.mocked(updateAiThread).mockReturnValue({ id: 'thread-1', bookId: 'book-1', title: '重命名', createdAt: 1, updatedAt: 4, messageCount: 2 })

    const app = createApp({ id: 'member-1', role: 'member' })
    const listResponse = await app.request('http://test/api/v1/ai/threads?bookId=book-1')
    expect(listResponse.status).toBe(200)
    expect(await listResponse.json()).toEqual({ data: [{ id: 'thread-1', bookId: 'book-1', title: '第一章', createdAt: 1, updatedAt: 2, messageCount: 2 }] })
    expect(listAiThreads).toHaveBeenCalledWith('member-1', { bookId: 'book-1', limit: 50 })

    const createResponse = await app.request('http://test/api/v1/ai/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId: 'book-1' }) })
    expect(createResponse.status).toBe(201)
    expect(createAiThread).toHaveBeenCalledWith('member-1', { bookId: 'book-1' })

    const detailResponse = await app.request('http://test/api/v1/ai/threads/thread-1')
    expect(detailResponse.status).toBe(200)
    expect(getAiThread).toHaveBeenCalledWith('member-1', 'thread-1')

    const updateResponse = await app.request('http://test/api/v1/ai/threads/thread-1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '重命名' }) })
    expect(updateResponse.status).toBe(200)
    expect(updateAiThread).toHaveBeenCalledWith('member-1', 'thread-1', { title: '重命名' })

    const deleteResponse = await app.request('http://test/api/v1/ai/threads/thread-1', { method: 'DELETE' })
    expect(deleteResponse.status).toBe(200)
    expect(deleteAiThread).toHaveBeenCalledWith('member-1', 'thread-1')
  })

  it('exposes versioned book retrieval status, indexing, and search contracts', async () => {
    getAiIndexStatus.mockResolvedValue({ bookId: 'book-1', status: 'ready', chunkCount: 12, updatedAt: 123 })
    indexAiBook.mockResolvedValue({ bookId: 'book-1', status: 'ready', chunkCount: 12, updatedAt: 123 })
    searchAiBook.mockResolvedValue({ status: 'ready', results: [{ id: 'chunk-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '第一章', startOffset: 4, endOffset: 18, excerpt: '命中内容', score: 1 }] })

    const app = createApp({ id: 'member-1', role: 'member' })
    const statusResponse = await app.request('http://test/api/v1/ai/retrieval/status?bookId=book-1')
    expect(statusResponse.status).toBe(200)
    expect(await statusResponse.json()).toEqual({ data: { bookId: 'book-1', status: 'ready', chunkCount: 12, updatedAt: 123 } })
    expect(getAiIndexStatus).toHaveBeenCalledWith('member-1', 'book-1')

    const indexResponse = await app.request('http://test/api/v1/ai/retrieval/index', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        bookId: 'book-1',
        force: true,
        visibleTextVersion: 'reader-test',
        chapters: [
          { chapterIndex: 0, text: '第一章 变换后的正文' },
          { chapterIndex: 1, text: '第二章 变换后的正文' },
        ],
      }),
    })
    expect(indexResponse.status).toBe(200)
    expect(indexAiBook).toHaveBeenCalledWith('member-1', {
      bookId: 'book-1',
      force: true,
      visibleTextVersion: 'reader-test',
      chapters: [
        { chapterIndex: 0, text: '第一章 变换后的正文' },
        { chapterIndex: 1, text: '第二章 变换后的正文' },
      ],
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }))

    const searchResponse = await app.request('http://test/api/v1/ai/retrieval/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId: 'book-1', query: '命中内容', limit: 3, maxChapterIndex: 0 }),
    })
    expect(searchResponse.status).toBe(200)
    expect(await searchResponse.json()).toEqual({ data: { status: 'ready', results: [{ id: 'chunk-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '第一章', startOffset: 4, endOffset: 18, excerpt: '命中内容', score: 1 }] } })
    expect(searchAiBook).toHaveBeenCalledWith('member-1', { bookId: 'book-1', query: '命中内容', limit: 3, maxChapterIndex: 0 }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('exposes index cancellation and cleanup endpoints', async () => {
    getAiIndexStatus.mockResolvedValue({ bookId: 'book-1', status: 'not_indexed', embeddingStatus: 'not_indexed', chunkCount: 0, updatedAt: null })
    const app = createApp({ id: 'member-1', role: 'member' })

    const cancelResponse = await app.request('http://test/api/v1/ai/retrieval/index/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId: 'book-1' }),
    })
    expect(cancelResponse.status).toBe(200)
    expect(await cancelResponse.json()).toEqual({ data: { bookId: 'book-1', status: 'not_indexed', embeddingStatus: 'not_indexed', chunkCount: 0, updatedAt: null } })

    const clearResponse = await app.request('http://test/api/v1/ai/retrieval/index?bookId=book-1', { method: 'DELETE' })
    expect(clearResponse.status).toBe(200)
    expect(await clearResponse.json()).toEqual({ data: null })
  })

  it('does not label a raw fallback as a visible Reader corpus', async () => {
    const callsBefore = indexAiBook.mock.calls.length
    const response = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/retrieval/index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookId: 'book-1', visibleTextVersion: 'reader-only' }),
    })

    expect(response.status).toBe(400)
    expect(indexAiBook.mock.calls).toHaveLength(callsBefore)
  })

  it('caps direct retrieval at the user reading boundary', async () => {
    vi.mocked(getProgress).mockResolvedValueOnce({ chapterIndex: 1 } as never)
    searchAiBook.mockResolvedValueOnce({ status: 'ready', results: [] })

    const response = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/retrieval/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId: 'book-1', query: '未来内容', limit: 3, maxChapterIndex: 999 }),
    })

    expect(response.status).toBe(200)
    expect(searchAiBook).toHaveBeenCalledWith('member-1', { bookId: 'book-1', query: '未来内容', limit: 3, maxChapterIndex: 1 }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('uses the first chapter as the safe retrieval boundary without progress', async () => {
    searchAiBook.mockResolvedValueOnce({ status: 'ready', results: [] })

    const response = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/retrieval/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId: 'book-1', query: '内容', limit: 3 }),
    })

    expect(response.status).toBe(200)
    expect(searchAiBook).toHaveBeenCalledWith('member-1', { bookId: 'book-1', query: '内容', limit: 3, maxChapterIndex: 0 }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('rejects hosted provider operations without a required API key', async () => {
    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: 'AI_NOT_CONFIGURED', message: 'AI API key is required' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('discovers OpenAI-compatible models through the server', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: 'gpt-test', owned_by: 'openai' },
      { id: 'vision-test', owned_by: 'openai', capabilities: { vision: true, tools: true, reasoning: true } },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'draft-secret' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [
      { id: 'gpt-test', name: 'gpt-test', ownedBy: 'openai' },
      { id: 'vision-test', name: 'vision-test', ownedBy: 'openai', capabilities: { vision: true, tools: true, reasoning: true } },
    ] })
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.objectContaining({
      headers: { Accept: 'application/json', Authorization: 'Bearer draft-secret' },
      signal: expect.any(AbortSignal),
    }))
  })

  it('adds capability hints for known model families when the provider returns only model ids', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: 'deepseek-v4-flash', owned_by: 'octopus' },
      { id: 'deepseek/deepseek-v4-pro', owned_by: 'octopus' },
      { id: 'doubao-seed-2.1-pro', owned_by: 'octopus' },
      { id: 'doubao-seed-1.6', owned_by: 'octopus' },
      { id: 'qwen3.7-plus', owned_by: 'octopus' },
      { id: 'qwen3.7-max', owned_by: 'octopus' },
      { id: 'qwen3.7-max-2026-06-08', owned_by: 'octopus' },
      { id: 'qwen3-embedding-8b', owned_by: 'octopus' },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'draft-secret' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [
      { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', ownedBy: 'octopus', capabilities: { tools: true, reasoning: true } },
      { id: 'deepseek/deepseek-v4-pro', name: 'deepseek/deepseek-v4-pro', ownedBy: 'octopus', capabilities: { tools: true, reasoning: true } },
      { id: 'doubao-seed-2.1-pro', name: 'doubao-seed-2.1-pro', ownedBy: 'octopus', capabilities: { vision: true, tools: true, reasoning: true } },
      { id: 'doubao-seed-1.6', name: 'doubao-seed-1.6', ownedBy: 'octopus', capabilities: { vision: true, tools: true, reasoning: true } },
      { id: 'qwen3.7-plus', name: 'qwen3.7-plus', ownedBy: 'octopus', capabilities: { vision: true, tools: true, reasoning: true } },
      { id: 'qwen3.7-max', name: 'qwen3.7-max', ownedBy: 'octopus', capabilities: { tools: true, reasoning: true } },
      { id: 'qwen3.7-max-2026-06-08', name: 'qwen3.7-max-2026-06-08', ownedBy: 'octopus', capabilities: { vision: true, tools: true, reasoning: true } },
      { id: 'qwen3-embedding-8b', name: 'qwen3-embedding-8b', ownedBy: 'octopus', capabilities: { embedding: true } },
    ] })
  })

  it('merges detailed model metadata when a provider returns both data and models arrays', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'metadata-model', owned_by: 'octopus' }],
      models: [{ id: 'metadata-model', capabilities: { vision: true, tools: true } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'draft-secret' }),
    })

    expect(await response.json()).toEqual({ data: [
      { id: 'metadata-model', name: 'metadata-model', ownedBy: 'octopus', capabilities: { vision: true, tools: true } },
    ] })
  })

  it('discovers native Ollama models', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ models: [
      { name: 'qwen3:8b', model: 'qwen3:8b' },
      { name: 'llama3.2' },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'ollama', baseUrl: 'http://localhost:11434' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [
      { id: 'qwen3:8b', name: 'qwen3:8b', capabilities: { tools: true, reasoning: true } },
      { id: 'llama3.2', name: 'llama3.2' },
    ] })
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.anything())
  })

  it('discovers Gemini chat models and excludes embedding-only models', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ models: [
      { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', kind: 'chat', apiKey: 'gemini-secret' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [{
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      capabilities: { vision: true, tools: true, reasoning: true },
    }] })
    expect(fetchMock).toHaveBeenCalledWith('https://generativelanguage.googleapis.com/v1beta/models', expect.objectContaining({
      headers: { Accept: 'application/json', 'x-goog-api-key': 'gemini-secret' },
    }))
  })

  it('keeps all Gemini model capabilities when discovery has no kind filter', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ models: [
      { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', displayName: 'Text Embedding 004', supportedGenerationMethods: ['embedContent'] },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'gemini-secret' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', capabilities: { vision: true, tools: true, reasoning: true } },
      { id: 'text-embedding-004', name: 'Text Embedding 004', capabilities: { embedding: true } },
    ] })
  })

  it('discovers Gemini embedding models when the embedding capability is requested', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ models: [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', displayName: 'Text Embedding 004', supportedGenerationMethods: ['embedContent'] },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', kind: 'embedding', apiKey: 'gemini-secret' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: [{ id: 'text-embedding-004', name: 'Text Embedding 004', capabilities: { embedding: true } }] })
    expect(fetchMock).toHaveBeenCalledWith('https://generativelanguage.googleapis.com/v1beta/models', expect.objectContaining({
      headers: { Accept: 'application/json', 'x-goog-api-key': 'gemini-secret' },
    }))
  })

  it('tests a draft embedding model without saving or uploading book content', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [0.1, -0.2, 0.3] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', kind: 'embedding', model: 'text-embedding-test', apiKey: 'draft-secret' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { ok: true, provider: 'openai', model: 'text-embedding-test' } })
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/embeddings', expect.objectContaining({
      headers: { Accept: 'application/json', Authorization: 'Bearer draft-secret', 'Content-Type': 'application/json' },
    }))
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ model: 'text-embedding-test', input: ['Bookdock embedding connectivity test'] })
  })

  it('rejects embedding tests for providers without embedding support', async () => {
    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', kind: 'embedding', model: 'claude-test', apiKey: 'draft-secret' }),
    })

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: { code: 'AI_PROVIDER_ERROR', message: 'This AI provider does not support embeddings' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('reports configured status without exposing provider credentials', async () => {
    const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/status')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        enabled: true,
        provider: 'openai',
        model: 'test-model',
        models: [{ id: 'test-model', name: 'test-model' }],
        prompts: expect.any(Array),
        modes: [{ id: 'assistant', name: '助理', prompt: '', builtIn: true }],
        embeddingProfileId: null,
        embeddingProvider: null,
        embeddingModel: null,
        embeddingModels: [],
        embeddingConfigured: false,
        activeProfileId: null,
        maxSelectionChars: 6000,
        maxContextChars: 8000,
      },
    })
  })

  it('streams a chat response and sends only server-owned provider settings', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"解释"}}]}\n\ndata: {"choices":[{"delta":{"content":"完成"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))

    const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const stream = await response.text()
    expect(stream).toContain('event: meta')
    expect(stream).toContain('"selectionChars":11')
    expect(stream).toContain('event: delta\ndata: {"text":"解释"}')
    expect(stream).toContain('event: delta\ndata: {"text":"完成"}')
    expect(stream).toContain('event: done')

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://ai.example.test/v1/chat/completions')
    expect(init).toEqual(expect.objectContaining({
      method: 'POST',
      signal: expect.any(AbortSignal),
      headers: expect.objectContaining({ Authorization: 'Bearer test-secret' }),
    }))
    const payload = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ content?: string }> }
    expect(payload.messages.at(-1)?.content).toContain('&lt;需要分析&gt;')
    expect(payload.messages.at(-1)?.content).toContain('trust="untrusted"')
  })

  it('persists custom assistant modes while keeping the built-in assistant', async () => {
    const app = createApp({ id: 'member-1', role: 'member' })
    const response = await app.request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        modes: [{ id: 'reviewer', name: '书评人', prompt: '请从叙事结构和人物动机分析。' }],
      }),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).data.modes).toEqual([
      { id: 'assistant', name: '助理', prompt: '', builtIn: true },
      { id: 'reviewer', name: '书评人', prompt: '请从叙事结构和人物动机分析。', builtIn: false },
    ])

    const status = await app.request('http://test/api/v1/ai/status')
    expect((await status.json()).data.modes).toEqual([
      { id: 'assistant', name: '助理', prompt: '', builtIn: true },
      { id: 'reviewer', name: '书评人', prompt: '请从叙事结构和人物动机分析。', builtIn: false },
    ])
  })

  it('includes assistant mode instructions and explicit chapter references in the provider request', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"完成"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))

    const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requestBody,
        context: {
          ...requestBody.context,
          chapterIndex: 1,
          chapterReferences: [{ chapterIndex: 1, chapterTitle: '第二章', text: '变换后的<正文>' }],
        },
        assistantModePrompt: '请优先指出叙事视角的变化。',
      }),
    })

    expect(response.status).toBe(200)
    await response.text()
    const [, init] = fetchMock.mock.calls[0] ?? []
    const payload = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ role: string; content?: string }> }
    expect(payload.messages[0]?.content).toContain('<assistant_mode>请优先指出叙事视角的变化。</assistant_mode>')
    expect(payload.messages.at(-1)?.content).toContain('<chapter_reference chapter="第二章" chapter_index="1">')
    expect(payload.messages.at(-1)?.content).toContain('变换后的&lt;正文&gt;')
  })

  it('allows explicit chapter references beyond the current reading boundary', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"完成"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))

    const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requestBody,
        context: {
          ...requestBody.context,
          chapterIndex: 1,
          chapterReferences: [{ chapterIndex: 2, chapterTitle: '第三章', text: '不应发送' }],
        },
      }),
    })

    expect(response.status).toBe(200)
    await response.text()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('enforces the per-user chat request window before contacting the provider', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"第一次回答"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const mutableConfig = config as typeof config & { aiRpm: number }
    mutableConfig.aiRpm = 1
    const app = createApp({ id: 'rate-limit-user', role: 'member' })

    try {
      const first = await app.request('http://test/api/v1/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
      expect(first.status).toBe(200)
      await first.text()

      const second = await app.request('http://test/api/v1/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })
      expect(second.status).toBe(429)
      expect(second.headers.get('retry-after')).toMatch(/^\d+$/)
      expect(await second.json()).toMatchObject({ error: { code: 'AI_RATE_LIMITED', details: { retryAfterSeconds: expect.any(Number) } } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      mutableConfig.aiRpm = 1000
    }
  })

  it('tests a draft model without persisting its credentials', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))

    const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'custom', baseUrl: 'https://draft.example.test/v1', model: 'draft-model', apiKey: 'draft-secret' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { ok: true, provider: 'openai', model: 'draft-model', latencyMs: expect.any(Number) } })
    expect(fetchMock).toHaveBeenCalledWith('https://draft.example.test/v1/chat/completions', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer draft-secret' }),
    }))
    expect(settings.size).toBe(0)
  })

  it('blocks member-owned custom endpoints before any outbound request', async () => {
    const fetchMock = vi.mocked(fetch)
    const app = createApp({ id: 'member-1', role: 'member' })

    const ownerConfigResponse = await createApp({ id: 'member-1', role: 'owner' }).request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'custom', baseUrl: 'http://127.0.0.1:9999/v1', model: 'local-model' }),
    })
    expect(ownerConfigResponse.status).toBe(200)
    const statusResponse = await app.request('http://test/api/v1/ai/status')
    expect(await statusResponse.json()).toMatchObject({ data: { enabled: false } })

    const chatResponse = await app.request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    expect(chatResponse.status).toBe(403)
    expect(await chatResponse.json()).toMatchObject({ error: { code: 'AI_NOT_ALLOWED' } })

    const profileResponse = await app.request('http://test/api/v1/ai/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Private endpoint', provider: 'custom', baseUrl: 'http://127.0.0.1:9999/v1', model: 'local-model' }),
    })
    expect(profileResponse.status).toBe(403)
    expect(await profileResponse.json()).toMatchObject({ error: { code: 'AI_NOT_ALLOWED' } })

    const modelsResponse = await app.request('http://test/api/v1/ai/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', baseUrl: 'http://127.0.0.1:9999/v1', apiKey: 'draft-secret' }),
    })
    expect(modelsResponse.status).toBe(403)
    expect(await modelsResponse.json()).toMatchObject({ error: { code: 'AI_NOT_ALLOWED' } })

    const testResponse = await app.request('http://test/api/v1/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', baseUrl: 'http://127.0.0.1:9999/v1', model: 'local-model', apiKey: 'draft-secret' }),
    })
    expect(testResponse.status).toBe(403)
    expect(await testResponse.json()).toMatchObject({ error: { code: 'AI_NOT_ALLOWED' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resets a legacy endpoint to the provider default when a member changes provider', async () => {
    const app = createApp({ id: 'member-1', role: 'member' })
    const initial = await app.request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: 'deepseek-secret' }),
    })
    expect(initial.status).toBe(200)

    const updated = await app.request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'openai-secret' }),
    })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ data: { provider: 'openai', baseUrl: 'https://api.openai.com/v1' } })
  })

  it('allows any signed-in user to save encrypted provider settings without returning the key', async () => {
    const response = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKey: 'saved-secret',
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        activeProfileId: 'legacy',
        profiles: [{
          id: 'legacy',
          name: '',
          provider: 'deepseek',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          models: [{ id: 'deepseek-chat', name: 'deepseek-chat', capabilities: { tools: true } }],
          embeddingModel: null,
          embeddingModels: [],
          apiKeyConfigured: true,
          createdAt: 0,
          updatedAt: 0,
        }],
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        models: [{ id: 'deepseek-chat', name: 'deepseek-chat', capabilities: { tools: true } }],
        prompts: expect.any(Array),
        modes: [{ id: 'assistant', name: '助理', prompt: '', builtIn: true }],
        embeddingProfileId: null,
        embeddingProvider: null,
        embeddingModel: null,
        embeddingModels: [],
        embeddingConfigured: false,
        apiKeyConfigured: true,
        configuredByUser: true,
      },
    })
    const saved = settings.get('member-1')
    expect(saved?.key).toBe('ai')
    expect(saved?.value).not.toEqual(expect.objectContaining({ encryptedApiKey: 'saved-secret' }))
  })

  it('supports independent user profiles and active-profile switching', async () => {
    const first = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Cloud',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKey: 'cloud-secret',
      }),
    })
    expect(first.status).toBe(201)
    const firstProfile = (await first.json()).data
    expect(firstProfile).toEqual(expect.objectContaining({ name: 'Cloud', provider: 'deepseek', apiKeyConfigured: true }))

    const second = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Local', provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen3:8b' }),
    })
    expect(second.status).toBe(201)
    const secondProfile = (await second.json()).data

    const configResponse = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/config')
    expect(await configResponse.json()).toMatchObject({ data: { activeProfileId: secondProfile.id, profiles: expect.arrayContaining([expect.objectContaining({ id: firstProfile.id }), expect.objectContaining({ id: secondProfile.id })]), provider: 'ollama', model: 'qwen3:8b' } })

    const activateResponse = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeProfileId: firstProfile.id }),
    })
    expect(await activateResponse.json()).toMatchObject({ data: { activeProfileId: firstProfile.id, provider: 'deepseek', model: 'deepseek-chat' } })
    expect(settings.get('member-1')?.value).not.toEqual(expect.objectContaining({ encryptedApiKey: 'cloud-secret' }))
  })

  it('explicitly selects or disables an embedding model without switching the active chat profile', async () => {
    const app = createApp({ id: 'owner-1', role: 'owner' })
    const chatResponse = await app.request('http://test/api/v1/ai/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Chat', provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', embeddingModel: 'text-embedding-3-small', apiKey: 'chat-secret' }),
    })
    const chatProfile = (await chatResponse.json()).data
    const embeddingResponse = await app.request('http://test/api/v1/ai/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Local embeddings', provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'llama3.2', embeddingModel: 'nomic-embed-text' }),
    })
    const embeddingProfile = (await embeddingResponse.json()).data

    const initial = await app.request('http://test/api/v1/ai/config')
    expect((await initial.json()).data).toMatchObject({
      activeProfileId: embeddingProfile.id,
      embeddingProfileId: null,
      embeddingProvider: null,
      embeddingModel: null,
      embeddingConfigured: false,
    })

    const selected = await app.request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeddingProfileId: chatProfile.id, embeddingModel: 'text-embedding-3-small' }),
    })
    expect((await selected.json()).data).toMatchObject({
      activeProfileId: embeddingProfile.id,
      embeddingProfileId: chatProfile.id,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
    })

    const disabled = await app.request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeddingProfileId: null, embeddingModel: null }),
    })
    expect((await disabled.json()).data).toMatchObject({
      activeProfileId: embeddingProfile.id,
      embeddingProfileId: null,
      embeddingProvider: null,
      embeddingModel: null,
      embeddingConfigured: false,
    })
  })

  it('reuses only the selected profile key for draft model operations', async () => {
    const first = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Cloud',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKey: 'cloud-secret',
      }),
    })
    const firstProfile = (await first.json()).data

    const second = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Second cloud',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-test',
      }),
    })
    const secondProfile = (await second.json()).data

    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'gpt-test' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const selectedExisting = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: firstProfile.id, provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1' }),
    })
    expect(selectedExisting.status).toBe(200)
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.deepseek.com/v1/models', expect.objectContaining({
      headers: { Accept: 'application/json', Authorization: 'Bearer cloud-secret' },
    }))

    const newDraftWithoutKey = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: secondProfile.id, provider: 'openai', baseUrl: 'https://api.openai.com/v1' }),
    })
    expect(newDraftWithoutKey.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('clears a saved key when an existing profile changes provider without a replacement key', async () => {
    const created = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Hosted',
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKey: 'deepseek-secret',
      }),
    })
    const profile = (await created.json()).data

    const updated = await createApp({ id: 'member-1', role: 'member' }).request(`http://test/api/v1/ai/profiles/${profile.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-test' }),
    })

    expect(updated.status).toBe(200)
    expect((await updated.json()).data).toEqual(expect.objectContaining({ provider: 'openai', apiKeyConfigured: false }))

    const testResponse = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profileId: profile.id, provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-test' }),
    })

    expect(testResponse.status).toBe(503)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('lets signed-in members read their own AI configuration', async () => {
    const response = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/config')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        activeProfileId: null,
        profiles: [],
        provider: 'openai',
        baseUrl: 'https://ai.example.test/v1',
        model: 'test-model',
        models: [{ id: 'test-model', name: 'test-model' }],
        prompts: expect.any(Array),
        modes: [{ id: 'assistant', name: '助理', prompt: '', builtIn: true }],
        embeddingProfileId: null,
        embeddingProvider: null,
        embeddingModel: null,
        embeddingModels: [],
        embeddingConfigured: false,
        apiKeyConfigured: true,
        configuredByUser: false,
      },
    })
  })

  it('persists user quick prompts and hides disabled prompts from reader status', async () => {
    const app = createApp({ id: 'member-1', role: 'member' })
    const response = await app.request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompts: [
          { id: 'custom-review', name: '自定义回顾', prompt: '请结合已读内容列出三个关键线索。', scope: 'reading', enabled: true, order: 20 },
          { id: 'hidden-prompt', name: '隐藏提示', prompt: '不会显示。', scope: 'both', enabled: false, order: 10 },
        ],
      }),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).data.prompts).toEqual([
      expect.objectContaining({ id: 'hidden-prompt', builtIn: false, enabled: false }),
      expect.objectContaining({ id: 'custom-review', builtIn: false, enabled: true }),
    ])

    const status = await app.request('http://test/api/v1/ai/status')
    expect((await status.json()).data.prompts).toEqual([
      expect.objectContaining({ id: 'custom-review', enabled: true }),
    ])
  })

  it('blocks guests from configuring or calling AI', async () => {
    const configResponse = await createApp({ id: 'guest-1', role: 'guest' }).request('http://test/api/v1/ai/config')
    expect(configResponse.status).toBe(403)

    const chatResponse = await createApp({ id: 'guest-1', role: 'guest' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(chatResponse.status).toBe(403)
    expect(await chatResponse.json()).toMatchObject({ error: { code: 'AI_NOT_ALLOWED' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects unexpected client fields', async () => {
    const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, model: 'client-model' }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
  })

  it('sends Anthropic Messages requests through the native protocol', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"type":"content_block_delta","delta":{"text":"解释"}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))

    await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-20250514', apiKey: 'anthropic-secret' }),
    })
    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('event: delta\ndata: {"text":"解释"}')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        'anthropic-version': '2023-06-01',
        'x-api-key': 'anthropic-secret',
      }),
    }))
    const payload = JSON.parse(String((init as RequestInit).body)) as { system?: string; messages: Array<{ role: string }> }
    expect(payload.system).toContain('Bookdock')
    expect(payload.messages[0]?.role).toBe('user')
  })

  it('sends Gemini generateContent requests through the native protocol', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"candidates":[{"content":{"parts":[{"text":"解释"}]}}]}\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))

    await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash', apiKey: 'gemini-secret' }),
    })
    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('event: delta\ndata: {"text":"解释"}')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse')
    expect(init).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ 'x-goog-api-key': 'gemini-secret' }),
    }))
    const payload = JSON.parse(String((init as RequestInit).body)) as { systemInstruction?: unknown; contents: Array<{ role: string }> }
    expect(payload.systemInstruction).toBeDefined()
    expect(payload.contents[0]?.role).toBe('user')
  })

  it('sends Ollama chat requests and parses NDJSON responses', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      '{"message":{"content":"解释"},"done":false}\n{"done":true,"prompt_eval_count":12,"eval_count":5}\n',
      { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } },
    ))

    await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen3:8b' }),
    })
    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(response.status).toBe(200)
    const stream = await response.text()
    expect(stream).toContain('event: delta\ndata: {"text":"解释"}')
    expect(stream).toContain('event: usage\ndata: {"inputTokens":12,"outputTokens":5}')
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('http://localhost:11434/api/chat')
    expect(init).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'application/x-ndjson' }),
    }))
    const payload = JSON.parse(String((init as RequestInit).body)) as { model: string; stream: boolean; options?: { num_predict: number } }
    expect(payload).toMatchObject({ model: 'qwen3:8b', stream: true, options: { num_predict: 128 } })
  })

  it('lets the model read an allowlisted chapter and continues with the tool result', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"get_book_toc","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"content":"根据第二章正文，答案是……"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(response.status).toBe(200)
    const stream = await response.text()
    expect(stream).toContain('event: tool\ndata: {"name":"get_book_toc","phase":"start"}')
    expect(stream).toContain('event: tool\ndata: {"name":"get_book_toc","phase":"result","resultChars":')
    expect(stream).toContain('event: delta\ndata: {"text":"根据第二章正文，答案是……"}')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const firstCall = fetchMock.mock.calls[0]
    const secondCall = fetchMock.mock.calls[1]
    if (!firstCall || !secondCall) throw new Error('Expected two provider requests')
    const firstPayload = JSON.parse(String((firstCall[1] as RequestInit).body)) as { tools?: unknown }
    expect(firstPayload.tools).toBeDefined()
    const secondPayload = JSON.parse(String((secondCall[1] as RequestInit).body)) as { messages: Array<{ role: string; tool_calls?: unknown; tool_call_id?: string }> }
    expect(secondPayload.messages.at(-2)).toMatchObject({ role: 'assistant', tool_calls: expect.any(Array) })
    expect(secondPayload.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'call-1' })
  })

  it('limits provider tools to the requested allowlist and blocks disabled calls', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-notes","function":{"name":"search_notes","arguments":"{\\"query\\":\\"想法\\"}"}}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"content":"我会只根据已启用的能力回答。"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, enabledTools: ['search_book'] }),
    })

    expect(response.status).toBe(200)
    const stream = await response.text()
    expect(stream).toContain('我会只根据已启用的能力回答。')

    const firstCall = fetchMock.mock.calls[0]
    const secondCall = fetchMock.mock.calls[1]
    if (!firstCall || !secondCall) throw new Error('Expected two provider requests')
    const firstPayload = JSON.parse(String((firstCall[1] as RequestInit).body)) as { tools?: Array<{ function?: { name?: string } }> }
    const secondPayload = JSON.parse(String((secondCall[1] as RequestInit).body)) as { messages: Array<{ content?: string }> }
    expect(firstPayload.tools).toHaveLength(1)
    expect(firstPayload.tools?.[0]?.function?.name).toBe('search_book')
    expect(secondPayload.messages.at(-1)?.content).toContain('该工具已被用户关闭')
  })

  it('streams bounded source citations and persists them with the assistant answer', async () => {
    vi.mocked(saveAiMessage).mockClear()
    vi.mocked(updateAiMessageContext).mockClear()
    vi.mocked(saveAiMessage).mockReturnValue('ai-user-message')
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-chapter","function":{"name":"get_chapter_content","arguments":"{\\"chapterIndex\\":1}"}}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"content":"根据第二章正文作答。"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(response.status).toBe(200)
    const stream = await response.text()
    expect(stream).toContain('event: tool\ndata: {"name":"get_chapter_content","phase":"result","chapterIndex":1,"resultChars":')
    expect(stream).toContain('"questionChars":')
    expect(stream).toContain('"chapterChars":5')
    expect(stream).toContain('"citations":[{"id":"chapter:1"')
    expect(vi.mocked(updateAiMessageContext)).toHaveBeenCalled()
    expect(vi.mocked(saveAiMessage)).toHaveBeenLastCalledWith('user-1', 'ai-thread-test', expect.objectContaining({
      role: 'assistant',
      content: '根据第二章正文作答。',
      citations: [expect.objectContaining({ id: 'chapter:1', chapterIndex: 1, startOffset: 0 })],
    }))
  })

  it('caps the combined tool results and removes tools from the forced final turn', async () => {
    const chapterText = '正文'.repeat(7_000)
    const getBookChapterContent = await import('../books/books.service').then((module) => module.getBookChapterContent)
    vi.mocked(getBookChapterContent).mockResolvedValue({
      id: 'ch-1', index: 1, title: '第二章', level: 1, wordCount: chapterText.length, content: chapterText,
    } as never)
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"get_chapter_content","arguments":"{\\"chapterIndex\\":1}"}},{"index":1,"id":"call-2","function":{"name":"get_chapter_content","arguments":"{\\"chapterIndex\\":1}"}}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"content":"基于已提供内容作答。"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(response.status).toBe(200)
    const stream = await response.text()
    expect(stream).toContain('event: delta\ndata: {"text":"基于已提供内容作答。"}')
    const toolResultChars = [...stream.matchAll(/phase":"result"[^\n]*"resultChars":(\d+)/g)].map((match) => Number(match[1]))
    expect(toolResultChars.length).toBe(2)
    expect(toolResultChars.reduce((total, chars) => total + chars, 0)).toBeLessThanOrEqual(AI_TOOL_MAX_TOTAL_RESULT_CHARS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondCall = fetchMock.mock.calls[1]
    if (!secondCall) throw new Error('Expected the forced final provider request')
    const secondPayload = JSON.parse(String((secondCall[1] as RequestInit).body)) as { tools?: unknown }
    expect(secondPayload.tools).toBeUndefined()
  })

  it('returns a distinct retryable error when the provider times out before streaming', async () => {
    const mutableConfig = config as typeof config & { aiTimeoutMs: number }
    const previousTimeout = mutableConfig.aiTimeoutMs
    mutableConfig.aiTimeoutMs = 10
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The request timed out', 'AbortError')), { once: true })
    }))

    try {
      const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      expect(response.status).toBe(504)
      expect(await response.json()).toMatchObject({ error: { code: 'AI_TIMEOUT', message: 'AI request timed out' } })
    } finally {
      mutableConfig.aiTimeoutMs = previousTimeout
    }
  })

  it('maps provider-level timeouts to the shared AI timeout error', async () => {
    const mutableConfig = config as typeof config & { aiTimeoutMs: number }
    const previousTimeout = mutableConfig.aiTimeoutMs
    mutableConfig.aiTimeoutMs = 10
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The request timed out', 'AbortError')), { once: true })
    }))

    try {
      const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'custom', baseUrl: 'https://draft.example.test/v1', model: 'draft-model' }),
      })

      expect(response.status).toBe(504)
      expect(await response.json()).toMatchObject({ error: { code: 'AI_TIMEOUT' } })
    } finally {
      mutableConfig.aiTimeoutMs = previousTimeout
    }
  })

  it('uses the persisted reading position as the search tool spoiler boundary', async () => {
    vi.mocked(getProgress).mockResolvedValue({ chapterIndex: 0, chapter: '第一章' } as never)
    searchAiBook.mockResolvedValue({ status: 'empty', results: [] })
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-search","function":{"name":"search_book","arguments":"{\\"query\\":\\"线索\\"}"}}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"content":"没有找到。"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, context: { ...requestBody.context, chapterIndex: 2 } }),
    })

    expect(response.status).toBe(200)
    expect(searchAiBook).toHaveBeenCalledWith('user-1', { bookId: 'book-1', query: '线索', limit: 5, maxChapterIndex: 0 }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('passes the Reader visible-text version through the chat tool loop', async () => {
    const fetchMock = vi.mocked(fetch)
    searchAiBook.mockResolvedValueOnce({ status: 'ready', results: [] })
    fetchMock
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-visible-search","function":{"name":"search_book","arguments":"{\\"query\\":\\"线索\\"}"}}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"content":"没有命中"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, context: { ...requestBody.context, visibleTextVersion: 'reader-test' } }),
    })

    expect(response.status).toBe(200)
    await response.text()
    expect(searchAiBook).toHaveBeenCalledWith('user-1', { bookId: 'book-1', query: '线索', limit: 5, maxChapterIndex: expect.any(Number) }, expect.objectContaining({ visibleTextVersion: 'reader-test' }))
  })

  it('runs read-only tool loops through native protocol adapters', async () => {
    const fetchMock = vi.mocked(fetch)
    const cases = [
      {
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-20250514',
        apiKey: 'anthropic-secret',
        first: 'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call-a","name":"get_book_toc","input":{}}}\n\ndata: {"type":"content_block_stop","index":0}\n\n',
        second: 'data: {"type":"content_block_delta","delta":{"text":"目录回答"}}\n\n',
      },
      {
        provider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini-2.5-flash',
        apiKey: 'gemini-secret',
        first: 'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_book_toc","args":{}}}]}}]}\n\n',
        second: 'data: {"candidates":[{"content":{"parts":[{"text":"目录回答"}]}}]}\n\n',
      },
      {
        provider: 'ollama',
        baseUrl: 'http://localhost:11434',
        model: 'qwen3:8b',
        first: '{"message":{"tool_calls":[{"function":{"name":"get_book_toc","arguments":{}}}]},"done":false}\n',
        second: '{"message":{"content":"目录回答"},"done":false}\n',
      },
    ]

    for (const item of cases) {
      fetchMock.mockResolvedValueOnce(new Response(item.first, {
        status: 200,
        headers: { 'Content-Type': item.provider === 'ollama' ? 'application/x-ndjson' : 'text/event-stream' },
      }))
      fetchMock.mockResolvedValueOnce(new Response(item.second, {
        status: 200,
        headers: { 'Content-Type': item.provider === 'ollama' ? 'application/x-ndjson' : 'text/event-stream' },
      }))

      await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: item.provider, baseUrl: item.baseUrl, model: item.model, ...(item.apiKey ? { apiKey: item.apiKey } : {}) }),
      })
      const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      expect(response.status).toBe(200)
      expect(await response.text()).toContain('event: delta\ndata: {"text":"目录回答"}')
    }
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })
})
