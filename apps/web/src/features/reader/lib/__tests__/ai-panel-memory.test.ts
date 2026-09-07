import { beforeEach, describe, expect, it } from 'vitest'

import { readAiPanelMemory, writeAiPanelMemory } from '../ai-panel-memory'

describe('AI panel memory', () => {
  beforeEach(() => localStorage.clear())

  it('keeps drafts and active threads isolated by user and book', () => {
    writeAiPanelMemory('user-1', 'book-1', {
      activeThreadId: 'thread-1',
      prompt: '稍后继续',
      chapterReferences: [2, 4],
    })

    expect(readAiPanelMemory('user-1', 'book-1')).toEqual({
      activeThreadId: 'thread-1',
      prompt: '稍后继续',
      chapterReferences: [2, 4],
    })
    expect(readAiPanelMemory('user-1', 'book-2').activeThreadId).toBeNull()
    expect(readAiPanelMemory('user-2', 'book-1').prompt).toBe('')
  })

  it('sanitizes stale or malformed stored values', () => {
    localStorage.setItem('bd-ai-panel-memory:user-1:book-1', JSON.stringify({
      activeThreadId: 42,
      prompt: true,
      readingScope: 'future_scope',
      enabledTools: ['search_annotations', 'removed_tool', 'search_annotations'],
      assistantModeId: '',
      chapterReferences: [3, -1, 3, 1.5, '2'],
    }))

    expect(readAiPanelMemory('user-1', 'book-1')).toEqual({
      activeThreadId: null,
      prompt: '',
      chapterReferences: [3],
    })
  })
})
