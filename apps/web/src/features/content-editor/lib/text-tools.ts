import { fallbackTxtChapters, normalizeTxtText, predictTxtContinuationStart, scanTxtChapterBoundaries, type TocRulePattern } from '@bookdock/shared'

import type { EditorUnit } from './editor-draft'

function newUnitId() {
  return `tool-${globalThis.crypto.randomUUID()}`
}

export function previewTextChapters(text: string, patterns: readonly TocRulePattern[], alreadyNormalized = false): EditorUnit[] {
  const normalized = alreadyNormalized ? text : normalizeTxtText(text)
  const scanned = scanTxtChapterBoundaries(normalized, patterns)
  const boundaries = scanned.length > 0 ? scanned : fallbackTxtChapters(normalized)
  return boundaries.map((chapter) => ({
    id: newUnitId(), title: chapter.title,
    content: normalized.slice(chapter.contentStartOffset, chapter.endOffset), level: chapter.level,
  }))
}

export function predictContinuationStartIndex(existing: readonly EditorUnit[], candidates: readonly EditorUnit[]): number {
  return predictTxtContinuationStart(existing, candidates)
}

