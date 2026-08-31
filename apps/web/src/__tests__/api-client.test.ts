import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AiChatReq } from '@bookdock/shared'

import { apiStreamAiChat } from '@/api/client'

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
})
