import { describe, expect, it } from 'vitest'

import {
  EXCERPT_MAX_CHARS,
  EXCERPT_MIN_FONT_SIZE,
  attributionLine,
  calendarDateParts,
  excerptFontSize,
  excerptParagraphs,
  formatChineseDate,
  formatShareDate,
  shareFileName,
  toChineseNumeral,
  truncateExcerpt,
} from '../features/reader/components/share/share-text'

describe('excerptFontSize', () => {
  it('uses the largest size for short excerpts', () => {
    expect(excerptFontSize(0)).toBe(24)
    expect(excerptFontSize(160)).toBe(24)
  })

  it('drops one tier for medium excerpts', () => {
    expect(excerptFontSize(161)).toBe(20)
    expect(excerptFontSize(320)).toBe(20)
  })

  it('floors at the minimum size for long excerpts', () => {
    expect(excerptFontSize(321)).toBe(EXCERPT_MIN_FONT_SIZE)
    expect(excerptFontSize(10000)).toBe(EXCERPT_MIN_FONT_SIZE)
  })
})

describe('truncateExcerpt', () => {
  it('keeps text at or under the limit untouched', () => {
    expect(truncateExcerpt('')).toBe('')
    expect(truncateExcerpt('短')).toBe('短')
    expect(truncateExcerpt('a'.repeat(EXCERPT_MAX_CHARS))).toHaveLength(EXCERPT_MAX_CHARS)
  })

  it('truncates over-limit text with an ellipsis', () => {
    const out = truncateExcerpt('a'.repeat(EXCERPT_MAX_CHARS + 10))
    expect(out).toBe(`${'a'.repeat(EXCERPT_MAX_CHARS)}……`)
  })

  it('does not split surrogate pairs', () => {
    const text = '😀'.repeat(EXCERPT_MAX_CHARS + 1)
    const out = truncateExcerpt(text)
    expect(out).toBe(`${'😀'.repeat(EXCERPT_MAX_CHARS)}……`)
  })
})

describe('excerptParagraphs', () => {
  it('splits on newline runs and trims each paragraph', () => {
    expect(excerptParagraphs('第一段。\n\n第二段。')).toEqual(['第一段。', '第二段。'])
    expect(excerptParagraphs('第一段。\n\n\n\n第二段。')).toEqual(['第一段。', '第二段。'])
    expect(excerptParagraphs('  第一段。  \n\n  第二段。  ')).toEqual(['第一段。', '第二段。'])
  })

  it('normalizes CRLF and drops empty paragraphs', () => {
    expect(excerptParagraphs('第一段。\r\n\r\n第二段。')).toEqual(['第一段。', '第二段。'])
    expect(excerptParagraphs('\n\n第一段。\n\n')).toEqual(['第一段。'])
  })

  it('returns an empty list for blank text', () => {
    expect(excerptParagraphs('')).toEqual([])
    expect(excerptParagraphs(' \n\n ')).toEqual([])
  })
})

describe('attributionLine', () => {
  it('joins title and chapter', () => {
    expect(attributionLine('不平静的日常', '第三十二章')).toBe('/ 不平静的日常 · 第三十二章')
  })

  it('degrades to title only without a chapter', () => {
    expect(attributionLine('不平静的日常', null)).toBe('/ 不平静的日常')
  })
})

describe('formatShareDate', () => {
  it('formats unpadded Y/M/D', () => {
    expect(formatShareDate(new Date(2024, 4, 30).getTime())).toBe('2024/5/30')
    expect(formatShareDate(new Date(2026, 11, 9).getTime())).toBe('2026/12/9')
  })
})

describe('toChineseNumeral', () => {
  it('covers 1–31 for month/day usage', () => {
    expect(toChineseNumeral(1)).toBe('一')
    expect(toChineseNumeral(9)).toBe('九')
    expect(toChineseNumeral(10)).toBe('十')
    expect(toChineseNumeral(11)).toBe('十一')
    expect(toChineseNumeral(20)).toBe('二十')
    expect(toChineseNumeral(21)).toBe('二十一')
    expect(toChineseNumeral(31)).toBe('三十一')
  })
})

describe('formatChineseDate', () => {
  it('renders the date in Chinese numerals', () => {
    expect(formatChineseDate(new Date(2024, 4, 30).getTime())).toBe('二〇二四年五月三十日')
    expect(formatChineseDate(new Date(2026, 7, 9).getTime())).toBe('二〇二六年八月九日')
  })
})

describe('calendarDateParts', () => {
  it('splits day, EN month-year and ZH weekday', () => {
    // 2026-08-09 is a Sunday
    expect(calendarDateParts(new Date(2026, 7, 9))).toEqual({
      day: '9',
      monthYear: 'AUGUST 2026',
      weekday: '星期日',
    })
    expect(calendarDateParts(new Date(2026, 7, 10)).weekday).toBe('星期一')
  })
})

describe('shareFileName', () => {
  const date = new Date(2026, 7, 9)

  it('formats title and date', () => {
    expect(shareFileName('不平静的日常', date)).toBe('书摘-不平静的日常-20260809.png')
  })

  it('strips filesystem-hostile characters', () => {
    expect(shareFileName('a/b\\c:d*e?f"g<h>i|j', date)).toBe('书摘-abcdefghij-20260809.png')
  })

  it('falls back when the title sanitizes to nothing', () => {
    expect(shareFileName('???', date)).toBe('书摘-book-20260809.png')
  })
})
