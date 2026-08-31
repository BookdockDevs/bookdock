import crypto from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../config', () => ({
  config: {
    aiBaseUrl: 'https://ai.example.test/v1',
    aiApiKey: 'env-key',
    aiModel: 'chat-model',
    aiProvider: 'custom',
    jwtSecret: 'test-jwt-secret',
    aiRpm: 1000,
    aiTimeoutMs: 2000,
  },
}))

vi.mock('../../db/client', () => ({ getDb: vi.fn() }))
vi.mock('../books/books.service', () => ({ getActiveBook: vi.fn(), getBookChapters: vi.fn() }))
vi.mock('../progress/progress.service', () => ({ getProgress: vi.fn() }))
vi.mock('./ai.tools', () => ({
  AI_TOOL_MAX_CALLS: 8,
  AI_TOOL_MAX_STEPS: 4,
  AI_TOOL_MAX_RESULT_CHARS: 12_000,
  AI_TOOLS: [],
  executeAiTool: vi.fn(),
}))
vi.mock('./ai.sessions.service', () => ({
  deleteAiThread: vi.fn(),
  prepareAiThread: vi.fn(),
  saveAiMessage: vi.fn(),
}))

import { getDb } from '../../db/client'
import { embedAiTexts } from './ai.service'

interface SettingRow {
  userId: string
  key: string
  value: unknown
}

let setting: SettingRow | undefined

const testDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        get: () => setting,
      }),
    }),
  }),
}

function encryptApiKey(value: string) {
  const iv = Buffer.alloc(12, 1)
  const key = crypto.createHash('sha256').update('test-jwt-secret').digest()
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.')
}

function setLegacyConfig(provider: string, baseUrl: string, encryptedApiKey: string | null = null, embeddingModel?: string) {
  setting = {
    userId: 'user-1',
    key: 'ai',
    value: { provider, baseUrl, model: 'chat-model', encryptedApiKey, ...(embeddingModel ? { embeddingProfileId: 'legacy', embeddingModel } : {}) },
  }
}

describe('AI embedding provider adapters', () => {
  beforeEach(() => {
    vi.mocked(getDb).mockReturnValue(testDb as never)
    vi.stubGlobal('fetch', vi.fn())
    setting = undefined
  })

  it('uses the OpenAI-compatible embeddings contract', async () => {
    setLegacyConfig('openai', 'https://api.openai.test/v1', encryptApiKey('openai-key'), 'text-embedding-3-small')
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [1, 2] }, { embedding: [3, 4] }] }), { status: 200 }))

    const result = await embedAiTexts('user-1', ['first', 'second'], new AbortController().signal, 'document', 'owner')
    expect(result).toEqual({ provider: 'openai', model: 'text-embedding-3-small', vectors: [[1, 2], [3, 4]] })
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('https://api.openai.test/v1/embeddings')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer openai-key', 'Content-Type': 'application/json' })
    expect(JSON.parse(String(init?.body))).toEqual({ model: 'text-embedding-3-small', input: ['first', 'second'] })
  })

  it('uses Ollama batch embeddings without requiring an API key', async () => {
    setLegacyConfig('ollama', 'http://localhost:11434', null, 'nomic-embed-text')
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ embeddings: [[1, 0], [0, 1]] }), { status: 200 }))

    const result = await embedAiTexts('user-1', ['first', 'second'], new AbortController().signal, 'document', 'owner')
    expect(result).toEqual({ provider: 'ollama', model: 'nomic-embed-text', vectors: [[1, 0], [0, 1]] })
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('http://localhost:11434/api/embed')
    expect(JSON.parse(String(init?.body))).toEqual({ model: 'nomic-embed-text', input: ['first', 'second'] })
  })

  it('uses Gemini batch embeddings and distinguishes query tasks', async () => {
    setLegacyConfig('gemini', 'https://generativelanguage.googleapis.com', encryptApiKey('gemini-key'), 'text-embedding-004')
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ embeddings: [{ values: [0.5, 0.25] }] }), { status: 200 }))

    const result = await embedAiTexts('user-1', ['question'], new AbortController().signal, 'query', 'owner')
    expect(result).toEqual({ provider: 'gemini', model: 'text-embedding-004', vectors: [[0.5, 0.25]] })
    const [url, init] = vi.mocked(fetch).mock.calls[0]!
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents')
    expect(JSON.parse(String(init?.body))).toEqual({
      requests: [{ model: 'models/text-embedding-004', content: { parts: [{ text: 'question' }] }, taskType: 'RETRIEVAL_QUERY' }],
    })
  })

  it('keeps unsupported Anthropic embeddings out of the network path', async () => {
    setLegacyConfig('anthropic', 'https://api.anthropic.test', encryptApiKey('anthropic-key'), 'text-embedding-004')
    await expect(embedAiTexts('user-1', ['text'], new AbortController().signal, 'document', 'owner')).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not send book text when only a chat model is configured', async () => {
    setLegacyConfig('custom', 'https://api.example.test/v1')

    await expect(embedAiTexts('user-1', ['text'], new AbortController().signal, 'document', 'owner')).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
