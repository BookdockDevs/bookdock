import { describe, expect, it, vi } from 'vitest'

import type { HighlightRuleDef } from '@bookdock/shared'

import { computeHighlightSegments } from '@/lib/highlight-match'
import {
  applyDocHighlights,
  clearDocHighlights,
  collectHighlightParagraphsFrom,
  collectYieldIntervals,
  createDocHighlightLayer,
  supportsCustomHighlights,
  type HighlightInkRange,
} from '../highlight-render'

// jsdom has no Custom Highlight API; a minimal stub exercises the real
// registration path (per-document registry + Range anchoring).
interface FakeHighlight {
  ranges: Range[]
}
// createHTMLDocument yields a defaultView-less document; anchor it to the
// jsdom window and stub the Custom Highlight API there.
function installFakeHighlightApi(doc: Document): Map<string, FakeHighlight> {
  const registry = new Map<string, FakeHighlight>()
  Object.defineProperty(doc, 'defaultView', { value: window, configurable: true })
  const view = window as unknown as {
    Highlight?: unknown
    CSS: { highlights?: Map<string, FakeHighlight> }
  }
  view.Highlight = class {
    ranges: Range[]
    constructor(...ranges: Range[]) {
      this.ranges = ranges
    }
  }
  view.CSS.highlights = registry
  return registry
}

function uninstallFakeHighlightApi(doc: Document): void {
  Object.defineProperty(doc, 'defaultView', { value: null, configurable: true })
  const view = window as unknown as { Highlight?: unknown; CSS: { highlights?: Map<string, FakeHighlight> } }
  delete view.Highlight
  delete view.CSS.highlights
}

function rule(overrides: Partial<HighlightRuleDef> & { id: string }): HighlightRuleDef {
  return {
    name: 'rule',
    pattern: '三体',
    isRegex: false,
    enabled: true,
    ...overrides,
  }
}

function buildDoc(html: string): Document {
  const doc = document.implementation.createHTMLDocument('test')
  doc.body.innerHTML = html
  return doc
}

describe('collectHighlightParagraphsFrom', () => {
  it('keeps separate paragraphs apart', () => {
    const doc = buildDoc('<p>第一段</p><p>第二段</p>')
    const paragraphs = collectHighlightParagraphsFrom(doc.body, doc)
    expect(paragraphs.map((p) => p.text)).toEqual(['第一段', '第二段'])
  })

  it('joins inline markup inside one paragraph and keeps node offsets', () => {
    const doc = buildDoc('<p>我在读<span>《三体》</span>。</p>')
    const [paragraph] = collectHighlightParagraphsFrom(doc.body, doc)
    expect(paragraph!.text).toBe('我在读《三体》。')
    expect(paragraph!.nodes).toHaveLength(3)
    expect(paragraph!.nodes[0]!.start).toBe(0)
    expect(paragraph!.nodes[1]!.start).toBe(3)
    expect(paragraph!.nodes[2]!.start).toBe(7)
  })

  it('splits at a hard br but not across CSS-wrapped lines', () => {
    const doc = buildDoc('<p>上行<br>下行</p><p>第三行</p>')
    const paragraphs = collectHighlightParagraphsFrom(doc.body, doc)
    expect(paragraphs.map((p) => p.text)).toEqual(['上行', '下行', '第三行'])
  })

  it('ignores script and style subtrees', () => {
    const doc = buildDoc('<style>.三体{}</style><p>正文三体</p><script>三体</script>')
    const paragraphs = collectHighlightParagraphsFrom(doc.body, doc)
    expect(paragraphs.map((p) => p.text)).toEqual(['正文三体'])
  })

  it('omits hidden inline content without breaking adjacent visible text', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>《三<span hidden>忽略</span><span style="display: none">忽略</span><em>体</em>》</p>'
    document.body.appendChild(root)
    try {
      expect(collectHighlightParagraphsFrom(root, document).map((paragraph) => paragraph.text)).toEqual(['《三体》'])
    } finally {
      root.remove()
    }
  })
})

