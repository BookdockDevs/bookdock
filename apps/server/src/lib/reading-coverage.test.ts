import { describe, expect, it } from 'vitest'

import { projectReadingCoverage, readingCompatibleRevisions } from './reading-coverage'

describe('reading coverage projection', () => {
  it('scales a known append without changing the stored contribution', () => {
    const intervals: [number, number][] = [[0, 0.5]]
    expect(projectReadingCoverage(intervals, { revisionId: 'old', wordCount: 1000 }, {
      revisionId: 'new', wordCount: 2000, compatibleRevisionIds: ['old'],
    })).toEqual({ intervals: [[0, 0.25]], unaligned: false })
    expect(intervals).toEqual([[0, 0.5]])
  })

  it('excludes incompatible or unknown provenance while preserving equivalent content', () => {
    const target = { revisionId: 'new', wordCount: 2000, compatibleRevisionIds: [], equivalentRevisionIds: ['same-bytes'] }
    expect(projectReadingCoverage([[0.1, 0.5]], { revisionId: 'replaced', wordCount: 1000 }, target)).toEqual({ intervals: [], unaligned: true })
    expect(projectReadingCoverage([[0.1, 0.5]], { revisionId: null, wordCount: 1000 }, target)).toEqual({ intervals: [], unaligned: true })
    expect(projectReadingCoverage([[0.1, 0.5]], { revisionId: 'same-bytes', wordCount: 2000 }, target)).toEqual({ intervals: [[0.1, 0.5]], unaligned: false })
    expect(projectReadingCoverage([[0.1, 0.5]], { revisionId: null, wordCount: 1000 }, { revisionId: null, wordCount: 1000, compatibleRevisionIds: [] })).toEqual({ intervals: [[0.1, 0.5]], unaligned: false })
  })

  it('retains verified ancestry through metadata-only revisions', () => {
    expect(readingCompatibleRevisions({ readingCompatibleRevisions: ['r1', 'r1', 99] }, 'r2')).toEqual(['r1', 'r2'])
  })
})
