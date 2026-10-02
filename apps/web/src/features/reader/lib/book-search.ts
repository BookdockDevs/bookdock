// Self-contained book search core: plain-text extraction per chapter plus
// contains/regex matching. Replaces foliate's `view.search` (segmenterSearch
// is O(n×q) on the main thread — 5-20s for a sentence query over a full
// book). Contains matching here is a lowercased `indexOf` sliding window
// (O(n)); browser regex matching uses a disposable worker.
//
// Search text is derived from the same text-replacement and Chinese-conversion
// pipeline as the rendered section, so result offsets can be mapped back to
// the live transformed document.

import type { ChineseConversion, SearchStatus } from '../types'
import { findMatches, type SearchMatchOptions } from './book-search-match'
import { convertChinese } from '@/lib/chinese'
import { applyReplacementsWithWorker, type TextReplacementRule } from './text-replacements'

export { findMatches } from './book-search-match'
export type { SearchMatchOptions } from './book-search-match'

// length for context in excerpts (mirrors foliate's search.js)
const EXCERPT_CONTEXT_LENGTH = 50

export interface ChapterText {
  /** Concatenated text of every text node in the section body */
  text: string
  /** Per-text-node lengths; block boundaries add virtual spaces to `text` */
  nodeLengths: number[]
}

export interface SearchMatch {
  start: number
  end: number
}

export interface TextOffsetRange {
  start: number
  end: number
}

export function mapMatchTextsToOffsets(
  text: string,
  matchTexts: string[],
): Array<TextOffsetRange | null> {
  let cursor = 0

  return matchTexts.map((matchText) => {
    if (!matchText) return null

    const start = text.indexOf(matchText, cursor)
    if (start < 0) return null

    const end = start + matchText.length
    cursor = start + 1
    return { start, end }
  })
}

export interface SearchTimings {
  load: number
  parse: number
  replacements: number
  conversion: number
  extract: number
  chapterCacheHits: number
}

export interface ChapterTextOptions {
  chineseConversion?: ChineseConversion
  replacements?: TextReplacementRule[]
}

// Script/style/noscript subtrees are markup, not book text — same exclusion
// foliate's textWalker applies.
function isContentTextNode(node: Node): boolean {
  return !(node.parentElement?.closest('script,style,noscript'))
}

const SEARCH_BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
])

interface SearchTextNode {
  node: Text
  start: number
  end: number
}

interface ExtractedSearchText extends ChapterText {
  nodes: SearchTextNode[]
}

function searchBlockAncestor(node: Text): Element | null {
  let element = node.parentElement
  while (element) {
    if (SEARCH_BLOCK_TAGS.has(element.localName.toLowerCase())) return element
    element = element.parentElement
  }
  return null
}

function collectSearchText(doc: Document): ExtractedSearchText {
  const nodeLengths: number[] = []
  const nodes: SearchTextNode[] = []
  let text = ''
  let previousBlock: Element | null = null
  if (!doc.body) return { text, nodeLengths, nodes }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      isContentTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  })
  let node: Node | null
  while ((node = walker.nextNode())) {
    const textNode = node as Text
    const value = textNode.textContent ?? ''
    const block = searchBlockAncestor(textNode)
    // Ignore XHTML formatting whitespace outside a content block. Keeping it
    // would create a second separator next to the virtual paragraph space.
    if (!value || (!block && /^[\t\n\r ]*$/.test(value))) continue
    nodeLengths.push(value.length)
    if (nodes.length > 0 && block !== previousBlock) text += ' '
    const start = text.length
    text += value
    nodes.push({ node: textNode, start, end: text.length })
    previousBlock = block
  }
  return { text, nodeLengths, nodes }
}

export function extractChapterText(doc: Document): ChapterText {
  const { text, nodeLengths } = collectSearchText(doc)
  return { text, nodeLengths }
}

