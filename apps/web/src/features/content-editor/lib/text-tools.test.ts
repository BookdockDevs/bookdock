import { describe, expect, it } from 'vitest'

import { predictContinuationStartIndex, previewTextChapters } from './text-tools'

describe('content editor text tools', () => {
  it('predicts a continuation after a matching chapter suffix', () => {
    const existing = [
      { id: 'one', title: '第一章', level: 0, content: '' },
      { id: 'two', title: '第二章', level: 0, content: '' },
    ]
    const preview = [
      { id: 'old-one', title: '第一章', level: 0, content: '' },
      { id: 'old-two', title: '第二章', level: 0, content: '' },
      { id: 'three', title: '第三章', level: 0, content: '' },
      { id: 'four', title: '第四章', level: 0, content: '' },
    ]
    expect(predictContinuationStartIndex(existing, preview)).toBe(2)
  })

  it('uses numbered chapter continuation when the import begins at the next chapter', () => {
    expect(predictContinuationStartIndex(
      [{ id: 'last', title: '第 8 章 结束', level: 0, content: '' }],
      [
        { id: 'first', title: '杂项', level: 0, content: '' },
        { id: 'next', title: '第九章 新篇', level: 0, content: '' },
      ],
    )).toBe(1)
  })

  it('keeps text preview available when no heading rule matches', () => {
    expect(previewTextChapters('Body text', []).map((unit) => unit.content)).toEqual(['Body text'])
  })
})
