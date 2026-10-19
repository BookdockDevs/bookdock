import type { ReadingCoverageInterval } from '@bookdock/shared'

import { mergeInterval } from './intervals'

export interface ReadingCoverageBasis {
  revisionId: string | null
  wordCount: number | null
  compatibleRevisionIds: readonly string[]
  equivalentRevisionIds?: readonly string[]
}

export function readingCompatibleRevisions(meta: Record<string, unknown>, previousId: string): string[] {
  const inherited = Array.isArray(meta.readingCompatibleRevisions)
    ? meta.readingCompatibleRevisions.filter((id): id is string => typeof id === 'string') : []
  return [...new Set([...inherited, previousId])]
}

export function projectReadingCoverage(
  intervals: readonly ReadingCoverageInterval[],
  source: { revisionId: string | null; wordCount: number | null },
  target: ReadingCoverageBasis,
): { intervals: ReadingCoverageInterval[]; unaligned: boolean } {
  if (!intervals.length) return { intervals: [], unaligned: false }
  const equivalent = source.revisionId === target.revisionId
    || (source.revisionId !== null && target.equivalentRevisionIds?.includes(source.revisionId))
  let scale = 1
  if (!equivalent) {
    if (source.revisionId === null || !target.compatibleRevisionIds.includes(source.revisionId)
      || source.wordCount === null || target.wordCount === null || source.wordCount <= 0 || target.wordCount < source.wordCount) {
      return { intervals: [], unaligned: true }
    }
    scale = source.wordCount / target.wordCount
  }
  return {
    intervals: intervals.reduce<ReadingCoverageInterval[]>((merged, [start, end]) => mergeInterval(merged, [Math.min(start, end) * scale, Math.max(start, end) * scale]), []),
    unaligned: false,
  }
}