export async function findMatchesSafely(
  text: string,
  query: string,
  options: SearchMatchOptions,
  signal: AbortSignal,
): Promise<{ matches: SearchMatch[]; error?: SearchStatus['error'] }> {
  if (signal.aborted) return { matches: [] }
  if (options.mode !== 'regex') return { matches: findMatches(text, query, options) }
  if (typeof Worker === 'undefined') return { matches: [], error: 'regex-unavailable' }
  let worker: Worker
  try {
    worker = new Worker(new URL('./book-search.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return { matches: [], error: 'regex-unavailable' }
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (matches: SearchMatch[], error?: SearchStatus['error']) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      worker.terminate()
      resolve({ matches, error })
    }
    const abort = () => finish([])
    const timer = setTimeout(() => finish([], 'regex-timeout'), 3000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<{ matches: SearchMatch[] }>) => finish(event.data.matches)
    worker.onerror = () => finish([], 'regex-failed')
    worker.onmessageerror = () => finish([], 'regex-failed')
    try {
      worker.postMessage({ text, query, options })
    } catch {
      finish([], 'regex-failed')
    }
  })
}


export function formatCardExcerpt(
  excerpt: { pre: string; match: string; post: string },
  maxPre = 16,
): { pre: string; match: string; post: string } {
  const pre = excerpt.pre.trim()
  if (pre.length <= maxPre) return excerpt
  const sliced = pre.slice(-maxPre).replace(/^[…\s]+/, '')
  return {
    pre: `…${sliced}`,
    match: excerpt.match,
    post: excerpt.post,
  }
}
export function makeExcerpt(
  text: string,
  start: number,
  end: number,
  skipWhitespace?: (offset: number, backwards: boolean) => number,
): { pre: string; match: string; post: string } {
  const match = text.slice(start, end)
  const before: string[] = []
  const after: string[] = []
  for (let i = start - 1; i >= 0 && before.length <= EXCERPT_CONTEXT_LENGTH; i--) {
    if (/\s/.test(text[i]!)) {
      if (skipWhitespace) i = skipWhitespace(i, true)
      else while (i >= 0 && /\s/.test(text[i]!)) i--
      if (i < 0) break
      before.push(' ')
      i++
    } else before.push(text[i]!)
  }
  for (let i = end; i < text.length && after.length <= EXCERPT_CONTEXT_LENGTH; i++) {
    if (/\s/.test(text[i]!)) {
      if (skipWhitespace) i = skipWhitespace(i, false)
      else while (i < text.length && /\s/.test(text[i]!)) i++
      if (i === text.length) break
      after.push(' ')
      i--
    } else after.push(text[i]!)
  }
  const pre = `${before.length > EXCERPT_CONTEXT_LENGTH ? '…' : ''}${before.slice(0, EXCERPT_CONTEXT_LENGTH).reverse().join('')}`
  const post = `${after.slice(0, EXCERPT_CONTEXT_LENGTH).join('')}${after.length > EXCERPT_CONTEXT_LENGTH ? '…' : ''}`
  return { pre, match, post }
}

export function createExcerptBuilder(text: string): (start: number, end: number) => ReturnType<typeof makeExcerpt> {
  const runs = [...text.matchAll(/\s+/g)].map((match) => ({ start: match.index, end: match.index + match[0].length }))
  // Regex hits inside one long whitespace run must not rescan that run for every excerpt.
  const skipWhitespace = (offset: number, backwards: boolean) => {
    let low = 0
    let high = runs.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (runs[middle]!.end <= offset) low = middle + 1
      else high = middle
    }
    const run = runs[low]!
    return backwards ? run.start - 1 : run.end
  }
  return (start, end) => makeExcerpt(text, start, end, skipWhitespace)
}

// Maps a [start, end) span of the concatenated plain text back to a DOM Range.
// Walks `doc` fresh (rather than trusting cached offsets) so it stays correct
// on the live rendered document, which may differ from the parsed source once
// Chinese conversion has rewritten its text nodes.
export function prepareSearchDocument(doc: Document): {
  text: string
  toRange: (start: number, end: number) => Range | null
} {
  const extracted = collectSearchText(doc)

  const resolve = (offset: number, side: 'start' | 'end'): { node: Text; local: number } | null => {
    let low = 0
    let high = extracted.nodes.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (extracted.nodes[middle]!.end < offset) low = middle + 1
      else high = middle
    }
    const index = low
    const entry = extracted.nodes[index]
    if (entry) {
      if (offset >= entry.start && offset <= entry.end) {
        if (side === 'start' && offset === entry.end) {
          const next = extracted.nodes[index + 1]
          if (next && next.start > offset) return { node: next.node, local: 0 }
        }
        return { node: entry.node, local: offset - entry.start }
      }
      if (side === 'end' && offset < entry.start) {
        const previous = extracted.nodes[index - 1]
        if (previous) return { node: previous.node, local: previous.node.length }
        return null
      }
    }
    const last = extracted.nodes[extracted.nodes.length - 1]
    return offset === last.end ? { node: last.node, local: last.node.length } : null
  }

  return {
    text: extracted.text,
    toRange: (start, end) => {
      if (!doc.body || start < 0 || end < start || end > extracted.text.length || !extracted.nodes.length) return null
      const startPoint = resolve(start, 'start')
      const endPoint = resolve(end, 'end')
      if (!startPoint || !endPoint) return null
      const range = doc.createRange()
      range.setStart(startPoint.node, startPoint.local)
      range.setEnd(endPoint.node, endPoint.local)
      return range
    },
  }
}

