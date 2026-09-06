import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestDb } from '../../__tests__/setup'
import { getDb } from '../../db/client'
import { aiMessages, books, users } from '../../db/schema'

vi.mock('../../db/client', () => ({ getDb: vi.fn() }))

import { createAiThread, deleteAiThread, getAiThread, listAiThreads, prepareAiThread, saveAiMessage, updateAiMessageContext, updateAiThread } from './ai.sessions.service'

describe('AI session service', () => {
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
  })

  it('creates, lists, restores, renames, and deletes a book-scoped thread', () => {
    const thread = createAiThread('user-1', { bookId: 'book-1' })
    saveAiMessage('user-1', thread.id, {
      role: 'user',
      content: '解释第一章',
      context: { selectionChars: 4, beforeChars: 0, contextChars: 4, chapterTitle: '第一章', sourceCfi: 'selection' },
      retry: {
        context: { chapterIndex: 0, chapterTitle: '第一章', cfiRange: 'selection', selection: '正文' },
        readingScope: 'to_here',
        enabledTools: ['get_book_toc', 'get_chapter_content'],
        assistantMode: '助理',
      },
    })
    saveAiMessage('user-1', thread.id, {
      role: 'assistant',
      content: '这是解释',
      citations: [{ id: 'chunk-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '第一章', startOffset: 2, endOffset: 8, excerpt: '命中段落' }],
      aborted: true,
    })

    expect(listAiThreads('user-1', { bookId: 'book-1' })).toEqual([expect.objectContaining({ id: thread.id, title: '新对话', messageCount: 2 })])
    expect(getAiThread('user-1', thread.id)).toMatchObject({
      id: thread.id,
      bookId: 'book-1',
      messages: [
        expect.objectContaining({ role: 'user', content: '解释第一章', context: expect.objectContaining({ selectionChars: 4 }), retry: expect.objectContaining({ readingScope: 'to_here' }), aborted: false }),
        expect.objectContaining({
          role: 'assistant', content: '这是解释', context: null, aborted: true,
          citations: [{ id: 'chunk-1', chapterIndex: 0, chapterId: 'ch-0', chapterTitle: '第一章', startOffset: 2, endOffset: 8, excerpt: '命中段落' }],
        }),
      ],
    })

    expect(updateAiThread('user-1', thread.id, { title: '第一章解释' })).toEqual(expect.objectContaining({ title: '第一章解释', messageCount: 2 }))
    deleteAiThread('user-1', thread.id)
    expect(listAiThreads('user-1', { bookId: 'book-1' })).toEqual([])
    expect(getDb().select().from(aiMessages).all()).toEqual([])
  })

  it('uses persisted messages as the authoritative history and derives the first title', () => {
    const first = prepareAiThread('user-1', 'book-1', undefined, '  总结\n第一章   内容  ')
    expect(getAiThread('user-1', first.threadId).title).toBe('总结 第一章 内容')

    const context = { chapterIndex: 0, chapterTitle: '第一章', cfiRange: 'selection', selection: '服务端引用原文', before: '服务端前文' }
    saveAiMessage('user-1', first.threadId, {
      role: 'user',
      content: '服务端问题',
      retry: { context, readingScope: 'to_here', enabledTools: ['get_book_toc'] },
    })
    saveAiMessage('user-1', first.threadId, { role: 'assistant', content: '服务端回答' })
    expect(prepareAiThread('user-1', 'book-1', first.threadId, '客户端伪造历史')).toMatchObject({
      threadId: first.threadId,
      history: [
        { role: 'user', content: '服务端问题', context },
        { role: 'assistant', content: '服务端回答' },
      ],
      settings: {
        readingScope: 'to_here',
        enabledTools: ['get_book_toc', 'get_chapter_content', 'search_book', 'search_notes'],
      },
    })
  })

  it('updates only an owned user message context receipt', () => {
    const thread = createAiThread('user-1', { bookId: 'book-1' })
    const messageId = saveAiMessage('user-1', thread.id, { role: 'user', content: '解释第一章' })
    if (!messageId) throw new Error('Expected a persisted message id')

    updateAiMessageContext('user-1', thread.id, messageId, {
      questionChars: 5,
      selectionChars: 4,
      beforeChars: 2,
      chapterChars: 6,
      ragChars: 8,
      contextChars: 20,
      chapterTitle: '第一章',
      sourceCfi: 'selection',
    })

    expect(getAiThread('user-1', thread.id).messages[0]).toMatchObject({
      id: messageId,
      context: expect.objectContaining({ questionChars: 5, chapterChars: 6, ragChars: 8, contextChars: 20 }),
    })
  })

  it('atomically replaces the matching last turn for regeneration', () => {
    const thread = createAiThread('user-1', { bookId: 'book-1' })
    saveAiMessage('user-1', thread.id, { role: 'user', content: '重新回答' })
    saveAiMessage('user-1', thread.id, { role: 'assistant', content: '旧回答' })

    const prepared = prepareAiThread('user-1', 'book-1', thread.id, '重新回答', true)
    expect(prepared.history).toEqual([])
    expect(prepared.replaceMessageIds).toHaveLength(2)
    saveAiMessage('user-1', thread.id, { role: 'user', content: '重新回答', replaceMessageIds: prepared.replaceMessageIds })

    expect(getAiThread('user-1', thread.id).messages).toEqual([expect.objectContaining({ role: 'user', content: '重新回答' })])
  })

  it('rejects cross-user and cross-book access', () => {
    const thread = createAiThread('user-1', { bookId: 'book-1' })

    expect(() => listAiThreads('user-2', { bookId: 'book-1' })).toThrow('BOOK_NOT_FOUND')
    expect(() => getAiThread('user-2', thread.id)).toThrow('AI thread not found')
    expect(() => prepareAiThread('user-1', 'book-2', thread.id, '问题')).toThrow('AI thread does not belong to this book')
    expect(() => saveAiMessage('user-2', thread.id, { role: 'user', content: '越权写入' })).toThrow('AI thread not found')
  })
})
