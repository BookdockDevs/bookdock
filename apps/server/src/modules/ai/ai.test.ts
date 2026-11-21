import Database from 'better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AI_CORE_SYSTEM_PROMPT, AI_CORE_TOOL_SYSTEM_PROMPT, AI_DEFAULT_ASSISTANT_MODE_PROMPT } from '@bookdock/shared'
import type { AiChatReq } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { migrateBeforeBookRetirementIncluding } from '../../db/migration-stage'
import * as schema from '../../db/schema'
import { createId } from '../../lib/id'
import { errorHandler } from '../../middleware/error'
import { getProgress } from '../progress/progress.service'
import { encryptApiKey } from './ai.secrets'
import { AI_TOOL_MAX_CALLS, AI_TOOL_MAX_STEPS, AI_TOOL_MAX_TOTAL_RESULT_CHARS } from './ai.tools'

vi.mock('../../config', () => ({
  config: {
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
    { id: 'ch-2', title: '第三章', level: 1, startOffset: 20, endOffset: 30, wordCount: 6 },
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
  createAiAssistantDraft: vi.fn().mockReturnValue('ai-assistant-draft'),
  updateAiMessageContext: vi.fn(),
  createAiThread: vi.fn(),
  deleteAiThread: vi.fn(),
  getAiThread: vi.fn(),
  listAiMessageRevisions: vi.fn().mockReturnValue([]),
  listAiThreads: vi.fn().mockReturnValue([]),
  selectAiMessageRevision: vi.fn(),
  updateAiThread: vi.fn(),
}))

const generationRunMocks = vi.hoisted(() => ({
  startAiGenerationRun: vi.fn().mockReturnValue({ id: 'ai-run-test', checkpointSeq: 0 }),
  setAiGenerationTargetMessage: vi.fn(),
  transitionAiGenerationRun: vi.fn(),
  getAiGenerationRun: vi.fn().mockReturnValue({ state: 'streaming', checkpointSeq: 0 }),
  createAiCheckpointWriter: vi.fn().mockReturnValue({ schedule: vi.fn(), close: vi.fn() }),
  finalizeAiGenerationRun: vi.fn(),
  cancelAiGenerationRun: vi.fn().mockReturnValue({ id: 'ai-run-test', state: 'cancelled' }),
}))

vi.mock('./ai.runs.service', () => generationRunMocks)

const { searchAiBook } = vi.hoisted(() => ({ searchAiBook: vi.fn() }))

vi.mock('./ai.retrieval.service', () => ({ searchAiBook }))

import aiRoutes from './ai.routes'
import { getAiReadingBoundary } from './ai.service'
import { config } from '../../config'
import { searchAiBook } from './ai.retrieval.service'
import { finalizeAiGenerationRun } from './ai.runs.service'
import { createAiThread, deleteAiThread, getAiThread, listAiMessageRevisions, listAiThreads, prepareAiThread, saveAiMessage, selectAiMessageRevision, updateAiMessageContext, updateAiThread } from './ai.sessions.service'
import { getActiveBook, getBookChapters } from '../books/books.service'

interface TestUser {
  id: string
  role: 'owner' | 'member' | 'guest'
}

function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  const db = drizzle(sqlite, { schema })
  migrateBeforeBookRetirementIncluding(db, { migrationsFolder: './src/db/migrations' }, [])
  return db
}

type TestDb = ReturnType<typeof createTestDb>

/** Settings and AI rows carry a user FK, so every acting account needs a row. */
function ensureUser(db: TestDb, id: string) {
  if (db.select().from(schema.users).where(eq(schema.users.id, id)).get()) return
  db.insert(schema.users).values({ id, username: id, createdAt: Date.now() }).run()
}

interface SeedModel {
  upstreamModelId: string
  name?: string
  enabled?: number
  capabilities?: Record<string, boolean>
}

interface SeedConnection {
  name?: string
  provider: string
  baseUrl?: string | null
  apiKey?: string
  availability?: 'user' | 'instance'
  models?: SeedModel[]
}

/** Insert a saved connection (and its model entries) the way the service would. */
function seedConnection(db: TestDb, userId: string, input: SeedConnection) {
  ensureUser(db, userId)
  const connectionId = createId('ai-connection')
  const now = Date.now()
  db.insert(schema.aiConnections).values({
    id: connectionId,
    userId,
    name: input.name ?? input.provider,
    provider: input.provider as never,
    baseUrl: input.baseUrl ?? null,
    encryptedApiKey: input.apiKey ? encryptApiKey(input.apiKey) : null,
    availability: input.availability ?? 'user',
    createdAt: now,
    updatedAt: now,
  }).run()
  const models = (input.models ?? []).map((model) => {
    const id = createId('ai-model')
    db.insert(schema.aiModels).values({
      id,
      connectionId,
      upstreamModelId: model.upstreamModelId,
      name: model.name ?? model.upstreamModelId,
      enabled: model.enabled ?? 1,
      capabilities: (model.capabilities ?? null) as never,
      createdAt: now,
      updatedAt: now,
    }).run()
    return { id, upstreamModelId: model.upstreamModelId }
  })
  return { connectionId, models, modelId: models[0]?.id }
}

