import { beforeEach, describe, expect, it } from 'vitest'

import { getGuestProgress, saveGuestProgress } from '../guest-progress'

describe('guest reader progress', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('keeps progress in the guest browser namespace', () => {
    const saved = saveGuestProgress('book-1', {
      cfi: 'epubcfi(/6/4!/4/2)',
      chapter: '第一章',
      chapterIndex: 0,
      percent: 18,
      fraction: 0.18,
    })

    expect(saved.bookId).toBe('book-1')
    expect(getGuestProgress('book-1')).toEqual(saved)
    expect(JSON.parse(localStorage.getItem('bd-guest-reading-progress') ?? '{}')).toEqual({ 'book-1': saved })
  })

  it('retains the last position when a later update omits optional fields', () => {
    saveGuestProgress('book-1', {
      cfi: 'txt:120',
      chapter: '第二章',
      percent: 24,
      fraction: 0.24,
    })

    const saved = saveGuestProgress('book-1', { percent: 28, fraction: 0.28 })

    expect(saved.cfi).toBe('txt:120')
    expect(saved.chapter).toBe('第二章')
    expect(saved.percent).toBe(28)
  })
})
