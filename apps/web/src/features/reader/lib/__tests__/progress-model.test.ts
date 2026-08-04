import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import {
  buildChapterPercentRanges,
  chapterAtPercent,
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
