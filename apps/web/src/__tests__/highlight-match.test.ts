import { describe, expect, it } from 'vitest'

import type { HighlightRuleDef } from '@bookdock/shared'

import {
  HIGHLIGHT_LIMITS,
  applyManualYield,
  compileHighlightRegex,
  computeHighlightSegments,
  highlightLineOf,
  matchRuleInParagraph,
  ruleGroupCount,
} from '../lib/highlight-match'

function rule(overrides: Partial<HighlightRuleDef> & { id?: string }): HighlightRuleDef {
  return {
    id: overrides.id ?? 'r',
    name: 'rule',
    pattern: '三体',
    isRegex: false,
    enabled: true,
    ...overrides,
  }
}

describe('compileHighlightRegex', () => {
  it('compiles valid patterns with unicode + global flags', () => {
    const regex = compileHighlightRegex('「[^」]*」')
    expect(regex).not.toBeNull()
    expect(regex!.global).toBe(true)
    expect(regex!.unicode).toBe(true)
  })

  it('rejects invalid patterns', () => {
    expect(compileHighlightRegex('[unclosed')).toBeNull()
  })
})

describe('matchRuleInParagraph', () => {
  it('returns exact literal offsets for repeated text', () => {
    const { matches } = matchRuleInParagraph('三体好看，三体真好看', rule({ pattern: '三体' }))
    expect(matches.map((m) => [m.start, m.end])).toEqual([[0, 2], [5, 7]])
  })

  it('gives exact capture-group offsets via hasIndices (no substring re-search)', () => {
    const { matches } = matchRuleInParagraph('我在读《三体》和《球状闪电》', rule({ pattern: '《(.+?)》', isRegex: true }))
    expect(matches).toHaveLength(2)
    expect(matches[0]!.start).toBe(3)
    expect(matches[0]!.end).toBe(7)
    expect(matches[0]!.groups[0]).toEqual([4, 6])
    expect(matches[1]!.start).toBe(8)
    expect(matches[1]!.end).toBe(14)
    expect(matches[1]!.groups[0]).toEqual([9, 13])
  })

  it('marks non-participating groups as null', () => {
    const { matches } = matchRuleInParagraph('aab', rule({ pattern: 'a(b)?', isRegex: true }))
    expect(matches).toHaveLength(2)
    expect(matches[0]!.groups[0]).toBeNull()
    expect(matches[1]!.groups[0]).toEqual([2, 3])
  })

  it('skips zero-length matches', () => {
    const { matches } = matchRuleInParagraph('a𠮷b', rule({ pattern: 'a*', isRegex: true }))
    expect(matches).toEqual([{ start: 0, end: 1, groups: [] }])
  })

  it('keeps surrogate pairs intact when a pattern splits one', () => {
    // Without the `u` flag semantics a pattern like `.` may end mid-pair; the
    // snap keeps the drawn Range on whole characters.
    const text = 'a𠮷b'
    const { matches } = matchRuleInParagraph(text, rule({ pattern: 'a.', isRegex: true }))
    expect(matches).toHaveLength(1)
    expect(text.slice(matches[0]!.start, matches[0]!.end)).toBe('a𠮷')
  })

  it('caps matches per rule', () => {
    const text = '三'.repeat(HIGHLIGHT_LIMITS.maxMatchesPerRule + 10)
    const { matches } = matchRuleInParagraph(text, rule({ pattern: '三', isRegex: false }))
    expect(matches).toHaveLength(HIGHLIGHT_LIMITS.maxMatchesPerRule)
  })

  it('yields no matches for an invalid regex (rule isolated)', () => {
    expect(matchRuleInParagraph('abc', rule({ pattern: '[bad', isRegex: true })).matches).toEqual([])
  })
})

