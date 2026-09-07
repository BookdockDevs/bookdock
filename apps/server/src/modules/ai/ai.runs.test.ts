import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDb } from '../../__tests__/setup'
import { getDb } from '../../db/client'
import { aiGenerationRuns, aiMessageEvents, aiMessages, aiThreads, books, users } from '../../db/schema'

vi.mock('../../db/client', () => ({ getDb: vi.fn() }))

import { cancelAiGenerationRun, checkpointAiGenerationRun, finalizeAiGenerationRun, getAiGenerationRun, interruptStaleAiGenerationRuns, setAiGenerationTargetMessage, startAiGenerationRun, transitionAiGenerationRun } from './ai.runs.service'

describe('AI generation run service', () => {
  beforeEach(() => {
    const db = createTestDb()
    vi.mocked(getDb).mockReturnValue(db as never)
    db.insert(users).values([
      { id: 'user-1', username: 'user-1', createdAt: 1 },
      { id: 'user-2', username: 'user-2', createdAt: 1 },
    ]).run()
    db.insert(books).values([
      { id: 'book-1', userId: 'user-1', title: 'Book 1', format: 'txt', filePath: '/book-1.txt', size: 10, createdAt: 1, updatedAt: 1 },
      { id: 'book-2', userId: 'user-2', title: 'Book 2', format: 'txt', filePath: '/book-2.txt', size: 10, createdAt: 1, updatedAt: 1 },
    ]).run()
    db.insert(aiThreads).values({ id: 'thread-1', userId: 'user-1', bookId: 'book-1', title: 'Thread', settings: null, createdAt: 1, updatedAt: 1 }).run()
  })

  it('enforces ownership, active uniqueness, CAS transitions, and monotonic checkpoints', () => {
    const run = startAiGenerationRun('user-1', 'thread-1', 'request-1')
    expect(run).toMatchObject({ state: 'preparing', checkpointSeq: 0, targetMessageId: null })
    expect(() => startAiGenerationRun('user-1', 'thread-1', 'request-2')).toThrow('Another AI request is already running')
    expect(() => getAiGenerationRun('user-2', run.id)).toThrow('AI generation run not found')

    transitionAiGenerationRun('user-1', run.id, 'preparing', 'requesting')
    expect(() => transitionAiGenerationRun('user-1', run.id, 'preparing', 'streaming')).toThrow('AI generation state changed')
    checkpointAiGenerationRun('user-1', run.id, 2, { text: '较新的前缀', events: [], usage: { outputTokens: 2 } })
    checkpointAiGenerationRun('user-1', run.id, 1, { text: '旧前缀', events: [], usage: { outputTokens: 1 } })
    expect(getAiGenerationRun('user-1', run.id)).toMatchObject({ checkpointSeq: 2, checkpointText: '较新的前缀', checkpointUsage: { outputTokens: 2 } })
  })

  it('finalizes the target assistant draft atomically with the terminal run', () => {
    const db = getDb()
    const run = startAiGenerationRun('user-1', 'thread-1', 'request-1')
    db.insert(aiMessages).values({
      id: 'assistant-1',
      userId: 'user-1',
      threadId: 'thread-1',
      role: 'assistant',
      content: '',
      context: null,
      retry: null,
      citations: null,
      createdAt: 2,
      aborted: 0,
    }).run()
    setAiGenerationTargetMessage('user-1', run.id, 'assistant-1')
    transitionAiGenerationRun('user-1', run.id, 'preparing', 'streaming')

    const finished = finalizeAiGenerationRun('user-1', run.id, {
      state: 'completed',
      text: '最终回答[1]',
      events: [{ type: 'tool', name: 'search_book', phase: 'result', resultChars: 12 }],
      usage: { inputTokens: 10, outputTokens: 4 },
      citations: [{ id: 'citation-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '第一章', startOffset: 0, endOffset: 4, excerpt: '正文' }],
      diagnostics: {
        provider: 'openai',
        model: 'test-model',
        providerRequestCount: 2,
        timeToFirstTokenMs: 120,
        totalDurationMs: 800,
        contextChars: 100,
        sentMessageChars: 200,
        droppedHistoryChars: 20,
        toolSteps: 1,
        toolCalls: 1,
        toolResultChars: 12,
        retrievalQueries: 1,
        retrievalLexicalCandidates: 4,
        retrievalSemanticCandidates: 3,
        retrievalSelectedResults: 2,
        retrievalFallbacks: 0,
        outputChars: 4,
      },
    })

    expect(finished).toMatchObject({ state: 'completed', targetMessageId: 'assistant-1', checkpointText: '最终回答[1]', checkpointSeq: 1, diagnostics: { provider: 'openai', providerRequestCount: 2, retrievalSelectedResults: 2 } })
    const assistant = db.select().from(aiMessages).all().find((message) => message.id === 'assistant-1')
    expect(assistant).toMatchObject({ content: '最终回答[1]', aborted: 0, citations: [{ id: 'citation-1' }] })
    expect(db.select().from(aiMessageEvents).all()).toEqual([
      expect.objectContaining({ messageId: 'assistant-1', sequence: 0, type: 'tool', phase: 'result', name: 'search_book', resultChars: 12 }),
      expect.objectContaining({ messageId: 'assistant-1', sequence: 1, type: 'citation', citationId: 'citation-1' }),
    ])
  })

  it('persists only citation markers backed by the generation citation registry', () => {
    const db = getDb()
    const run = startAiGenerationRun('user-1', 'thread-1', 'request-citations')
    const citations = [
      { id: 'citation-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '第一章', startOffset: 0, endOffset: 4, excerpt: '正文一' },
      { id: 'citation-2', chapterIndex: 1, chapterId: 'ch-1', chapterTitle: '第二章', startOffset: 5, endOffset: 9, excerpt: '正文二' },
    ]

    const finished = finalizeAiGenerationRun('user-1', run.id, {
      state: 'completed',
      text: '有效依据[2]，无效依据[3]，链接[1](https://example.com)。',
      events: [],
      usage: null,
      citations,
    })

    expect(finished.checkpointText).toBe('有效依据[1]，无效依据，链接[1](https://example.com)。')
    expect(db.select().from(aiMessages).all().find((message) => message.id === finished.targetMessageId)).toMatchObject({
      content: '有效依据[1]，无效依据，链接[1](https://example.com)。',
      citations: [{ id: 'citation-2' }],
    })
  })

  it('maps user cancellation and startup recovery to terminal interrupted states', () => {
    const cancelled = startAiGenerationRun('user-1', 'thread-1', 'request-1')
    expect(cancelAiGenerationRun('user-1', cancelled.id)).toMatchObject({ state: 'cancelled', reason: 'user_cancelled' })

    const stale = startAiGenerationRun('user-1', 'thread-1', 'request-2')
    transitionAiGenerationRun('user-1', stale.id, 'preparing', 'requesting')
    expect(interruptStaleAiGenerationRuns()).toBe(1)
    expect(getAiGenerationRun('user-1', stale.id)).toMatchObject({ state: 'interrupted', reason: 'server_restarted' })
    expect(getDb().select().from(aiGenerationRuns).all()).toHaveLength(2)
  })
})