describe('applyDocHighlights', () => {
  it('reports no support in a bare jsdom document', () => {
    const doc = buildDoc('<p>三体</p>')
    Object.defineProperty(doc, 'defaultView', { value: window, configurable: true })
    expect(supportsCustomHighlights(doc)).toBe(false)
  })

  it('registers ranges grouped by style signature and writes ::highlight rules', () => {
    const doc = buildDoc('<p>《三体》很好看</p>')
    const registry = installFakeHighlightApi(doc)
    const layer = createDocHighlightLayer('bd-hl-test')
    const paragraphs = collectHighlightParagraphsFrom(doc.body, doc)
    const segments = paragraphs.map((p) => computeHighlightSegments(p.text, [
      rule({ id: 'santi', pattern: '三体', style: { textColor: '#0EA5E9' } }),
      rule({ id: 'marks', pattern: '《(.+?)》', isRegex: true, style: { textColor: '#B8860B', backgroundColor: '#FFF7E0' } }),
    ]))
    expect(applyDocHighlights(doc, paragraphs, segments, layer)).toBe(true)
    expect(layer.names).toHaveLength(2)
    expect(layer.names).toEqual(['bd-hl-test-0', 'bd-hl-test-1'])
    const styleText = layer.styleEl!.textContent!
    expect(styleText).toContain('::highlight(bd-hl-test-0)')
    expect(styleText).toContain('color: #B8860B')
    // one Highlight object per style bucket, ranges anchored in the doc
    const highlights = [...registry.values()]
    expect(highlights).toHaveLength(2)
    const allRanges = highlights.flatMap((highlight) => highlight.ranges)
    expect(allRanges.length).toBeGreaterThanOrEqual(2)
    const painted = allRanges.map((range) => range.toString()).sort()
    // whole-match 《 and 》 in one bucket, the inner title (cyan from the
    // earlier rule) in the other
    expect(painted).toEqual(['《', '》', '三体'])
    uninstallFakeHighlightApi(doc)
  })

  it('spans a segment across the inline element boundary with one Range', () => {
    const doc = buildDoc('<p>我在读<span>《三体》</span>。</p>')
    installFakeHighlightApi(doc)
    const layer = createDocHighlightLayer()
    const paragraphs = collectHighlightParagraphsFrom(doc.body, doc)
    const segments = paragraphs.map((p) => computeHighlightSegments(p.text, [
      rule({ id: 'marks', pattern: '《(.+?)》', isRegex: true, style: { textColor: '#B8860B' } }),
    ]))
    applyDocHighlights(doc, paragraphs, segments, layer)
    // 《…》 crosses from the plain text node into the span's text node
    expect(paragraphs[0]!.nodes).toHaveLength(3)
    expect(segments[0]![0]).toMatchObject({ start: 3, end: 7 })
    uninstallFakeHighlightApi(doc)
  })

  it('clears registry names and the style element', () => {
    const doc = buildDoc('<p>三体</p>')
    const registry = installFakeHighlightApi(doc)
    const layer = createDocHighlightLayer()
    const paragraphs = collectHighlightParagraphsFrom(doc.body, doc)
    const segments = paragraphs.map((p) => computeHighlightSegments(p.text, [rule({ id: 'a', style: { textColor: '#111111' } })]))
    applyDocHighlights(doc, paragraphs, segments, layer)
    expect(layer.names).toHaveLength(1)
    clearDocHighlights(doc, layer)
    expect(layer.names).toHaveLength(0)
    expect(layer.styleEl).toBeNull()
    expect(registry.size).toBe(0)
    uninstallFakeHighlightApi(doc)
  })

  it('an empty segment list removes the previous paint', () => {
    const doc = buildDoc('<p>三体</p>')
    installFakeHighlightApi(doc)
    const layer = createDocHighlightLayer()
    const paragraphs = collectHighlightParagraphsFrom(doc.body, doc)
    applyDocHighlights(doc, paragraphs, paragraphs.map((p) => computeHighlightSegments(p.text, [rule({ id: 'a', style: { textColor: '#111111' } })])), layer)
    expect(layer.styleEl).not.toBeNull()
    applyDocHighlights(doc, paragraphs, paragraphs.map(() => []), layer)
    expect(layer.styleEl).toBeNull()
    expect(layer.names).toHaveLength(0)
    uninstallFakeHighlightApi(doc)
  })
})

