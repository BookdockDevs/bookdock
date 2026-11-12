import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AiChatReq } from '@bookdock/shared'

import { apiGet, apiStreamAiChat, apiUpload, UNAUTHORIZED_EVENT } from '@/api/client'
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

  it('does not sign out a new account when an old upload returns 401', async () => {
    const xhr = transport()
    const unauthorized = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, unauthorized)
    try {
      useAuthStore.getState().setAuth({ id: 'upload-a', username: 'a', role: 'member' })
      const request = apiUpload('/dictionaries', new File(['data'], 'sample.mdx'), 'POST', { onProgress: vi.fn() })
      const rejected = expect(request).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
      useAuthStore.getState().setAuth({ id: 'upload-b', username: 'b', role: 'member' })
      xhr.status = 401
      xhr.responseText = '{"error":{"code":"UNAUTHORIZED","message":"expired"}}'
      xhr.onload?.()
      await rejected
      expect(useAuthStore.getState().user?.id).toBe('upload-b')
      expect(unauthorized).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(UNAUTHORIZED_EVENT, unauthorized)
      useAuthStore.getState().clearAuth()
    }
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

  it.each(['json', 'upload'] as const)('ignores an old %s request 401 after changing accounts', async (transport) => {
    useAuthStore.getState().setAuth({ id: 'request-a', username: 'a', role: 'member' })
    let respond!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve })))
    const unauthorized = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, unauthorized)
    try {
      const request = transport === 'json' ? apiGet('/dictionaries') : apiUpload('/dictionaries', new File(['data'], 'sample.mdx'))
      const rejected = expect(request).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
      useAuthStore.getState().setAuth({ id: 'request-b', username: 'b', role: 'member' })
      respond(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'expired' } }), { status: 401 }))
      await rejected
      expect(useAuthStore.getState().user?.id).toBe('request-b')
      expect(unauthorized).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(UNAUTHORIZED_EVENT, unauthorized)
    }
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

describe('AI background job client', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const job = { id: 'job-1', kind: 'book', scopeKey: 'book-1', clientRequestId: 'answer-1', threadId: 'thread-1', runId: 'run-1', state: 'completed', content: 'Answer.', citations: [], receipt: null, tool: null, error: null, createdAt: 1, updatedAt: 2 }

  it('submits a job and preserves only valid final citations', async () => {
    const excerpt = 'x'.repeat(300)
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ...job, citations: [
      { id: 'chunk-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: 'First', startOffset: 4, endOffset: 18, excerpt, sourceType: 'book' },
      { id: 'missing-chapter' },
      { id: 'reversed', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: 'First', startOffset: 20, endOffset: 10, excerpt: 'Invalid' },
    ] } })))
    vi.stubGlobal('fetch', fetchMock)
    const onDone = vi.fn()
    const onAccepted = vi.fn()
    await apiStreamAiChat(requestBody, { onDone, onAccepted })
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/ai/jobs')
    expect(onAccepted).toHaveBeenCalledWith({ id: 'job-1', threadId: 'thread-1' })
    expect(onDone).toHaveBeenCalledWith({ content: 'Answer.', citations: [
      { id: 'chunk-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: 'First', startOffset: 4, endOffset: 18, excerpt: excerpt.slice(0, 240), sourceType: 'book' },
    ] })
  })

  it('detaches an observer without posting a cancellation', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ...job, state: 'running' } })))
    vi.stubGlobal('fetch', fetchMock)
    await expect(apiStreamAiChat(requestBody, { onAccepted: () => controller.abort() }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain('/cancel')
  })

  it('surfaces persisted provider errors instead of treating an HTTP-successful poll as completion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { ...job, state: 'failed', error: { code: 'AI_PROVIDER_ERROR', message: 'HTTP 400: Invalid signature' } } }))))
    await expect(apiStreamAiChat(requestBody, {})).rejects.toMatchObject({ code: 'AI_PROVIDER_ERROR', message: 'HTTP 400: Invalid signature' })
  })
})
