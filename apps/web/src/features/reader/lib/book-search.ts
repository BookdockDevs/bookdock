// Self-contained book search core: plain-text extraction per chapter plus
// contains/regex matching. Replaces foliate's `view.search` (segmenterSearch
// is O(n×q) on the main thread — 5-20s for a sentence query over a full
// book). Contains matching here is a lowercased `indexOf` sliding window
// (O(n)); regex delegates to the native engine.
//
// Matching runs on the raw (unconverted) section markup returned by the
// memoized loadText — Chinese conversion applies downstream on the Loader's
// data event, so search results may diverge from the displayed text when a
// conversion mode is active (known backlog item, same as before).

// length for context in excerpts (mirrors foliate's search.js)
const EXCERPT_CONTEXT_LENGTH = 50

export interface ChapterText {
  /** Concatenated text of every text node in the section body */
  text: string
  /** Per-node length map: node i occupies text[sum(nodeLengths[0..i-1]) .. +nodeLengths[i]] */
  nodeLengths: number[]
}

export interface SearchMatch {
  start: number
  end: number
}

export interface SearchMatchOptions {
  mode?: 'contains' | 'regex'
  matchCase?: boolean
}

// Script/style/noscript subtrees are markup, not book text — same exclusion
// foliate's textWalker applies.
function isContentTextNode(node: Node): boolean {
  return !(node.parentElement?.closest('script,style,noscript'))
}

export function extractChapterText(doc: Document): ChapterText {
  const nodeLengths: number[] = []
  let text = ''
  if (!doc.body) return { text, nodeLengths }
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      isContentTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  })
  let node: Node | null
  while ((node = walker.nextNode())) {
    const value = node.textContent ?? ''
    nodeLengths.push(value.length)
    text += value
  }
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
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      isContentTextNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  })
  let pos = 0
  let startNode: Node | null = null
  let startOffset = 0
  let node: Node | null
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0
    if (startNode === null && start < pos + length) {
      startNode = node
      startOffset = start - pos
    }
    if (startNode !== null && end <= pos + length) {
      const range = doc.createRange()
      range.setStart(startNode, startOffset)
      range.setEnd(node, end - pos)
      return range
    }
    pos += length
  }
  return null
}

interface SearchableBook {
  sections?: { id?: string; linear?: string }[] | null
  loadSectionText?: (href: string) => Promise<string | null>
}

// Chapter text cache keyed by (book, section index). Stored on a WeakMap so
// it shares the book object's lifetime — which is the module-level parse
// cache's lifetime in FoliateReader (evicting the book drops this too).
const chapterTextCaches = new WeakMap<object, Map<number, Promise<ChapterText | null>>>()

async function loadChapterText(book: SearchableBook, index: number): Promise<ChapterText | null> {
  const section = book.sections?.[index]
  if (!section?.id || typeof book.loadSectionText !== 'function') return null
  const markup = await book.loadSectionText(section.id)
  if (typeof markup !== 'string') return null
  const parser = new DOMParser()
  let doc = parser.parseFromString(markup, 'application/xhtml+xml')
  // Malformed XHTML fails hard under the XML parser; retry as lenient HTML
  if (doc.getElementsByTagName('parsererror').length > 0) {
    doc = parser.parseFromString(markup, 'text/html')
  }
  return extractChapterText(doc)
}

export function getChapterText(book: SearchableBook, index: number): Promise<ChapterText | null> {
  let cache = chapterTextCaches.get(book as object)
  if (!cache) {
    cache = new Map()
    chapterTextCaches.set(book as object, cache)
  }
  const cached = cache.get(index)
  if (cached) return cached
  // Failures resolve to null but are evicted, so the next search retries
  const promise = loadChapterText(book, index).catch(() => null)
  cache.set(index, promise)
  void promise.then((value) => {
    if (value === null && cache.get(index) === promise) cache.delete(index)
  })
  return promise
}
