import { describe, expect, it } from 'vitest'

import { applyRuleToRuns, applyRuleToText, type TextRun } from './text-replacement-engine'

function runsOf(...texts: string[]): TextRun[] {
  return texts.map((text) => ({ text }))
}

function joined(runs: TextRun[]): string {
  return runs.map((run) => run.text).join('')
}

describe('applyRuleToRuns', () => {
  it('replaces a match that crosses run boundaries', () => {
    const runs = runsOf('before ', 'tar', 'get', ' after')
    applyRuleToRuns(runs, { id: 'r1', pattern: 'target', replacement: 'swap', isRegex: false })
    expect(joined(runs)).toBe('before swap after')
  })

  it('applies repeated edits at their original offsets', () => {
    // The second edit lands inside a run the first edit already rewrote, so
    // both edits must resolve against the pre-edit offsets.
    const runs = runsOf('x', 'ax', 'a')
    applyRuleToRuns(runs, { id: 'r2', pattern: 'xa', replacement: 'z', isRegex: false })
    expect(joined(runs)).toBe('zz')
  })

  it('replaces a match spanning more than two runs with a different length', () => {
    const runs = runsOf('a', 'b', 'c', 'd', 'e')
    applyRuleToRuns(runs, { id: 'r3', pattern: 'bcde', replacement: 'long-swap', isRegex: false })
    expect(joined(runs)).toBe('along-swap')
  })

  it('handles edits at the very start and end of the stream', () => {
    const runs = runsOf('head', '-', 'tail')
    applyRuleToRuns(runs, { id: 'r4', pattern: 'head', replacement: '', isRegex: false })
    expect(joined(runs)).toBe('-tail')
    applyRuleToRuns(runs, { id: 'r5', pattern: 'tail', replacement: 'end', isRegex: false })
    expect(joined(runs)).toBe('-end')
  })

  it('advances past zero-width regex matches', () => {
    const runs = runsOf('ab', 'cd')
    applyRuleToRuns(runs, { id: 'r6', pattern: '(?=b)', replacement: '·', isRegex: true })
    expect(joined(runs)).toBe('a·bcd')
  })

  it('matches the plain-string result when text is split into many runs', () => {
    const pattern = '光影'
    const text = ('前光影中光影后'.repeat(80))
    const runs: TextRun[] = []
    let remaining = text
    while (remaining) {
      const take = (remaining.length % 7) + 1
      runs.push({ text: remaining.slice(0, take) })
      remaining = remaining.slice(take)
    }
    const rule = { id: 'r7', pattern, replacement: '光·影', isRegex: false }
    applyRuleToRuns(runs, rule)
    expect(joined(runs)).toBe(applyRuleToText(text, rule))
  })
})
