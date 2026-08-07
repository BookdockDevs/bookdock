import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import {
  buildChapterPercentRanges,
  chapterAtPercent,
  chapterIndexAtFraction,
  sectionFractionBoundaries,
  readingRateOf,
  totalPagesOf,
  pageOfPercent,
  pageAlignedPercent,
  DragModeDetector,
  CHARS_PER_PAGE,
} from '../progress-model'
import type { Chapter } from '@bookdock/shared'

function chapter(wordCount: number, title = '章'): Chapter {
  return { id: `ch-${title}`, title, level: 1, startOffset: 0, endOffset: 100, wordCount }
}

const chapters = [chapter(100, '第一章'), chapter(200, '第二章'), chapter(300, '第三章')]

describe('buildChapterPercentRanges', () => {
  it('maps word counts to percent ranges', () => {
    const ranges = buildChapterPercentRanges(chapters)!
    expect(ranges).toHaveLength(3)
    expect(ranges[0].startPct).toBeCloseTo(0)
    expect(ranges[0].endPct).toBeCloseTo(100 / 6)
    expect(ranges[1].startPct).toBeCloseTo(100 / 6)
    expect(ranges[2].endPct).toBeCloseTo(100)
  })

  it('returns null for empty/missing/zero word counts', () => {
    expect(buildChapterPercentRanges(undefined)).toBeNull()
    expect(buildChapterPercentRanges([])).toBeNull()
    expect(buildChapterPercentRanges([chapter(0)])).toBeNull()
    expect(buildChapterPercentRanges([{ ...chapter(10), wordCount: undefined }])).toBeNull()
  })
})

describe('chapterAtPercent', () => {
  const ranges = buildChapterPercentRanges(chapters)!

  it('finds the owning chapter, clamping 100 to the last', () => {
    expect(chapterAtPercent(ranges, 0)!.index).toBe(0)
    expect(chapterAtPercent(ranges, 16)!.index).toBe(0)
    expect(chapterAtPercent(ranges, 49)!.index).toBe(1)
    expect(chapterAtPercent(ranges, 99.9)!.index).toBe(2)
    expect(chapterAtPercent(ranges, 100)!.index).toBe(2)
  })

  it('returns null without ranges', () => {
    expect(chapterAtPercent(null, 50)).toBeNull()
  })
})

describe('sectionFractionBoundaries', () => {
  it('builds cumulative byte fractions', () => {
    expect(sectionFractionBoundaries([100, 100, 200])).toEqual([0.25, 0.5, 1])
  })

  it('returns null for empty or all-zero sizes', () => {
    expect(sectionFractionBoundaries([])).toBeNull()
    expect(sectionFractionBoundaries([0, 0])).toBeNull()
  })
})

describe('chapterIndexAtFraction', () => {
  // byte model: two real sections plus one zero-size (skipped) section
  const boundaries = sectionFractionBoundaries([100, 0, 100, 200])!

  it('lands inside the section containing the fraction', () => {
    expect(chapterIndexAtFraction(boundaries, 0)).toBe(0)
    expect(chapterIndexAtFraction(boundaries, 12.5)).toBe(0)
    expect(chapterIndexAtFraction(boundaries, 25.1)).toBe(2)
    expect(chapterIndexAtFraction(boundaries, 75)).toBe(3)
  })

  it('a fraction exactly on a boundary lands on the next section (foliate semantics)', () => {
    expect(chapterIndexAtFraction(boundaries, 25)).toBe(2)
    expect(chapterIndexAtFraction(boundaries, 50)).toBe(3)
  })

  it('skips zero-size sections via duplicate boundaries', () => {
    // 24.9% is inside section 0; the zero-size section 1 has no span of its own
    expect(chapterIndexAtFraction(boundaries, 24.9)).toBe(0)
  })

  it('100% falls on the last section; clamps out-of-range', () => {
    expect(chapterIndexAtFraction(boundaries, 100)).toBe(3)
    expect(chapterIndexAtFraction(boundaries, 150)).toBe(3)
    expect(chapterIndexAtFraction(boundaries, -5)).toBe(0)
  })

  it('returns null without boundaries', () => {
    expect(chapterIndexAtFraction(null, 50)).toBeNull()
  })
})

