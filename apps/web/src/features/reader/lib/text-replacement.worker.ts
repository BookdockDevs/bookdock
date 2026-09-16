import { applyRuleToRuns, type ReplacementRuleLike, type TextRun } from '@bookdock/shared'

interface ReplacementWorkerRequest {
  runs: TextRun[]
  rules: ReplacementRuleLike[]
}

self.onmessage = (event: MessageEvent<ReplacementWorkerRequest>) => {
  const runs = event.data.runs.map((run) => ({ ...run }))
  for (const rule of event.data.rules) {
    try {
      applyRuleToRuns(runs, rule)
    } catch {
      // A malformed rule is isolated to itself; the remaining rules still run.
    }
  }
  self.postMessage({ runs })
}
