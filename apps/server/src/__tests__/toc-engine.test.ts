import { describe, it, expect } from 'vitest'

import { applyTitleReplacement, scorePattern, scorePreset, pickTocRule, type TocRuleLike } from '../formats/toc'

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

describe('applyTitleReplacement', () => {
  it('returns the full match when no replacement is set', () => {
    const m = /^第(\d+)章 (.+)$/.exec('第1章 启程')
    expect(applyTitleReplacement(m!, undefined)).toBe('第1章 启程')
  })

  it('applies $1-style capture group substitution', () => {
    const m = /^第(\d+)章 (.+)$/.exec('第1章 启程')
    expect(applyTitleReplacement(m!, '第$1章 $2')).toBe('第1章 启程')
  })
})

describe('scorePattern', () => {
  it('counts real chapters (csNum) when content exceeds 1000 chars', () => {
    const sample = book(['第一章 启程', '第二章 旅途', '第三章 归来'])
    const score = scorePattern({ level: 1, regex: CHAPTER_REGEX }, sample)
    expect(score.csNum).toBe(3)
    expect(score.numE).toBe(0)
  })

  it('counts near-miss misjudges (numE) when content is under 100 chars', () => {
    const sample = '第一章 启程\n\n第二章 旅途\n\n第三章 归来\n\n' + longBody()
    const score = scorePattern({ level: 1, regex: CHAPTER_REGEX }, sample)
    // First line starts the sample (csNum), the next two follow <100 chars
    expect(score.csNum).toBe(1)
    expect(score.numE).toBe(2)
  })

  it('ignores malformed regexes', () => {
    const score = scorePattern({ level: 1, regex: '(' }, '第一章 启程\n\n正文')
    expect(score).toEqual({ csNum: 0, numE: 0 })
  })

  it('handles lookbehind-based chapter rules', () => {
    // Leading newline so every title line is preceded by whitespace — a
    // lookbehind-constrained rule never matches the file's first byte
    const sample = '\n' + book(['第一章 启程', '第二章 续篇', '第三章 终局'])
    const score = scorePattern(
      { level: 1, regex: '(?<=[\\u3000\\s])(?:序章|第[\\d〇零一二三四五六七八九十百千万]+章).{0,30}$' },
      sample,
    )
    expect(score.csNum).toBe(3)
  })
})

describe('scorePreset', () => {
  it('aggregates scores across levels', () => {
    const sample =
      '第一卷 崛起\n\n第一章 启程\n\n' +
      longBody() +
      '\n\n第二卷 鼎盛\n\n第二章 旅途\n\n' +
      longBody()
    const preset = [
      { level: 0, regex: '^第[一二三四五六七八九十\\d]+卷 .+' },
      { level: 1, regex: CHAPTER_REGEX },
    ]
    const score = scorePreset(preset, sample)
    expect(score.csNum).toBe(4)
  })
})

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