describe('computeHighlightSegments', () => {
  it('colors a literal hit', () => {
    const segments = computeHighlightSegments('我在读《三体》。', [rule({ style: { textColor: '#0EA5E9' } })])
    expect(segments).toEqual([{ start: 4, end: 6, textColor: '#0EA5E9' }])
  })

  it('merges adjacent identical segments', () => {
    const segments = computeHighlightSegments('三体三体', [
      rule({ id: 'a', pattern: '三', style: { textColor: '#111111' } }),
      rule({ id: 'b', pattern: '体', style: { textColor: '#111111' } }),
    ])
    expect(segments).toEqual([{ start: 0, end: 4, textColor: '#111111' }])
  })

  it('runs every enabled rule past the former 64-rule cap', () => {
    // One distinct CJK char per rule keeps matches disjoint: the last rule in
    // the list must still paint, not be dropped by a count cap.
    const charOf = (i: number) => String.fromCharCode(0x4e00 + i)
    const rules = Array.from({ length: 80 }, (_, i) => rule({ id: `r${i}`, pattern: charOf(i), style: { textColor: `#0000${i.toString(16).padStart(2, '0')}` } }))
    const text = Array.from({ length: 80 }, (_, i) => charOf(i)).join('')
    const segments = computeHighlightSegments(text, rules)
    expect(segments).toHaveLength(80)
    expect(segments.at(-1)).toEqual({ start: 79, end: 80, textColor: '#00004f' })
  })

  it('resolves same-effect conflicts by list order but lets different effects coexist', () => {
    // 三体: rule A (earlier) wins the color; rule B still contributes nothing
    // else. 《》: only rule B styles color → gold. Background comes from B
    // where A left it unset.
    const text = '《三体》'
    const segments = computeHighlightSegments(text, [
      rule({ id: 'a', pattern: '三体', style: { textColor: '#0EA5E9' } }),
      rule({ id: 'b', pattern: '《(.+?)》', isRegex: true, style: { textColor: '#B8860B', backgroundColor: '#FFF7E0' } }),
    ])
    expect(segments).toEqual([
      { start: 0, end: 1, textColor: '#B8860B', backgroundColor: '#FFF7E0' },
      { start: 1, end: 3, textColor: '#0EA5E9', backgroundColor: '#FFF7E0' },
      { start: 3, end: 4, textColor: '#B8860B', backgroundColor: '#FFF7E0' },
    ])
  })

  it('lets a later rule contribute an effect an earlier rule left unset', () => {
    const segments = computeHighlightSegments('三体', [
      rule({ id: 'a', pattern: '三体', style: { textColor: '#0EA5E9' } }),
      rule({ id: 'b', pattern: '三体', style: { backgroundColor: '#FFF7E0', underline: true } }),
    ])
    // legacy `underline: true` still reads as a solid line in the text color
    expect(segments).toEqual([{ start: 0, end: 2, textColor: '#0EA5E9', backgroundColor: '#FFF7E0', line: { style: 'solid' } }])
  })

  it('applies the dialogue acceptance scenario: whole-sentence background plus inner colors', () => {
    const text = '「我在读《三体》。」'
    const segments = computeHighlightSegments(text, [
      rule({ id: 'dialogue', pattern: '「[^」]*」', isRegex: true, style: { backgroundColor: '#F5E3B8' } }),
      rule({ id: 'santi', pattern: '三体', style: { textColor: '#0EA5E9' } }),
      rule({ id: 'marks', pattern: '《(.+?)》', isRegex: true, style: { textColor: '#B8860B' } }),
    ])
    // 「我在读《 / 三体 / 。》。」 — the sentence carries the dialogue
    // background everywhere, 三体 keeps its cyan (earlier rule), 《》 and the
    // inner title keep gold from the marks rule.
    expect(segments).toEqual([
      { start: 0, end: 4, backgroundColor: '#F5E3B8' },
      { start: 4, end: 5, backgroundColor: '#F5E3B8', textColor: '#B8860B' },
      { start: 5, end: 7, backgroundColor: '#F5E3B8', textColor: '#0EA5E9' },
      { start: 7, end: 8, backgroundColor: '#F5E3B8', textColor: '#B8860B' },
      { start: 8, end: 10, backgroundColor: '#F5E3B8' },
    ])
  })

  it('prefers the lowest covering group over the whole-match style of the same rule (field-by-field)', () => {
    const segments = computeHighlightSegments('《三体》', [
      rule({ pattern: '《(.+?)》', isRegex: true, style: { textColor: '#B8860B', backgroundColor: '#FFF7E0' }, groups: [{ index: 1, style: { textColor: '#0EA5E9' } }] }),
    ])
    expect(segments).toEqual([
      { start: 0, end: 1, textColor: '#B8860B', backgroundColor: '#FFF7E0' },
      { start: 1, end: 3, textColor: '#0EA5E9', backgroundColor: '#FFF7E0' },
      { start: 3, end: 4, textColor: '#B8860B', backgroundColor: '#FFF7E0' },
    ])
  })

  it('disables single rules without touching the others', () => {
    const segments = computeHighlightSegments('三体', [
      rule({ id: 'a', enabled: false, style: { textColor: '#111111' } }),
      rule({ id: 'b', style: { textColor: '#222222' } }),
    ])
    expect(segments).toEqual([{ start: 0, end: 2, textColor: '#222222' }])
  })

  it('an invalid rule only disables itself', () => {
    const segments = computeHighlightSegments('三体', [
      rule({ id: 'bad', pattern: '[bad', isRegex: true, style: { textColor: '#111111' } }),
      rule({ id: 'good', style: { textColor: '#222222' } }),
    ])
    expect(segments).toEqual([{ start: 0, end: 2, textColor: '#222222' }])
  })

  it('skips paragraphs beyond the length cap', () => {
    const long = 'x'.repeat(HIGHLIGHT_LIMITS.maxParagraphLength + 1)
    expect(computeHighlightSegments(long, [rule({ style: { textColor: '#111111' } })])).toEqual([])
  })

  it('counts capture groups including named ones but not non-capturing groups', () => {
    expect(ruleGroupCount({ pattern: 'a(?:b)(c)(?<name>d)', isRegex: true })).toBe(2)
    expect(ruleGroupCount({ pattern: 'abc', isRegex: false })).toBe(0)
    expect(ruleGroupCount({ pattern: '[bad', isRegex: true })).toBe(0)
  })
})