describe('readingRateOf', () => {
  // 10 samples at 60s spacing, 1% of the book per minute -> 1/6000 per ms
  function steadySamples(count = 10, perMinute = 0.01) {
    const samples = []
    for (let i = 0; i < count; i++) {
      samples.push({ fraction: i * perMinute, at: 1_000_000 + i * 60_000 })
    }
    return samples
  }

  it('returns null with too few samples', () => {
    expect(readingRateOf(undefined)).toBeNull()
    expect(readingRateOf([{ fraction: 0, at: 0 }])).toBeNull()
    expect(readingRateOf(steadySamples(3))).toBeNull()
  })

  it('derives the median pairwise rate from a steady window', () => {
    const rate = readingRateOf(steadySamples(10))!
    expect(rate).toBeCloseTo(0.01 / 60_000)
  })

  it('drops pairs that span idle gaps (Δt beyond the cap)', () => {
    const samples = steadySamples(8)
    // 30-minute idle gap in the middle: those pairs must not drag the rate to ~0
    samples[4].at += 30 * 60_000
    for (let i = 5; i < samples.length; i++) samples[i].at += 30 * 60_000
    const rate = readingRateOf(samples)!
    expect(rate).toBeCloseTo(0.01 / 60_000)
  })

  it('drops backward pairs and is robust to a fast-scroll burst', () => {
    const samples = steadySamples(10)
    // one burst: 5% of the book in 10s (much faster than the median pace)
    samples[5].fraction = samples[4].fraction + 0.05
    samples[5].at = samples[4].at + 10_000
    // a backward blip pair
    samples[7].fraction = samples[6].fraction - 0.001
    const rate = readingRateOf(samples)!
    // median of 9 pairs: 4 below, 4 above the steady value -> still steady
    expect(rate).toBeCloseTo(0.01 / 60_000)
  })
})

describe('page math', () => {
  it('derives total pages from word count at CHARS_PER_PAGE', () => {
    expect(totalPagesOf(800)).toBe(1)
    expect(totalPagesOf(801)).toBe(2)
    expect(totalPagesOf(undefined)).toBe(1)
    expect(totalPagesOf(0)).toBe(1)
    expect(CHARS_PER_PAGE).toBe(800)
  })

  it('maps percent to 1-based pages and back (page-aligned percent)', () => {
    expect(pageOfPercent(0, 100)).toBe(1)
    expect(pageOfPercent(100, 100)).toBe(100)
    expect(pageOfPercent(50, 100)).toBe(50)
    expect(pageOfPercent(50.4, 100)).toBe(50)
    expect(pageOfPercent(50.6, 100)).toBe(51)
    // clamping
    expect(pageOfPercent(-10, 100)).toBe(1)
    expect(pageOfPercent(200, 100)).toBe(100)
    expect(pageAlignedPercent(50.4, 100)).toBeCloseTo(50)
  })
})

describe('DragModeDetector', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('starts coarse and switches to fine after sustained slow movement', () => {
    const d = new DragModeDetector()
    d.move(10)
    vi.advanceTimersByTime(100)
    d.move(10.5) // slow: dv < 1.5 over 100ms
    expect(d.get()).toBe('coarse')
    vi.advanceTimersByTime(300)
    expect(d.get()).toBe('fine')
  })

  it('fast movement keeps coarse and cancels the pending switch', () => {
    const d = new DragModeDetector()
    d.move(10)
    vi.advanceTimersByTime(100)
    d.move(10.5) // slow → arms the timer
    vi.advanceTimersByTime(50)
    d.move(30) // fast → cancels
    vi.advanceTimersByTime(300)
    expect(d.get()).toBe('coarse')
  })

  it('once fine, stays fine until reset', () => {
    const d = new DragModeDetector()
    d.move(10)
    vi.advanceTimersByTime(100)
    d.move(10.5)
    vi.advanceTimersByTime(300)
    expect(d.get()).toBe('fine')
    d.move(50) // fast move in fine mode does not revert
    expect(d.get()).toBe('fine')
    d.reset()
    expect(d.get()).toBe('coarse')
  })
})
