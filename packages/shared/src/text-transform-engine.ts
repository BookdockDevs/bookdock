/**
 * Pure text-transform matching primitives, shared by the browser render
 * pipeline (apps/web text-transforms.ts, DOM traversal stays there) and the
 * server-side TXT export engine (apps/server). One implementation = the two
 * sides can never drift apart on regex flags, case sensitivity or the
 * point-patch offset disambiguation.
 */

export interface TransformRuleLike {
  id: string
  pattern: string | null
  replacement: string | null
  isRegex: boolean
  caseSensitive: boolean
}

export interface TextRun {
  text: string
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Apply one pattern rule to a single text run. A broken rule (e.g. a regex the
// server validation let through) must not block the chapter — return the text
// unchanged. Literal + caseSensitive uses split/join so `$` in the replacement
// is never interpreted; literal + insensitive escapes the pattern; regex uses
// String.replace with `g`/`gi` and native `$1` capture-group support.
export function applyRuleToText(text: string, rule: TransformRuleLike): string {
  const pattern = rule.pattern ?? ''
  if (!pattern) return text
  const replacement = rule.replacement ?? ''
  try {
    if (rule.isRegex) {
      return text.replace(new RegExp(pattern, rule.caseSensitive ? 'g' : 'gi'), replacement)
    }
    if (!rule.caseSensitive) {
      return text.replace(new RegExp(escapeRegExp(pattern), 'gi'), () => replacement)
    }
    return text.split(pattern).join(replacement)
  } catch {
    return text
  }
}

// Point-patch anchoring (P2): the snapshot is searched across the runs in
// order (their concatenation is the section's text content — the same
// coordinate system the renderer's textContentOffset walks), and the
// occurrence whose start lies closest to the recorded textOffset wins (exact
// position when rules haven't shifted, nearest when they have — never a blind
// first match, so repeated text keeps its patch on the right spot). Returns
// the run and local offset to replace, or null when the snapshot is gone
// (invalid patch — skipped, never misapplied).
export function findPointMatch(
  runs: TextRun[],
  snapshot: string,
  textOffset: number,
  caseSensitive: boolean,
): { runIndex: number; local: number } | null {
  if (!snapshot || textOffset == null || runs.length === 0) return null
  const wanted = caseSensitive ? snapshot : snapshot.toLocaleLowerCase()
  let best: { runIndex: number; local: number; dist: number } | null = null
  let global = 0
  for (let i = 0; i < runs.length; i++) {
    const text = runs[i].text
    const searchable = caseSensitive ? text : text.toLocaleLowerCase()
    let from = 0
    while (from <= searchable.length - wanted.length) {
      const at = searchable.indexOf(wanted, from)
      if (at < 0) break
      const dist = Math.abs(global + at - textOffset)
      if (!best || dist < best.dist) best = { runIndex: i, local: at, dist }
      from = at + 1
    }
    global += text.length
  }
  return best ? { runIndex: best.runIndex, local: best.local } : null
}

// Match count of one pattern rule within a single text run — the per-section
// countPatternMatches accumulates these. Same semantics as applyRuleToText.
export function countRuleInText(text: string, rule: TransformRuleLike): number {
  const pattern = rule.pattern ?? ''
  if (!pattern) return 0
  try {
    if (rule.isRegex) {
      return text.match(new RegExp(pattern, rule.caseSensitive ? 'g' : 'gi'))?.length ?? 0
    }
    if (!rule.caseSensitive) {
      const hay = text.toLocaleLowerCase()
      const needle = pattern.toLocaleLowerCase()
      let count = 0
      let from = 0
      while (from <= hay.length - needle.length) {
        const at = hay.indexOf(needle, from)
        if (at < 0) break
        count++
        from = at + 1
      }
      return count
    }
    return text.split(pattern).length - 1
  } catch {
    return 0
  }
}
