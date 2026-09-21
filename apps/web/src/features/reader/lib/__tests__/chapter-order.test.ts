import { describe, expect, it } from 'vitest'

import { buildChapterOrderLookup } from '../chapter-order'

describe('buildChapterOrderLookup', () => {
  const order = [
    { label: '第一卷', href: 'volume:1' },
    { label: '第一章 起点', href: 'chapter:1' },
    { label: '第十二章 中段', href: 'chapter:12' },
    { label: '第四章 山谷夜谈', href: 'chapter:4' },
    { label: '第十六章 插入', href: 'chapter:16' },
  ]

  it('matches labels exactly', () => {
    expect(buildChapterOrderLookup(order)('第四章 山谷夜谈')).toBe(3)
  })

  it('prefers href when duplicate labels exist', () => {
    const lookup = buildChapterOrderLookup([
      { label: '第二十七章', href: 'chapter:first-27' },
      { label: '第二十七章', href: 'chapter:second-27' },
    ])
    expect(lookup('第二十七章', 'chapter:second-27')).toBe(1)
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
    const lookup = buildChapterOrderLookup([
      { label: '第十四章 山谷夜谈', href: 'chapter:14' },
      { label: '第四章 山谷夜谈', href: 'chapter:4' },
    ])
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
