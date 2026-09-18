import { describe, expect, it } from 'vitest'

import { middleTruncate } from '@/features/library/components/book-detail/types'

describe('middleTruncate', () => {
  it('returns short ASCII values unchanged', () => {
    expect(middleTruncate('my-old-book.txt')).toBe('my-old-book.txt')
  })

  it('middle-truncates long ASCII by character count', () => {
    const value = 'a'.repeat(20) + '-isbn-' + 'b'.repeat(20)
    const result = middleTruncate(value)
    expect(result).toContain('…')
    expect(result.startsWith('a'.repeat(14))).toBe(true)
    expect(result.endsWith('b'.repeat(13))).toBe(true)
  })

  it('counts CJK characters as double width and truncates Chinese file names', () => {
    const value = '《花都猎人》（校对版全本）作者：不乐无语.txt'
    const result = middleTruncate(value)
    expect(result).toContain('…')
    // head budget is 14 display width → 7 CJK chars
    expect(result.startsWith('《花都猎人》（')).toBe(true)
    expect(result.endsWith('不乐无语.txt')).toBe(true)
    expect(result).not.toBe(value)
  })

  it('leaves values within the width budget untouched', () => {
    const value = '短书名.txt' // 3 CJK (6) + 4 ASCII = width 10
    expect(middleTruncate(value)).toBe(value)
  })
})
