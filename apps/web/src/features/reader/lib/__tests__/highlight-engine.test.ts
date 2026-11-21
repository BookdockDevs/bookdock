import { afterEach, describe, expect, it, vi } from 'vitest'

import type { HighlightRuleDef } from '@bookdock/shared'

import { collectHighlightSpans } from '@/lib/highlight-match'

import { HighlightEngine, HIGHLIGHT_RULE_TIMEOUT_MS } from '../highlight-engine'

const base = { enabled: true, isRegex: true, style: { textColor: '#ff0000' } }

describe('highlight engine', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps completed matches and continues to the next regex after one times out', async () => {
    vi.useFakeTimers()
    const terminated = vi.fn()
    class TestWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null
      terminate = terminated
      constructor() {
        queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }))
      }
      postMessage({ paragraphs, rule, order }: { paragraphs: string[]; rule: HighlightRuleDef; order: number }) {
        if (rule.id === 'slow') return
        this.onmessage?.({ data: paragraphs.map((text) => collectHighlightSpans(text, [rule], order)) })
      }
    }
    vi.stubGlobal('Worker', TestWorker)
    const engine = new HighlightEngine()
    const result = engine.run(['abc'], [
      { ...base, id: 'first', name: 'First', pattern: 'a' },
      { ...base, id: 'slow', name: 'Slow', pattern: 'b' },
      { ...base, id: 'last', name: 'Last', pattern: 'c' },
    ])
    await vi.advanceTimersByTimeAsync(HIGHLIGHT_RULE_TIMEOUT_MS)
    await expect(result).resolves.toEqual([[
      { start: 0, end: 1, textColor: '#ff0000' },
      { start: 2, end: 3, textColor: '#ff0000' },
    ]])
    expect(terminated).toHaveBeenCalledOnce()
    engine.dispose()
  })

  it('applies literal rules without executing regex when workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined)
    const engine = new HighlightEngine()
    await expect(engine.run(['ab'], [
      { ...base, id: 'regex', name: 'Regex', pattern: 'a' },
      { ...base, id: 'literal', name: 'Literal', pattern: 'b', isRegex: false },
    ])).resolves.toEqual([[{ start: 1, end: 2, textColor: '#ff0000' }]])
  })

  it('waits for slow worker boot beyond per-rule timeout before matching regexes', async () => {
    vi.useFakeTimers()
    class SlowBootWorker {
      onmessage: ((event: { data: unknown }) => void) | null = null
      terminate = vi.fn()
      constructor() {
        setTimeout(() => this.onmessage?.({ data: { type: 'ready' } }), HIGHLIGHT_RULE_TIMEOUT_MS + 100)
      }
      postMessage({ paragraphs, rule, order }: { paragraphs: string[]; rule: HighlightRuleDef; order: number }) {
        this.onmessage?.({ data: paragraphs.map((text) => collectHighlightSpans(text, [rule], order)) })
      }
    }
    vi.stubGlobal('Worker', SlowBootWorker)
    const engine = new HighlightEngine()
    const result = engine.run(['abc'], [{ ...base, id: 'first', name: 'First', pattern: 'a' }])
    await vi.advanceTimersByTimeAsync(HIGHLIGHT_RULE_TIMEOUT_MS + 100)
    await expect(result).resolves.toEqual([[{ start: 0, end: 1, textColor: '#ff0000' }]])
    engine.dispose()
  })
})
