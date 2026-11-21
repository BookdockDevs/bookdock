import { describe, it, expect } from 'vitest'

import { pickTocRule, type TocRuleLike } from '../formats/toc'

const PARAGRAPH = '这是一段足够长的正文内容，用于满足一千字符的门槛判定，让它看起来像真正的书章节正文。'

function longBody(targetChars = 1100): string {
  const paragraphs = []
  let len = 0
  while (len < targetChars) {
    paragraphs.push(PARAGRAPH)
    len += PARAGRAPH.length + 2
  }
  return paragraphs.join('\n\n')
}

function book(chapterLines: string[], body = longBody()): string {
  return chapterLines.map((line) => `${line}\n\n${body}`).join('\n\n')
}

const CHAPTER_REGEX = '^第[一二三四五六七八九十]+章 .+'

describe('pickTocRule', () => {
  function rules(...items: TocRuleLike[]): TocRuleLike[] {
    return items
  }

  it('picks the preset with the most reliable chapters', () => {
    const good: TocRuleLike = { id: 'good', patterns: [{ level: 1, regex: CHAPTER_REGEX }] }
    const weak: TocRuleLike = { id: 'weak', patterns: [{ level: 1, regex: '^[^第].+' }] }
    const sample = book(['第一章 启程', '第二章 旅途', '第三章 归来', '第四章 续篇', '第五章 高潮'])

    expect(pickTocRule(rules(weak, good), sample)).toBe('good')
  })

  it('prefers a reliable hierarchy when a flat preset is only a near tie', () => {
    const flat: TocRuleLike = { id: 'flat', patterns: [{ level: 1, regex: CHAPTER_REGEX }] }
    const nested: TocRuleLike = {
      id: 'nested',
      patterns: [
        { level: 1, regex: '^第[一二三四五六七八九十]+卷 .+' },
        { level: 2, regex: CHAPTER_REGEX },
      ],
    }
    const numerals = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
    const chapters = Array.from({ length: 80 }, (_, index) =>
      `第${numerals[index % numerals.length]}章 第${index + 1}节\n\n${longBody()}`,
    ).join('\n\n')
    const sample = `第一卷 崛起\n\n${chapters}`

    expect(pickTocRule(rules(flat, nested), sample)).toBe('nested')
  })

  it('keeps the hierarchy preset when only its child level matches', () => {
    const nested: TocRuleLike = {
      id: 'nested',
      patterns: [
        { level: 1, regex: '^第[一二三四五六七八九十]+卷 .+' },
        { level: 2, regex: CHAPTER_REGEX },
      ],
    }
    const flat: TocRuleLike = { id: 'flat', patterns: [{ level: 1, regex: CHAPTER_REGEX }] }
    const sample = book(['第一章 启程', '第二章 旅途', '第三章 归来'])

    expect(pickTocRule(rules(nested, flat), sample)).toBe('nested')
  })

  it('keeps the hierarchy preset when only its parent level matches', () => {
    const nested: TocRuleLike = {
      id: 'nested',
      patterns: [
        { level: 1, regex: '^第[一二三四五六七八九十]+卷 .+' },
        { level: 2, regex: '^第[一二三四五六七八九十]+节 .+' },
      ],
    }
    const flat: TocRuleLike = { id: 'flat', patterns: [{ level: 1, regex: CHAPTER_REGEX }] }
    const sample = [
      `第一卷 崛起\n\n${longBody()}`,
      `第二卷 鼎盛\n\n${longBody()}`,
      `第三卷 终局\n\n${longBody()}`,
    ].join('\n\n')

    expect(pickTocRule(rules(nested, flat), sample)).toBe('nested')
  })

  it('prefers the earlier sortOrder on a tie', () => {
    const a: TocRuleLike = { id: 'a', patterns: [{ level: 1, regex: CHAPTER_REGEX }] }
    const b: TocRuleLike = { id: 'b', patterns: [{ level: 1, regex: CHAPTER_REGEX }] }
    const sample = book(['第一章 启程', '第二章 旅途', '第三章 归来', '第四章 续篇'])

    expect(pickTocRule(rules(a, b), sample)).toBe('a')
  })

  it('returns null when no preset clears the bar', () => {
    const noise: TocRuleLike = { id: 'noise', patterns: [{ level: 1, regex: '^[^\\n]+$' }] }
    // Every line looks like a chapter: each match follows <100 chars, so the
    // preset never wins (csNum stays ~0 relative to the misjudge floor)
    const sample = Array.from({ length: 60 }, () => '短行正文内容').join('\n')

    expect(pickTocRule(rules(noise), sample)).toBeNull()
  })
})
