import { describe, expect, it } from 'vitest'

import { composeMarginalLine, composeMarginalText } from '../marginals'

const ctx = {
  bookTitle: '三体',
  chapterTitle: '第一章 科学边界',
  chapterFraction: 0.5,
  bookFraction: 0.1234,
  chapterWordCount: 12345,
  now: new Date(2026, 0, 1, 9, 5).getTime(),
}

describe('composeMarginalText', () => {
  it('none renders empty', () => {
    expect(composeMarginalText('none', ctx)).toBe('')
  })

  it('bookTitle and chapter render their labels', () => {
    expect(composeMarginalText('bookTitle', ctx)).toBe('三体')
    expect(composeMarginalText('chapter', ctx)).toBe('第一章 科学边界')
  })

  it('progress fields render rounded percentages', () => {
    expect(composeMarginalText('chapterProgress', ctx)).toBe('50%')
    expect(composeMarginalText('bookProgress', ctx)).toBe('12%')
  })

  it('undefined fractions render empty instead of NaN', () => {
    expect(composeMarginalText('bookProgress', { ...ctx, bookFraction: undefined })).toBe('')
  })

  it('chapter word count renders plain and 万 formats', () => {
    expect(composeMarginalText('chapterWordCount', { ...ctx, chapterWordCount: 3215 })).toBe('3215字')
    expect(composeMarginalText('chapterWordCount', ctx)).toBe('1.2万字')
    expect(composeMarginalText('chapterWordCount', { ...ctx, chapterWordCount: 12000 })).toBe('1.2万字')
    expect(composeMarginalText('chapterWordCount', { ...ctx, chapterWordCount: 20000 })).toBe('2万字')
    expect(composeMarginalText('chapterWordCount', { ...ctx, chapterWordCount: undefined })).toBe('')
  })

  it('time renders HH:mm', () => {
    expect(composeMarginalText('time', ctx)).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('composeMarginalLine', () => {
  it('maps each position to its field', () => {
    const line = composeMarginalLine(['bookTitle', 'time', 'bookProgress'], ctx)
    expect(line[0]).toBe('三体')
    expect(line[1]).toMatch(/^\d{2}:\d{2}$/)
    expect(line[2]).toBe('12%')
  })
})
