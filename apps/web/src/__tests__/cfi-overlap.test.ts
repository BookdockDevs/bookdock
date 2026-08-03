import { describe, expect, it } from 'vitest'

// @ts-expect-error plain vendored ESM without type declarations
import * as epubcfi from '../../public/foliate-js/epubcfi.js'

import { cfiRangesOverlap, type CfiModule } from '../features/reader/lib/cfi-overlap'

const cfi = epubcfi as CfiModule

// Ranges in chapter /6/4 over a single text node: chars [start, end)
const range = (start: number, end: number, chapter = 4) =>
  `epubcfi(/6/${chapter}!/4/2,/1:${start},/1:${end})`

const overlap = (a: string, b: string) => cfiRangesOverlap(cfi, a, b)

describe('cfiRangesOverlap', () => {
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
