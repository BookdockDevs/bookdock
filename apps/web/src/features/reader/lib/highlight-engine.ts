import type { HighlightRuleDef } from '@bookdock/shared'

import { collectHighlightSpans, HIGHLIGHT_LIMITS, mergeHighlightSpans, type HighlightSegment, type HighlightSpan } from '@/lib/highlight-match'

export const HIGHLIGHT_RULE_TIMEOUT_MS = 250
/** Upper bound for one section across all of its regex rules. The per-section
 *  budget grows with the rule count (one rule's slot each) so a long rule list
 *  is not starved by a fixed cap, but a pathological book still returns. */
export const HIGHLIGHT_SECTION_BUDGET_MS = 6000
export const MAX_HIGHLIGHT_PARAGRAPHS = 512
export const MAX_HIGHLIGHT_TEXT_LENGTH = 120_000
export const MAX_HIGHLIGHT_SPANS = 12_000

/** Why a regex rule produced nothing: only `timeout` means the rule was tried
 *  and cut short, which is worth reporting; a missing worker is reported once
 *  on its own. */
type RegexOutcome = { spans: HighlightSpan[][] | null; reason: 'ok' | 'timeout' | 'unavailable' }

export class HighlightEngine {
  private worker: Worker | null = null
  private generation = 0
  private queue: Promise<unknown> = Promise.resolve()
  private cancelMatching: (() => void) | null = null
  private reportedWorkerFailure = false
  private reportedTimeout = false

  run(paragraphs: string[], rules: HighlightRuleDef[]): Promise<HighlightSegment[][]> {
    const generation = this.generation
    const result = this.queue.then(() => this.runSection(paragraphs, rules, generation))
    this.queue = result.catch(() => undefined)
    return result
  }

  dispose(): void {
    this.generation++
    this.cancelMatching?.()
    this.worker?.terminate()
    this.worker = null
  }

  private async runSection(paragraphs: string[], rules: HighlightRuleDef[], generation: number): Promise<HighlightSegment[][]> {
    if (generation !== this.generation) return []
    let length = 0
    const bounded: string[] = []
    for (const text of paragraphs.slice(0, MAX_HIGHLIGHT_PARAGRAPHS)) {
      if (length + text.length > MAX_HIGHLIGHT_TEXT_LENGTH) break
      length += text.length
      bounded.push(text)
    }
    const spans: HighlightSpan[][] = bounded.map(() => [])
    let remaining = MAX_HIGHLIGHT_SPANS
    const started = performance.now()
    const budget = Math.min(HIGHLIGHT_RULE_TIMEOUT_MS * rules.length, HIGHLIGHT_SECTION_BUDGET_MS)
    let skipped = 0
    for (const [order, rule] of rules.slice(0, HIGHLIGHT_LIMITS.maxRules).entries()) {
      if (!rule.enabled || !remaining) continue
      if (rule.isRegex) {
        const timeout = Math.min(HIGHLIGHT_RULE_TIMEOUT_MS, budget - (performance.now() - started))
        if (timeout <= 0) {
          skipped += 1
          continue
        }
        const matched = await this.matchRegex(bounded, rule, order, remaining, timeout)
        if (generation !== this.generation) return []
        if (!matched.spans) {
          // A timed-out rule keeps the rest of the list going; count it so the
          // chapter does not silently look like "this rule matches nothing".
          if (matched.reason === 'timeout') skipped += 1
          continue
        }
        for (let index = 0; index < matched.spans.length && remaining > 0; index++) {
          const next = matched.spans[index]!.slice(0, Math.min(remaining, HIGHLIGHT_LIMITS.maxSpansPerParagraph - spans[index]!.length))
          spans[index]!.push(...next)
          remaining -= next.length
        }
      } else {
        for (let index = 0; index < bounded.length && remaining > 0; index++) {
          const next = collectHighlightSpans(bounded[index]!, [rule], order)
            .slice(0, Math.min(remaining, HIGHLIGHT_LIMITS.maxSpansPerParagraph - spans[index]!.length))
          spans[index]!.push(...next)
          remaining -= next.length
        }
      }
    }
    if (skipped) this.reportTimeout(skipped)
    return bounded.map((text, index) => mergeHighlightSpans(text, spans[index]!))
  }

  private matchRegex(paragraphs: string[], rule: HighlightRuleDef, order: number, limit: number, timeout: number): Promise<RegexOutcome> {
    let worker: Worker
    try {
      worker = this.worker ??= new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      this.reportWorkerFailure()
      return Promise.resolve({ spans: null, reason: 'unavailable' })
    }
    return new Promise((resolve) => {
      const finish = (spans: HighlightSpan[][] | null, reason: RegexOutcome['reason']) => {
        clearTimeout(timer)
        this.cancelMatching = null
        worker.onmessage = worker.onerror = worker.onmessageerror = null
        if (!spans) {
          worker.terminate()
          this.worker = null
        }
        resolve({ spans, reason })
      }
      const timer = setTimeout(() => finish(null, 'timeout'), timeout)
      this.cancelMatching = () => finish(null, 'timeout')
      worker.onmessage = (event: MessageEvent<HighlightSpan[][]>) => finish(event.data, 'ok')
      worker.onerror = worker.onmessageerror = () => {
        // A worker that fails to load (a dev-server reload mid-HMR, a blocked
        // module) silently drops every regex rule, which reads as "the rule is
        // on but nothing is highlighted". Surface it once instead of guessing.
        this.reportWorkerFailure()
        finish(null, 'unavailable')
      }
      try {
        worker.postMessage({ paragraphs, rule, order, limit })
      } catch {
        this.reportWorkerFailure()
        finish(null, 'unavailable')
      }
    })
  }

  private reportWorkerFailure(): void {
    if (this.reportedWorkerFailure) return
    this.reportedWorkerFailure = true
    console.debug('[bd] highlight worker unavailable; regex rules are skipped until it loads again')
  }

  private reportTimeout(skipped: number): void {
    if (this.reportedTimeout) return
    this.reportedTimeout = true
    console.debug(`[bd] highlight: ${skipped} regex rule(s) timed out or ran out of budget in this section`)
  }
}
