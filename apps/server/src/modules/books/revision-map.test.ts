import { describe, expect, it } from 'vitest'

import { composeRevisionMaps, createRevisionMap, mapRevisionOffset, projectRevisionCoverage } from './revision-map'
import { composeRevisionStructuralRanges } from './revision-map.persistence'

const passage = (label: string) => `${label}: ${Array.from({ length: 40 }, (_, index) => `${label}-段落文字${index}，保留内容用于锚点映射。`).join('')}`

describe('content revision maps', () => {
  it('maps a short exact passage only when it has one target occurrence', () => {
    expect(createRevisionMap('短句正文', '新增标题短句正文继续内容')).toEqual([
      { sourceStart: 0, sourceEnd: 4, targetStart: 4, targetEnd: 8 },
    ])
    expect(createRevisionMap('短句正文', '短句正文与短句正文重复')).toEqual([])
  })

  it('projects only mapped text and treats structural headings as covered across a split', () => {
    const segments = [
      { sourceStart: 0, sourceEnd: 5, targetStart: 2, targetEnd: 7, sourceSpineHref: 'old.xhtml', targetSpineHref: 'one.xhtml' },
      { sourceStart: 5, sourceEnd: 10, targetStart: 2, targetEnd: 7, sourceSpineHref: 'old.xhtml', targetSpineHref: 'two.xhtml' },
    ]

    expect(projectRevisionCoverage(
      [[0, 1]],
      [{ spineHref: 'old.xhtml', size: 10, textLength: 10 }],
      [{ spineHref: 'one.xhtml', size: 7, textLength: 7 }, { spineHref: 'two.xhtml', size: 7, textLength: 7 }],
      segments,
      [
        { spineHref: 'one.xhtml', start: 0, end: 2, sourceSpineHref: 'old.xhtml', sourceOffset: 0 },
        { spineHref: 'two.xhtml', start: 0, end: 2, sourceSpineHref: 'old.xhtml', sourceOffset: 5 },
      ],
    )).toEqual([[0, 1]])
  })

  it('never adds structural coverage when the source has no covered range', () => {
    const mapped = projectRevisionCoverage(
      [],
      [{ spineHref: 'old.xhtml', size: 10, textLength: 10 }],
      [{ spineHref: 'new.xhtml', size: 12, textLength: 12 }],
      [],
      [{ spineHref: 'new.xhtml', start: 0, end: 2, sourceSpineHref: 'old.xhtml', sourceOffset: 5 }],
    )

    expect(mapped).toEqual([])
  })

  it('composes structural ranges through successive revisions in both directions', () => {
    const priorSegments = [{ sourceSpineHref: 'old.xhtml', targetSpineHref: 'middle.xhtml', sourceStart: 0, sourceEnd: 10, targetStart: 0, targetEnd: 10 }]
    const directSegments = [{ sourceSpineHref: 'middle.xhtml', targetSpineHref: 'latest.xhtml', sourceStart: 0, sourceEnd: 10, targetStart: 3, targetEnd: 13 }]
    expect(composeRevisionStructuralRanges(
      [{ spineHref: 'middle.xhtml', start: 5, end: 7, sourceSpineHref: 'old.xhtml', sourceOffset: 5 }],
      priorSegments,
      directSegments,
      [{ spineHref: 'latest.xhtml', start: 0, end: 2, sourceSpineHref: 'middle.xhtml', sourceOffset: 6 }],
    )).toEqual([
      { spineHref: 'latest.xhtml', start: 8, end: 10, sourceSpineHref: 'old.xhtml', sourceOffset: 5 },
      { spineHref: 'latest.xhtml', start: 0, end: 2, sourceSpineHref: 'old.xhtml', sourceOffset: 6 },
    ])
  })

  it('maps unique unchanged text around inserted content without mapping the insertion', () => {
    const before = `${passage('第一段')}${passage('第二段')}`
    const inserted = '新增内容'.repeat(30)
    const after = `${passage('第一段')}${inserted}${passage('第二段')}`
    const segments = createRevisionMap(before, after)

    expect(mapRevisionOffset(segments, 10)).toBe(10)
    expect(mapRevisionOffset(segments, before.indexOf('第二段') + 5)).toBe(before.indexOf('第二段') + inserted.length + 5)
    expect(mapRevisionOffset(segments, before.length)).toBeNull()
  })

  it('maps a long pure append with one linear pass over shared text', () => {
    const source = Array.from({ length: 8_000 }, (_, index) =>
      `第${String(index).padStart(5, '0')}章，星光照亮河流与山脉，旅人记录独有的日期和故事内容。`,
    ).join('\n')
    const segments = createRevisionMap(source, `${source}尾部新增正文`)

    expect(segments).toEqual([{ sourceStart: 0, sourceEnd: source.length, targetStart: 0, targetEnd: source.length }])
  })

  it('composes correspondence across consecutive edits and does not map rewritten text', () => {
    const before = `${passage('前文')}${passage('中段')}${passage('后文')}`
    const intermediate = `${passage('前文')}${'新增段落'.repeat(24)}${passage('中段')}${passage('后文')}`
    const changed = passage('中段').replaceAll('中段-段落文字', '重写-全新内容')
    const after = `${passage('前文')}${'新增段落'.repeat(24)}${changed}${passage('后文')}`
    const first = createRevisionMap(before, intermediate)
    const second = createRevisionMap(intermediate, after)
    const composed = composeRevisionMaps(first, second)

    const beforeTail = before.indexOf('后文') + 7
    const expectedTail = after.indexOf('后文') + 7
    expect(mapRevisionOffset(composed, beforeTail)).toBe(expectedTail)
    const rewritten = before.indexOf('中段-段落文字') + 5
    expect(mapRevisionOffset(composed, rewritten)).toBeNull()
  })

  it('leaves repeated ambiguous passages unmapped', () => {
    const repeated = passage('重复')
    const segments = createRevisionMap(`${repeated}${repeated}`, `${repeated}${'插入'.repeat(40)}${repeated}`)
    expect(mapRevisionOffset(segments, 10)).toBeNull()
  })

  it('maps unique passages through a reorder', () => {
    const first = passage('第一章')
    const second = passage('第二章')
    const segments = createRevisionMap(`${first}${second}`, `${second}${first}`)

    expect(mapRevisionOffset(segments, 100)).toBe(second.length + 100)
    expect(mapRevisionOffset(segments, first.length + 100)).toBe(100)
  })

  it('composes cross-spine text offsets without mixing identical offsets from other files', () => {
    const composed = composeRevisionMaps(
      [{ sourceSpineHref: 'old.xhtml', targetSpineHref: 'middle.xhtml', sourceStart: 10, sourceEnd: 80, targetStart: 20, targetEnd: 90 }],
      [
        { sourceSpineHref: 'middle.xhtml', targetSpineHref: 'new.xhtml', sourceStart: 20, sourceEnd: 90, targetStart: 100, targetEnd: 170 },
        { sourceSpineHref: 'other.xhtml', targetSpineHref: 'wrong.xhtml', sourceStart: 20, sourceEnd: 90, targetStart: 0, targetEnd: 70 },
      ],
    )

    expect(composed).toEqual([{
      sourceSpineHref: 'old.xhtml', targetSpineHref: 'new.xhtml',
      sourceStart: 10, sourceEnd: 80, targetStart: 100, targetEnd: 170,
    }])
    expect(mapRevisionOffset(composed, 25, 'old.xhtml')).toBe(115)
    expect(mapRevisionOffset(composed, 25, 'other.xhtml')).toBeNull()
  })
})
