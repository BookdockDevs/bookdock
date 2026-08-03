import { describe, expect, it, vi } from 'vitest'

import {
  extractChapterText,
  findMatches,
  getChapterText,
  makeExcerpt,
  offsetsToRange,
} from '../features/reader/lib/book-search'

const parseXhtml = (markup: string) =>
  new DOMParser().parseFromString(markup, 'application/xhtml+xml')

const XHTML_HEAD = '<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body>'
const XHTML_TAIL = '</body></html>'

describe('extractChapterText', () => {
  it('concatenates text nodes in document order and records their lengths', () => {
    const doc = parseXhtml(`${XHTML_HEAD}<p>春宵</p><p>一刻<b>值</b>千金</p>${XHTML_TAIL}`)
    const { text, nodeLengths } = extractChapterText(doc)
    expect(text).toBe('春宵一刻值千金')
    expect(nodeLengths).toEqual([2, 2, 1, 2])
    expect(nodeLengths.reduce((a, b) => a + b, 0)).toBe(text.length)
  })

  it('excludes script and style subtrees', () => {
    const doc = parseXhtml(
      `${XHTML_HEAD}<style>.a{color:red}</style><p>正文</p><script>var x = 1;</script>${XHTML_TAIL}`,
    )
    expect(extractChapterText(doc).text).toBe('正文')
  })

  it('returns empty text for a document without body', () => {
    const doc = parseXhtml('<html xmlns="http://www.w3.org/1999/xhtml"></html>')
    expect(extractChapterText(doc)).toEqual({ text: '', nodeLengths: [] })
  })
})

describe('findMatches', () => {
  it('finds case-insensitive contains matches by default', () => {
    const matches = findMatches('Hello hELLo world HELLO', 'hello')
    expect(matches).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 11 },
      { start: 18, end: 23 },
    ])
  })

  it('respects matchCase', () => {
    expect(findMatches('Hello hello HELLO', 'hello', { matchCase: true })).toEqual([{ start: 6, end: 11 }])
  })

  it('matches CJK text verbatim regardless of case mode', () => {
    const text = '他是一个高中生，高中生活很精彩'
    expect(findMatches(text, '高中')).toEqual([
      { start: 4, end: 6 },
      { start: 8, end: 10 },
    ])
  })

  it('matches regex patterns and honors matchCase', () => {
    const text = 'abc123 DEF456 def789'
    expect(findMatches(text, '[a-z]+\\d+', { mode: 'regex', matchCase: true })).toEqual([
      { start: 0, end: 6 },
      { start: 14, end: 20 },
    ])
    expect(findMatches(text, '[a-z]+\\d+', { mode: 'regex' })).toHaveLength(3)
  })

  it('skips empty regex matches', () => {
    const matches = findMatches('ab', 'a*', { mode: 'regex', matchCase: true })
    expect(matches).toEqual([{ start: 0, end: 1 }])
  })

  it('returns no results for an invalid regex instead of throwing', () => {
    expect(findMatches('anything', '([', { mode: 'regex' })).toEqual([])
  })

  it('returns no results when there is no match', () => {
    expect(findMatches('春宵一刻值千金', '不存在')).toEqual([])
  })

  it('returns no results for empty text or query', () => {
    expect(findMatches('', 'q')).toEqual([])
    expect(findMatches('text', '')).toEqual([])
  })
})

describe('makeExcerpt', () => {
  it('slices pre, match and post around the hit', () => {
    const excerpt = makeExcerpt('他是一个高中生', 4, 6)
    expect(excerpt).toEqual({ pre: '他是一个', match: '高中', post: '生' })
  })

  it('caps context at 50 chars with an ellipsis', () => {
    const text = `${'前'.repeat(60)}命中${'后'.repeat(60)}`
    const excerpt = makeExcerpt(text, 60, 62)
    expect(excerpt.pre.startsWith('…')).toBe(true)
    expect(excerpt.pre).toHaveLength(51)
    expect(excerpt.post.endsWith('…')).toBe(true)
    expect(excerpt.post).toHaveLength(51)
    expect(excerpt.match).toBe('命中')
  })

  it('normalizes whitespace in the context but keeps the match verbatim', () => {
    const excerpt = makeExcerpt('一\n\n  二命中三\n四', 6, 8)
    expect(excerpt.pre).toBe('一 二')
    expect(excerpt.match).toBe('命中')
    expect(excerpt.post).toBe('三 四')
  })

  it('omits ellipses when the context fits', () => {
    const excerpt = makeExcerpt('短上下文匹配短', 4, 6)
    expect(excerpt.pre).toBe('短上下文')
    expect(excerpt.post).toBe('短')
  })
})

describe('offsetsToRange', () => {
  it('maps a plain-text span back to a DOM range', () => {
    const doc = parseXhtml(`${XHTML_HEAD}<p>春宵</p><p>一刻<b>值</b>千金</p>${XHTML_TAIL}`)
    const range = offsetsToRange(doc, 2, 6)
    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('一刻值千')
  })

  it('returns null when the span is out of range', () => {
    const doc = parseXhtml(`${XHTML_HEAD}<p>短</p>${XHTML_TAIL}`)
    expect(offsetsToRange(doc, 0, 10)).toBeNull()
    expect(offsetsToRange(doc, -1, 1)).toBeNull()
  })

  it('ignores script text like extraction does', () => {
    const doc = parseXhtml(`${XHTML_HEAD}<script>var x = 1;</script><p>正文</p>${XHTML_TAIL}`)
    const range = offsetsToRange(doc, 0, 2)
    expect(range!.toString()).toBe('正文')
  })
})

describe('getChapterText', () => {
  const makeBook = (loadSectionText: (href: string) => Promise<string | null>) => ({
    sections: [{ id: 'a.xhtml' }, { id: 'b.xhtml', linear: 'no' }],
    loadSectionText,
  })

  it('loads raw markup through book.loadSectionText and caches per (book, chapter)', async () => {
    const loadSectionText = vi.fn(async () => `${XHTML_HEAD}<p>正文</p>${XHTML_TAIL}`)
    const book = makeBook(loadSectionText)
    const first = await getChapterText(book, 0)
    const second = await getChapterText(book, 0)
    expect(first?.text).toBe('正文')
    expect(second).toBe(first)
    expect(loadSectionText).toHaveBeenCalledTimes(1)
    expect(loadSectionText).toHaveBeenCalledWith('a.xhtml')
  })

  it('falls back to lenient HTML parsing for malformed XHTML', async () => {
    const book = makeBook(async () => '<html><body><p>容错正文')
    expect((await getChapterText(book, 0))?.text).toBe('容错正文')
  })

  it('resolves null and retries after a failed load', async () => {
    let calls = 0
    const book = makeBook(async () => {
      calls++
      if (calls === 1) throw new Error('network')
      return `${XHTML_HEAD}<p>重试成功</p>${XHTML_TAIL}`
    })
    expect(await getChapterText(book, 0)).toBeNull()
    expect((await getChapterText(book, 0))?.text).toBe('重试成功')
    expect(calls).toBe(2)
  })

  it('resolves null when loadSectionText is unavailable', async () => {
    expect(await getChapterText({ sections: [{ id: 'a.xhtml' }] }, 0)).toBeNull()
  })
})
