import { applyRuleToRuns, type ReplacementRuleLike, type TextRun } from '@bookdock/shared/text-replacement-engine'

export interface ReplacementJob {
  groups: TextRun[][]
  rules: ReplacementRuleLike[]
}

self.onmessage = (event: MessageEvent<ReplacementJob[]>) => {
  const results = event.data.map(({ groups, rules }) => {
    for (const runs of groups) {
      for (const rule of rules) {
        try {
          applyRuleToRuns(runs, rule)
        } catch {
          // A malformed rule is isolated to itself; the remaining rules still run.
        }
      }
    }
    return groups
  })
  self.postMessage(results)
}
