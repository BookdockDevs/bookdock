import { describe, expect, it } from 'vitest'

// @ts-expect-error plain vendored ESM without type declarations
import { search } from '../../public/foliate-js/search.js'

describe('foliate search compatibility', () => {
  it('keeps excerpt context across text nodes', () => {
    const results = [...search(
      ['前文'.repeat(30), '目标', '后文'.repeat(30)],
      '目标',
      { mode: 'contains' },
    )]

    expect(results).toHaveLength(1)
    expect(results[0].excerpt.pre).toContain('前文')
    expect(results[0].excerpt.match).toBe('目标')
    expect(results[0].excerpt.post).toContain('后文')
  })

  it('supports nearby-words matches and separate highlight ranges', () => {
    const results = [...search(
      ['alpha one beta'],
      'alpha beta',
      { mode: 'nearby-words', nearbyWords: 2 },
    )]

    expect(results).toHaveLength(1)
    expect(results[0].subRanges).toHaveLength(2)
    expect(results[0].excerpt.match).toBe('alpha one beta')
  })

  it('keeps the legacy regex option as an alias for regex mode', () => {
    const results = [...search(['ab', 'xc'], 'b.c', { regex: true })]

    expect(results).toHaveLength(1)
    expect(results[0].range).toEqual({
      startIndex: 0,
      startOffset: 1,
      endIndex: 1,
      endOffset: 2,
    })
  })
})
