import { describe, expect, it } from 'vitest'

// @ts-expect-error plain vendored ESM without type declarations
import * as epubcfi from '../../public/foliate-js/epubcfi.js'

import { compareCfiPosition, cfiRangesIntersect, cfiRangesOverlap, type CfiModule } from '../features/reader/lib/cfi-overlap'

const cfi = epubcfi as CfiModule

// Ranges in chapter /6/4 over a single text node: chars [start, end)
const range = (start: number, end: number, chapter = 4) =>
  `epubcfi(/6/${chapter}!/4/2,/1:${start},/1:${end})`

const overlap = (a: string, b: string) => cfiRangesOverlap(cfi, a, b)
const intersect = (a: string, b: string) => cfiRangesIntersect(cfi, a, b)

describe('cfiRangesOverlap', () => {
  it('compares CFIs with different indirection depths without throwing', () => {
    expect(() => cfi.compare(
      'epubcfi(/6/2)',
      'epubcfi(/6/2!/4/2)',
    )).not.toThrow()
  })

  it('detects partial overlap in the same chapter', () => {
    expect(overlap(range(0, 10), range(5, 15))).toBe(true)
    expect(overlap(range(5, 15), range(0, 10))).toBe(true)
  })

  it('detects containment in both directions', () => {
    expect(overlap(range(0, 20), range(5, 10))).toBe(true)
    expect(overlap(range(5, 10), range(0, 20))).toBe(true)
  })

  it('treats identical ranges as overlapping', () => {
    expect(overlap(range(3, 8), range(3, 8))).toBe(true)
  })

  it('rejects disjoint ranges, including touching boundaries', () => {
    expect(overlap(range(0, 5), range(6, 10))).toBe(false)
    expect(overlap(range(0, 5), range(5, 10))).toBe(false)
    expect(overlap(range(5, 10), range(0, 5))).toBe(false)
  })

  it('rejects ranges in different chapters', () => {
    expect(overlap(range(0, 10, 4), range(0, 10, 6))).toBe(false)
  })

  it('handles a point CFI against a range', () => {
    expect(overlap('epubcfi(/6/4!/4/2/1:5)', range(0, 10))).toBe(true)
    expect(overlap('epubcfi(/6/4!/4/2/1:15)', range(0, 10))).toBe(false)
  })

  it('falls back to equality for non-EPUB CFIs', () => {
    expect(overlap('txt:100', 'txt:100')).toBe(true)
    expect(overlap('txt:100', 'txt:200')).toBe(false)
    expect(overlap('txt:100', range(0, 10))).toBe(false)
  })
})

describe('cfiRangesIntersect', () => {
  it('includes a bookmark at the current visible-range boundary', () => {
    expect(intersect('epubcfi(/6/4!/4/2/1:0)', range(0, 10))).toBe(true)
    expect(intersect('epubcfi(/6/4!/4/2/1:10)', range(0, 10))).toBe(true)
  })

  it('still rejects ranges from different chapters', () => {
    expect(intersect(range(0, 10, 4), range(0, 10, 6))).toBe(false)
  })
})

describe('compareCfiPosition', () => {
  const point = (offset: number, chapter = 4) => `epubcfi(/6/${chapter}!/4/2/1:${offset})`

  it('orders text offsets numerically, not as strings', () => {
    // "1234" < "567" as strings — the reversal this comparator exists to fix
    expect(compareCfiPosition(point(567), point(1234))).toBeLessThan(0)
    expect(compareCfiPosition(point(1234), point(567))).toBeGreaterThan(0)
    expect(compareCfiPosition(point(9), point(10))).toBeLessThan(0)
  })

  it('orders node indices before offsets', () => {
    expect(compareCfiPosition('epubcfi(/6/4!/4/2/1:9)', 'epubcfi(/6/4!/4/4/1:1)')).toBeLessThan(0)
  })

  it('uses the start point of a range CFI', () => {
    expect(compareCfiPosition(range(5, 15), point(9))).toBeLessThan(0)
    expect(compareCfiPosition(range(5, 15), point(3))).toBeGreaterThan(0)
  })

  it('orders different chapters by spine index numerically', () => {
    // chapter /6/16 vs /6/4: string compare would put 16 first
    expect(compareCfiPosition(point(0, 4), point(0, 16))).toBeLessThan(0)
  })

  it('compares end points when toEnd is set', () => {
    // same start: start comparison ties, end comparison orders the shorter range first
    expect(compareCfiPosition(range(100, 200), range(100, 1500))).toBe(0)
    expect(compareCfiPosition(range(100, 200), range(100, 1500), true)).toBeLessThan(0)
    // a point's end is its start
    expect(compareCfiPosition(point(100), range(100, 200), true)).toBeLessThan(0)
  })

  it('falls back to string compare for non-EPUB positions', () => {
    expect(compareCfiPosition('chapter:4:0.5', 'chapter:4:0.5')).toBe(0)
    expect(compareCfiPosition('txt:100', 'txt:200')).toBeLessThan(0)
  })

  it('agrees in sign with epubcfi.compare on collapsed start points', () => {
    const samples = [
      point(567), point(1234), point(9),
      range(5, 15), range(0, 3),
      'epubcfi(/6/16!/4/2/1:1)', 'epubcfi(/6/4!/4/4/1:1)',
    ]
    for (const a of samples) {
      for (const b of samples) {
        const expected = Math.sign(cfi.compare(cfi.collapse(a), cfi.collapse(b)))
        expect(Math.sign(compareCfiPosition(a, b))).toBe(expected)
      }
    }
  })
})
