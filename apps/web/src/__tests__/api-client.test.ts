import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AiChatReq } from '@bookdock/shared'

import { apiGet, apiStreamAiChat } from '@/api/client'
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
