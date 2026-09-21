import { describe, expect, it } from 'vitest'

import { mergeProgressSaveCache } from '../progress-cache'

describe('mergeProgressSaveCache', () => {
  it('seeds a first-read cache that was previously null with the saved position', () => {
    const saved = {
      id: 'prog-book-1',
      bookId: 'book-1',
      cfi: 'epubcfi(/6/4!/2/4:120)',
      chapter: '第四章',
      chapterIndex: 3,
      percent: 47,
      fraction: 0.47,
      readFraction: 0.47,
      updatedAt: 123,
    }

    expect(mergeProgressSaveCache({ data: null }, { data: saved })).toEqual({ data: saved })
  })

  it('keeps the current cache when a response contains no progress', () => {
    const current = { data: null }

    expect(mergeProgressSaveCache(current, { data: null })).toBe(current)
  })
})
