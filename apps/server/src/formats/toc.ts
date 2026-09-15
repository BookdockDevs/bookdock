/**
 * TOC-rule scoring and selection. Pure functions only — callers own the sample
 * text and the database.
 *
 * Auto-scoring answers "which of my presets splits this book best". Each
 * preset's patterns are scored on a 512KB sample; a preset wins when its
 * chapter count is clearly above both the misjudge floor and the current best.
 * The user can pin a preset per book (books.meta.tocRuleId); auto-scoring only
 * runs when no pin exists.
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

interface ScoredPreset extends TocScore {
  /** Number of levels with at least one reliable candidate. */
  matchedLevels: number
}

/**
 * `$1`-replacement semantics for cleaning a matched line into a title.
 * `$1`..`$9` refer to capture groups; anything else is kept literally.
 */
export function applyTitleReplacement(match: RegExpExecArray, replacement?: string | null): string {
  if (!replacement) return match[0]
  return replacement.replace(/\$(\d)/g, (_, n: string) => match[Number(n)] ?? '')
}

/**
 * Score a single pattern against a sample.
 * Walks all matches; a match counts as a chapter candidate when it starts the
 * sample or follows >1000 chars of content, and as a misjudge when it follows
 * <100 chars. `last` tracks the previous match position and is updated on
 * every match so short false positives are counted separately.
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
  const scored = scorePresetDetails(patterns, sample)
  return { csNum: scored.csNum, numE: scored.numE }
}

function scorePresetDetails(patterns: TocPatternLike[], sample: string): ScoredPreset {
  let csNum = 0
  let numE = 0
  const matchedLevels = new Set<number>()
  for (const pattern of patterns) {
    if (pattern.enabled === false) continue
    const score = scorePattern(pattern, sample)
    csNum += score.csNum
    numE += score.numE
    if (score.csNum > 0) matchedLevels.add(pattern.level)
  }
  return {
    csNum,
    numE,
    matchedLevels: matchedLevels.size,
  }
}

/**
 * Pick the best enabled preset for a sample.
 * Candidates need csNum >= numE*3 and normally must beat the current best by
 * more than 2. A preset that reliably matches more than one level may replace
 * a near-tied preset (within 2 candidates), because a volume heading can be
 * sparse in the sample while still proving that the hierarchy exists. For a
 * single matched level, configured rule order remains the tie-breaker; the
 * scanner later compacts any unobserved levels.
 * Rules are expected to be pre-sorted by sortOrder ascending (lower wins
 * ties). Returns the rule id, or null when nothing clears the bar.
 */
export function pickTocRule(rules: TocRuleLike[], sample: string): string | null {
  let maxNum = 0
  let bestId: string | null = null
  let bestMatchedLevels = 0

  for (const rule of rules) {
    if (rule.patterns.length === 0) continue
    const { csNum, numE, matchedLevels } = scorePresetDetails(rule.patterns, sample)
    if (csNum < numE * 3) continue

    const clearlyBetter = csNum > maxNum + 2
    const structuredNearTie = bestId !== null && matchedLevels > bestMatchedLevels && csNum >= maxNum - 2
    if (clearlyBetter || structuredNearTie) {
      maxNum = csNum
      bestId = rule.id
      bestMatchedLevels = matchedLevels
    }
  }

  return bestId
}
