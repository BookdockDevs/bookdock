import { describe, expect, it } from 'vitest'

import { buildChapterOrderLookup } from '../chapter-order'

describe('buildChapterOrderLookup', () => {
  const order = ['第一卷', '第一章 起点', '第十二章 中段', '第四章 山谷夜谈', '第十六章 插入']

  it('matches labels exactly', () => {
    expect(buildChapterOrderLookup(order)('第四章 山谷夜谈')).toBe(3)
  })

  it('matches across whitespace differences', () => {
    const lookup = buildChapterOrderLookup(order)
    expect(lookup('第四章山谷夜谈')).toBe(3)
    expect(lookup('第四章  山谷夜谈')).toBe(3)
  })

  it('matches when the annotation label is a prefix fragment of the TOC label', () => {
    expect(buildChapterOrderLookup(order)('第四章')).toBe(3)
  })

  it('does not confuse numerals: "第四章" must not match "第十四章"', () => {
    const lookup = buildChapterOrderLookup(['第十四章 山谷夜谈', '第四章 山谷夜谈'])
    expect(lookup('第四章 山谷夜谈')).toBe(1)
  })

  it('returns -1 for unknown or empty chapters', () => {
    const lookup = buildChapterOrderLookup(order)
    expect(lookup('不存在的章节')).toBe(-1)
    expect(lookup(null)).toBe(-1)
    expect(lookup(undefined)).toBe(-1)
    expect(lookup('  ')).toBe(-1)
  })

  it('tolerates empty chapterOrder', () => {
    expect(buildChapterOrderLookup([])('第一章')).toBe(-1)
  })
})
