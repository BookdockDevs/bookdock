import type { HighlightRuleDef } from '@bookdock/shared'

import { collectHighlightSpans, type HighlightSpan } from '@/lib/highlight-match'

self.onmessage = (event: MessageEvent<{ paragraphs: string[]; rule: HighlightRuleDef; order: number; limit: number }>) => {
  const { paragraphs, rule, order, limit } = event.data
  const result: HighlightSpan[][] = []
  let remaining = limit
  for (const text of paragraphs) {
    if (!remaining) break
    const spans = collectHighlightSpans(text, [rule], order).slice(0, remaining)
    remaining -= spans.length
    result.push(spans)
  }
  self.postMessage(result)
}