describe('line effect', () => {
  it('lets a line and a color from different rules coexist per effect', () => {
    const text = '《三体》'
    const segments = computeHighlightSegments(text, [
      rule({ id: 'title', pattern: '《(.+?)》', isRegex: true, style: { textColor: '#B8860B' } }),
      rule({ id: 'wave', pattern: '三体', style: { line: { style: 'wavy', color: '#B45309' } } }),
    ])
    expect(segments).toEqual([
      { start: 0, end: 1, textColor: '#B8860B' },
      { start: 1, end: 3, textColor: '#B8860B', line: { style: 'wavy', color: '#B45309' } },
      { start: 3, end: 4, textColor: '#B8860B' },
    ])
  })

  it('keeps the line style of the earlier rule and the color of the later one', () => {
    const segments = computeHighlightSegments('三体', [
      rule({ id: 'a', style: { line: { style: 'dashed' } } }),
      rule({ id: 'b', style: { line: { style: 'wavy', color: '#B45309' }, backgroundColor: '#FFF7E0' } }),
    ])
    expect(segments).toEqual([{ start: 0, end: 2, backgroundColor: '#FFF7E0', line: { style: 'dashed' } }])
  })

  it('treats a legacy explicit off as the winning line effect', () => {
    const segments = computeHighlightSegments('三体', [
      rule({ id: 'a', style: { underline: false, textColor: '#111111' } }),
      rule({ id: 'b', style: { line: { style: 'wavy' } } }),
    ])
    expect(segments).toEqual([{ start: 0, end: 2, textColor: '#111111' }])
  })

  it('normalizes the legacy boolean and prefers an explicit line', () => {
    expect(highlightLineOf({ underline: true })).toEqual({ style: 'solid' })
    expect(highlightLineOf({ underline: false })).toBeNull()
    expect(highlightLineOf({})).toBeUndefined()
    expect(highlightLineOf({ underline: true, line: { style: 'wavy' } })).toEqual({ style: 'wavy' })
  })
})

describe('applyManualYield', () => {
  it('suppresses only the automatic line where a manual line mark sits', () => {
    const segments = computeHighlightSegments('《三体》', [
      rule({ pattern: '《(.+?)》', isRegex: true, style: { textColor: '#B8860B', line: { style: 'wavy' } } }),
    ])
    // the manual note covers 三体 only
    const yielded = applyManualYield(segments, [{ start: 1, end: 3, line: true, background: false }])
    expect(yielded).toEqual([
      { start: 0, end: 1, textColor: '#B8860B', line: { style: 'wavy' } },
      { start: 1, end: 3, textColor: '#B8860B' },
      { start: 3, end: 4, textColor: '#B8860B', line: { style: 'wavy' } },
    ])
  })

  it('suppresses only the automatic background where a manual marker sits', () => {
    const segments = computeHighlightSegments('《三体》', [
      rule({ pattern: '《(.+?)》', isRegex: true, style: { textColor: '#B8860B', backgroundColor: '#FFF7E0' } }),
    ])
    const yielded = applyManualYield(segments, [{ start: 1, end: 3, line: false, background: true }])
    expect(yielded).toEqual([
      { start: 0, end: 1, textColor: '#B8860B', backgroundColor: '#FFF7E0' },
      { start: 1, end: 3, textColor: '#B8860B' },
      { start: 3, end: 4, textColor: '#B8860B', backgroundColor: '#FFF7E0' },
    ])
  })

  it('drops everything a manual marker covers when the match only had a background', () => {
    const segments = computeHighlightSegments('三体', [rule({ style: { backgroundColor: '#F5E3B8' } })])
    expect(applyManualYield(segments, [{ start: 0, end: 2, line: false, background: true }])).toEqual([])
  })

  it('leaves segments untouched outside every interval and merges the rest', () => {
    const segments = computeHighlightSegments('「三体」', [
      rule({ id: 'a', pattern: '「(三体)」', isRegex: true, style: { backgroundColor: '#F5E3B8' }, groups: [{ index: 1, style: { textColor: '#0F766E' } }] }),
    ])
    expect(applyManualYield(segments, [])).toBe(segments)
    const yielded = applyManualYield(segments, [{ start: 0, end: 1, line: false, background: true }])
    // the leading bracket loses its fill and has nothing left to paint
    expect(yielded).toEqual([
      { start: 1, end: 3, backgroundColor: '#F5E3B8', textColor: '#0F766E' },
      { start: 3, end: 4, backgroundColor: '#F5E3B8' },
    ])
  })
})
