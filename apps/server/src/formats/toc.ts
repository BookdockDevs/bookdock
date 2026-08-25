/**
 * TOC-rule scoring + selection, ported from legado's getTocRule (TextFile.kt).
 * Pure functions only — callers own the sample text and the DB.
 *
 * Auto-scoring answers "which of my presets splits this book best", mirroring
 * legado: each preset's patterns are scored on a 512KB sample; a preset wins
 * when its chapter count is clearly above both the misjudge floor and the
 * current best. The user can pin a preset per book (books.meta.tocRuleId);
 * auto-scoring only runs when no pin exists.
 */

/** Sample size (chars) read from the head of the normalized text. */
export const TOC_SAMPLE_SIZE = 512 * 1024

/** A bare pattern as stored in a TOC rule (level/regex/replacement/name/enabled). */
export type TocPatternLike = {
  level: number
  regex: string
  replacement?: string | null
  name?: string | null
  enabled?: boolean
}

export interface TocRuleLike {
  id: string
  patterns: TocPatternLike[]
}

export interface TocScore {
  /** Strongly-reliable chapter candidates (preceded by a large block). */
  csNum: number
  /** Likely misjudges (chapters preceded by a tiny block). */
  numE: number
}

/**
 * Legado's $1-replacement semantics for cleaning a matched line into a title.
 * `$1`..`$9` refer to capture groups; anything else is kept literally.
 */
export function applyTitleReplacement(match: RegExpExecArray, replacement?: string | null): string {
  if (!replacement) return match[0]
  return replacement.replace(/\$(\d)/g, (_, n: string) => match[Number(n)] ?? '')
}

/**
 * Score a single pattern against a sample (legado TextFile.kt analyze()).
 * Walks all matches; a match counts as a chapter candidate when it starts the
 * sample or follows >1000 chars of content, and as a misjudge when it follows
 * <100 chars. `last` tracks the previous match position and is updated on
 * every match (legado semantics). Mirrors legado's csNum/numE exactly.
 */
export function scorePattern(pattern: TocPatternLike, sample: string): TocScore {
  let re: RegExp
  try {
    re = new RegExp(pattern.regex, 'gm')
  } catch {
    return { csNum: 0, numE: 0 }
  }

  let csNum = 0
  let numE = 0
  let last = 0

  for (let m = re.exec(sample); m !== null; m = re.exec(sample)) {
    const len = m[0].length
    if (len === 0) {
      re.lastIndex++
      continue
    }
    const contentLength = m.index - last
    if (last === 0 || contentLength > 1000) {
      if (applyTitleReplacement(m, pattern.replacement).trim()) csNum++
    } else if (contentLength < 100) {
      numE++
    }
    last = m.index + len
  }

  return { csNum, numE }
}

/** Aggregate a preset's score from its enabled patterns. */
export function scorePreset(patterns: TocPatternLike[], sample: string): TocScore {
  let csNum = 0
  let numE = 0
  for (const pattern of patterns) {
    if (pattern.enabled === false) continue
    const score = scorePattern(pattern, sample)
    csNum += score.csNum
    numE += score.numE
  }
  return { csNum, numE }
}

/**
 * Pick the best enabled preset for a sample (legado getTocRule()).
 * Candidates need csNum >= numE*3; they must beat the current best by more
 * than 2. Stops early once a preset reaches maxNum > 70. Rules are expected to
 * be pre-sorted by sortOrder ascending (lower wins ties). Returns the rule id,
 * or null when nothing clears the bar.
 */
export function pickTocRule(rules: TocRuleLike[], sample: string): string | null {
  let maxNum = 0
  let bestId: string | null = null

  for (const rule of rules) {
    if (rule.patterns.length === 0) continue
    const { csNum, numE } = scorePreset(rule.patterns, sample)
    if (csNum >= numE * 3 && csNum > maxNum + 2) {
      maxNum = csNum
      bestId = rule.id
      if (maxNum > 70) break
    }
  }

  return bestId
}