export function offsetsToRange(doc: Document, start: number, end: number): Range | null {
  return prepareSearchDocument(doc).toRange(start, end)
}

interface SearchableBook {
  sections?: { id?: string; linear?: string }[] | null
  loadSectionText?: (href: string) => Promise<string | null>
}

// Chapter text cache keyed by (book, section index). Stored on a WeakMap so
// it shares the book object's lifetime — which is the module-level parse
// cache's lifetime in FoliateReader (evicting the book drops this too).
const chapterTextCaches = new WeakMap<object, Map<string, Promise<ChapterText | null>>>()

async function loadChapterText(
  book: SearchableBook,
  index: number,
  options?: ChapterTextOptions,
  timings?: SearchTimings,
): Promise<ChapterText | null> {
  const section = book.sections?.[index]
  if (!section?.id || typeof book.loadSectionText !== 'function') return null
  let started = performance.now()
  const markup = await book.loadSectionText(section.id)
  if (timings) timings.load += performance.now() - started
  if (typeof markup !== 'string') return null
  const parser = new DOMParser()
  started = performance.now()
  let docType: DOMParserSupportedType = 'application/xhtml+xml'
  let doc = parser.parseFromString(markup, docType)
  // Malformed XHTML fails hard under the XML parser; retry as lenient HTML
  if (doc.getElementsByTagName('parsererror').length > 0) {
    docType = 'text/html'
    doc = parser.parseFromString(markup, docType)
  }
  if (timings) timings.parse += performance.now() - started
  const conversion = options?.chineseConversion ?? 'off'
  const replacements = options?.replacements ?? []
  if (replacements.length || conversion !== 'off') {
    started = performance.now()
    let transformedMarkup = replacements.length
      ? await applyReplacementsWithWorker(markup, replacements, docType)
      : markup
    if (timings) timings.replacements += performance.now() - started
    started = performance.now()
    if (conversion !== 'off') transformedMarkup = await convertChinese(transformedMarkup, conversion)
    if (timings) timings.conversion += performance.now() - started
    started = performance.now()
    doc = parser.parseFromString(transformedMarkup, docType)
    if (docType === 'application/xhtml+xml' && doc.getElementsByTagName('parsererror').length > 0) {
      doc = parser.parseFromString(transformedMarkup, 'text/html')
    }
    if (timings) timings.parse += performance.now() - started
  }
  started = performance.now()
  const extracted = extractChapterText(doc)
  if (timings) timings.extract += performance.now() - started
  return extracted
}

export function getChapterText(
  book: SearchableBook,
  index: number,
  options?: ChapterTextOptions,
  timings?: SearchTimings,
): Promise<ChapterText | null> {
  let cache = chapterTextCaches.get(book as object)
  if (!cache) {
    cache = new Map()
    chapterTextCaches.set(book as object, cache)
  }
  const cacheKey = `${index}:${JSON.stringify({
    chineseConversion: options?.chineseConversion ?? 'off',
    replacements: options?.replacements ?? [],
  })}`
  const cached = cache.get(cacheKey)
  if (cached) {
    if (timings) timings.chapterCacheHits++
    return cached
  }
  // Failures resolve to null but are evicted, so the next search retries
  const promise = loadChapterText(book, index, options, timings).catch(() => null)
  cache.set(cacheKey, promise)
  void promise.then((value) => {
    if (value === null && cache.get(cacheKey) === promise) cache.delete(cacheKey)
  })
  return promise
}
