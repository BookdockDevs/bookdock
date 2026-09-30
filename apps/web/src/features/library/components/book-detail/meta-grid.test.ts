import { describe, expect, it } from 'vitest'

import { packMetaSpans, resolveMetaSpanClasses, resolveMetaValueSizeClasses } from './meta-grid'

function rowSums(spans: number[], cols: number): number[][] {
  const rows: number[][] = []
  let row: number[] = []
  let used = 0
  for (const s of spans) {
    row.push(s)
    used += s
    if (used === cols) {
      rows.push(row)
      row = []
      used = 0
    }
  }
  if (row.length > 0) rows.push(row)
  return rows
}

describe('packMetaSpans', () => {
  it('packs the reported case without holes: [1,1,1] + [1,2]', () => {
    const values = ['TXT', '2.7 MB', '75.1万字', '2026-09-24', '《红楼风华志》作者：嗷世巅锋（324）.txt']
    expect(packMetaSpans(values, 3)).toEqual([1, 1, 1, 1, 2])
  })

  it('keeps a short trailing file name on one cell instead of full width', () => {
    expect(packMetaSpans(['EPUB', '100 B', '1970-01-01', 'my-old-book.txt'], 3)).toEqual([1, 1, 1, 1])
  })

  it('squeezes a long trailing file name into one cell with two-line clamp', () => {
    const values = ['TXT', '160.9 KB', '4.3万字', '2026-09-24', '2026-09-30', '《前世杀我的仙子，今生是我的母亲》排版01_21连载_作品作者：编程浪子.txt']
    expect(packMetaSpans(values, 3)).toEqual([1, 1, 1, 1, 1, 1])
  })

  it('fills every non-last row exactly and never crosses rows', () => {
    const values = ['TXT', '2.7 MB', '75.1万字', '2026-09-24', '《红楼风华志》作者：嗷世巅锋（324）.txt']
    for (const cols of [2, 3]) {
      const spans = packMetaSpans(values, cols)
      expect(spans.every((s) => s >= 1 && s <= cols)).toBe(true)
      const rows = rowSums(spans, cols)
      for (let i = 0; i < rows.length - 1; i++) {
        expect(rows[i].reduce((a, b) => a + b, 0)).toBe(cols)
      }
    }
  })
})

describe('resolveMetaValueSizeClasses', () => {
  it('keeps single-line values at normal size', () => {
    const classes = resolveMetaValueSizeClasses(['TXT', '2.7 MB', '2026-09-24'])
    expect(classes.every((c) => c === '')).toBe(true)
  })

  it('shrinks a file name squeezed into one cell', () => {
    const classes = resolveMetaValueSizeClasses(['TXT', '160.9 KB', '4.3万字', '2026-09-24', '2026-09-30', '《前世杀我的仙子，今生是我的母亲》排版01_21连载_作品作者：编程浪子.txt'])
    expect(classes[5]).toContain('text-[13px]')
    expect(classes[3]).toBe('')
  })
})

describe('resolveMetaSpanClasses', () => {
  it('gives the long file name two cells on desktop', () => {
    const classes = resolveMetaSpanClasses(['TXT', '2.7 MB', '75.1万字', '2026-09-24', '《红楼风华志》作者：嗷世巅锋（324）.txt'])
    expect(classes[4]).toContain('sm:col-span-2')
  })
})
