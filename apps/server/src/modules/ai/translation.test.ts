import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { translationRequestSchema, type TranslationRequest } from '@bookdock/shared'

vi.mock('../../config', () => ({ config: {
  aiBaseUrl: 'https://ai.example.test/v1', aiApiKey: 'secret', aiModel: 'test-model', aiProvider: 'openai',
  jwtSecret: 'test-secret', aiMaxOutputTokens: 128, aiRpm: 1000, aiTimeoutMs: 2000,
} }))
vi.mock('../../db/client', () => ({ getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ get: () => undefined }) }) }) }) }))
vi.mock('../books/books.service', () => ({ getActiveBook: vi.fn().mockResolvedValue({ id: 'book' }) }))

import { config } from '../../config'
import { AppError, errorHandler } from '../../middleware/error'
import { getActiveBook } from '../books/books.service'
import { translateAiSelection } from './ai.service'
import translationRoutes from './translation.routes'

const input: TranslationRequest = { bookId: 'book', text: 'Hello\nworld', targetLang: 'zh-Hans', channel: { kind: 'ai', profileId: null, model: null } }
const upstream = (reason = 'stop', separator = '\n') => new Response([
  `data: ${JSON.stringify({ choices: [{ delta: { content: '你好\n世界' } }] })}`,
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}`,
  'data: [DONE]',
].join(separator + separator) + separator + separator, { headers: { 'Content-Type': 'text/event-stream' } })

function app(guest = false) {
  const instance = new Hono()
  instance.onError(errorHandler)
  instance.use('*', async (c, next) => {
    c.set('user', guest ? null : { id: 'reader', role: 'member', username: 'reader', avatarKey: null })
    c.set('guest', guest)
    await next()
  })
  instance.route('/api/v1/translation', translationRoutes)
  return instance
}

describe('selection translation', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstream()))
    vi.mocked(getActiveBook).mockResolvedValue({ id: 'book' } as never)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('translates only selected text without tools, history or source context', async () => {
    const chunks: string[] = []
    await translateAiSelection('reader', 'member', input, new AbortController().signal, (text) => chunks.push(text))
    expect(chunks.join('')).toBe('你好\n世界')
    expect(getActiveBook).toHaveBeenCalledWith('reader', 'book')
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)
    expect(body.messages).toHaveLength(2)
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello\nworld' })
    expect(body.tools).toBeUndefined()
  })

  it('handles CRLF upstream events', async () => {
    vi.mocked(fetch).mockResolvedValue(upstream('stop', '\r\n'))
    await expect(translateAiSelection('crlf', 'owner', input, new AbortController().signal, vi.fn())).resolves.toBeUndefined()
  })

  it('does not treat truncated output as a completed translation', async () => {
    vi.mocked(fetch).mockResolvedValue(upstream('length'))
    await expect(translateAiSelection('truncated', 'owner', input, new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR' })
    vi.mocked(fetch).mockResolvedValue(upstream())
    await expect(translateAiSelection('truncated', 'owner', input, new AbortController().signal, vi.fn())).resolves.toBeUndefined()
  })

  it('rejects unavailable profiles and unreadable books before contacting the provider', async () => {
    await expect(translateAiSelection('reader', 'member', { ...input, channel: { kind: 'ai', profileId: 'another-users-profile', model: null } }, new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' })
    vi.mocked(getActiveBook).mockRejectedValueOnce(new AppError('BOOK_NOT_FOUND'))
    await expect(translateAiSelection('reader', 'owner', input, new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'BOOK_NOT_FOUND' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('cancels upstream work, releases the user slot and rejects concurrent requests', async () => {
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => await new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }))
    const controller = new AbortController()
    const first = translateAiSelection('cancel', 'owner', input, controller.signal, vi.fn())
    const rejected = expect(first).rejects.toThrow('Aborted')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    await expect(translateAiSelection('cancel', 'owner', input, new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'AI_BUSY' })
    controller.abort()
    await rejected
    vi.mocked(fetch).mockResolvedValueOnce(upstream())
    await expect(translateAiSelection('cancel', 'owner', input, new AbortController().signal, vi.fn())).resolves.toBeUndefined()
  })

  it('enforces the AI rate limit', async () => {
    const previous = config.aiRpm
    config.aiRpm = 1
    try {
      await translateAiSelection('rate-limit', 'owner', input, new AbortController().signal, vi.fn())
      await expect(translateAiSelection('rate-limit', 'owner', input, new AbortController().signal, vi.fn())).rejects.toMatchObject({ code: 'AI_RATE_LIMITED' })
    } finally { config.aiRpm = previous }
  })

  it('rejects guest access and extra context, including oversized selections', async () => {
    expect((await app(true).request('/api/v1/translation/config')).status).toBe(401)
    expect((await app(true).request('/api/v1/translation/translate', { method: 'POST', body: JSON.stringify(input) })).status).toBe(401)
    expect(translationRequestSchema.safeParse({ ...input, context: 'not allowed' }).success).toBe(false)
    expect(translationRequestSchema.safeParse({ ...input, text: 'x'.repeat(6001) }).success).toBe(false)
    const response = await app().request('/api/v1/translation/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, text: ' ' }) })
    expect(response.status).toBe(400)
  })

  it('streams channel-neutral events and reports interrupted output', async () => {
    const response = await app().request('/api/v1/translation/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    expect(response.headers.get('Content-Type')).toContain('application/x-ndjson')
    expect(await response.text()).toContain('"type":"done"')
    vi.mocked(fetch).mockResolvedValueOnce(upstream('length'))
    const failed = await app().request('/api/v1/translation/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
    const text = await failed.text()
    expect(text).toContain('"type":"delta"')
    expect(text).toContain('"type":"error"')
    expect(text).not.toContain('"type":"done"')
  })
})
