// DOM side of automatic text highlights (phase 3): paragraph-stream
// collection from live section documents, offset→Range mapping, and
// CSS color registration and decorative SVG ink. Both effects use ranges
// without rewriting book HTML or entering the annotation hit-test path.

import type { HighlightSegment, ManualYieldInterval } from '@/lib/highlight-match'

import { MAX_HIGHLIGHT_PARAGRAPHS, MAX_HIGHLIGHT_TEXT_LENGTH } from './highlight-engine'

export interface HighlightTextNode {
  node: Text
  start: number
  end: number
}

export interface HighlightParagraph {
  text: string
  nodes: HighlightTextNode[]
}

export interface DocHighlightLayer {
  styleEl: HTMLStyleElement | null
  names: string[]
  inkOverlay: HighlightInkOverlay | null
  /** Registry-name prefix; section docs share 'bd-hl', editor previews use
   *  instance-unique prefixes so two previews never collide. */
  namePrefix: string
}

export interface HighlightInkRange {
  range: Range
  style: 'underline' | 'squiggly' | 'dashed'
  color?: string
  opacity?: number
}

export interface HighlightInkOverlay {
  setHighlightInk(ranges: HighlightInkRange[]): void
}

export function highlightInkRange(range: Range, segment: HighlightSegment, dashedOpacity?: number): HighlightInkRange | null {
  const line = segment.line
  if (!line) return null
  return {
    range,
    style: line.style === 'solid' ? 'underline' : line.style === 'wavy' ? 'squiggly' : 'dashed',
    color: line.color ?? segment.textColor,
    opacity: line.style === 'dashed' ? dashedOpacity : undefined,
  }
}

export function createDocHighlightLayer(namePrefix = 'bd-hl'): DocHighlightLayer {
  return { styleEl: null, names: [], namePrefix, inkOverlay: null }
}

// Same block-tag judgment as the search corpus: a match never joins two
// paragraphs. A `br` splits too — it is a hard break, not a visual wrap.
const HIGHLIGHT_BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

function highlightBlockAncestor(node: Text): Element | null {
  let element = node.parentElement
  while (element) {
    if (HIGHLIGHT_BLOCK_TAGS.has(element.localName.toLowerCase())) return element
    element = element.parentElement
  }
  return null
}

export function collectHighlightParagraphs(doc: Document): HighlightParagraph[] {
  if (!doc.body) return []
  return collectHighlightParagraphsFrom(doc.body, doc)
}

// Works on any subtree: the reading page collects from the section body, the
// editor preview collects from its mock page column.
export function collectHighlightParagraphsFrom(root: Node, doc: Document): HighlightParagraph[] {
  const paragraphs: HighlightParagraph[] = []
  const computedStyles = new WeakMap<Element, CSSStyleDeclaration>()
  const styleOf = (element: Element) => {
    const cached = computedStyles.get(element)
    if (cached) return cached
    const style = doc.defaultView?.getComputedStyle(element)
    if (style) computedStyles.set(element, style)
    return style
  }
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const visibility = node.parentElement && styleOf(node.parentElement)?.visibility
        return visibility === 'hidden' || visibility === 'collapse' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
      }
      const element = node as Element
      const tag = element.localName.toLowerCase()
      if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'rp'
        || element.hasAttribute('hidden') || styleOf(element)?.display === 'none') return NodeFilter.FILTER_REJECT
      return tag === 'br' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    },
  })
  let current: HighlightParagraph | null = null
  let previousBlock: Element | null = null
  let collectedLength = 0
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      // br only (other elements are skipped, not visited): hard break splits.
      current = null
      continue
    }
    const textNode = node as Text
    const value = textNode.textContent ?? ''
    const block = highlightBlockAncestor(textNode)
    // Formatting whitespace outside a content block is not displayed text.
    if (!value || (!block && /^[\t\n\r ]*$/.test(value))) continue
    if (!current || block !== previousBlock) {
      if (paragraphs.length >= MAX_HIGHLIGHT_PARAGRAPHS) break
      current = { text: '', nodes: [] }
      paragraphs.push(current)
      previousBlock = block
    }
    if (collectedLength + value.length > MAX_HIGHLIGHT_TEXT_LENGTH) {
      paragraphs.pop()
      break
    }
    current.nodes.push({ node: textNode, start: current.text.length, end: current.text.length + value.length })
    current.text += value
    collectedLength += value.length
  }
  return paragraphs
}

