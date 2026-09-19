import { and, eq, isNull, or } from 'drizzle-orm'

import { applyPointMatch, applyRuleToRuns, findPointMatch, type TextRun } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { textReplacementOverrides, textReplacements } from '../../db/schema'

export interface BookReplacementRule {
  id: string
  matchType: 'pattern' | 'point'
  pattern: string | null
  replacement: string | null
  isRegex: boolean
  applyTo: 'content' | 'title' | 'both'
  effectiveEnabled: boolean
  spineHref: string | null
  textOffset: number | null
  originalText: string | null
}

export async function loadEffectiveBookReplacementRules(userId: string, bookId: string): Promise<BookReplacementRule[]> {
  const db = getDb()
  const rows = await db.select().from(textReplacements).where(
    and(
      eq(textReplacements.userId, userId),
      or(
        and(eq(textReplacements.matchType, 'pattern'), isNull(textReplacements.bookId)),
        eq(textReplacements.bookId, bookId),
      ),
    ),
  ).all()
  const overrides = await db.select().from(textReplacementOverrides).where(
    and(eq(textReplacementOverrides.userId, userId), eq(textReplacementOverrides.bookId, bookId)),
  ).all()
  const overrideByReplacement = new Map(overrides.map((override) => [override.replacementId, override]))

  return rows.map((row) => {
    const override = row.matchType === 'pattern' && row.bookId === null
      ? overrideByReplacement.get(row.id)
      : undefined
    return {
      id: row.id,
      matchType: row.matchType,
      pattern: row.pattern,
      replacement: row.replacement,
      isRegex: row.isRegex === 1,
      applyTo: row.applyTo as BookReplacementRule['applyTo'],
      effectiveEnabled: override ? override.enabled === 1 : row.enabled === 1,
      spineHref: row.spineHref,
      textOffset: row.textOffset,
      originalText: row.originalText,
    }
  })
}

export function applyChapterReplacements(runs: TextRun[], rules: BookReplacementRule[], spineHref: string): void {
  const patternRules = rules.filter((rule) => rule.matchType === 'pattern' && rule.effectiveEnabled && rule.pattern)
  const titleRuns = runs.slice(0, 1)
  const contentRuns = runs.slice(1)
  for (const rule of patternRules) {
    try {
      if (rule.applyTo !== 'content') applyRuleToRuns(titleRuns, rule)
      if (rule.applyTo !== 'title') applyRuleToRuns(contentRuns, rule)
    } catch {
      // One malformed rule must not make a chapter unavailable.
    }
  }

  for (const patch of rules) {
    if (patch.matchType !== 'point' || !patch.effectiveEnabled || patch.spineHref !== spineHref) continue
    const snapshot = patch.originalText ?? ''
    if (!snapshot || patch.textOffset == null) continue
    const found = findPointMatch(runs, snapshot, patch.textOffset)
    if (!found) continue
    applyPointMatch(runs, found, patch.replacement ?? '')
  }
}
