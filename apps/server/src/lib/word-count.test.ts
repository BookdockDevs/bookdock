import { describe, it, expect } from 'vitest'

import { countWords } from './word-count'

describe('countWords', () => {
  it('counts each CJK char as one word', () => {
    expect(countWords('你好世界')).toBe(4)
  })

  it('counts each latin/digit run as one word', () => {
    expect(countWords('hello world')).toBe(2)
    expect(countWords('abc123')).toBe(1)
  })

  it('counts mixed CJK and latin text', () => {
    expect(countWords('我有3个apple')).toBe(5)
  })

  it('ignores whitespace, newlines and ideographic spaces', () => {
    expect(countWords(' 你 好 \n\t 世 界 ')).toBe(4)
    expect(countWords('你　好')).toBe(2)
  })

  it('counts full-width punctuation but not ASCII punctuation', () => {
    expect(countWords('你好，世界！')).toBe(6)
    expect(countWords('hello, world!')).toBe(2)
  })

  it('returns 0 for empty and whitespace-only text', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('  \n　 ')).toBe(0)
  })
})
