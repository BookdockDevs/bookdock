import { describe, expect, it } from 'vitest'

import {
  findSearchMatches,
  highlightRuleSchema,
  reTocSchema,
  tocPreviewSchema,
  tocRuleCreateSchema,
  tocRuleUpdateSchema,
} from './index'

describe('regex schema validation alignment', () => {
  it('rejects Legado inline flags in TOC rule schemas', () => {
    const pattern = { level: 1, regex: '(?i)^chapter\\s+\\d+', replacement: null, enabled: true }

    expect(tocRuleCreateSchema.safeParse({ name: 'test', patterns: [pattern] }).success).toBe(false)
    expect(tocRuleUpdateSchema.safeParse({ patterns: [pattern] }).success).toBe(false)
    expect(tocPreviewSchema.safeParse({ customPatterns: [pattern] }).success).toBe(false)
    expect(reTocSchema.safeParse({ customPatterns: [pattern] }).success).toBe(false)
  })

  it('accepts standard JS multiline regexes in TOC rule schemas', () => {
    const pattern = { level: 1, regex: '^第[一二三]+章\\s+.+$', replacement: null, enabled: true }

    expect(tocRuleCreateSchema.safeParse({ name: 'test', patterns: [pattern] }).success).toBe(true)
    expect(tocPreviewSchema.safeParse({ customPatterns: [pattern] }).success).toBe(true)
  })

  it('validates highlightRuleSchema pattern only when isRegex is true', () => {
    const base = { id: 'r1', name: 'Rule', enabled: true }

    expect(highlightRuleSchema.safeParse({ ...base, pattern: '([unclosed', isRegex: false }).success).toBe(true)
    expect(highlightRuleSchema.safeParse({ ...base, pattern: '([unclosed', isRegex: true }).success).toBe(false)
    expect(highlightRuleSchema.safeParse({ ...base, pattern: '(?i)hello', isRegex: true }).success).toBe(false)
    expect(highlightRuleSchema.safeParse({ ...base, pattern: '第(\\d+)章', isRegex: true }).success).toBe(true)
  })
})

describe('findSearchMatches', () => {
  it('matches substrings with flexible whitespace fallback and limit', () => {
    expect(findSearchMatches('alpha\n  beta', 'alpha beta')).toEqual([
      { start: 0, end: 12 },
    ])
    expect(findSearchMatches('foo foo foo', 'foo', { limit: 2 })).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ])
  })

  it('matches regexes with case sensitivity and skips invalid or empty matches', () => {
    expect(findSearchMatches('Abc abc', 'abc', { mode: 'regex', matchCase: false })).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ])
    expect(findSearchMatches('Abc abc', 'abc', { mode: 'regex', matchCase: true })).toEqual([
      { start: 4, end: 7 },
    ])
    expect(findSearchMatches('abc', '[unclosed', { mode: 'regex' })).toEqual([])
    expect(findSearchMatches('ab', '.*', { mode: 'regex' })).toEqual([
      { start: 0, end: 2 },
    ])
  })
})
