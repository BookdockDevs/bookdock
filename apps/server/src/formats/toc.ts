import { pickTxtTocRule } from '@bookdock/shared'

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
  return pickTxtTocRule(rules, sample)?.id ?? null
}