function resolvePoint(
  paragraph: HighlightParagraph,
  offset: number,
  side: 'start' | 'end',
): { node: Text; local: number } | null {
  let low = 0
  let high = paragraph.nodes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    const end = paragraph.nodes[middle]!.end
    if (end < offset || (side === 'start' && end === offset)) low = middle + 1
    else high = middle
  }
  const entry = paragraph.nodes[low]
  return entry && offset >= entry.start ? { node: entry.node, local: offset - entry.start } : null
}

function rangeForSegment(doc: Document, paragraph: HighlightParagraph, segment: HighlightSegment): Range | null {
  const startPoint = resolvePoint(paragraph, segment.start, 'start')
  const endPoint = resolvePoint(paragraph, segment.end, 'end')
  if (!startPoint || !endPoint) return null
  const range = doc.createRange()
  range.setStart(startPoint.node, startPoint.local)
  range.setEnd(endPoint.node, endPoint.local)
  return range
}

// The registry is per-document (each section iframe owns one); guard for
// engines without the Custom Highlight API.
function highlightRegistry(doc: Document): HighlightRegistry | null {
  const view = doc.defaultView as (Window & { Highlight?: unknown; CSS?: { highlights?: HighlightRegistry } }) | null
  if (!view || typeof view.Highlight !== 'function' || !view.CSS?.highlights) return null
  return view.CSS.highlights
}

export function supportsCustomHighlights(doc: Document): boolean {
  return highlightRegistry(doc) !== null
}

function signatureOf(segment: HighlightSegment): string {
  return `${segment.textColor ?? ''}|${segment.backgroundColor ?? ''}`
}

const RANGE_CHUNK = 10000

/** Paint segments into the document and refresh the layer's style sheet. */
export function applyDocHighlights(
  doc: Document,
  paragraphs: HighlightParagraph[],
  segments: HighlightSegment[][],
  layer: DocHighlightLayer,
  overlay: HighlightInkOverlay | null = null,
  dashedOpacity?: number,
): boolean {
  const registry = highlightRegistry(doc)
  if (registry) for (const name of layer.names) registry.delete(name)
  layer.names = []

  const buckets = new Map<string, { style: HighlightSegment; ranges: Range[] }>()
  const ink: HighlightInkRange[] = []
  for (let p = 0; p < paragraphs.length; p++) {
    let previousInk: HighlightInkRange | undefined
    let inkEnd = -1
    for (const segment of segments[p] ?? []) {
      const hasColor = registry && (segment.textColor || segment.backgroundColor)
      if (!hasColor && !(overlay && segment.line)) continue
      const range = rangeForSegment(doc, paragraphs[p]!, segment)
      if (!range) continue
      const line = overlay && highlightInkRange(range, segment, dashedOpacity)
      if (line) {
        if (previousInk && inkEnd === segment.start && previousInk.style === line.style && previousInk.color === line.color) {
          previousInk.range.setEnd(range.endContainer, range.endOffset)
        } else {
          previousInk = { ...line, range: hasColor ? range.cloneRange() : range }
          ink.push(previousInk)
        }
        inkEnd = segment.end
      }
      if (!hasColor) continue
      const signature = signatureOf(segment)
      let bucket = buckets.get(signature)
      if (!bucket) {
        bucket = { style: segment, ranges: [] }
        buckets.set(signature, bucket)
      }
      bucket.ranges.push(range)
    }
  }

  if (layer.inkOverlay && layer.inkOverlay !== overlay) layer.inkOverlay.setHighlightInk([])
  if (overlay && (ink.length || layer.inkOverlay === overlay)) overlay.setHighlightInk(ink)
  layer.inkOverlay = ink.length ? overlay : null

  if (!registry || !buckets.size) {
    layer.styleEl?.remove()
    layer.styleEl = null
    return Boolean(registry || overlay)
  }

  const HighlightCtor = (doc.defaultView as unknown as { Highlight: new (...ranges: Range[]) => unknown }).Highlight
  const cssRules: string[] = []
  let index = 0
  for (const { style, ranges } of buckets.values()) {
    if (!ranges.length) continue
    // One Highlight object per style bucket, chunked so extreme range counts
    // stay far below constructor argument limits.
    const declarations = [
      style.textColor ? `color: ${style.textColor};` : '',
      style.backgroundColor ? `background-color: ${style.backgroundColor};` : '',
    ].filter(Boolean).join(' ')
    for (let offset = 0; offset < ranges.length; offset += RANGE_CHUNK) {
      const name = `${layer.namePrefix}-${index++}`
      registry.set(name, new HighlightCtor(...ranges.slice(offset, offset + RANGE_CHUNK)) as Highlight)
      layer.names.push(name)
      cssRules.push(`::highlight(${name}) { ${declarations} }`)
    }
  }
  if (!layer.names.length) {
    layer.styleEl?.remove()
    layer.styleEl = null
    return true
  }
  const text = cssRules.join('\n')
  if (!layer.styleEl || !layer.styleEl.isConnected) {
    layer.styleEl = doc.createElement('style')
    layer.styleEl.dataset.bdUserHighlight = ''
    doc.head?.appendChild(layer.styleEl)
  }
  layer.styleEl.textContent = text
  return true
}

