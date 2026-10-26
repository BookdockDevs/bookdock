import { describe, expect, it } from 'vitest'

import { processReaderSearchChapter, type SearchInput } from './reader-search.worker'
import { scanChapter } from './reader-search.service'

function searchInput(overrides: Partial<SearchInput> = {}): SearchInput {
  return {
    markup: '<html><body><p>first <b>second</b></p><p>third</p></body></html>',
    query: 'second third',
    mode: 'contains',
    matchCase: false,
    conversion: 'off',
    replacements: [],
    spineHref: 'Text/chapter.xhtml',
    ...overrides,
  }
}

describe('reader search worker', () => {
  it('matches the reader text projection across inline nodes and virtual paragraph spaces', () => {
    const result = processReaderSearchChapter(searchInput())
    expect(result.text).toBe('first second third')
    expect(result.matches).toEqual([{ start: 6, end: 18, excerpt: { pre: 'first ', match: 'second third', post: '' } }])
  })

  it('applies text replacements and Chinese conversion to search-local content', () => {
    const result = processReaderSearchChapter(searchInput({
      markup: '<html><body><p><span>傳</span><i>奇</i>故事</p></body></html>',
      query: '传奇',
      conversion: 'simplified',
      replacements: [{
        id: 'rule-1', matchType: 'pattern', pattern: '故事', replacement: '篇章', isRegex: false,
        applyTo: 'content', enabled: true, spineHref: null, textOffset: null, originalText: null,
      }],
    }))
    expect(result.text).toBe('传奇篇章')
    expect(result.matches[0]).toMatchObject({ start: 0, end: 2, excerpt: { match: '传奇' } })
    expect(searchInput().markup).toContain('second')
    const traditional = processReaderSearchChapter(searchInput({
      markup: '<html><body><p>传奇</p></body></html>', query: '傳奇', conversion: 'traditional',
    }))
    expect(traditional.matches[0]?.excerpt.match).toBe('傳奇')
  })

  it('keeps case-sensitive contains and regex modes distinct', () => {
    const insensitive = processReaderSearchChapter(searchInput({ query: 'SECOND' }))
    const sensitive = processReaderSearchChapter(searchInput({ query: 'SECOND', matchCase: true }))
    const regex = processReaderSearchChapter(searchInput({ query: 'sec.nd', mode: 'regex' }))
    expect(insensitive.matches).toHaveLength(1)
    expect(sensitive.matches).toEqual([])
    expect(regex.matches).toHaveLength(1)
  })

  it('applies anchored point replacements before matching', () => {
    const result = processReaderSearchChapter(searchInput({
      markup: '<html><body><p>before target after</p></body></html>',
      query: 'substitute',
      replacements: [{
        id: 'point-1', matchType: 'point', pattern: null, replacement: 'substitute', isRegex: false,
        applyTo: 'content', enabled: true, spineHref: 'Text/chapter.xhtml', textOffset: 7, originalText: 'target',
      }],
    }))
    expect(result.text).toBe('before substitute after')
    expect(result.matches[0]).toMatchObject({ start: 7, end: 17, excerpt: { match: 'substitute' } })
  })

  it('runs pathological regex in a terminable worker and honors cancellation', async () => {
    const request = {
      revisionId: 'revision-1', query: '^(a+)+$', mode: 'regex' as const, matchCase: true,
      chineseConversion: 'off' as const, replacements: [],
    }
    const started = Date.now()
    const timeout = await scanChapter(`<html><body><p>${'a'.repeat(200_000)}!</p></body></html>`, 'chapter.xhtml', request, new AbortController().signal)
    expect(timeout.error).toBe('regex-timeout')
    expect(Date.now() - started).toBeLessThan(5000)

    const controller = new AbortController()
    const canceled = scanChapter('<html><body><p>needle</p></body></html>', 'chapter.xhtml', {
      ...request, query: 'needle', mode: 'contains',
    }, controller.signal)
    controller.abort()
    await expect(canceled).resolves.toEqual({ matches: [] })
  }, 8000)
})
