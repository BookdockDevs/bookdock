// Self-contained book search core: plain-text extraction per chapter plus
// contains/regex matching. Replaces foliate's `view.search` (segmenterSearch
// is O(n×q) on the main thread — 5-20s for a sentence query over a full
// book). Contains matching here is a lowercased `indexOf` sliding window
// (O(n)); regex delegates to the native engine.
//
// Search text is derived from the same text-replacement and Chinese-conversion
// pipeline as the rendered section, so result offsets can be mapped back to
// the live transformed document.

import type { ChineseConversion } from '../types'
import { convertChinese } from '@/lib/chinese'
import { applyReplacementsWithWorker, type TextReplacementRule } from './text-replacements'

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

export interface SearchMatchOptions {
  mode?: 'contains' | 'regex'
  matchCase?: boolean
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

export function findMatches(text: string, query: string, opts?: SearchMatchOptions): SearchMatch[] {
  if (!text || !query) return []
  const matches: SearchMatch[] = []
  if (opts?.mode === 'regex') {
    let re: RegExp
    try {
      re = new RegExp(query, opts?.matchCase ? 'gu' : 'giu')
    } catch {
      // invalid pattern: no results, don't crash the whole search
      return []
    }
    for (const m of text.matchAll(re)) {
      // skip empty matches so `.*`-style patterns can't flood the result list
      if (!m[0]) continue
      matches.push({ start: m.index, end: m.index + m[0].length })
    }
    return matches
  }
  const haystack = opts?.matchCase ? text : text.toLowerCase()
  const needle = opts?.matchCase ? query : query.toLowerCase()
  if (!needle) return []
  let index = -1
  while ((index = haystack.indexOf(needle, index + 1)) > -1) {
    matches.push({ start: index, end: index + needle.length })
  }
  return matches
}

const normalizeWhitespace = (str: string) => str.replace(/\s+/g, ' ')


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
): { pre: string; match: string; post: string } {
  const match = text.slice(start, end)
  const trimmedPre = normalizeWhitespace(text.slice(0, start)).trimStart()
  const trimmedPost = normalizeWhitespace(text.slice(end)).trimEnd()
  const pre = `${trimmedPre.length > EXCERPT_CONTEXT_LENGTH ? '…' : ''}${trimmedPre.slice(-EXCERPT_CONTEXT_LENGTH)}`
  const post = `${trimmedPost.slice(0, EXCERPT_CONTEXT_LENGTH)}${trimmedPost.length > EXCERPT_CONTEXT_LENGTH ? '…' : ''}`
  return { pre, match, post }
}

// Maps a [start, end) span of the concatenated plain text back to a DOM Range.
// Walks `doc` fresh (rather than trusting cached offsets) so it stays correct
// on the live rendered document, which may differ from the parsed source once
// Chinese conversion has rewritten its text nodes.
export function offsetsToRange(doc: Document, start: number, end: number): Range | null {
  if (!doc.body || start < 0 || end < start) return null
  const extracted = collectSearchText(doc)
  if (end > extracted.text.length || extracted.nodes.length === 0) return null

  const resolve = (offset: number, side: 'start' | 'end'): { node: Text; local: number } | null => {
    for (const [index, entry] of extracted.nodes.entries()) {
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

  const startPoint = resolve(start, 'start')
  const endPoint = resolve(end, 'end')
  if (!startPoint || !endPoint) return null
  const range = doc.createRange()
  range.setStart(startPoint.node, startPoint.local)
  range.setEnd(endPoint.node, endPoint.local)
  return range
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
): Promise<ChapterText | null> {
  const section = book.sections?.[index]
  if (!section?.id || typeof book.loadSectionText !== 'function') return null
  const markup = await book.loadSectionText(section.id)
  if (typeof markup !== 'string') return null
  const parser = new DOMParser()
  let docType: DOMParserSupportedType = 'application/xhtml+xml'
  let doc = parser.parseFromString(markup, docType)
  // Malformed XHTML fails hard under the XML parser; retry as lenient HTML
  if (doc.getElementsByTagName('parsererror').length > 0) {
    docType = 'text/html'
    doc = parser.parseFromString(markup, docType)
  }
  const conversion = options?.chineseConversion ?? 'off'
  const replacements = options?.replacements ?? []
  if (!replacements.length && conversion === 'off') return extractChapterText(doc)

  let transformedMarkup = replacements.length
    ? await applyReplacementsWithWorker(markup, replacements, docType)
    : markup
  if (conversion !== 'off') transformedMarkup = await convertChinese(transformedMarkup, conversion)
  doc = parser.parseFromString(transformedMarkup, docType)
  if (docType === 'application/xhtml+xml' && doc.getElementsByTagName('parsererror').length > 0) {
    doc = parser.parseFromString(transformedMarkup, 'text/html')
  }
  return extractChapterText(doc)
}

export function getChapterText(
  book: SearchableBook,
  index: number,
  options?: ChapterTextOptions,
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
  if (cached) return cached
  // Failures resolve to null but are evicted, so the next search retries
  const promise = loadChapterText(book, index, options).catch(() => null)
  cache.set(cacheKey, promise)
  void promise.then((value) => {
    if (value === null && cache.get(cacheKey) === promise) cache.delete(cacheKey)
  })
  return promise
}