export function clearDocHighlights(doc: Document, layer: DocHighlightLayer): void {
  const registry = highlightRegistry(doc)
  if (registry) for (const name of layer.names) registry.delete(name)
  layer.names = []
  layer.styleEl?.remove()
  layer.styleEl = null
  layer.inkOverlay?.setHighlightInk([])
  layer.inkOverlay = null
}

/** A manual annotation that should make the automatic layer yield. */
export interface ManualAnnotation {
  range: Range
  /** Draws a line under the text: underline, wavy, or the dashed note ink */
  line: boolean
  /** Fills the background: a marker highlight */
  background: boolean
}

function paragraphBoundaryOffset(paragraph: HighlightParagraph, boundary: Range): number {
  const { startContainer, startOffset } = boundary
  for (const entry of paragraph.nodes) {
    const length = entry.end - entry.start
    if (entry.node === startContainer) return entry.start + Math.min(startOffset, length)
    // An element boundary (or a text node omitted by the collector) can sit
    // between two visible text nodes in this very paragraph.
    if (boundary.comparePoint(entry.node, length) >= 0) return entry.start
  }
  return paragraph.text.length
}

/**
 * Map one manual annotation Range onto a paragraph's text offsets. Both ends
 * normally sit in the paragraph's own text nodes; a selection that starts or
 * ends elsewhere (a range covering whole paragraphs) clamps to this
 * paragraph's bounds, and a range entirely outside yields nothing.
 */
export function yieldIntervalFor(
  paragraph: HighlightParagraph,
  annotation: ManualAnnotation,
): ManualYieldInterval | null {
  if (!paragraph.nodes.length || annotation.range.collapsed) return null
  const { range } = annotation
  const first = paragraph.nodes[0]!.node
  const last = paragraph.nodes[paragraph.nodes.length - 1]!
  if (range.comparePoint(first, 0) > 0 || range.comparePoint(last.node, last.end - last.start) < 0) return null
  const boundary = range.cloneRange()
  boundary.collapse(true)
  const start = paragraphBoundaryOffset(paragraph, boundary)
  boundary.setStart(range.endContainer, range.endOffset)
  const end = paragraphBoundaryOffset(paragraph, boundary)
  return end > start
    ? { start, end, line: annotation.line, background: annotation.background }
    : null
}

/** Per-paragraph yield intervals, aligned with the paragraph list. */
export function collectYieldIntervals(
  paragraphs: HighlightParagraph[],
  annotations: ManualAnnotation[],
): ManualYieldInterval[][] {
  return paragraphs.map((paragraph) => annotations.flatMap((annotation) => {
    const interval = yieldIntervalFor(paragraph, annotation)
    return interval ? [interval] : []
  }))
}