function setLastUsedChatModel(db: TestDb, userId: string, modelId: string | null) {
  ensureUser(db, userId)
  const where = and(eq(schema.settings.userId, userId), eq(schema.settings.key, 'ai'))
  const existing = db.select().from(schema.settings).where(where).get()
  const value = { ...(existing?.value as Record<string, unknown> | undefined ?? {}), lastUsedModels: { chat: modelId } }
  if (existing) db.update(schema.settings).set({ value }).where(where).run()
  else db.insert(schema.settings).values({ id: createId('setting'), userId, key: 'ai', value }).run()
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

function createApp(user: TestUser) {
  // Settings/AI rows carry user FKs, so acting accounts need a real row.
  if (user.role !== 'guest') ensureUser(getDb() as TestDb, user.id)
  const app = new Hono()
  app.onError(errorHandler)

  app.use('/api/v1/ai/*', async (c, next) => {
    c.set('user', user.role === 'guest' ? null : { ...user, username: user.role, avatarKey: null })
    return next()
  })
  app.route('/api/v1/ai', aiRoutes)
  return app
}

function toolResponse(count: number, prefix: string, chapter = false): Response {
  const calls = Array.from({ length: count }, (_, index) => ({
    index, id: `${prefix}-${index}`, type: 'function', function: {
      name: chapter ? 'get_chapter_content' : 'get_book_toc',
      arguments: JSON.stringify(chapter ? { chapterIndex: 0, startOffset: index, maxChars: 1 } : { startChapterIndex: Number(prefix) % 2 }),
    },
  }))
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: calls } }] })}\n\ndata: [DONE]\n\n`)
}

function finalResponse(): Response {
  return new Response('data: {"choices":[{"delta":{"content":"Final answer."}}]}\n\ndata: [DONE]\n\n')
}

describe('ai routes', () => {
  let db: TestDb

  beforeEach(() => {
    db = createTestDb()
    vi.mocked(getDb).mockReturnValue(db as never)
    vi.stubGlobal('fetch', vi.fn())
    // Chat surfaces need one runnable model per account: mirror the hosted
    // provider the request-body assertions below expect.
    seedConnection(db, 'user-1', {
      name: 'Test', provider: 'openai', apiKey: 'test-secret',
      models: [{ upstreamModelId: 'test-model' }],
    })
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

  // Slim route contract: methods, paths, status codes and the authenticated
  // user identity reaching the service layer. Deeper behavior lives in the
  // session/run service tests.
  it('routes thread, revision and generation-run contracts with the authenticated user', async () => {
    vi.mocked(createAiThread).mockReturnValue({ id: 'thread-1', bookId: 'book-1', title: '新对话', createdAt: 3, updatedAt: 3, messageCount: 0 })
    vi.mocked(getAiThread).mockReturnValue({ id: 'thread-1', bookId: 'book-1', title: '第一章', createdAt: 1, updatedAt: 2, messageCount: 2, messages: [] })
    vi.mocked(updateAiThread).mockReturnValue({ id: 'thread-1', bookId: 'book-1', title: '重命名', createdAt: 1, updatedAt: 4, messageCount: 2 })
    vi.mocked(listAiMessageRevisions).mockReturnValue([])
    vi.mocked(selectAiMessageRevision).mockReturnValue({ id: 'assistant-1', revisionGroupId: 'user-1', revision: 0, content: '答案', citations: [], events: [], createdAt: 1, aborted: false, selected: true })

    const app = createApp({ id: 'member-1', role: 'member' })
    expect((await app.request('http://test/api/v1/ai/threads?bookId=book-1')).status).toBe(200)
    expect(listAiThreads).toHaveBeenCalledWith('member-1', { bookId: 'book-1', limit: 50 })

    const created = await app.request('http://test/api/v1/ai/threads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId: 'book-1' }) })
    expect(created.status).toBe(201)
    expect(createAiThread).toHaveBeenCalledWith('member-1', { bookId: 'book-1' })

    expect((await app.request('http://test/api/v1/ai/threads/thread-1')).status).toBe(200)
    expect(getAiThread).toHaveBeenCalledWith('member-1', 'thread-1')

    const updated = await app.request('http://test/api/v1/ai/threads/thread-1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '重命名' }) })
    expect(updated.status).toBe(200)
    expect(updateAiThread).toHaveBeenCalledWith('member-1', 'thread-1', { title: '重命名' })

    expect((await app.request('http://test/api/v1/ai/threads/thread-1', { method: 'DELETE' })).status).toBe(200)
    expect(deleteAiThread).toHaveBeenCalledWith('member-1', 'thread-1')

    expect((await app.request('http://test/api/v1/ai/threads/thread-1/messages/assistant-1/revisions')).status).toBe(200)
    expect(listAiMessageRevisions).toHaveBeenCalledWith('member-1', 'thread-1', 'assistant-1')

    const selected = await app.request('http://test/api/v1/ai/threads/thread-1/messages/assistant-1/revisions/select', { method: 'POST' })
    expect(selected.status).toBe(200)
    expect(selectAiMessageRevision).toHaveBeenCalledWith('member-1', 'thread-1', 'assistant-1')

    expect((await app.request('http://test/api/v1/ai/runs/run-1')).status).toBe(200)
    expect(generationRunMocks.getAiGenerationRun).toHaveBeenCalledWith('member-1', 'run-1')

    const cancelled = await app.request('http://test/api/v1/ai/runs/run-1/cancel', { method: 'POST' })
    expect(cancelled.status).toBe(200)
    expect(generationRunMocks.cancelAiGenerationRun).toHaveBeenCalledWith('member-1', 'run-1')
  })

  it('validates keyword search conditions and preserves the server boundary', async () => {
    searchAiBook.mockResolvedValue({ status: 'empty', results: [] })
    const app = createApp({ id: 'member-1', role: 'member' })
    const request = (body: unknown) => app.request('http://test/api/v1/ai/retrieval/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    expect((await request({ bookId: 'book-1', requiredTerms: ['林舟'], anyTerms: ['隐瞒'] })).status).toBe(200)
    expect(searchAiBook).toHaveBeenLastCalledWith('member-1', expect.objectContaining({ requiredTerms: ['林舟'], anyTerms: ['隐瞒'], maxChapterIndex: 0 }), expect.anything())
    for (const invalid of [{}, { requiredTerms: [] }, { requiredTerms: [''] }, { anyTerms: Array(9).fill('word') }, { requiredTerms: 'word' }]) {
      expect((await request({ bookId: 'book-1', ...invalid })).status).toBe(400)
    }
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

  it('derives chapter intervals from the requested reading scope without trusting the client chapter', async () => {
    vi.mocked(getProgress).mockResolvedValue({ chapterIndex: 1 } as never)

    await expect(getAiReadingBoundary('member-1', 'book-1', 'to_here')).resolves.toEqual({ minChapterIndex: 0, maxChapterIndex: 1, currentChapterIndex: 1, readingScope: 'to_here' })
    await expect(getAiReadingBoundary('member-1', 'book-1', 'full_book')).resolves.toEqual({ minChapterIndex: 0, maxChapterIndex: 2, currentChapterIndex: 1, readingScope: 'full_book' })
  })

  it('rejects testing a hosted model when its connection has no credential', async () => {
    const { modelId } = seedConnection(db, 'user-1', {
      name: 'DeepSeek',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      models: [{ upstreamModelId: 'deepseek-chat' }],
    })

    const response = await createApp({ id: 'user-1', role: 'member' }).request(`http://test/api/v1/ai/models/${modelId}/test`, { method: 'POST' })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: { code: 'AI_NOT_CONFIGURED', message: 'This AI connection has no credential' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('discovers OpenAI-compatible models through a saved connection', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: 'gpt-test', owned_by: 'openai' },
      { id: 'vision-test', owned_by: 'openai', capabilities: { vision: true, tools: true, reasoning: true } },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const { connectionId } = seedConnection(db, 'user-1', { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'saved-secret' })
    const response = await createApp({ id: 'user-1', role: 'member' }).request(`http://test/api/v1/ai/connections/${connectionId}/models/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual([
      expect.objectContaining({ upstreamModelId: 'gpt-test', name: 'gpt-test', enabled: false, mine: true }),
      expect.objectContaining({ upstreamModelId: 'vision-test', name: 'vision-test', enabled: false, capabilities: { vision: true, tools: true, reasoning: true } }),
    ])
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.objectContaining({
      headers: { Accept: 'application/json', Authorization: 'Bearer saved-secret' },
      signal: expect.any(AbortSignal),
    }))
  })

  it('adds capability hints for known model families when the provider returns only model ids', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: 'deepseek-v4-flash', owned_by: 'octopus' },
      { id: 'deepseek/deepseek-v4-pro', owned_by: 'octopus' },
      { id: 'doubao-seed-2.1-pro', owned_by: 'octopus' },
      { id: 'qwen3.7-max', owned_by: 'octopus' },
      { id: 'qwen3-embedding-8b', owned_by: 'octopus' },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const { connectionId } = seedConnection(db, 'user-1', { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'saved-secret' })
    const response = await createApp({ id: 'user-1', role: 'member' }).request(`http://test/api/v1/ai/connections/${connectionId}/models/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(200)
    const entries = (await response.json()).data as Array<{ upstreamModelId: string; capabilities?: unknown }>
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ upstreamModelId: 'deepseek-v4-flash', capabilities: { tools: true, reasoning: true } }),
      expect.objectContaining({ upstreamModelId: 'deepseek/deepseek-v4-pro', capabilities: { tools: true, reasoning: true } }),
      expect.objectContaining({ upstreamModelId: 'doubao-seed-2.1-pro', capabilities: { vision: true, tools: true, reasoning: true } }),
      expect.objectContaining({ upstreamModelId: 'qwen3.7-max', capabilities: { tools: true, reasoning: true } }),
      expect.objectContaining({ upstreamModelId: 'qwen3-embedding-8b', capabilities: { embedding: true } }),
    ]))
  })

  it('merges detailed model metadata when a provider returns both data and models arrays', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'metadata-model', owned_by: 'octopus' }],
      models: [{ id: 'metadata-model', capabilities: { vision: true, tools: true } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const { connectionId } = seedConnection(db, 'user-1', { provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'saved-secret' })
    const response = await createApp({ id: 'user-1', role: 'member' }).request(`http://test/api/v1/ai/connections/${connectionId}/models/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect((await response.json()).data).toEqual([
      expect.objectContaining({ upstreamModelId: 'metadata-model', name: 'metadata-model', capabilities: { vision: true, tools: true } }),
    ])
  })

  it('discovers native Ollama models', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ models: [
      { name: 'qwen3:8b', model: 'qwen3:8b' },
      { name: 'llama3.2' },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const { connectionId } = seedConnection(db, 'user-1', { provider: 'ollama', baseUrl: 'http://localhost:11434' })
    const response = await createApp({ id: 'user-1', role: 'member' }).request(`http://test/api/v1/ai/connections/${connectionId}/models/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(200)
    const entries = (await response.json()).data as Array<{ upstreamModelId: string; name: string; capabilities?: unknown }>
    // Row order follows the (connection_id, upstream_model_id) index, not discovery order.
    expect(entries).toHaveLength(2)
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ upstreamModelId: 'qwen3:8b', name: 'qwen3:8b', capabilities: { tools: true, reasoning: true } }),
      expect.objectContaining({ upstreamModelId: 'llama3.2', name: 'llama3.2' }),
    ]))
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/tags', expect.anything())
  })

  it('discovers Gemini chat models and excludes embedding-only models', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ models: [
      { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const { connectionId } = seedConnection(db, 'user-1', { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'gemini-secret' })
    const response = await createApp({ id: 'user-1', role: 'member' }).request(`http://test/api/v1/ai/connections/${connectionId}/models/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'chat' }),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual([expect.objectContaining({
      upstreamModelId: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      capabilities: { vision: true, tools: true, reasoning: true },
    })])
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

    const { connectionId } = seedConnection(db, 'user-1', { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'gemini-secret' })
    const response = await createApp({ id: 'user-1', role: 'member' }).request(`http://test/api/v1/ai/connections/${connectionId}/models/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual([
      expect.objectContaining({ upstreamModelId: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', capabilities: { vision: true, tools: true, reasoning: true } }),
      expect.objectContaining({ upstreamModelId: 'text-embedding-004', name: 'Text Embedding 004', capabilities: { embedding: true } }),
    ])
  })

  it('discovers Gemini embedding models when the embedding capability is requested', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ models: [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', displayName: 'Text Embedding 004', supportedGenerationMethods: ['embedContent'] },
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const { connectionId } = seedConnection(db, 'user-1', { provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'gemini-secret' })
    const response = await createApp({ id: 'user-1', role: 'member' }).request(`http://test/api/v1/ai/connections/${connectionId}/models/discover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'embedding' }),
    })

    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual([expect.objectContaining({ upstreamModelId: 'text-embedding-004', name: 'Text Embedding 004', capabilities: { embedding: true } })])
    expect(fetchMock).toHaveBeenCalledWith('https://generativelanguage.googleapis.com/v1beta/models', expect.objectContaining({
      headers: { Accept: 'application/json', 'x-goog-api-key': 'gemini-secret' },
    }))
  })

  it('tests a saved embedding model without uploading book content', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [0.1, -0.2, 0.3] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    const { modelId } = seedConnection(db, 'user-1', {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'saved-secret',
      models: [{ upstreamModelId: 'text-embedding-test', capabilities: { embedding: true } }],
    })
    const response = await createApp({ id: 'user-1', role: 'member' }).request(`http://test/api/v1/ai/models/${modelId}/test`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { ok: true, provider: 'openai', upstreamModelId: 'text-embedding-test' } })
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/embeddings', expect.objectContaining({
      headers: { Accept: 'application/json', Authorization: 'Bearer saved-secret', 'Content-Type': 'application/json' },
    }))
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ model: 'text-embedding-test', input: ['Bookdock embedding connectivity test'] })
  })

  it('rejects embedding tests for providers without embedding support', async () => {
    const { modelId } = seedConnection(db, 'user-1', {
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'saved-secret',
      models: [{ upstreamModelId: 'claude-test', capabilities: { embedding: true } }],
    })

    const response = await createApp({ id: 'user-1', role: 'member' }).request(`http://test/api/v1/ai/models/${modelId}/test`, { method: 'POST' })

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
        lastUsedModelId: null,
        models: [expect.objectContaining({ upstreamModelId: 'test-model', enabled: true })],
        prompts: expect.any(Array),
        modes: [{ id: 'assistant', name: '助理', prompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT, builtIn: true }],
        lastUsedConversationSettings: { readingScope: 'to_here', enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book', 'list_annotations', 'search_annotations'], assistantModeId: 'assistant' },
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
    const meta = JSON.parse(stream.match(/event: meta\ndata: ([^\n]+)/)?.[1] ?? '{}') as { receipt?: { contextPlan?: Record<string, unknown> } }
    expect(meta.receipt?.contextPlan).toEqual(expect.objectContaining({
      maxChars: 100_000,
      historyChars: 0,
      historyMessageCount: 0,
      directContextChars: expect.any(Number),
      historyTruncated: false,
      readingBoundary: expect.objectContaining({ readingScope: 'to_here' }),
    }))
    expect(generationRunMocks.finalizeAiGenerationRun).toHaveBeenCalledWith('user-1', 'ai-run-test', expect.objectContaining({
      diagnostics: expect.objectContaining({
        provider: 'openai',
        model: 'test-model',
        providerRequestCount: 1,
        timeToFirstTokenMs: expect.any(Number),
        totalDurationMs: expect.any(Number),
        outputChars: 4,
      }),
    }))

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init).toEqual(expect.objectContaining({
      method: 'POST',
      signal: expect.any(AbortSignal),
      headers: expect.objectContaining({ Authorization: 'Bearer test-secret' }),
    }))
    const payload = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ content?: string }> }
    expect(payload.messages.at(-1)?.content).toContain('&lt;需要分析&gt;')
    expect(payload.messages.at(-1)?.content).toContain('trust="untrusted"')
  })

  it('ignores stale client history when an existing thread is supplied', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"继续回答"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))

    const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requestBody,
        threadId: 'ai-thread-test',
        history: Array.from({ length: 13 }, (_, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content: `旧消息 ${index}` })),
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('event: done')
  })

  it('rebuilds quoted context from persisted user history', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"明白了"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    vi.mocked(prepareAiThread).mockReturnValueOnce({
      threadId: 'ai-thread-test',
      history: [{ role: 'user', content: requestBody.prompt, context: requestBody.context }],
      settings: {
        readingScope: 'to_here',
        enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book', 'list_annotations', 'search_annotations'],
        assistantModeId: 'assistant',
      },
    })

    const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, threadId: 'ai-thread-test', prompt: '你说什么' }),
    })

    expect(response.status).toBe(200)
    await response.text()
    const [, init] = fetchMock.mock.calls[0] ?? []
    const payload = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ role: string; content?: string }> }
    const historicalMessage = payload.messages.find((message) => message.content?.includes('<selection>这是&lt;需要分析&gt;的内容</selection>'))
    expect(historicalMessage).toMatchObject({ role: 'user' })
    expect(historicalMessage?.content).toContain('请解释这段文字')
    expect(payload.messages.at(-1)?.content).toContain('你说什么')
  })

  it.each(['Summarize this chapter', 'Summarize {CHAPTER}'])('binds middle and ending claims to separate supplied passages: %s', async (prompt) => {
    const text = '开场叙述。'.repeat(130) + '\n\n' + '晚宴转折。'.repeat(100) + '\n\n' + '失眠收尾。'.repeat(100)
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementationOnce(async (_url, init) => {
      const payload = JSON.parse(String(init?.body))
      const message = payload.messages.at(-1).content as string
      const passages = [...message.matchAll(/<passage[^>]*citation="(\d+)"[^>]*>([^<]*)<\/passage>/g)]
      const middle = passages.find((match) => match[2]?.includes('晚宴转折'))!
      const ending = passages.find((match) => match[2]?.includes('失眠收尾'))!
      expect(middle).toBeDefined()
      expect(ending).toBeDefined()
      expect(middle[1]).not.toBe(ending[1])
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: `转折[[cite:${middle[1]}]]，收尾[[cite:${ending[1]}]]` } }] })}\n\ndata: [DONE]\n\n`)
    })
    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, prompt, context: { ...requestBody.context, chapterIndex: 1, selection: '', before: '', chapterReferences: [{ chapterIndex: 1, chapterTitle: 'One', text }] } }),
    })
    expect(await response.text()).toContain('转折【1】，收尾【2】')
    const finalized = vi.mocked(finalizeAiGenerationRun).mock.calls.at(-1)![2]
    expect(finalized.citations).toHaveLength(2)
    expect(finalized.citations[0]!.quote).toContain('晚宴转折')
    expect(finalized.citations[1]!.quote).toContain('失眠收尾')
    expect(finalized.citations[0]!.startOffset).toBeGreaterThan(0)
    expect(finalized.citations[1]!.startOffset).toBeGreaterThan(finalized.citations[0]!.startOffset)
  })

  it('accepts direct reader context beyond the former small character budget', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"可以继续分析"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requestBody,
        context: { ...requestBody.context, selection: '字'.repeat(10_000), visibleTextVersion: 'reader-visible-v1' },
      }),
    })

    expect(response.status).toBe(200)
    const stream = await response.text()
    const [, init] = fetchMock.mock.calls[0] ?? []
    const payload = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ content?: string }> }
    expect(payload.messages.at(-1)?.content).toContain('<selection>')
    const passages = [...(payload.messages.at(-1)?.content ?? '').matchAll(/<passage[^>]*>([^<]*)<\/passage>/g)]
    expect(passages.map((match) => match[1]).join('')).toBe('字'.repeat(10_000))
    const meta = JSON.parse(stream.match(/event: meta\ndata: ([^\n]+)/)?.[1] ?? '{}') as { receipt?: { contextPlan?: Record<string, unknown> } }
    expect(meta.receipt?.contextPlan).toEqual(expect.objectContaining({ visibleTextVersion: 'reader-visible-v1', directContextChars: expect.any(Number) }))
  })

  it('expands a paragraph placeholder while keeping the saved prompt template', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"已读取"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requestBody,
        prompt: '请分析{SELPARA}',
        context: { ...requestBody.context, selection: '', paragraph: '这是完整段落' },
      }),
    })

    expect(response.status).toBe(200)
    await response.text()
    const [, init] = fetchMock.mock.calls[0] ?? []
    const payload = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ content?: string }> }
    expect(payload.messages.at(-1)?.content).toContain('请分析这是完整段落')
    expect(payload.messages.at(-1)?.content).not.toContain('<paragraph>这是完整段落</paragraph>')
    expect(saveAiMessage).toHaveBeenCalledWith('user-1', 'ai-thread-test', expect.objectContaining({ content: '请分析{SELPARA}' }))
  })

  it('expands a chapter placeholder from the current chapter reference', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"已概括"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requestBody,
        prompt: '总结：{CHAPTER}',
        context: {
          ...requestBody.context,
          chapterReferences: [{ chapterIndex: 2, chapterTitle: '第三章', text: '这是当前章节正文' }],
        },
      }),
    })

    expect(response.status).toBe(200)
    await response.text()
    const [, init] = fetchMock.mock.calls[0] ?? []
    const payload = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ content?: string }> }
    const currentMessage = payload.messages.at(-1)?.content ?? ''
    expect(currentMessage).toContain('总结：这是当前章节正文')
    expect(currentMessage).not.toContain('<chapter_reference chapter="第三章" chapter_index="2">')
    expect(saveAiMessage).toHaveBeenCalledWith('user-1', 'ai-thread-test', expect.objectContaining({ content: '总结：{CHAPTER}' }))
  })

  it('leaves a placeholder unchanged when its context value is unavailable', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"保留占位符"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requestBody,
        prompt: '解释：{SELTEXT}',
        context: { ...requestBody.context, selection: '' },
      }),
    })

    expect(response.status).toBe(200)
    await response.text()
    const [, init] = fetchMock.mock.calls[0] ?? []
    const payload = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ content?: string }> }
    expect(payload.messages.at(-1)?.content).toContain('解释：{SELTEXT}')
  })

  it('expands a selected-text placeholder without duplicating the selection context', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"已分析"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requestBody,
        prompt: '解释：{SELTEXT}',
      }),
    })

    expect(response.status).toBe(200)
    await response.text()
    const [, init] = fetchMock.mock.calls[0] ?? []
    const payload = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ content?: string }> }
    const currentMessage = payload.messages.at(-1)?.content ?? ''
    expect(currentMessage).toContain('解释：这是<需要分析>的内容')
    expect(currentMessage).not.toContain('<selection>这是&lt;需要分析&gt;的内容</selection>')
  })

  it('does not send an empty book context for a follow-up question', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"沿用上一轮内容回答"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requestBody,
        prompt: '你觉得这段话的文风是什么类型的',
        context: { ...requestBody.context, selection: '', before: '' },
      }),
    })

    expect(response.status).toBe(200)
    await response.text()
    const [, init] = fetchMock.mock.calls[0] ?? []
    const payload = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ content?: string }> }
    expect(payload.messages.at(-1)?.content).toBe('用户问题：\n你觉得这段话的文风是什么类型的')
  })

  it('keeps the recent conversation tail when older history exceeds the budget', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"保留最近上下文"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    vi.mocked(prepareAiThread).mockReturnValueOnce({
      threadId: 'ai-thread-test',
      history: [
        { role: 'user', content: '旧用户问题'.repeat(20_000) },
        { role: 'assistant', content: '旧助手回答'.repeat(20_000) },
        { role: 'user', content: '最近用户问题' },
        { role: 'assistant', content: '最近助手回答' },
      ],
      settings: {
        readingScope: 'to_here',
        enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book', 'list_annotations', 'search_annotations'],
        assistantModeId: 'assistant',
      },
    })

    const response = await createApp({ id: 'user-1', role: 'owner' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, threadId: 'ai-thread-test', prompt: '当前问题' }),
    })

    expect(response.status).toBe(200)
    const stream = await response.text()
    const [, init] = fetchMock.mock.calls[0] ?? []
    const payload = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ content?: string }> }
    const contents = payload.messages.map((message) => message.content ?? '').join('\n')
    expect(contents).not.toContain('旧用户问题')
    expect(contents).not.toContain('旧助手回答')
    expect(contents).toContain('最近用户问题')
    expect(contents).toContain('最近助手回答')
    expect(contents).toContain('当前问题')
    const meta = JSON.parse(stream.match(/event: meta\ndata: ([^\n]+)/)?.[1] ?? '{}') as { receipt?: { contextPlan?: Record<string, unknown> } }
    expect(meta.receipt?.contextPlan).toEqual(expect.objectContaining({
      historyMessageCount: 2,
      droppedHistoryMessageCount: 2,
      droppedHistoryChars: expect.any(Number),
      historyTruncated: true,
    }))
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
      { id: 'assistant', name: '助理', prompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT, builtIn: true },
      { id: 'reviewer', name: '书评人', prompt: '请从叙事结构和人物动机分析。', builtIn: false },
    ])

    const status = await app.request('http://test/api/v1/ai/status')
    expect((await status.json()).data.modes).toEqual([
      { id: 'assistant', name: '助理', prompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT, builtIn: true },
      { id: 'reviewer', name: '书评人', prompt: '请从叙事结构和人物动机分析。', builtIn: false },
    ])
  })

  it('persists the latest conversation settings for new threads', async () => {
    const app = createApp({ id: 'member-1', role: 'member' })
    const latestSettings = {
      readingScope: 'full_book',
      enabledTools: ['search_book'],
      assistantModeId: 'assistant',
    }
    const updated = await app.request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lastUsedConversationSettings: latestSettings }),
    })

    expect(updated.status).toBe(200)
    expect((await updated.json()).data.lastUsedConversationSettings).toEqual(latestSettings)

    const status = await app.request('http://test/api/v1/ai/status')
    expect((await status.json()).data.lastUsedConversationSettings).toEqual(latestSettings)
  })

  it('allows editing and restoring the built-in assistant mode', async () => {
    const app = createApp({ id: 'member-1', role: 'member' })
    const edited = await app.request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        defaultAssistantMode: { id: 'assistant', name: '自由助理', prompt: '按照我的要求自由回答。' },
      }),
    })

    expect(edited.status).toBe(200)
    expect((await edited.json()).data.modes[0]).toEqual({ id: 'assistant', name: '自由助理', prompt: '按照我的要求自由回答。', builtIn: true })

    const restored = await app.request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultAssistantMode: null }),
    })

    expect(restored.status).toBe(200)
    expect((await restored.json()).data.modes[0]).toEqual({ id: 'assistant', name: '助理', prompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT, builtIn: true })
  })

  it('keeps the invariant system prompt when a custom assistant mode is selected', async () => {
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
    expect(payload.messages[0]?.role).toBe('system')
    expect(payload.messages[0]?.content).toContain('请优先指出叙事视角的变化。')
    expect(payload.messages[0]?.content).toContain(AI_CORE_TOOL_SYSTEM_PROMPT)
    expect(payload.messages.filter((message) => message.role === 'system')).toHaveLength(1)
    expect(payload.messages.at(-1)?.content).toContain('<chapter_reference chapter="第二章" chapter_index="1">')
    expect(payload.messages.at(-1)?.content).toContain('变换后的&lt;正文&gt;')
  })

  it('uses the built-in assistant prompt when the default mode is selected', async () => {
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
        assistantMode: '助理',
        assistantModePrompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT,
      }),
    })

    expect(response.status).toBe(200)
    await response.text()
    const [, init] = fetchMock.mock.calls[0] ?? []
    const payload = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ role: string; content?: string }> }
    expect(payload.messages[0]).toEqual({
      role: 'system',
      content: `${AI_DEFAULT_ASSISTANT_MODE_PROMPT}\n\n${AI_CORE_TOOL_SYSTEM_PROMPT}`,
    })
  })

  it('uses the tool-free core system prompt when all tools are disabled', async () => {
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
        enabledTools: [],
        assistantMode: '助理',
        assistantModePrompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT,
      }),
    })

    expect(response.status).toBe(200)
    await response.text()
    const [, init] = fetchMock.mock.calls[0] ?? []
    const payload = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ role: string; content?: string }> }
    expect(payload.messages[0]).toEqual({
      role: 'system',
      content: `${AI_DEFAULT_ASSISTANT_MODE_PROMPT}\n\n${AI_CORE_SYSTEM_PROMPT}`,
    })
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
    seedConnection(db, 'rate-limit-user', { name: 'Test', provider: 'openai', apiKey: 'test-secret', models: [{ upstreamModelId: 'test-model' }] })
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

  it('tests a saved model without returning its stored credential', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))

    const { modelId, connectionId } = seedConnection(db, 'user-1', {
      provider: 'openai',
      baseUrl: 'https://draft.example.test/v1',
      apiKey: 'saved-secret',
      models: [{ upstreamModelId: 'draft-model' }],
    })
    const response = await createApp({ id: 'user-1', role: 'owner' }).request(`http://test/api/v1/ai/models/${modelId}/test`, { method: 'POST' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { ok: true, provider: 'openai', upstreamModelId: 'draft-model', latencyMs: expect.any(Number) } })
    expect(fetchMock).toHaveBeenCalledWith('https://draft.example.test/v1/chat/completions', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer saved-secret' }),
    }))
    const stored = db.select().from(schema.aiConnections).where(eq(schema.aiConnections.id, connectionId)).get()
    expect(stored?.encryptedApiKey).toEqual(expect.any(String))
    expect(stored?.encryptedApiKey).not.toContain('saved-secret')
  })

  it('blocks member-owned custom endpoints before any outbound request', async () => {
    const fetchMock = vi.mocked(fetch)
    const app = createApp({ id: 'member-1', role: 'member' })

    const createResponse = await app.request('http://test/api/v1/ai/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Private endpoint', provider: 'openai', baseUrl: 'http://127.0.0.1:9999/v1' }),
    })
    expect(createResponse.status).toBe(403)
    expect(await createResponse.json()).toMatchObject({ error: { code: 'AI_NOT_ALLOWED' } })

    // A row saved outside the route must not bypass the endpoint rule either.
    const { modelId } = seedConnection(db, 'member-1', {
      provider: 'openai',
      baseUrl: 'http://127.0.0.1:9999/v1',
      apiKey: 'saved-secret',
      models: [{ upstreamModelId: 'local-model' }],
    })
    setLastUsedChatModel(db, 'member-1', modelId)

    const chatResponse = await app.request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
    expect(chatResponse.status).toBe(403)
    expect(await chatResponse.json()).toMatchObject({ error: { code: 'AI_NOT_ALLOWED' } })

    const testResponse = await app.request(`http://test/api/v1/ai/models/${modelId}/test`, { method: 'POST' })
    expect(testResponse.status).toBe(403)
    expect(await testResponse.json()).toMatchObject({ error: { code: 'AI_NOT_ALLOWED' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows any signed-in user to save an encrypted connection without returning the key', async () => {
    const app = createApp({ id: 'member-1', role: 'member' })
    const created = await app.request('http://test/api/v1/ai/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'DeepSeek', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'saved-secret' }),
    })

    expect(created.status).toBe(201)
    const connection = (await created.json()).data
    expect(connection).toEqual(expect.objectContaining({
      name: 'DeepSeek',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      availability: 'user',
      mine: true,
      apiKeyConfigured: true,
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    }))
    expect(connection).not.toHaveProperty('apiKey')
    expect(connection).not.toHaveProperty('encryptedApiKey')
    const stored = db.select().from(schema.aiConnections).where(eq(schema.aiConnections.id, connection.id)).get()
    expect(stored?.encryptedApiKey).toEqual(expect.any(String))
    expect(stored?.encryptedApiKey).not.toContain('saved-secret')

    const model = await app.request(`http://test/api/v1/ai/connections/${connection.id}/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upstreamModelId: 'deepseek-chat' }),
    })
    expect(model.status).toBe(201)
    expect((await model.json()).data).toEqual(expect.objectContaining({
      connectionId: connection.id,
      connectionName: 'DeepSeek',
      upstreamModelId: 'deepseek-chat',
      name: 'deepseek-chat',
      enabled: true,
      mine: true,
    }))
  })

  it('keeps connections independent per user and rejects the retired default-model setting', async () => {
    const app = createApp({ id: 'member-1', role: 'member' })
    const first = await app.request('http://test/api/v1/ai/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Cloud', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'cloud-secret' }),
    })
    const firstConnection = (await first.json()).data
    const firstModel = (await (await app.request(`http://test/api/v1/ai/connections/${firstConnection.id}/models`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upstreamModelId: 'deepseek-chat' }),
    })).json()).data

    const second = await app.request('http://test/api/v1/ai/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Local', provider: 'ollama', baseUrl: 'http://localhost:11434' }),
    })
    const secondConnection = (await second.json()).data
    const secondModel = (await (await app.request(`http://test/api/v1/ai/connections/${secondConnection.id}/models`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upstreamModelId: 'qwen3:8b' }),
    })).json()).data

    const configResponse = await app.request('http://test/api/v1/ai/config')
    const config = (await configResponse.json()).data
    expect(config.connections).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: firstConnection.id }),
      expect.objectContaining({ id: secondConnection.id }),
    ]))
    expect(config.lastUsedModels).toEqual({ chat: null, translate: null })

    // The retired global default is rejected by the strict update schema.
    const activateResponse = await app.request('http://test/api/v1/ai/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultModelId: secondModel.id }),
    })
    expect(activateResponse.status).toBe(400)

    const status = (await (await app.request('http://test/api/v1/ai/status')).json()).data
    expect(status.lastUsedModelId).toBeNull()
    expect(status.models.map((model: { id: string }) => model.id)).toEqual(expect.arrayContaining([firstModel.id, secondModel.id]))

    // Another account sees neither connection nor model.
    const otherConfig = (await (await createApp({ id: 'member-2', role: 'member' }).request('http://test/api/v1/ai/config')).json()).data
    expect(otherConfig).toMatchObject({ connections: [], models: [], lastUsedModels: { chat: null, translate: null } })
  })

  it('rejects retired semantic retrieval settings', async () => {
    const response = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/config', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeddingProfileId: 'profile', embeddingModel: 'embedding-model' }),
    })
    expect(response.status).toBe(400)
  })

  it('discovers models with the saved connection credential only', async () => {
    const app = createApp({ id: 'member-1', role: 'member' })
    const cloud = seedConnection(db, 'member-1', {
      name: 'Cloud', provider: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'cloud-secret',
    })
    const second = seedConnection(db, 'member-1', {
      name: 'Second cloud', provider: 'openai', baseUrl: 'https://api.openai.com/v1',
    })

    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: 'gpt-test' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const selectedExisting = await app.request(`http://test/api/v1/ai/connections/${cloud.connectionId}/models/discover`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    })
    expect(selectedExisting.status).toBe(200)
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.deepseek.com/v1/models', expect.objectContaining({
      headers: { Accept: 'application/json', Authorization: 'Bearer cloud-secret' },
    }))

    const withoutKey = await app.request(`http://test/api/v1/ai/connections/${second.connectionId}/models/discover`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
    })
    expect(withoutKey.status).toBe(503)
    expect(await withoutKey.json()).toEqual({ error: { code: 'AI_NOT_CONFIGURED', message: 'AI API key is required' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('clears a saved key when a connection changes provider without a replacement key', async () => {
    const app = createApp({ id: 'member-1', role: 'member' })
    const { connectionId, modelId } = seedConnection(db, 'member-1', {
      name: 'Hosted',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'deepseek-secret',
      models: [{ upstreamModelId: 'deepseek-chat' }],
    })

    const updated = await app.request(`http://test/api/v1/ai/connections/${connectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' }),
    })

    expect(updated.status).toBe(200)
    expect((await updated.json()).data).toEqual(expect.objectContaining({ provider: 'openai', apiKeyConfigured: false }))

    const testResponse = await app.request(`http://test/api/v1/ai/models/${modelId}/test`, { method: 'POST' })
    expect(testResponse.status).toBe(503)
    expect(await testResponse.json()).toEqual({ error: { code: 'AI_NOT_CONFIGURED', message: 'This AI connection has no credential' } })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('lets signed-in members read their own AI configuration', async () => {
    const response = await createApp({ id: 'member-1', role: 'member' }).request('http://test/api/v1/ai/config')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      data: {
        connections: [],
        models: [],
        lastUsedModels: { chat: null, translate: null },
        prompts: expect.any(Array),
        promptsRestoreAvailable: expect.any(Boolean),
        modes: [{ id: 'assistant', name: '助理', prompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT, builtIn: true }],
        lastUsedConversationSettings: { readingScope: 'to_here', enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book', 'list_annotations', 'search_annotations'], assistantModeId: 'assistant' },
      },
    })
  })

  it('persists quick commands through their endpoints and hides disabled ones from reader status', async () => {
    const app = createApp({ id: 'member-1', role: 'member' })
    const reviewResponse = await app.request('http://test/api/v1/ai/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '自定义回顾', prompt: '请结合已读内容列出三个关键线索。', scope: 'both' }),
    })
    expect(reviewResponse.status).toBe(201)
    const review = (await reviewResponse.json()).data

    const hiddenResponse = await app.request('http://test/api/v1/ai/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '隐藏提示', prompt: '不会显示。' }),
    })
    const hidden = (await hiddenResponse.json()).data
    const disableResponse = await app.request(`http://test/api/v1/ai/prompts/${hidden.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(disableResponse.status).toBe(200)

    const config = await app.request('http://test/api/v1/ai/config')
    const configPrompts = (await config.json()).data.prompts
    expect(configPrompts.find((prompt: { id: string }) => prompt.id === review.id))
      .toEqual(expect.objectContaining({ enabled: true, scope: 'both', builtIn: false, mine: true, availability: 'user' }))
    expect(configPrompts.find((prompt: { id: string }) => prompt.id === hidden.id)?.enabled).toBe(false)

    const status = await app.request('http://test/api/v1/ai/status')
    const statusPrompts = (await status.json()).data.prompts
    expect(statusPrompts.some((prompt: { id: string }) => prompt.id === review.id)).toBe(true)
    expect(statusPrompts.some((prompt: { id: string }) => prompt.id === hidden.id)).toBe(false)
  })

  it('runs the current quick-command definition instead of client-cached text', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"已执行"}}]}\n\ndata: [DONE]\n\n',
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const app = createApp({ id: 'owner-1', role: 'owner' })
    seedConnection(db, 'owner-1', { name: 'Test', provider: 'openai', apiKey: 'test-secret', models: [{ upstreamModelId: 'test-model' }] })
    const createdResponse = await app.request('http://test/api/v1/ai/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '共读', prompt: '旧提示词' }),
    })
    const published = (await createdResponse.json()).data
    await app.request(`http://test/api/v1/ai/prompts/${published.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: '新提示词' }),
    })

    const chatResponse = await app.request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, prompt: '客户端缓存的旧提示词', promptId: published.id }),
    })

    expect(chatResponse.status).toBe(200)
    await chatResponse.text()
    const [, init] = fetchMock.mock.calls[0] ?? []
    const payload = JSON.parse(String((init as RequestInit).body)) as { messages: Array<{ content?: string }> }
    expect(payload.messages.at(-1)?.content).toContain('新提示词')
    expect(payload.messages.at(-1)?.content).not.toContain('旧提示词')

    // After deletion a stale promptId stops the request instead of replaying text.
    await app.request(`http://test/api/v1/ai/prompts/${published.id}`, { method: 'DELETE' })
    const staleResponse = await app.request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, prompt: '客户端缓存的旧提示词', promptId: published.id }),
    })
    expect(staleResponse.status).toBe(409)
    expect(await staleResponse.json()).toMatchObject({ error: { code: 'AI_PROMPT_UNAVAILABLE' } })
  })

  it('blocks guests from configuring or calling AI', async () => {
    const configResponse = await createApp({ id: 'guest-1', role: 'guest' }).request('http://test/api/v1/ai/config')
    expect(configResponse.status).toBe(401)

    const chatResponse = await createApp({ id: 'guest-1', role: 'guest' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(chatResponse.status).toBe(401)
    expect(await chatResponse.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } })
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

    const { modelId } = seedConnection(db, 'user-1', {
      name: 'Anthropic',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'anthropic-secret',
      models: [{ upstreamModelId: 'claude-sonnet-4-20250514' }],
    })
    setLastUsedChatModel(db, 'user-1', modelId)
    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, assistantMode: '助理', assistantModePrompt: AI_DEFAULT_ASSISTANT_MODE_PROMPT }),
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

    const { modelId } = seedConnection(db, 'user-1', {
      name: 'Gemini',
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'gemini-secret',
      models: [{ upstreamModelId: 'gemini-2.5-flash' }],
    })
    setLastUsedChatModel(db, 'user-1', modelId)
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

    const { modelId } = seedConnection(db, 'user-1', {
      name: 'Ollama',
      provider: 'ollama',
      baseUrl: 'http://localhost:11434',
      models: [{ upstreamModelId: 'qwen3:8b' }],
    })
    setLastUsedChatModel(db, 'user-1', modelId)
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

  it('runs same-round read-only calls concurrently while preserving provider order', async () => {
    const { getBookChapters } = await import('../books/books.service')
    let activeReads = 0
    let maximumActiveReads = 0
    vi.mocked(getBookChapters).mockImplementation(async () => {
      activeReads += 1
      maximumActiveReads = Math.max(maximumActiveReads, activeReads)
      await new Promise((resolve) => setTimeout(resolve, 20))
      activeReads -= 1
      return [
        { id: 'ch-0', title: '第一章', level: 1, startOffset: 0, endOffset: 10, wordCount: 4 },
        { id: 'ch-1', title: '第二章', level: 1, startOffset: 10, endOffset: 20, wordCount: 5 },
      ]
    })
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"get_book_toc","arguments":"{}"}},{"index":1,"id":"call-2","function":{"name":"get_book_toc","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"content":"已按顺序整理两个读取结果。"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('已按顺序整理两个读取结果。')
    expect(maximumActiveReads).toBe(2)
    const secondCall = fetchMock.mock.calls[1]
    if (!secondCall) throw new Error('Expected the provider request after tool execution')
    const secondPayload = JSON.parse(String((secondCall[1] as RequestInit).body)) as { messages: Array<{ role: string; tool_call_id?: string }> }
    expect(secondPayload.messages.slice(-2)).toEqual([
      expect.objectContaining({ role: 'tool', tool_call_id: 'call-1' }),
      expect.objectContaining({ role: 'tool', tool_call_id: 'call-2' }),
    ])
  })

  it('limits provider tools to the requested allowlist and blocks disabled calls', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-notes","function":{"name":"search_annotations","arguments":"{\\"query\\":\\"想法\\"}"}}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"content":"我会只根据已启用的能力回答。"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...requestBody,
        enabledTools: ['search_book'],
        readingScope: 'full_book',
        assistantMode: '书评人',
        context: { ...requestBody.context, chapterReferences: [{ chapterIndex: 2, chapterTitle: '第三章', text: '显式章节' }] },
      }),
    })

    expect(response.status).toBe(200)
    const stream = await response.text()
    expect(stream).toContain('我会只根据已启用的能力回答。')
    expect(stream).toContain('"readingScope":"full_book"')
    expect(stream).toContain('"enabledTools":["search_book"]')
    expect(stream).toContain('"assistantMode":"书评人"')
    expect(stream).toContain('"directChapterReferences":[{"chapterIndex":2,"chapterTitle":"第三章"}]')

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
    vi.mocked(getProgress).mockResolvedValueOnce({ chapterIndex: 1 } as never)
    vi.mocked(saveAiMessage).mockClear()
    vi.mocked(finalizeAiGenerationRun).mockClear()
    vi.mocked(updateAiMessageContext).mockClear()
    vi.mocked(saveAiMessage).mockReturnValue('ai-user-message')
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-chapter","function":{"name":"get_chapter_content","arguments":"{\\"chapterIndex\\":1}"}}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"content":"根据第二章正文作答。[[cite:2]]"}}]}\n\ndata: [DONE]\n\n',
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
    const toolEvents = [...stream.matchAll(/event: tool\ndata: ([^\n]+)/g)].map((match) => JSON.parse(match[1] ?? '{}') as { phase?: string; citations?: unknown })
    expect(toolEvents.find((event) => event.phase === 'result')?.citations).toBeUndefined()
    expect(stream).toContain('event: done')
    const secondCall = fetchMock.mock.calls[1]
    if (!secondCall) throw new Error('Expected the provider request after tool execution')
    const secondPayload = JSON.parse(String((secondCall[1] as RequestInit).body)) as { messages: Array<{ role: string; content?: string }> }
    expect(secondPayload.messages.at(-1)?.content).toContain('Citation manifest (only these numbers may be used as [[cite:n]] markers): 2=chapter:1:0:5')
    expect(vi.mocked(updateAiMessageContext)).toHaveBeenCalled()
    expect(vi.mocked(finalizeAiGenerationRun)).toHaveBeenLastCalledWith('user-1', 'ai-run-test', expect.objectContaining({
      state: 'completed',
      text: '根据第二章正文作答。【1】',
      citations: [expect.objectContaining({ id: 'chapter:1:0:5', chapterIndex: 1, startOffset: 0 })],
    }))
  })

  it.each([false, true])('closes tools at the round limit and handles provider disregard: %s', async (disregard) => {
    const fetchMock = vi.mocked(fetch)
    for (let round = 0; round < AI_TOOL_MAX_STEPS; round += 1) fetchMock.mockResolvedValueOnce(toolResponse(1, String(round)))
    fetchMock.mockResolvedValueOnce(disregard ? toolResponse(1, '99') : finalResponse())
    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
    })
    const stream = await response.text()
    expect(stream).toContain(disregard ? 'event: error' : 'event: done')
    if (disregard) expect(stream).toContain('"code":"AI_TOOL_LIMIT_EXCEEDED"')
    expect(fetchMock).toHaveBeenCalledTimes(AI_TOOL_MAX_STEPS + 1)
    const payloads = fetchMock.mock.calls.map((call) => JSON.parse(String((call[1] as RequestInit).body)))
    expect(payloads[5].tools.length).toBeGreaterThan(0)
    expect(payloads.at(-1).tools).toBeUndefined()
    expect(payloads.at(-1).tool_choice).toBe('none')
    expect(payloads.at(-1).messages.at(-1).content).toContain('Tool use is now closed')
    expect(vi.mocked(finalizeAiGenerationRun)).toHaveBeenLastCalledWith('user-1', 'ai-run-test', expect.objectContaining({
      state: disregard ? 'failed' : 'completed',
      ...(disregard ? { errorCode: 'AI_TOOL_LIMIT_EXCEEDED', errorMessage: 'AI provider requested tools after tool use was closed' } : {}),
      diagnostics: expect.objectContaining({ toolSteps: AI_TOOL_MAX_STEPS }),
    }))
  })

  it('limits executed calls while pairing overflow results across batches', async () => {
    const getBookChapterContent = await import('../books/books.service').then((module) => module.getBookChapterContent)
    vi.mocked(getBookChapterContent).mockClear()
    vi.mocked(getBookChapterContent).mockResolvedValue({ id: 'ch-0', index: 0, title: 'First', level: 1, wordCount: 100, content: 'x'.repeat(100) } as never)
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(toolResponse(13, 'first', true)).mockResolvedValueOnce(toolResponse(13, 'second', true)).mockResolvedValueOnce(finalResponse())
    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
    })
    expect(await response.text()).toContain('event: done')
    expect(getBookChapterContent).toHaveBeenCalledTimes(AI_TOOL_MAX_CALLS)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const payload = JSON.parse(String((fetchMock.mock.calls[2]![1] as RequestInit).body))
    expect(payload.tools).toBeUndefined()
    const results = payload.messages.filter((message: { role: string }) => message.role === 'tool')
    expect(results).toHaveLength(26)
    expect(results.at(-1).content).toContain('budget exhausted')
    expect(vi.mocked(finalizeAiGenerationRun)).toHaveBeenLastCalledWith('user-1', 'ai-run-test', expect.objectContaining({
      state: 'completed', diagnostics: expect.objectContaining({ toolCalls: AI_TOOL_MAX_CALLS }),
    }))
  })

  it('caps the combined tool results and removes tools from the forced final turn', async () => {
    vi.mocked(getProgress).mockResolvedValueOnce({ chapterIndex: 1 } as never)
    const chapterText = '正文'.repeat(7_000)
    const getBookChapterContent = await import('../books/books.service').then((module) => module.getBookChapterContent)
    vi.mocked(getBookChapterContent).mockResolvedValue({
      id: 'ch-1', index: 1, title: '第二章', level: 1, wordCount: chapterText.length, content: chapterText,
    } as never)
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: Array.from({ length: 6 }, (_, index) => ({
        index, id: `budget-${index}`, function: { name: 'get_chapter_content', arguments: JSON.stringify({ chapterIndex: 1, startOffset: index * 1000 }) },
      })) } }] })}\n\ndata: [DONE]\n\n`))
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
    expect(toolResultChars.length).toBe(6)
    expect(toolResultChars.reduce((total, chars) => total + chars, 0)).toBeLessThanOrEqual(AI_TOOL_MAX_TOTAL_RESULT_CHARS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondCall = fetchMock.mock.calls[1]
    if (!secondCall) throw new Error('Expected the forced final provider request')
    const secondPayload = JSON.parse(String((secondCall[1] as RequestInit).body)) as { tools?: unknown }
    expect(secondPayload.tools).toBeUndefined()
  })

  it('re-trims older complete turns when a tool round would exceed the input budget', async () => {
    vi.mocked(getProgress).mockResolvedValueOnce({ chapterIndex: 1 } as never)
    const getBookChapterContent = await import('../books/books.service').then((module) => module.getBookChapterContent)
    vi.mocked(getBookChapterContent).mockResolvedValue({
      id: 'ch-1', index: 1, title: '第二章', level: 1, wordCount: 20_000, content: '正文'.repeat(10_000),
    } as never)
    vi.mocked(prepareAiThread).mockReturnValueOnce({
      threadId: 'ai-thread-test',
      history: [
        { role: 'user', content: '旧问题'.repeat(7_000) },
        { role: 'assistant', content: '旧回答'.repeat(7_000) },
        { role: 'user', content: '最近问题'.repeat(8_000) },
        { role: 'assistant', content: '最近回答'.repeat(8_000) },
      ],
      settings: {
        readingScope: 'to_here',
        enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book', 'list_annotations', 'search_annotations'],
        assistantModeId: 'assistant',
      },
    })
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-budget","function":{"name":"get_chapter_content","arguments":"{\\"chapterIndex\\":1}"}}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"content":"已在预算内继续回答。"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...requestBody, threadId: 'ai-thread-test' }),
    })

    expect(response.status).toBe(200)
    const stream = await response.text()
    const secondCall = fetchMock.mock.calls[1]
    if (!secondCall) throw new Error('Expected the provider request after tool execution')
    const secondPayload = JSON.parse(String((secondCall[1] as RequestInit).body)) as { messages: Array<{ content?: string }> }
    const secondContents = secondPayload.messages.map((message) => message.content ?? '').join('\n')
    expect(secondContents).not.toContain('旧问题')
    expect(secondContents).not.toContain('旧回答')
    expect(secondContents).toContain('最近问题')
    expect(secondContents).toContain('最近回答')
    expect(secondContents).toContain('正文')
    expect(JSON.stringify(secondPayload).length).toBeLessThan(110_000)
    const plans = [...stream.matchAll(/event: meta\ndata: ([^\n]+)/g)].map((match) => (JSON.parse(match[1] ?? '{}') as { receipt?: { contextPlan?: { truncationReasons?: string[]; droppedHistoryTurnCount?: number } } }).receipt?.contextPlan)
    expect(plans.some((plan) => plan?.truncationReasons?.includes('history') && plan.droppedHistoryTurnCount === 1)).toBe(true)
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

  it('normalizes provider HTTP errors into bounded retry metadata', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(
      JSON.stringify({ error: { message: 'invalid request', apiKey: 'should not be exposed' } }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    ))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({
      error: {
        code: 'AI_PROVIDER_ERROR',
        message: 'AI provider returned HTTP 400: invalid request',
        details: { providerStatus: 400, retryable: false, providerMessage: 'invalid request' },
      },
    })
  })

  it('keeps normalized provider diagnostics and retryability in stream errors', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-stream-error","function":{"name":"get_book_toc","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { message: 'invalid tool transcript' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(response.status).toBe(200)
    const stream = await response.text()
    expect(stream).toContain('event: error')
    expect(stream).toContain('"message":"AI provider returned HTTP 400: invalid tool transcript"')
    expect(stream).toContain('"retryable":false')
  })

  it.each([{ message: 'invalid tool transcript api_key=secret-value' }, 'invalid tool transcript api_key=secret-value'])('preserves sanitized errors inside a successful HTTP stream: %j', async (error) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ error })}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
    })
    const stream = await response.text()
    expect(stream).toContain('event: error')
    expect(stream).not.toContain('event: done')
    expect(stream).toContain('AI provider stream error: invalid tool transcript api_key=[redacted]')
    expect(stream).not.toContain('secret-value')
  })

  it('persists a partial assistant answer when a later provider round fails', async () => {
    vi.mocked(saveAiMessage).mockClear()
    vi.mocked(finalizeAiGenerationRun).mockClear()
    vi.mocked(saveAiMessage).mockReturnValue('ai-message')
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"content":"先给出部分回答","tool_calls":[{"index":0,"id":"call-1","function":{"name":"get_book_toc","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockRejectedValueOnce(new Error('provider round failed'))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    const stream = await response.text()
    expect(stream).toContain('event: delta\ndata: {"text":"先给出部分回答"}')
    expect(stream).toContain('event: error')
    expect(vi.mocked(finalizeAiGenerationRun)).toHaveBeenLastCalledWith('user-1', 'ai-run-test', expect.objectContaining({
      state: 'failed',
      text: '先给出部分回答',
    }))
    expect(vi.mocked(finalizeAiGenerationRun).mock.calls.at(-1)?.[2]).not.toHaveProperty('aborted', true)
  })

  it('persists a failure assistant message when a later provider round fails before any text', async () => {
    vi.mocked(saveAiMessage).mockClear()
    vi.mocked(finalizeAiGenerationRun).mockClear()
    vi.mocked(saveAiMessage).mockReturnValue('ai-message')
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"get_book_toc","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockRejectedValueOnce(new Error('provider round failed'))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(await response.text()).toContain('event: error')
    expect(vi.mocked(finalizeAiGenerationRun)).toHaveBeenLastCalledWith('user-1', 'ai-run-test', expect.objectContaining({
      state: 'failed',
      text: '',
    }))
  })

  it('maps provider-level timeouts to the shared AI timeout error', async () => {
    const mutableConfig = config as typeof config & { aiTimeoutMs: number }
    const previousTimeout = mutableConfig.aiTimeoutMs
    mutableConfig.aiTimeoutMs = 10
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The request timed out', 'AbortError')), { once: true })
    }))

    const { modelId } = seedConnection(db, 'user-1', {
      provider: 'openai',
      baseUrl: 'https://draft.example.test/v1',
      apiKey: 'saved-secret',
      models: [{ upstreamModelId: 'draft-model' }],
    })

    try {
      const response = await createApp({ id: 'user-1', role: 'owner' }).request(`http://test/api/v1/ai/models/${modelId}/test`, { method: 'POST' })

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

  it('uses on-demand server search in the chat tool loop', async () => {
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
    expect(searchAiBook).toHaveBeenCalledWith('user-1', { bookId: 'book-1', query: '线索', limit: 5, maxChapterIndex: expect.any(Number) }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
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

      const seeded = seedConnection(db, 'user-1', {
        name: `Native ${item.provider}`,
        provider: item.provider,
        baseUrl: item.baseUrl,
        ...(item.apiKey ? { apiKey: item.apiKey } : {}),
        models: [{ upstreamModelId: item.model }],
      })
      setLastUsedChatModel(db, 'user-1', seeded.modelId)
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

  it.each(['extra_content', 'provider_specific_fields', 'thought_signature', 'thoughtSignature'])('replays OpenAI-compatible Gemini signatures from a late signature delta: %s', async (field) => {
    const signature = field === 'extra_content' ? { extra_content: { google: { thought_signature: 'signed-call-1' } } }
      : field === 'provider_specific_fields' ? { provider_specific_fields: { thought_signature: 'signed-call-1' } }
      : { [field]: 'signed-call-1' }
    const chunks = [
      { index: 0, id: 'gateway-call-1', function: { name: 'get_book_toc', arguments: '{' } },
      { index: 0, function: { arguments: '}' } },
      { index: 0, ...signature },
    ].map((call) => `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call] } }] })}\n\n`).join('')
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(new Response(chunks + 'data: [DONE]\n\n')).mockResolvedValueOnce(finalResponse())
    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
    })
    expect(await response.text()).toContain('event: done')
    const payload = JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))
    const call = payload.messages.find((message: { tool_calls?: unknown }) => message.tool_calls)?.tool_calls[0]
    expect(call).toEqual({
      id: 'gateway-call-1', type: 'function', function: { name: 'get_book_toc', arguments: '{}' },
      extra_content: { google: { thought_signature: 'signed-call-1' } },
    })
    expect(payload.messages.at(-1).tool_call_id).toBe(call.id)
  })

  it('keeps duplicate gateway IDs uniquely paired within a batch and across rounds without changing replayed history', async () => {
    const getBookChapterContent = await import('../books/books.service').then((module) => module.getBookChapterContent)
    vi.mocked(getBookChapterContent).mockResolvedValueOnce({ id: 'ch-0', index: 0, title: 'Prologue', content: 'ABCDE' } as never)
      .mockResolvedValueOnce({ id: 'ch-0', index: 0, title: 'Prologue', content: 'ABCDE' } as never)
    const encode = (calls: unknown[]) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: calls } }] })}\n\ndata: [DONE]\n\n`)
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(encode([0, 1].map((index) => ({
      index, id: 'repeated-gateway-id', function: { name: 'get_chapter_content', arguments: JSON.stringify({ chapterIndex: 0, startOffset: index, maxChars: 2 }) },
    }))))
      .mockResolvedValueOnce(encode([{ index: 0, id: 'repeated-gateway-id', function: { name: 'get_book_toc', arguments: '{}' }, extra_content: { google: { thought_signature: 'round-two-signature' } } }]))
      .mockResolvedValueOnce(finalResponse())
    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
    })
    expect(await response.text()).toContain('event: done')
    const second = JSON.parse(String(fetchMock.mock.calls[1]![1]!.body))
    const third = JSON.parse(String(fetchMock.mock.calls[2]![1]!.body))
    const calls = third.messages.flatMap((message: { tool_calls?: Array<{ id: string }> }) => message.tool_calls ?? [])
    expect(calls).toHaveLength(3)
    expect(new Set(calls.map((call: { id: string }) => call.id)).size).toBe(3)
    expect(calls[0].id).toBe('repeated-gateway-id')
    expect(third.messages.slice(0, second.messages.length)).toEqual(second.messages)
    const results = third.messages.filter((message: { role: string }) => message.role === 'tool')
    expect(results.map((message: { tool_call_id: string }) => message.tool_call_id)).toEqual(calls.map((call: { id: string }) => call.id))
    expect(results[0].content).toContain('"text":"AB"')
    expect(results[1].content).toContain('"text":"BC"')
    expect(calls[2].extra_content).toEqual({ google: { thought_signature: 'round-two-signature' } })
    expect(calls[0]).not.toHaveProperty('extra_content')
  })

  it.each([undefined, '', '   '])('generates distinct IDs for missing or blank OpenAI-compatible call IDs: %j', async (id) => {
    const encode = () => new Response(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, ...(id === undefined ? {} : { id }), function: { name: 'get_book_toc', arguments: '{}' } }] } }] })}\n\ndata: [DONE]\n\n`)
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValueOnce(encode()).mockResolvedValueOnce(encode()).mockResolvedValueOnce(finalResponse())
    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(requestBody),
    })
    expect(await response.text()).toContain('event: done')
    const payload = JSON.parse(String(fetchMock.mock.calls[2]![1]!.body))
    const ids = payload.messages.flatMap((message: { tool_calls?: Array<{ id: string }> }) => message.tool_calls?.map((call) => call.id) ?? [])
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(ids.every((value: string) => value.trim().length > 0)).toBe(true)
    expect(payload.messages.filter((message: { role: string }) => message.role === 'tool').map((message: { tool_call_id: string }) => message.tool_call_id)).toEqual(ids)
  })

  it('preserves Gemini thought signatures across tool rounds', async () => {
    const fetchMock = vi.mocked(fetch)
    const { modelId } = seedConnection(db, 'user-1', {
      name: 'Gemini',
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'gemini-secret',
      models: [{ upstreamModelId: 'gemini-3.5-flash-lite' }],
    })
    setLastUsedChatModel(db, 'user-1', modelId)
    fetchMock
      .mockResolvedValueOnce(new Response(
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_book_toc","args":{}},"thoughtSignature":"signature-1"}]}}]}' + '\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(new Response(
        'data: {"candidates":[{"content":{"parts":[{"text":"目录回答"}]}}]}' + '\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('目录回答')
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { contents?: Array<{ role?: string; parts?: Array<Record<string, unknown>> }> }
    expect(secondRequest.contents?.[1]?.parts?.[0]).toMatchObject({
      functionCall: { name: 'get_book_toc', args: {} },
      thoughtSignature: 'signature-1',
    })
  })

  it('attaches a detached Gemini thought signature to the preceding tool call', async () => {
    const fetchMock = vi.mocked(fetch)
    const { modelId } = seedConnection(db, 'user-1', {
      name: 'Gemini',
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKey: 'gemini-secret',
      models: [{ upstreamModelId: 'gemini-3.5-flash-lite' }],
    })
    setLastUsedChatModel(db, 'user-1', modelId)
    fetchMock
      .mockResolvedValueOnce(new Response(
        'data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"get_book_toc","args":{}}}]}}]}\n\ndata: {"candidates":[{"content":{"parts":[{"text":"","thoughtSignature":"signature-detached"}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))
      .mockResolvedValueOnce(new Response(
        'data: {"candidates":[{"content":{"parts":[{"text":"目录回答"}]}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))

    const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('目录回答')
    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { contents?: Array<{ role?: string; parts?: Array<Record<string, unknown>> }> }
    expect(secondRequest.contents?.[1]?.parts?.[0]).toMatchObject({
      functionCall: { name: 'get_book_toc', args: {} },
      thoughtSignature: 'signature-detached',
    })
  })

  describe('POST /local-chat', () => {
    it('rejects unauthenticated or guest requests', async () => {
      const response = await createApp({ id: 'guest', role: 'guest' }).request('http://test/api/v1/ai/local-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: '请解释这段文字',
          context: requestBody.context,
        }),
      })
      expect(response.status).toBe(401)
    })

    it('rejects server-book fields such as bookId or enabledTools', async () => {
      const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/local-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId: 'book-1',
          prompt: '请解释这段文字',
          context: requestBody.context,
          enabledTools: ['get_book_toc'],
        }),
      })
      expect(response.status).toBe(400)
    })

    it('streams local context chat without touching server books, threads, or tools', async () => {
      vi.mocked(getActiveBook).mockClear()
      vi.mocked(getBookChapters).mockClear()
      vi.mocked(prepareAiThread).mockClear()
      const fetchMock = vi.mocked(fetch)
      fetchMock.mockResolvedValueOnce(new Response(
        'data: {"choices":[{"delta":{"content":"这是[[cite:1]]本地解释"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":8}}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ))

      const response = await createApp({ id: 'user-1', role: 'member' }).request('http://test/api/v1/ai/local-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: '请解释：{SELTEXT}',
          context: {
            ...requestBody.context,
            chapterReferences: [{ chapterIndex: 2, chapterTitle: '第三章', text: '第三章原文片段' }],
          },
          history: [
            { role: 'user', content: '上一轮问题' },
            { role: 'assistant', content: '上一轮回答' },
          ],
          assistantMode: '助理',
          assistantModeId: 'assistant',
        }),
      })

      expect(response.status).toBe(200)
      const sse = await response.text()
      expect(sse).toContain('event: meta')
      expect(sse).toContain('event: delta')
      expect(sse).toContain('event: done')
      expect(sse).toContain('"content":"这是【1】本地解释"')
      expect(sse).toContain('"id":"direct:selection"')
      expect(sse).toContain('"textBasis":"reader"')
      expect(getActiveBook).not.toHaveBeenCalled()
      expect(getBookChapters).not.toHaveBeenCalled()
      expect(prepareAiThread).not.toHaveBeenCalled()
      const upstreamBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { tools?: unknown; messages?: Array<{ role: string; content: string }> }
      expect(upstreamBody.tools).toBeUndefined()
      expect(upstreamBody.messages?.some((m) => m.content.includes('第三章原文片段'))).toBe(true)
      expect(upstreamBody.messages?.some((m) => m.content.includes('上一轮问题'))).toBe(true)
    })
  })

})
