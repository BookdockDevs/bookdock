import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AiChatReq } from '@bookdock/shared'

import { apiGet, apiStreamAiChat, apiUpload } from '@/api/client'
import { hasUndoOpportunity } from '@/lib/undo'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

const requestBody: AiChatReq = {
  bookId: 'book-1',
  prompt: '解释这段话',
  context: {
    chapterIndex: 0,
    chapterTitle: '第一章',
    cfiRange: 'epubcfi(/6/4!/4/2)',
    selection: '一段正文',
  },
}

describe('upload transport', () => {
  afterEach(() => vi.unstubAllGlobals())

  function transport() {
    const xhr = { open: vi.fn(), send: vi.fn(), abort: vi.fn(), upload: { onprogress: null as null | ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) }, onload: null as null | (() => void), onerror: null as null | (() => void), onabort: null as null | (() => void), status: 201, responseText: '{"data":{"id":"file"}}', statusText: '' }
    xhr.abort.mockImplementation(() => xhr.onabort?.())
    vi.stubGlobal('XMLHttpRequest', class { constructor() { return xhr } })
    return xhr
  }

  it('reports byte progress and waits for the successful server response', async () => {
    const xhr = transport()
    const onProgress = vi.fn()
    const request = apiUpload('/content-files', new File(['data'], 'sample.txt'), 'POST', { onProgress })
    expect(xhr.open).toHaveBeenCalledWith('POST', '/api/v1/content-files')
    expect(xhr.send.mock.calls[0][0].get('file').name).toBe('sample.txt')
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 3, total: 4 })
    expect(onProgress).toHaveBeenCalledWith(75)
    xhr.onload?.()
    await expect(request).resolves.toEqual({ data: { id: 'file' } })
  })

  it('preserves structured server rejection codes for retry feedback', async () => {
    const xhr = transport()
    xhr.status = 415
    xhr.responseText = '{"error":{"code":"UNSUPPORTED_FORMAT","message":"invalid image"}}'
    const request = apiUpload('/content-files', new File(['data'], 'sample.png'), 'POST', { onProgress: vi.fn() })
    const rejected = expect(request).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT', message: 'invalid image' })
    xhr.onload?.()
    await rejected
  })

  it('aborts pending upload bytes when the draft is cancelled', async () => {
    const xhr = transport()
    const controller = new AbortController()
    const request = apiUpload('/content-files', new File(['data'], 'sample.txt'), 'POST', { signal: controller.signal, onProgress: vi.fn() })
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    expect(xhr.abort).toHaveBeenCalledOnce()
  })
})

describe('expired hidden display session', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useAuthStore.getState().clearAuth()
    localStorage.clear()
  })

  it.each(['/auth/me', '/books/hidden'])('collapses immediately on a 401 from %s without deleting the preference', async (path) => {
    useAuthStore.getState().setAuth({ id: 'expired-user', username: 'expired', role: 'member' })
    useUiStore.getState().setRevealHidden(true)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'expired' } }), { status: 401 })))
    await expect(apiGet(path)).rejects.toThrow('expired')
    expect(useAuthStore.getState().user).toBeNull()
    expect(useUiStore.getState().revealHidden).toBe(false)
    expect(localStorage.getItem('bd-reveal-hidden:expired-user')).toBe('true')
  })
})

describe('undo receipt response session boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    useAuthStore.getState().clearAuth()
  })

  it('ignores an undo receipt returned after the request account changes', async () => {
    useAuthStore.getState().setAuth({ id: 'account-a', username: 'a', role: 'member' })
    let respond!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve })))
    const request = apiGet('/books')
    useAuthStore.getState().setAuth({ id: 'account-b', username: 'b', role: 'member' })
    respond(new Response(JSON.stringify({ data: null, undo: { token: 'receipt-a', expiresAt: Date.now() + 120_000, generation: 1 } }), { status: 200 }))
    await request
    expect(hasUndoOpportunity()).toBe(false)
  })
})

describe('AI stream client', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps valid citations and drops malformed citation payloads', async () => {
    const excerpt = 'x'.repeat(300)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response([
      'event: tool',
      `data: ${JSON.stringify({
        name: 'search_book',
        phase: 'result',
        citations: [
          {
            id: 'chunk-1',
            chapterIndex: 0,
            chapterId: 'ch-0',
            chapterTitle: '第一章',
            startOffset: 4,
            endOffset: 18,
            excerpt,
            sourceType: 'book',
          },
          { id: 'missing-chapter' },
          {
            id: 'reversed-range',
            chapterIndex: 0,
            chapterId: 'ch-0',
            chapterTitle: '第一章',
            startOffset: 20,
            endOffset: 10,
            excerpt: '无效范围',
          },
        ],
      })}`,
      '',
    ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })))

    const onTool = vi.fn()
    await apiStreamAiChat(requestBody, { onTool })

    expect(onTool).toHaveBeenCalledWith({
      name: 'search_book',
      phase: 'result',
      citations: [{
        id: 'chunk-1',
        chapterIndex: 0,
        chapterId: 'ch-0',
        chapterTitle: '第一章',
        startOffset: 4,
        endOffset: 18,
        excerpt: excerpt.slice(0, 240),
        sourceType: 'book',
      }],
    })
  })

  it('parses the final normalized answer and citations from the done event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response([
      'event: done',
      `data: ${JSON.stringify({
        content: '回答[1]，链接[2](https://example.com)。',
        citations: [
          { id: 'chunk-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '第一章', startOffset: 4, endOffset: 18, excerpt: '正文', sourceType: 'book' },
          { id: 'malformed' },
        ],
      })}`,
      '',
    ].join('\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })))

    const onDone = vi.fn()
    await apiStreamAiChat(requestBody, { onDone })

    expect(onDone).toHaveBeenCalledWith({
      content: '回答[1]，链接[2](https://example.com)。',
      citations: [{ id: 'chunk-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '第一章', startOffset: 4, endOffset: 18, excerpt: '正文', sourceType: 'book' }],
    })
  })
})