describe('line effect painting', () => {
  it('sends the winning line to the ink overlay and keeps colors in CSS', () => {
    const doc = buildDoc('<p>三体</p>')
    installFakeHighlightApi(doc)
    const layer = createDocHighlightLayer()
    const paragraphs = collectHighlightParagraphsFrom(doc.body, doc)
    const segments = paragraphs.map((p) => computeHighlightSegments(p.text, [
      rule({ id: 'wavy', style: { line: { style: 'wavy', color: '#B45309' } } }),
      rule({ id: 'plain', pattern: '体', style: { line: { style: 'dashed' }, backgroundColor: '#FFF7E0' } }),
    ]))
    const setHighlightInk = vi.fn<(ranges: HighlightInkRange[]) => void>()
    applyDocHighlights(doc, paragraphs, segments, layer, { setHighlightInk })
    const styleText = layer.styleEl!.textContent!
    expect(styleText).toContain('background-color: #FFF7E0')
    expect(styleText).not.toContain('text-decoration')
    expect(setHighlightInk.mock.calls[0]![0].map(({ style, color, range }) => [style, color, range.toString()]))
      .toEqual([['squiggly', '#B45309', '三体']])
    clearDocHighlights(doc, layer)
    expect(setHighlightInk).toHaveBeenLastCalledWith([])
    uninstallFakeHighlightApi(doc)
  })

  it('still paints and clears ink without the Custom Highlight API', () => {
    const doc = buildDoc('<p>三体</p>')
    const layer = createDocHighlightLayer()
    const paragraphs = collectHighlightParagraphsFrom(doc.body, doc)
    const segments = paragraphs.map((p) => computeHighlightSegments(p.text, [
      rule({ style: { line: { style: 'dashed' }, textColor: '#B45309' } }),
    ]))
    const setHighlightInk = vi.fn()
    expect(applyDocHighlights(doc, paragraphs, segments, layer, { setHighlightInk }, 0.68)).toBe(true)
    expect(layer.styleEl).toBeNull()
    expect(setHighlightInk).toHaveBeenCalledWith([expect.objectContaining({ style: 'dashed', color: '#B45309', opacity: 0.68 })])
    clearDocHighlights(doc, layer)
    expect(setHighlightInk).toHaveBeenLastCalledWith([])
  })
})

describe('manual-overlap yield mapping', () => {
  it('maps annotation ranges onto paragraph offsets', () => {
    const doc = buildDoc('<p>《三体》很好看</p>')
    const [paragraph] = collectHighlightParagraphsFrom(doc.body, doc)
    const text = paragraph!.nodes[0]!.node
    const range = doc.createRange()
    range.setStart(text, 1)
    range.setEnd(text, 3)
    const yields = collectYieldIntervals([paragraph!], [{ range, line: true, background: false }])
    expect(yields).toEqual([[{ start: 1, end: 3, line: true, background: false }]])
  })

  it('clamps an annotation that covers whole paragraphs', () => {
    const doc = buildDoc('<p>第一段</p><p>第二段</p>')
    const paragraphs = collectHighlightParagraphsFrom(doc.body, doc)
    const range = doc.createRange()
    range.setStart(paragraphs[0]!.nodes[0]!.node, 1)
    range.setEnd(paragraphs[1]!.nodes[0]!.node, 2)
    const yields = collectYieldIntervals(paragraphs, [{ range, line: false, background: true }])
    expect(yields).toEqual([
      [{ start: 1, end: 3, line: false, background: true }],
      [{ start: 0, end: 2, line: false, background: true }],
    ])
  })

  it('ignores an annotation outside the paragraph', () => {
    const doc = buildDoc('<p>第一段</p><p>第二段</p>')
    const paragraphs = collectHighlightParagraphsFrom(doc.body, doc)
    const range = doc.createRange()
    range.setStart(paragraphs[1]!.nodes[0]!.node, 0)
    range.setEnd(paragraphs[1]!.nodes[0]!.node, 3)
    const yields = collectYieldIntervals([paragraphs[0]!], [{ range, line: true, background: false }])
    expect(yields).toEqual([[]])
  })

  it('maps element boundaries to the selected inline text only', () => {
    const doc = buildDoc('<p>《<em>三体</em>》</p>')
    const paragraphs = collectHighlightParagraphsFrom(doc.body, doc)
    const range = doc.createRange()
    range.selectNode(doc.querySelector('em')!)

    expect(collectYieldIntervals(paragraphs, [{ range, line: true, background: false }])).toEqual([
      [{ start: 1, end: 3, line: true, background: false }],
    ])

    range.collapse(true)
    expect(collectYieldIntervals(paragraphs, [{ range, line: true, background: false }])).toEqual([[]])
  })
})
