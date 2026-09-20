import {
  BlobWriter as ZipBlobWriter,
  HttpReader,
  TextWriter as ZipTextWriter,
  ZipReader,
  configure as zipConfigure,
} from '@zip.js/zip.js'

import type {
  AiIndexCorpus,
  BookReader,
  ChineseConversion,
  ContinuousScroll,
  FontConfig,
  FootnoteEntry,
  ImageMediaContextInfo,
  ImageMediaInfo,
  MarginalConfig,
  MediaErrorInfo,
  MediaPlayInfo,
  ParagraphStyle,
  PopupRect,
  ReaderAnnotation,
  ReaderLocation,
  ReadingMode,
  RendererEvents,
  SearchOptions,
  SearchResult,
  SelectionInfo,
  TtsSegment,
} from '../types'
import { FONT_OPTIONS } from '../types'
import { composeMarginalLine, DEFAULT_MARGINAL_CONFIG } from '../lib/marginals'
import { MediaOverlaySection, type MediaOverlayCue } from '../lib/media-overlay'
import { applyReplacementsWithWorker, countPatternMatches, textContentOffset, textContentRangeNearOffset, type TextReplacementRule } from '../lib/text-replacements'
import { NavigationPending, type NavigationTarget } from '../lib/navigation-pending'
import { chapterTextNamespaceFromUrl, withTextCache } from '../lib/chapter-text-cache'
import { chapterIndexAtFraction, sectionFractionBoundaries } from '../lib/progress-model'
import { applyTitleReplacements } from '@bookdock/shared'

import {
  extractChapterText,
  findMatches,
  getChapterText,
  mapMatchTextsToOffsets,
  makeExcerpt,
  offsetsToRange,
  type SearchMatch,
} from '../lib/book-search'
import { convertChinese } from '@/lib/chinese'
import { mix, isDark } from '@/lib/color'

const ANNOTATION_COLORS: Record<string, string> = {
  yellow: '#eab308',
  red: '#ef4444',
  purple: '#a855f7',
  blue: '#3b82f6',
  green: '#22c55e',
}
const DEFAULT_ANNOTATION_COLOR = ANNOTATION_COLORS.yellow

// Must match SEARCH_PREFIX in foliate-js/view.js: values with this prefix are
// drawn as transient search highlights and ignored by annotation click handling
const SEARCH_ANNOTATION_PREFIX = 'foliate-search:'
const SEARCH_ACTIVE_ANNOTATION_PREFIX = 'foliate-search-active:'

function ttsTextHash(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function readerTextVersion(conversion: ChineseConversion, replacements: TextReplacementRule[]): string {
  let hash = 2166136261
  const value = JSON.stringify({ conversion, replacements })
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `reader-${(hash >>> 0).toString(36)}`
}

function normalizeBookHref(value: string): string {
  const withoutFragment = value.split('#', 1)[0]!.split('?', 1)[0]!
  try {
    return decodeURIComponent(withoutFragment)
  } catch {
    return withoutFragment
  }
}

export function ttsHighlightColor(theme: { bg: string; text: string; primary?: string }): string {
  return mix(theme.primary ?? theme.text, theme.bg, 0.25)
}

export function searchHighlightColor(theme: { bg: string; text: string; primary?: string }): string {
  return theme.primary ?? theme.text
}

export function searchActiveHighlightColor(theme: { bg: string; text: string; primary?: string }): string {
  const dark = isDark(theme.bg)
  return dark ? '#d97706' : '#fbbf24'
}

export function searchActiveBorderColor(theme: { bg: string; text: string; primary?: string }): string {
  const dark = isDark(theme.bg)
  return dark ? '#fcd34d' : '#d97706'
}

function textBeforeSelection(doc: Document, range: Range, maxLength = 2_000): string {
  try {
    if (!doc.body) return ''
    const before = doc.createRange()
    before.selectNodeContents(doc.body)
    before.setEnd(range.startContainer, range.startOffset)
    return before.toString().replace(/\s+/g, ' ').trim().slice(-maxLength)
  } catch {
    return ''
  }
}

function textContentSelection(doc: Document, range: Range): string {
  try {
    const fragment = range.cloneContents()
    const walker = doc.createTreeWalker(fragment, NodeFilter.SHOW_TEXT)
    let text = ''
    let node = walker.nextNode()
    while (node) {
      let parent = node.parentElement
      let skipped = false
      while (parent) {
        if (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') {
          skipped = true
          break
        }
        parent = parent.parentElement
      }
      if (!skipped) text += node.nodeValue ?? ''
      node = walker.nextNode()
    }
    return text.trim()
  } catch {
    return ''
  }
}

export function textParagraphSelection(range: Range, maxLength = 8_000): string {
  try {
    const node = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range.startContainer.parentElement
    const paragraph = node?.closest('p, li, blockquote, dd, dt, h1, h2, h3, h4, h5, h6')
    return paragraph?.textContent?.replace(/\s+/g, ' ').trim().slice(0, maxLength) ?? ''
  } catch {
    return ''
  }
}

// Click-to-turn zone config (F3). Kept pure for unit tests.
export type ClickAreaMode = 'standard' | 'fullscreen' | 'swap' | 'none'

// Middle zone never turns pages: it toggles the top/bottom chrome (tap-to-
// reveal, the mobile way to show the bars — no hover there). It stays active
// in 'none' mode because the click-area setting governs page turning only.
export type ClickDirection = 'prev' | 'next' | 'toggle' | null

// Maps a viewport-relative click x to a page-turn direction. `containerLeft`/
// `containerWidth` are the reader viewport bounds (click-view coordinates are
// window-relative). 'none' disables click-to-turn entirely.
export function resolveClickDirection(
  clientX: number,
  containerLeft: number,
  containerWidth: number,
  mode: ClickAreaMode,
): ClickDirection {
  if (containerWidth <= 0) return null
  const frac = (clientX - containerLeft) / containerWidth
  if (frac < 0 || frac > 1) return null
  if (mode === 'none') return frac < 1 / 3 || frac > 2 / 3 ? null : 'toggle'
  if (frac < 1 / 3) return mode === 'fullscreen' ? 'next' : (mode === 'swap' ? 'next' : 'prev')
  if (frac > 2 / 3) return mode === 'fullscreen' ? 'next' : (mode === 'swap' ? 'prev' : 'next')
  // middle zone never turns pages (menu/neutral)
  return 'toggle'
}

// True when a page-mode turn from the current page will cross into the
// adjacent section — mirroring the paginator's own math (`#scrollNext`:
// `page + 1 >= pages - 1`, `#scrollPrev`: `page - 1 <= 0`). The paginator's
// `atEnd`/`atStart` are NOT usable here: they mean book end, not chapter end.
// Unknown page geometry defaults to arming the indicator.
export function turnsCrossChapter(dir: 1 | -1, page: number | undefined, pages: number | undefined): boolean {
  if (page === undefined || pages === undefined) return true
  return dir === 1 ? page >= pages - 2 : page <= 1
}

// Whether an adjacent-chapter turn deserves the loading indicator: adjacent
// sections are served from the text-prefetch memo (warm) in the normal case,
// so arming the 200ms anti-flicker window would flash the spinner on every
// chapter crossing. Only cold targets (memo miss or unresolved prefetch —
// prefetch debounce skipped the turn, a slow load, or LRU eviction) arm it;
// missing/non-linear targets never load.
export function shouldArmPending(
  dir: 1 | -1,
  book: any,
  currentSectionIndex: number,
): boolean {
  const target = book?.sections?.[currentSectionIndex + dir]
  if (!target || target.linear === 'no') return false
  return !book?.loadSectionText?.has?.(target.id)
}

// Paginator scrollLeft is negative for the forward direction of vertical
// writing. Keeping this at the adapter boundary makes auto-reading use the
// same logical forward direction for horizontal and vertical books.
export function scrollForwardSign(scrollProp: string): 1 | -1 {
  return scrollProp === 'scrollLeft' ? -1 : 1
}

export type TtsViewportAction = 'stay' | 'advance' | 'return'

const TTS_START_VIEWPORT_INSET = 8

// Use the sentence's first line as the page-turn trigger. A sentence may span
// several lines, so using its bounding box would turn too early and scroll its
// opening lines out of view.
export function ttsViewportAction(
  segmentRect: Pick<DOMRect, 'top' | 'bottom'>,
  viewportRect: Pick<DOMRect, 'top' | 'bottom' | 'height'>,
  segmentStartRect: Pick<DOMRect, 'top' | 'bottom'> = segmentRect,
): TtsViewportAction {
  const bottomSafeZone = Math.max(48, Math.min(96, viewportRect.height * 0.12))
  if (segmentRect.bottom < viewportRect.top) return 'return'
  if (segmentStartRect.top <= viewportRect.top + 4) return 'stay'
  if (segmentStartRect.bottom <= viewportRect.bottom - bottomSafeZone) return 'stay'
  return 'advance'
}

// Module-level parse cache: fetch + unzip + EPUB.init is the dominant cost of
// entering the reader, and the parsed book is independent of the foliate view,
// so it can be reused across view mounts (StrictMode double-mount, leaving and
// re-entering the same book). Keyed by content URL. Rejected promises are
// evicted so a transient failure is retried, and the map is capped because an
// entry may retain the whole book blob via loader closures (fallback path).
// Sized for typical home libraries (5+ books) so session-wide book hopping
// never re-pays the open cost.
const PARSE_CACHE_MAX = 6
const parseCache = new Map<string, Promise<any>>()

// Books at or below this size are downloaded whole up front: foliate's
// paginator unloads a section on every chapter switch in non-continuous mode,
// so the Range path would pay one network RTT (100-300ms on slow networks)
// per chapter switch — N chapters read = N RTTs, worse than one full
// download. Above the threshold, Range loading keeps the first open fast and
// the per-chapter cost is amortized by the text memo below.
export const FULL_DOWNLOAD_MAX_BYTES = 4 * 1024 * 1024

// zip.js defaults to 64 KiB. EPUB chapter entries are commonly much larger,
// and HttpReader fetches each chunk serially, so the default turns one chapter
// into dozens of local file requests before the iframe can render it.
export const RANGE_CHUNK_SIZE = 1024 * 1024

// A single stalled Range fetch otherwise hangs chapter navigation forever:
// the View.load iframe guard cannot help because the hang happens before the
// navigation starts. Text chapters resolve in <1s, so hitting this budget
// means a dead connection. memoizeLoadText/memoizeLoadBlob do not cache
// failures, so the next navigation retries with a fresh signal.
const ENTRY_FETCH_TIMEOUT_MS = 20000

export type ZipLoadStrategy = 'full' | 'range'

function normalizeZipEntryPath(value: string): string {
  let path = value.trim().split(/[?#]/, 1)[0] ?? ''
  path = path.replace(/\\/g, '/')
  try {
    path = decodeURIComponent(path)
  } catch {
    // Keep the original path when a malformed percent escape is present.
  }

  const parts: string[] = []
  for (const part of path.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

export function createZipEntryMap(entries: any[]) {
  const exact = new Map<string, any>()
  const insensitive = new Map<string, any | null>()

  for (const entry of entries) {
    if (!entry?.filename) continue
    const path = normalizeZipEntryPath(entry.filename)
    if (!exact.has(entry.filename)) exact.set(entry.filename, entry)
    if (!exact.has(path)) exact.set(path, entry)

    const key = path.toLowerCase()
    if (!insensitive.has(key)) insensitive.set(key, entry)
    else if (insensitive.get(key) !== entry) insensitive.set(key, null)
  }

  return {
    get(name: string) {
      const normalized = normalizeZipEntryPath(name)
      return exact.get(name) ?? exact.get(normalized) ?? insensitive.get(normalized.toLowerCase()) ?? undefined
    },
  }
}

function findCssOpeningBrace(source: string, start: number, end: number): number {
  let quote = ''
  for (let index = start; index < end; index++) {
    const character = source[index]
    if (quote) {
      if (character === '\\') index++
      else if (character === quote) quote = ''
      continue
    }
    if (character === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2)
      if (commentEnd < 0 || commentEnd >= end) return -1
      index = commentEnd + 1
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '{') return index
  }
  return -1
}

function findCssClosingBrace(source: string, opening: number, end: number): number {
  let depth = 1
  let quote = ''
  for (let index = opening + 1; index < end; index++) {
    const character = source[index]
    if (quote) {
      if (character === '\\') index++
      else if (character === quote) quote = ''
      continue
    }
    if (character === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2)
      if (commentEnd < 0 || commentEnd >= end) return -1
      index = commentEnd + 1
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '{') depth++
    else if (character === '}' && --depth === 0) return index
  }
  return -1
}

function transformCssRules(css: string, transformBlock: (selector: string, block: string) => string): string {
  const visit = (source: string, start: number, end: number): string => {
    let result = ''
    let cursor = start
    while (cursor < end) {
      const opening = findCssOpeningBrace(source, cursor, end)
      if (opening < 0) {
        result += source.slice(cursor, end)
        break
      }
      const closing = findCssClosingBrace(source, opening, end)
      if (closing < 0) {
        result += source.slice(cursor, end)
        break
      }
      const selector = source.slice(cursor, opening)
      const block = source.slice(opening + 1, closing)
      const nestedBlock = selector.trimStart().startsWith('@') && block.includes('{')
        ? visit(block, 0, block.length)
        : block
      result += `${selector}{${transformBlock(selector, nestedBlock)}}`
      cursor = closing + 1
    }
    return result
  }

  return visit(css, 0, css.length)
}

function appendCssDeclarations(block: string, declarations: string[]): string {
  if (declarations.length === 0) return block
  const trailingWhitespace = block.match(/\s*$/)?.[0] ?? ''
  const content = block.slice(0, block.length - trailingWhitespace.length)
  const separator = content.length > 0 && !content.endsWith(';') ? '; ' : ' '
  return `${content}${separator}${declarations.join(' ')}${trailingWhitespace}`
}

export function transformEpubStylesheet(
  css: string,
  viewportWidth: number,
  viewportHeight = 0,
  fontScale = 1,
): string {
  const transformBlock = (_selector: string, originalBlock: string) => {
    let block = originalBlock
    const declarations: string[] = []
    const hasTextAlignCenter = /text-align\s*:\s*center\s*[;$]/i.test(block)
    const hasTextIndentZero = /text-indent\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?\s*[;$]/i.test(block)
    if (hasTextAlignCenter && hasTextIndentZero) {
      block = block
        .replace(/(text-align\s*:\s*center)(\s*;|\s*$)/gi, '$1 !important$2')
        .replace(/(text-indent\s*:\s*0(?:\.0+)?(?:px|em|rem|%)?)(\s*;|\s*$)/gi, '$1 !important$2')
    }

    if (/white-space\s*:\s*nowrap\s*[;$]/i.test(block) && !/overflow\s*:/i.test(block)) {
      declarations.push('overflow: clip !important;')
    }
    if (/page-break-after\s*:\s*always\s*[;$]/i.test(block) && !/margin-bottom\s*:/i.test(block)) {
      declarations.push('margin-bottom: var(--bd-page-break-margin, 100vh);')
    }

    const bleedDirections: string[] = []
    for (const direction of ['top', 'bottom', 'left', 'right']) {
      const hasBleed = new RegExp(`duokan-bleed\\s*:\\s*[^;]*${direction}[^;]*;`, 'i').test(block)
      if (hasBleed && !new RegExp(`margin-${direction}\\s*:`, 'i').test(block)) {
        bleedDirections.push(direction)
        declarations.push(`margin-${direction}: calc(-1 * var(--bd-page-margin-${direction}, 0px)) !important;`)
      }
    }
    if (bleedDirections.length > 0) {
      if (!/position\s*:/i.test(block)) declarations.push('position: relative !important;')
      if (!/overflow\s*:/i.test(block)) declarations.push('overflow: hidden !important;')
      if (!/display\s*:/i.test(block)) declarations.push('display: flow-root !important;')
      if (bleedDirections.includes('left') && bleedDirections.includes('right')) {
        declarations.push('width: var(--bd-full-width, 100%) !important; min-width: var(--bd-full-width, 100%) !important; max-width: var(--bd-full-width, 100%) !important;')
      }
      if (bleedDirections.includes('top') && bleedDirections.includes('bottom')) {
        declarations.push('height: var(--bd-full-height, 100%) !important; min-height: var(--bd-full-height, 100%) !important; max-height: var(--bd-full-height, 100%) !important;')
      }
    }

    const widthMatch = /(?:^|[;{])\s*width\s*:\s*(\d+(?:\.\d+)?)px(?:\s*!important)?\s*(?:;|$)/i.exec(block)
    const width = Number(widthMatch?.[1])
    if (viewportWidth > 0 && width > viewportWidth && !/max-width\s*:/i.test(block)) {
      declarations.push('width: 100%; max-width: var(--bd-available-width, 100%); box-sizing: border-box;')
    }

    return appendCssDeclarations(block, declarations)
  }

  let transformed = css.includes('{') ? transformCssRules(css, transformBlock) : transformBlock('', css)
  const toRem = (value: string, base: number) => Number((Number(value) / base / fontScale).toFixed(4))
  transformed = transformed
    .replace(/font-size\s*:\s*xx-small/gi, 'font-size: 0.6rem')
    .replace(/font-size\s*:\s*x-small/gi, 'font-size: 0.75rem')
    .replace(/font-size\s*:\s*small/gi, 'font-size: 0.875rem')
    .replace(/font-size\s*:\s*medium/gi, 'font-size: 1rem')
    .replace(/font-size\s*:\s*large/gi, 'font-size: 1.2rem')
    .replace(/font-size\s*:\s*x-large/gi, 'font-size: 1.5rem')
    .replace(/font-size\s*:\s*xx-large/gi, 'font-size: 2rem')
    .replace(/font-size\s*:\s*xxx-large/gi, 'font-size: 3rem')
    .replace(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi, (_match, value: string) => `font-size: ${toRem(value, 16)}rem`)
    .replace(/font-size\s*:\s*(\d+(?:\.\d+)?)pt/gi, (_match, value: string) => `font-size: ${toRem(value, 12)}rem`)
    .replace(/(font-family\s*:[^;]*?)\bsans-serif\b/gi, '$1__BD_SANS_SERIF__')
    .replace(/(font-family\s*:[^;]*?)\bserif\b(?!-)/gi, '$1var(--bd-serif, serif)')
    .replace(/(font-family\s*:[^;]*?)\bmonospace\b/gi, '$1var(--bd-monospace, monospace)')
    .replace(/__BD_SANS_SERIF__/g, 'var(--bd-sans-serif, sans-serif)')
    .replace(/(^|[\s;{])font-weight\s*:\s*normal/gi, '$1font-weight: var(--bd-font-weight, normal)')
    .replace(/(^|[\s;{])color\s*:\s*black/gi, '$1color: var(--bd-theme-text, black)')
    .replace(/(^|[\s;{])color\s*:\s*#000000/gi, '$1color: var(--bd-theme-text, black)')
    .replace(/(^|[\s;{])color\s*:\s*#000/gi, '$1color: var(--bd-theme-text, black)')
    .replace(/(^|[\s;{])color\s*:\s*rgb\(0,\s*0,\s*0\)/gi, '$1color: var(--bd-theme-text, black)')
    .replace(/(background(?:-color)?\s*:\s*)([^;!}]+?)(\s*!important)?(?=\s*(?:;|}|$))/gi, (match, prefix: string, value: string, important = '') => {
      const color = value.trim().split(/\s+/)[0] ?? ''
      return isLightCssColor(color)
        ? `${prefix}var(--bd-theme-bg, ${color})${important}`
        : match
    })
    .replace(/backdrop-filter\s*:\s*brightness\(100%\)\s*[;]?/gi, '')
    .replace(/(^|[\s;{])-webkit-user-select\s*:\s*none/gi, '$1-webkit-user-select: unset')
    .replace(/(^|[\s;{])-moz-user-select\s*:\s*none/gi, '$1-moz-user-select: unset')
    .replace(/(^|[\s;{])-ms-user-select\s*:\s*none/gi, '$1-ms-user-select: unset')
    .replace(/(^|[\s;{])-o-user-select\s*:\s*none/gi, '$1-o-user-select: unset')
    .replace(/(^|[\s;{])user-select\s*:\s*none/gi, '$1user-select: unset')
    .replace(/(font-size\s*:\s*)(\d*\.?\d+)(px|rem|em|%|)(?=\s*(?:!important\s*)?(?:;|}|$))/gi, '$1max($2$3, var(--bd-min-font-size, 8px))')
  if (viewportWidth > 0) {
    transformed = transformed.replace(/(\d*\.?\d+)vw/gi, (_match, value: string) => `${Number((Number(value) * viewportWidth / 100).toFixed(4))}px`)
  }
  if (viewportHeight > 0) {
    transformed = transformed.replace(/(\d*\.?\d+)vh/gi, (_match, value: string) => `${Number((Number(value) * viewportHeight / 100).toFixed(4))}px`)
  }
  transformed = transformed.replace(/-epub-/gi, '')
  return transformed
}

function isLightCssColor(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'white') return true
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(normalized)
  if (hex) {
    const value = hex[1]!
    const expanded = value.length === 3
      ? value.split('').map((part) => `${part}${part}`).join('')
      : value
    const red = Number.parseInt(expanded.slice(0, 2), 16)
    const green = Number.parseInt(expanded.slice(2, 4), 16)
    const blue = Number.parseInt(expanded.slice(4, 6), 16)
    return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 > 0.85
  }
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(normalized)
  if (!rgb) return false
  const red = Number(rgb[1])
  const green = Number(rgb[2])
  const blue = Number(rgb[3])
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 > 0.85
}

export function transformEpubMarkup(markup: string, viewportWidth: number, viewportHeight = 0, fontScale = 1): string {
  const transformed = markup.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_match, opening: string, css: string, closing: string) => `${opening}${transformEpubStylesheet(css, viewportWidth, viewportHeight, fontScale)}${closing}`,
  )
  return transformed.replace(
    /(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/gi,
    (_match, prefix: string, quote: string, style: string) => `${prefix}${quote}${transformEpubStylesheet(style, viewportWidth, viewportHeight, fontScale)}${quote}`,
  )
}

export interface NormalizeEpubDocumentOptions {
  sectionIndex?: number
  section?: { id?: string; loadHref?: (href: string) => Promise<string> }
  onMediaError?: (detail: MediaErrorInfo) => void
}

function firstParagraphTextNode(node: Node): Text | null {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) return child as Text
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const tag = (child as Element).tagName.toLowerCase()
    if (tag === 'br' || tag === 'img' || tag === 'svg') return null
    const textNode = firstParagraphTextNode(child)
    if (textNode) return textNode
  }
  return null
}

const paragraphWhitespacePrefixes = new WeakMap<Element, string>()

export function setEpubParagraphWhitespace(doc: Document, normalize: boolean): void {
  for (const paragraph of Array.from(doc.querySelectorAll('p'))) {
    const textNode = firstParagraphTextNode(paragraph)
    if (!textNode?.nodeValue) continue

    let prefix = paragraphWhitespacePrefixes.get(paragraph)
    if (prefix === undefined) {
      prefix = textNode.nodeValue.match(/^[\s\u3000]*/)?.[0] ?? ''
      paragraphWhitespacePrefixes.set(paragraph, prefix)
    }

    const content = textNode.nodeValue.replace(/^[\s\u3000]+/, '')
    textNode.nodeValue = normalize ? content : `${prefix}${content}`
  }
}

export function normalizeEpubParagraphWhitespace(doc: Document): void {
  setEpubParagraphWhitespace(doc, true)
}

export function normalizeEpubDocumentImages(doc: Document, options?: NormalizeEpubDocumentOptions): void {
  const view = doc.defaultView ?? (typeof window === 'undefined' ? null : window)
  if (!view) return

  const vertical = !!doc.body && /^vertical-(?:rl|lr)$/i.test(view.getComputedStyle(doc.body).writingMode)
  if (vertical) {
    doc.documentElement.classList.add('vertical-writing')
    doc.body?.classList.add('vertical-writing')
  }
  const plans = Array.from(doc.querySelectorAll('img')).map((image) => {
    const width = image.getAttribute('width') ?? ''
    const height = image.getAttribute('height') ?? ''
    const widthValue = /^(\d+(?:\.\d+)?)(%|vw)$/i.exec(width)
    const heightValue = /^(\d+(?:\.\d+)?)(%|vh)$/i.exec(height)
    const parent = image.parentElement
    const hasTextSibling = !!parent
      && Array.from(parent.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim())
      && Array.from(parent.children).every((child) => child.tagName !== 'BR')
    const computedStyle = view.getComputedStyle(image)
    const keepBaseline = hasTextSibling
      && (computedStyle.verticalAlign === '' || computedStyle.verticalAlign === 'baseline')
    return { image, widthValue, heightValue, hasTextSibling, keepBaseline, vertical }
  })

  for (const { image, widthValue, heightValue, hasTextSibling, keepBaseline, vertical } of plans) {
    if (widthValue && view.innerWidth > 0) {
      image.style.width = String(Number(widthValue[1]) * view.innerWidth / 100) + 'px'
      image.removeAttribute('width')
    }
    if (heightValue && view.innerHeight > 0) {
      image.style.height = String(Number(heightValue[1]) * view.innerHeight / 100) + 'px'
      image.removeAttribute('height')
    }
    if (hasTextSibling) {
      image.classList.add('has-text-siblings')
      if (vertical) image.classList.add('has-text-siblings-vertical')
      if (keepBaseline) image.classList.add('has-text-siblings-baseline')
    }
  }

  for (const rule of Array.from(doc.querySelectorAll('hr'))) {
    if (view.getComputedStyle(rule).backgroundImage !== 'none') rule.classList.add('background-img')
  }

  // Legacy cover float-hack normalization: legacy authoring tools insert a float wedge (.wedge)
  // with negative margin-bottom and a 0em container (.container) wrapping a
  // fixed-height table. In multi-column pagination this collapses the cover into
  // a thin horizontal strip. Reset them to normal flow and auto heights.
  for (const wedge of Array.from(doc.querySelectorAll('.wedge'))) {
    ;(wedge as HTMLElement).style.setProperty('display', 'none', 'important')
    const parent = wedge.parentElement
    if (parent) {
      for (const container of Array.from(parent.querySelectorAll('.container'))) {
        ;(container as HTMLElement).style.setProperty('height', 'auto', 'important')
        ;(container as HTMLElement).style.setProperty('min-height', 'auto', 'important')
        ;(container as HTMLElement).style.setProperty('position', 'static', 'important')
        const table = container.querySelector('table')
        if (table) {
          table.style.setProperty('height', 'auto', 'important')
          for (const cell of Array.from(table.querySelectorAll('tr, td, th'))) {
            ;(cell as HTMLElement).style.setProperty('height', 'auto', 'important')
          }
        }
      }
    }
  }

  for (const container of Array.from(doc.querySelectorAll('.container'))) {
    const table = container.querySelector('table')
    if (table && table.querySelector('img')) {
      ;(container as HTMLElement).style.setProperty('height', 'auto', 'important')
      ;(container as HTMLElement).style.setProperty('min-height', 'auto', 'important')
      ;(container as HTMLElement).style.setProperty('position', 'static', 'important')
      table.style.setProperty('height', 'auto', 'important')
      for (const cell of Array.from(table.querySelectorAll('tr, td, th'))) {
        ;(cell as HTMLElement).style.setProperty('height', 'auto', 'important')
      }
    }
  }

  // Ensure embedded media (e.g. legacy video markup) expose native
  // playback controls, warm preloading, and click-to-play when authoring markup omits them.
  for (const video of Array.from(doc.querySelectorAll('video'))) {
    const isDeferred = !video.src && Boolean(
      video.dataset.bdDeferredSrc
      || video.querySelector('[data-bd-deferred-src]')?.getAttribute('data-bd-deferred-src')
    )
    if (!video.hasAttribute('controls') && !isDeferred) {
      video.setAttribute('controls', '')
      video.controls = true
    }
    if (!video.hasAttribute('playsinline')) {
      video.setAttribute('playsinline', '')
    }
    if (!video.hasAttribute('preload')) {
      video.setAttribute('preload', 'auto')
      video.preload = 'auto'
    }

    if (!video.hasAttribute('controlslist')) {
      video.setAttribute('controlslist', 'nodownload noplaybackrate')
    }

    // Assigned in the deferred-media branch below; the click handlers close
    // over it and invoke it once the user asks to play.
    let startDeferredFetch: (() => void) | undefined

    // Wrap video in card container with frosted-glass center play button overlay
    let wrapper = video.parentElement?.classList.contains('bd-video-wrapper')
      ? (video.parentElement as HTMLElement)
      : null

    if (!wrapper && video.parentNode) {
      wrapper = doc.createElement('div')
      wrapper.className = 'bd-video-wrapper'
      const hasPosterOrSrc = video.hasAttribute('poster') || Boolean(video.src)
      if (!hasPosterOrSrc) wrapper.classList.add('is-empty-placeholder')
      video.parentNode.insertBefore(wrapper, video)
      wrapper.appendChild(video)
    }

    if (wrapper) {
      // Clean up any extraneous duplicate play buttons within this wrapper
      const existingBtns = Array.from(wrapper.querySelectorAll('.bd-video-play-btn'))
      for (let i = 1; i < existingBtns.length; i++) {
        existingBtns[i].remove()
      }

      let playBtn = existingBtns[0] as HTMLButtonElement | undefined
      if (!playBtn) {
        playBtn = doc.createElement('button')
        playBtn.className = 'bd-video-play-btn'
        playBtn.type = 'button'
        playBtn.setAttribute('aria-label', 'Play')

        const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('viewBox', '0 0 24 24')
        svg.setAttribute('width', '28')
        svg.setAttribute('height', '28')
        const polygon = doc.createElementNS('http://www.w3.org/2000/svg', 'polygon')
        polygon.setAttribute('points', '6,3 20,12 6,21')
        polygon.setAttribute('fill', 'white')
        svg.appendChild(polygon)
        playBtn.appendChild(svg)

        playBtn.addEventListener('click', (e) => {
          e.stopPropagation()
          e.preventDefault()
          if (startDeferredFetch && !video.src) {
            video.dataset.bdMediaPlayIntent = 'true'
            startDeferredFetch()
            return
          }
          if (video.paused) {
            void video.play().catch(() => {})
          } else {
            video.pause()
          }
        })

        wrapper.appendChild(playBtn)
      }

      if (wrapper.classList.contains('is-media-loading') || wrapper.classList.contains('is-media-error')) {
        playBtn.style.setProperty('display', 'none', 'important')
        playBtn.setAttribute('aria-hidden', 'true')
      }

      video.addEventListener('play', () => wrapper?.classList.add('is-playing'))
      video.addEventListener('pause', () => wrapper?.classList.remove('is-playing'))
      video.addEventListener('ended', () => wrapper?.classList.remove('is-playing'))
      if (!video.paused) wrapper.classList.add('is-playing')
    }

    // Resolve heavy media in the background after the chapter has had one task
    // boundary to paint its text. A chapter iframe is sized to its full
    // document, so an IntersectionObserver would effectively eager-load every
    // media element while still making the behavior depend on iframe layout.
    const deferredSrc = video.dataset.bdDeferredSrc
      || video.querySelector('[data-bd-deferred-src]')?.getAttribute('data-bd-deferred-src')

    if (!video.src && deferredSrc && wrapper) {
      const isJsdom = typeof navigator !== 'undefined' && navigator.userAgent.includes('jsdom')
      const startFetch = () => {
        if (video.dataset.bdMediaFetchStarted || video.src) return
        video.dataset.bdMediaFetchStarted = 'true'
        wrapper.classList.add('is-media-loading')
        wrapper.classList.remove('is-media-error')
        wrapper.querySelector('.bd-video-error-badge')?.remove()

        if (video.hasAttribute('controls')) {
          video.removeAttribute('controls')
          video.controls = false
        }

        const playBtn = wrapper.querySelector('.bd-video-play-btn') as HTMLElement | null
        if (playBtn) {
          playBtn.style.setProperty('display', 'none', 'important')
          playBtn.setAttribute('aria-hidden', 'true')
        }

        let spinner = wrapper.querySelector('.bd-video-spinner')
        if (!spinner) {
          spinner = doc.createElement('div')
          spinner.className = 'bd-video-spinner'
          spinner.setAttribute('aria-label', 'Loading media')
          const ring = doc.createElement('div')
          ring.className = 'bd-video-spinner-ring'
          const label = doc.createElement('span')
          label.className = 'bd-video-spinner-label'
          label.textContent = '媒体加载中...'
          spinner.appendChild(ring)
          spinner.appendChild(label)
          wrapper.appendChild(spinner)
        }

        if (options?.section?.loadHref) {
          options.section.loadHref(deferredSrc)
            .then((blobUrl: string) => {
              if (!video.isConnected) return
              const firstSource = video.querySelector('source')
              if (firstSource) {
                firstSource.src = blobUrl
                firstSource.removeAttribute('data-bd-deferred-src')
              }
              video.src = blobUrl
              video.removeAttribute('data-bd-deferred-src')
              wrapper?.classList.remove('is-empty-placeholder')

              const finishLoading = (immediate = false) => {
                if (!video.isConnected) return
                if (!video.hasAttribute('controls')) {
                  video.setAttribute('controls', '')
                  video.controls = true
                }
                const restorePlayBtn = () => {
                  wrapper?.classList.remove('is-media-loading')
                  const btn = wrapper?.querySelector('.bd-video-play-btn') as HTMLElement | null
                  if (btn) {
                    btn.style.removeProperty('display')
                    btn.removeAttribute('aria-hidden')
                  }
                }

                if (immediate || isJsdom) {
                  spinner?.remove()
                  restorePlayBtn()
                } else if (spinner) {
                  spinner.classList.add('is-fade-out')
                  setTimeout(() => {
                    spinner?.remove()
                    restorePlayBtn()
                  }, 250)
                } else {
                  restorePlayBtn()
                }

                if (video.dataset.bdMediaPlayIntent) {
                  delete video.dataset.bdMediaPlayIntent
                  void video.play().catch(() => {})
                }
              }

              if (video.readyState >= 2 || isJsdom) {
                finishLoading(true)
              } else {
                let finished = false
                const onReady = () => {
                  if (finished) return
                  finished = true
                  video.removeEventListener('loadeddata', onReady)
                  video.removeEventListener('canplay', onReady)
                  clearTimeout(timer)
                  finishLoading()
                }
                video.addEventListener('loadeddata', onReady)
                video.addEventListener('canplay', onReady)
                const timer = setTimeout(onReady, 1200)
              }
            })
            .catch((_err: unknown) => {
              if (!video.isConnected) return
              wrapper?.classList.remove('is-media-loading')
              wrapper?.classList.add('is-media-error')
              spinner?.remove()
              delete video.dataset.bdMediaFetchStarted
              delete video.dataset.bdMediaPlayIntent

              const btn = wrapper?.querySelector('.bd-video-play-btn') as HTMLElement | null
              if (btn) {
                btn.style.setProperty('display', 'none', 'important')
                btn.setAttribute('aria-hidden', 'true')
              }

              let errorBadge = wrapper.querySelector('.bd-video-error-badge') as HTMLButtonElement | null
              if (!errorBadge) {
                errorBadge = doc.createElement('button')
                errorBadge.className = 'bd-video-error-badge'
                errorBadge.type = 'button'
                errorBadge.setAttribute('aria-label', 'Retry loading media')
                const icon = doc.createElement('span')
                icon.className = 'bd-video-error-icon'
                icon.textContent = '!'
                const text = doc.createElement('span')
                text.className = 'bd-video-error-text'
                text.textContent = '媒体加载失败，点击重试'
                errorBadge.appendChild(icon)
                errorBadge.appendChild(text)
                errorBadge.addEventListener('click', (e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  errorBadge?.remove()
                  wrapper.classList.remove('is-media-error')
                  startFetch()
                })
                wrapper.appendChild(errorBadge)
              }

              options?.onMediaError?.({
                sectionIndex: options.sectionIndex ?? 0,
                kind: 'video',
                src: deferredSrc,
              })
            })
        }
      }
      startDeferredFetch = startFetch
      const mediaWindow = (video.ownerDocument as Document | null)?.defaultView ?? view
      if (mediaWindow) mediaWindow.setTimeout(startFetch, 0)
      else startFetch()
    } else {
      // Directly bind the first source's blob URL to the video element if unset.
      const firstSource = video.querySelector('source')
      if (firstSource?.src && !video.src) {
        video.src = firstSource.src
      }
    }

    if (!video.dataset.bdMediaNormalized) {
      video.dataset.bdMediaNormalized = 'true'
      // Click-to-play on video body: native desktop browsers do not play when
      // clicking the video canvas/poster. Clicking the upper body toggles playback,
      // while preserving clicks on the bottom 48px native control bar (scrubber/volume/fullscreen).
      video.addEventListener('click', (e) => {
        const rect = video.getBoundingClientRect()
        if (e.clientY > rect.bottom - 48) return
        e.preventDefault()
        if (video.paused) {
          if (startDeferredFetch && !video.src) {
            video.dataset.bdMediaPlayIntent = 'true'
            startDeferredFetch()
          } else {
            void video.play().catch(() => {})
          }
        } else {
          video.pause()
        }
      })
    }
  }
  for (const audio of Array.from(doc.querySelectorAll('audio'))) {
    if (!audio.hasAttribute('controls')) {
      audio.setAttribute('controls', '')
      audio.controls = true
    }
    if (!audio.hasAttribute('preload')) {
      audio.setAttribute('preload', 'auto')
      audio.preload = 'auto'
    }

    const deferredAudioSrc = audio.dataset.bdDeferredSrc
      || audio.querySelector('[data-bd-deferred-src]')?.getAttribute('data-bd-deferred-src')

    if (!audio.src && deferredAudioSrc && options?.section?.loadHref) {
      const loadMediaHref = options.section.loadHref
      const startFetch = () => {
        if (audio.dataset.bdMediaFetchStarted || audio.src) return
        audio.dataset.bdMediaFetchStarted = 'true'
        audio.classList.add('bd-audio-loading')
        loadMediaHref(deferredAudioSrc)
          .then((blobUrl: string) => {
            if (!audio.isConnected) return
            const firstSource = audio.querySelector('source')
            if (firstSource) {
              firstSource.src = blobUrl
              firstSource.removeAttribute('data-bd-deferred-src')
            }
            audio.src = blobUrl
            audio.removeAttribute('data-bd-deferred-src')
            audio.classList.remove('bd-audio-loading')
          })
          .catch((_err: unknown) => {
            if (!audio.isConnected) return
            audio.classList.remove('bd-audio-loading')
            options?.onMediaError?.({
              sectionIndex: options.sectionIndex ?? 0,
              kind: 'audio',
              src: deferredAudioSrc,
            })
          })
      }
      const mediaWindow = (audio.ownerDocument as Document | null)?.defaultView ?? view
      if (mediaWindow) mediaWindow.setTimeout(startFetch, 0)
      else startFetch()
      // Native control clicks may not surface on the element, but a tap on its
      // box should still start the fetch if the scheduled task has not run.
      audio.addEventListener('click', () => { if (!audio.src) startFetch() })
    } else {
      const firstSource = audio.querySelector('source')
      if (firstSource?.src && !audio.src) {
        audio.src = firstSource.src
      }
    }
  }
}

// Search results per (book, query, mode): re-searching the same term in a
// session skips the per-chapter matching pass. Keyed by content URL so it
// survives leaving and re-entering the book (parseCache lifecycle), capped by
// LRU — stale entries for evicted books only waste a slot.
const SEARCH_CACHE_MAX = 20
interface SearchCacheEntry {
  results: SearchResult[]
  matches: Map<number, SearchMatch[]>
  matchTexts: Map<number, string[]>
}
const searchCache = new Map<string, SearchCacheEntry>()

// Kept pure for unit tests: a known size at or under the threshold downloads
// whole; an unknown size (HEAD missing/failed) keeps the Range-first default.
export function selectZipLoadStrategy(size: number | null): ZipLoadStrategy {
  return size !== null && size <= FULL_DOWNLOAD_MAX_BYTES ? 'full' : 'range'
}

// The URL is same-origin, so fetch sends the auth cookie by default.
async function probeFileSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    const length = Number(res.headers.get('content-length'))
    return res.ok && Number.isFinite(length) && length > 0 ? length : null
  } catch {
    return null
  }
}

// Opens the epub zip through HTTP range requests: zip.js probes the server,
// reads the central directory from the file tail, and later pulls only the
// bytes of each entry as foliate's loader lazily asks for sections. Small
// books skip Range entirely and download whole; the whole-file path is also
// the fallback when the server does not speak Range.
async function openZipEntryMap(url: string, foliate: any, bookSize?: number) {
  // Book.size already rides on the book-detail response, so the HEAD probe is
  // only paid when it is missing — one less serial RTT before first paint
  const size = bookSize ?? await probeFileSize(url)
  if (selectZipLoadStrategy(size) === 'full') {
    return openZipFromWholeFile(url, foliate)
  }
  try {
    zipConfigure({ useWebWorkers: false, chunkSize: RANGE_CHUNK_SIZE })
    // The init probe (Range: bytes=0-0) throws ERR_HTTP_RANGE when the server
    // ignores Range, which lands us in the fallback below.
    const reader = new ZipReader(new HttpReader(url, { useRangeHeader: true }))
    const entries: any[] = await reader.getEntries()
    return {
      map: createZipEntryMap(entries),
      entries,
      TextWriter: ZipTextWriter,
      BlobWriter: ZipBlobWriter,
    }
  } catch (err) {
    console.warn('[FoliateReader] range loading unavailable, falling back to full download:', err)
    return openZipFromWholeFile(url, foliate)
  }
}

async function openZipFromWholeFile(url: string, foliate: any) {
  const { configure, ZipReader: VendoredZipReader, BlobReader, TextWriter, BlobWriter } = foliate
  const ac = new AbortController()
  const timeoutId = setTimeout(() => ac.abort(), 60000)
  const res = await fetch(url, { signal: ac.signal })
  clearTimeout(timeoutId)
  if (!res.ok) throw new Error(`fetch epub failed: ${res.status} ${res.statusText}`)
  const file = await res.blob()
  configure({ useWebWorkers: false })
  const reader = new VendoredZipReader(new BlobReader(file))
  const entries: any[] = await reader.getEntries()
  return {
    map: createZipEntryMap(entries),
    entries,
    TextWriter,
    BlobWriter,
  }
}

// Chapter text memo: the paginator clears the Loader's object-URL cache when
// it unloads a section (paginator.js), so loadText is re-invoked for chapters
// the user already read. Caching the resolved text per href makes revisits
// local — no network on the Range path, no re-inflate on the whole-file path.
// The memo stores raw (unconverted) text; Chinese conversion happens
// downstream on the Loader's data event. Promises are stored to dedupe
// concurrent loads, and the memo lives inside the book's loader closures, so
// it is GC'd when the parse cache evicts the book.
const TEXT_MEMO_MAX = 20

export type MemoizedLoadText = ((name: string) => Promise<string | null>) & {
  has: (name: string) => boolean
}

export function memoizeLoadText(
  loadText: (name: string) => Promise<string | null> | string | null,
): MemoizedLoadText {
  const memo = new Map<string, { promise: Promise<string | null>; resolved: boolean }>()
  const memoized = (name: string) => {
    const cached = memo.get(name)
    if (cached) {
      // refresh recency
      memo.delete(name)
      memo.set(name, cached)
      return cached.promise
    }
    const entry = { promise: null as unknown as Promise<string | null>, resolved: false }
    const promise = Promise.resolve()
      .then(() => loadText(name))
      .then((value) => {
        entry.resolved = value !== null
        return value
      })
    entry.promise = promise
    memo.set(name, entry)
    while (memo.size > TEXT_MEMO_MAX) {
      const oldest = memo.keys().next().value
      if (oldest === undefined) break
      memo.delete(oldest)
    }
    // never memo a failure — the next request must retry
    promise.catch(() => {
      if (memo.get(name) === entry) memo.delete(name)
    })
    return promise
  }
  // Only resolved, non-missing text is warm. A prefetch inserts its promise
  // immediately, so treating every map entry as warm hides the spinner while
  // the paginator has already blanked the old section.
  memoized.has = (name: string) => memo.get(name)?.resolved === true
  return memoized
}

const RESOURCE_BLOB_CACHE_MAX_ENTRIES = 256
const RESOURCE_BLOB_CACHE_MAX_BYTES = 64 * 1024 * 1024

interface ResourceBlobCacheEntry {
  promise: Promise<Blob | null>
  size: number
}

const resourceBlobCache = new Map<string, ResourceBlobCacheEntry>()
let resourceBlobCacheBytes = 0

function evictResourceBlobCache() {
  while (resourceBlobCache.size > RESOURCE_BLOB_CACHE_MAX_ENTRIES
    || resourceBlobCacheBytes > RESOURCE_BLOB_CACHE_MAX_BYTES) {
    const oldest = resourceBlobCache.entries().next().value as [string, ResourceBlobCacheEntry] | undefined
    if (!oldest) break
    const [key, entry] = oldest
    resourceBlobCache.delete(key)
    resourceBlobCacheBytes -= entry.size
  }
}

export type MemoizedLoadBlob = (name: string, type?: string) => Promise<Blob | null>

export function memoizeLoadBlob(
  cacheKey: string,
  loadBlob: (name: string, type?: string) => Promise<Blob | null> | Blob | null,
): MemoizedLoadBlob {
  return (name, type) => {
    const key = `${cacheKey}\u0000${name}`
    const cached = resourceBlobCache.get(key)
    if (cached) {
      resourceBlobCache.delete(key)
      resourceBlobCache.set(key, cached)
      return cached.promise
    }

    const entry = { promise: null as unknown as Promise<Blob | null>, size: 0 }
    const promise = Promise.resolve()
      .then(() => loadBlob(name, type))
      .then((blob) => {
        if (!blob) {
          if (resourceBlobCache.get(key) === entry) resourceBlobCache.delete(key)
          return null
        }
        if (resourceBlobCache.get(key) === entry) {
          entry.size = blob.size
          resourceBlobCacheBytes += entry.size
          evictResourceBlobCache()
        }
        return blob
      })
      .catch((error) => {
        if (resourceBlobCache.get(key) === entry) resourceBlobCache.delete(key)
        throw error
      })
    entry.promise = promise
    resourceBlobCache.set(key, entry)
    evictResourceBlobCache()
    return promise
  }
}

// Attached once per book (the parse cache hands the same book object to
// successive view mounts), mirroring the transformedBooks guard below.
const prefetchAttachedBooks = new WeakSet<object>()

// Pre-decompresses the sections adjacent to the current one so a chapter
// switch is served from the text memo instead of the network/inflate path.
// Also exposes the memoized loadText as `book.loadSectionText` so the book
// search (lib/book-search.ts) reads raw section markup through the same memo.
function attachTextPrefetch(book: any, loadText: (name: string) => Promise<unknown>) {
  if (!book || prefetchAttachedBooks.has(book)) return
  prefetchAttachedBooks.add(book)
  book.loadSectionText = loadText
  book.textPrefetch = (index: number) => {
    for (const i of [index - 1, index + 1]) {
      const section = book.sections?.[i]
      // sections[i].id is the manifest href — the same key the Loader passes
      // to loadText (epub.js loadItem); non-linear sections are skipped
      if (!section || section.linear === 'no') continue
      Promise.resolve(loadText(section.id)).catch(() => {})
    }
  }
}

function getParsedBook(url: string, foliate: any, bookSize?: number): Promise<any> {
  const cached = parseCache.get(url)
  if (cached) {
    // refresh recency
    parseCache.delete(url)
    parseCache.set(url, cached)
    return cached
  }
  const { EPUB } = foliate
  const promise = (async () => {
    const { map, entries, TextWriter, BlobWriter } = await openZipEntryMap(url, foliate, bookSize)

    const load = (fn: (entry: any, type?: string) => any) => (name: string) => {
      const entry = map.get(name)
      return entry ? fn(entry) : null
    }

    const signal = () => AbortSignal.timeout(ENTRY_FETCH_TIMEOUT_MS)
    // memo (this mount) → IndexedDB (cross-session, keyed by bookId|updatedAt)
    // → network. Only reached on a miss, so reopen reloads nothing that was
    // cached before; TXT books don't go through this path at all.
    const loadText = memoizeLoadText(withTextCache(
      load((entry: any) => entry.getData(new TextWriter(), { signal: signal() })),
      { namespace: chapterTextNamespaceFromUrl(url) },
    ))
    const loadBlob = memoizeLoadBlob(url, load((entry: any, type?: string) => entry.getData(new BlobWriter(type), { signal: signal() })))
    const getSize = (name: string) => map.get(name)?.uncompressedSize ?? 0

    const book = await new EPUB({ entries, loadText, loadBlob, getSize }).init()
    attachTextPrefetch(book, loadText)
    return book
  })()
  // never cache a failure — the next mount must retry
  promise.catch(() => {
    if (parseCache.get(url) === promise) parseCache.delete(url)
  })
  parseCache.set(url, promise)
  while (parseCache.size > PARSE_CACHE_MAX) {
    const oldest = parseCache.keys().next().value
    if (oldest === undefined) break
    parseCache.delete(oldest)
  }
  return promise
}

// Book data replacements run before foliate parses a section: the Loader
// dispatches a `data` event on book.transformTarget before caching each
// resource URL (epub.js createURL), so replacing detail.data changes the
// cached content. The parse cache reuses the same book object across view
// mounts — track which books already carry the listener to avoid stacking
// duplicates.
const transformedBooks = new WeakSet<object>()

interface FoliateTocItem {
  label?: string
  href?: string
  subitems?: FoliateTocItem[] | null
  [key: string]: unknown
}

const originalTocs = new WeakMap<object, FoliateTocItem[]>()

function cloneToc(items: FoliateTocItem[]): FoliateTocItem[] {
  return items.map((item) => ({
    ...item,
    ...(Array.isArray(item.subitems) ? { subitems: cloneToc(item.subitems) } : {}),
  }))
}

function originalToc(book: object & { toc?: unknown }): FoliateTocItem[] {
  const cached = originalTocs.get(book)
  if (cached) return cached
  const source = Array.isArray(book.toc) ? cloneToc(book.toc as FoliateTocItem[]) : []
  originalTocs.set(book, source)
  return source
}

export async function convertTocLabels(
  items: FoliateTocItem[],
  mode: ChineseConversion,
  rules: TextReplacementRule[] = [],
): Promise<FoliateTocItem[]> {
  // Same activation gate as the content engine (effectiveEnabled ?? enabled):
  // a rule toggled off must not keep transforming TOC labels.
  const activeRules = rules.filter((r) => (r.effectiveEnabled ?? r.enabled) && r.matchType === 'pattern')
  return Promise.all(items.map(async (item) => ({
    ...item,
    ...(typeof item.label === 'string'
      ? { label: await convertChinese(applyTitleReplacements(item.label, activeRules), mode) }
      : {}),
    ...(Array.isArray(item.subitems) ? { subitems: await convertTocLabels(item.subitems, mode, activeRules) } : {}),
  })))
}

async function applyTocConversion(book: object & { toc?: unknown }, mode: ChineseConversion) {
  if (!Array.isArray(book.toc)) return
  book.toc = await convertTocLabels(originalToc(book), mode, activeReplacements)
}

// The transform listener outlives any single FoliateReader (the parse cache
// keeps the book alive after destroy), so the current mode is module-level;
// chineseConversion is a global UI setting.
let conversionMode: ChineseConversion = 'off'
// Active text-replacement rules (文本替换 P1), module-level for the same reason
// as conversionMode. Rules are per-book/per-user data, not a global setting,
// so Reader clears them on unmount/book switch to avoid leaking across books.
let activeReplacements: TextReplacementRule[] = []
export function setActiveReplacements(rules: TextReplacementRule[]) {
  activeReplacements = rules
}
// Invalid point-patch reporter (P2): attachBookDataTransform runs outside any
// instance (module-level book listener), so the current instance registers a
// callback here on mount and clears it on destroy — same pattern as the rule
// set above. Without a live reader the report is dropped, which is correct.
let replacementInvalidListener: ((ids: string[]) => void) | null = null
export function setReplacementInvalidListener(fn: ((ids: string[]) => void) | null) {
  replacementInvalidListener = fn
}
// "选中即划": auto-create a highlight the moment a selection settles, keeping
// the toolbar open for restyling. Module-level like conversionMode because the
// selection handlers live on iframe documents owned by the renderer.
let autoMarkSelectionMode = false
export function setAutoMarkSelectionMode(enabled: boolean) {
  autoMarkSelectionMode = enabled
}
const CONVERTIBLE_MEDIA_TYPES = new Set(['application/xhtml+xml', 'text/html'])

function attachBookDataTransform(book: any) {
  const target = book?.transformTarget as EventTarget | undefined
  if (!target || transformedBooks.has(book)) return
  transformedBooks.add(book)
  const isFixedLayout = book?.rendition?.layout === 'pre-paginated'
  target.addEventListener('data', (event: Event) => {
    const detail = (event as CustomEvent).detail
    const mediaType = typeof detail?.type === 'string' ? detail.type.toLowerCase() : ''
    const isMarkup = CONVERTIBLE_MEDIA_TYPES.has(mediaType)
    const isStylesheet = mediaType === 'text/css'
    const applyBookStyleTransform = !isFixedLayout && (isMarkup || isStylesheet)
    const applyMarkupTransform = isMarkup && (conversionMode !== 'off' || activeReplacements.length > 0)
    if (!applyBookStyleTransform && !applyMarkupTransform) return
    const mode = conversionMode
    const rules = activeReplacements
    const docType = mediaType as DOMParserSupportedType
    const viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth
    const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight
    const fontScale = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)
      ? 1.25
      : 1
    // detail.data may be a promise; the Loader awaits it either way.
    detail.data = Promise.resolve(detail.data).then(async (data: unknown) => {
      if (typeof data !== 'string') return data
      let transformed = data
      if (applyBookStyleTransform) {
        transformed = isStylesheet
          ? transformEpubStylesheet(transformed, viewportWidth, viewportHeight, fontScale)
          : transformEpubMarkup(transformed, viewportWidth, viewportHeight, fontScale)
      }
      if (isMarkup) {
        // Text replacements run after book CSS normalization, and only markup
        // receives text conversion; images, fonts and CSS remain untouched.
        transformed = rules.length
          ? await applyReplacementsWithWorker(transformed, rules, docType, detail.name, (ids) => replacementInvalidListener?.(ids))
          : transformed
        if (mode !== 'off') transformed = await convertChinese(transformed, mode)
      }
      return transformed
    })
  })
}

// Spine part of a CFI (`epubcfi(/6/NN!...`), the bucketing key for annotations.
// Returns null for non-EPUB CFIs (defensive; bookdock annotates via view.getCFI
// which always produces `epubcfi(/6/...` from section cfis or fake.fromIndex).
export function cfiSpinePrefix(cfi: string): string | null {
  return /^epubcfi\((\/6\/\d+)/.exec(cfi)?.[1] ?? null
}

// Expected spine prefix of a section index: foliate fake CFIs are
// `/6/` + (index + 1) * 2, and real section cfis follow the same mapping.
export function sectionSpinePrefix(index: number): string {
  return `/6/${2 * (index + 1)}`
}

// Destination section index of a navigateTo target, resolvable before the
// navigation completes (used for the chapter-name/progress pre-update).
// Mirrors navigateTo's own parsing; returns null when unresolvable.
export function resolveNavigationSectionIndex(target?: string): number | null {
  if (!target) return 0
  if (target.startsWith('chapter:')) {
    const index = Number(target.split(':')[1])
    return Number.isNaN(index) ? null : index
  }
  // search-hit-chapter: carries an AI-corpus index, not a section index —
  // the mapping needs instance state, so no pre-update for those targets
  if (target.startsWith('search-hit:')) {
    const index = Number(target.split(':')[1])
    return Number.isFinite(index) ? index : null
  }
  if (/^epubcfi\(/.test(target)) {
    const step = Number(/^epubcfi\(\/6\/(\d+)/.exec(target)?.[1])
    return Number.isFinite(step) && step % 2 === 0 ? step / 2 - 1 : null
  }
  return null
}

export interface ReplacementHitTarget {
  spineHref: string
  textOffset: number
  replacement: string
}

export function parseReplacementHitTarget(target?: string): ReplacementHitTarget | null {
  if (!target?.startsWith('replacement-hit:')) return null
  const parts = target.split(':')
  const textOffset = Number(parts[2])
  if (!parts[1] || !Number.isInteger(textOffset) || textOffset < 0) return null
  try {
    return {
      spineHref: decodeURIComponent(parts[1]),
      textOffset,
      replacement: decodeURIComponent(parts[3] ?? ''),
    }
  } catch {
    return null
  }
}

export function buildAnnotationBuckets(annotations: ReaderAnnotation[]): {
  buckets: Map<string, Set<string>>
  uncategorized: Set<string>
} {
  const buckets = new Map<string, Set<string>>()
  const uncategorized = new Set<string>()
  for (const a of annotations) {
    const value = `${a.cfiRange}|${a.type}`
    const prefix = cfiSpinePrefix(a.cfiRange)
    if (prefix) {
      let bucket = buckets.get(prefix)
      if (!bucket) buckets.set(prefix, (bucket = new Set()))
      bucket.add(value)
    } else {
      uncategorized.add(value)
    }
  }
  return { buckets, uncategorized }
}

export class FoliateReader implements BookReader {
  private url: string
  private bookId: string
  private bookSize?: number
  private container: HTMLElement | null = null
  private view: any | null = null
  private book: any | null = null
  private listeners: { type: string; fn: (...args: unknown[]) => void }[] = []
  private tocHrefToIndex = new Map<string, number>()
  private readingMode: ReadingMode = 'scroll'
  private pageColumns = 2
  private columnGap = 5
  private font: FontConfig = {
    fontFamily: 'serif',
    size: 18,
    lineHeight: 1.8,
    fontWeight: 400,
    overrideBookFont: false,
  }
  private paragraph: ParagraphStyle = {
    paragraphSpacing: 0.5,
    letterSpacing: 0,
    indent: 2,
    verticalPadding: 0,
    horizontalPadding: 0,
    textAlignJustify: false,
    overrideBookLayout: false,
  }
  private theme: { bg: string; text: string; primary?: string } = { bg: '#ffffff', text: '#000000' }
  private pageWidth = 0
  private lastFraction: number | null = null
  private lastCfi: string | null = null
  // Position at the previous relocate, used to derive how many screens the
  // user moved since — continuous scroll emits many small relocates, so the
  // auto-hide tracker needs a mode-independent movement unit
  private lastRelocatePos: { chapterIndex?: number; start?: number; page?: number } | null = null
  // Departure point of an in-flight user jump, confirmed by handleRelocate
  // once the position actually changed
  private pendingJumpFrom: string | null = null
  // Chapter-switch loading indicator: shows only for navigations that outlive
  // the anti-flicker window; the newest navigation always wins. The target
  // hint for UI pre-update is emitted separately at navigation start by
  // beginPendingNavigation, not through this callback.
  private navigationPending = new NavigationPending((pending) => {
    this.emit('navigatePending', { pending })
  })
  private navigationIntent = 0
  private lastRange: Range | null = null
  private conversion: ChineseConversion = conversionMode
  // Snapshot of the rules this instance last applied, for change detection —
  // the same rule set re-delivered by a query refetch must not reload the view.
  private replacementsJson = JSON.stringify(activeReplacements)
  private replacements: TextReplacementRule[] = activeReplacements
  private continuousScroll: ContinuousScroll = 'off'
  private pageAnimation = true
  private showHeader = true
  private showFooter = true
  private currentSectionIndex = 0
  private mediaOverlaySections = new Map<number, MediaOverlaySection>()
  private ttsNavigation = false
  private autoReadingActive = false
  private autoReadingSnapTurn: boolean | null = null
  private resizeObserver: ResizeObserver | null = null
  private lastScrollVPad = -1
  private activeDocs = new Set<Document>()
  private selectionDocs = new Map<Document, { index: number; handler: () => void; selectionChangeHandler: () => void; startHandler: () => void; dblHandler: () => void; escHandler: (e: KeyboardEvent) => void }>()
  private selectionActive = false
  private selectionDismissPending = false
  private foliateOverlayer: any = null
  // `${cfiRange}|${type}` -> annotation; a range may hold a highlight and an
  // idea at once, so the bare cfiRange cannot be the key
  private annotationMap = new Map<string, ReaderAnnotation>()
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null
  // `${cfiRange}|${type}` value -> render key (`${type}|${color}|${style}`); a key change means remove + re-add
  private renderedAnnotations = new Map<string, string>()
  // Annotation values bucketed by CFI spine prefix (`epubcfi(/6/NN`); create-overlay
  // re-applies only the current section's bucket instead of every annotation.
  private annotationBuckets = new Map<string, Set<string>>()
  // Values whose CFI has no extractable spine prefix (defensive fallback: re-applied
  // on every create-overlay, same as the pre-bucketing behavior).
  private uncategorizedAnnotations = new Set<string>()
  // Generation token of the in-flight search: starting a new search, clearing
  // or destroying bumps it, and the search loop stops at the next chapter
  // boundary when its own generation goes stale
  private searchGen = 0
  // Latest search's matches per section (plain-text offsets), kept so
  // highlights can be drawn lazily when a section gets rendered
  private searchMatchOffsets = new Map<number, SearchMatch[]>()
  // The matched strings let live DOM ranges be recovered when rendering has
  // changed text-node boundaries or whitespace since the search pass.
  private searchMatchTexts = new Map<number, string[]>()
  // Search-highlight annotation values currently handed to the view, per section
  private drawnSearchValues = new Map<number, string[]>()
  private activeSearchTarget: { index: number; start: number; end: number } | null = null
  private activeSearchValue: string | null = null
  private activeSearchClearTimer: ReturnType<typeof setTimeout> | null = null
  private footnoteHandler: any = null
  private footnoteEntries: FootnoteEntry[] = []
  private footnoteEntryId = 0
  private footnoteGeneration = 0
  private footnoteRequests = new Map<number, number>()
  private handleDocInteraction = () => {
    if (this.footnoteEntries.length > 0) this.closeFootnote()
    // Must bubble: listeners on document (e.g. popup dismiss handlers) rely on
    // the event travelling up from the container
    this.container?.dispatchEvent(new CustomEvent('content-click', { bubbles: true }))
  }

  // Click-to-turn (F3): the vendored view emits window-relative `click-view`
  // coordinates on every click; map them to a page-turn direction. Page mode
  // turns pages, scrolled mode scrolls by one viewport (same as the page-up/
  // page-down buttons) — same zones, same direction semantics.
  private clickAreaMode: ClickAreaMode = 'standard'
  // Floating UIs (selection bubble, note editor, notes context menu) push this
  // while open; a guarded click only dismisses the float, never turns pages
  private popupGuardCount = 0
  pushPopupGuard() {
    this.popupGuardCount += 1
  }
  popPopupGuard() {
    this.popupGuardCount = Math.max(0, this.popupGuardCount - 1)
  }
  // Activation-click guard: when the browser window regains OS focus through
  // a click, that same click must not turn a page or toggle the chrome.
  // Engine facts this walks between (verified on the user's machines):
  // - Chromium keeps `document.hasFocus()` true after the window loses OS
  //   focus and dispatches the activating click AFTER the window `focus`
  //   event; Firefox reports hasFocus() false on real blur and dispatches the
  //   activating click BEFORE `focus`.
  // - Once focus sits inside a book iframe, the top window stops seeing blur
  //   at all when the app is left — the section contentWindow gets it, so
  //   every live section window is watched too.
  // - Turning a page / the OS activation itself makes foliate move focus
  //   between our documents, producing blur/focus pairs WHILE the app stays
  //   active. A blur within the gap window of the last click we handled (or a
  //   parent pointerdown) is post-activity fallout and ignored. An in-app
  //   shuffle blur never satisfies the hasFocus() arm condition, so a focus
  //   landing back-to-back on a blur only voids that blur's timestamp — the
  //   arm state survives (Firefox's real deactivate fires a frame focus 0ms
  //   after the leave blur; disarming there cost the guard its first switch).
  // Armed = a blur that reported real focus loss (Firefox) or a focus >300ms
  // after a pending blur (Chromium, where hasFocus never goes false).
  // click-view consumes an arm only while no fresh blur has re-stamped the
  // window, so same-gesture focus steals still turn pages.
  // Tab switches are NOT reactivations: Chromium fires a blur/focus pair and
  // flips hasFocus() with tab visibility while the window never lost OS
  // focus. The click that takes a tab from hidden to visible lands on the tab
  // strip / taskbar, never on page content, so becoming visible disarms the
  // guard and the first in-page click counts as real intent.
  private activationGuardReady = false
  private startupClickPending = false
  private awaitingActivationClick = false
  private lastBlurAt = 0
  private lastBlurFromFrame = false
  private activationReturnPending = false
  private lastActivationActivityAt = 0
  private static ACTIVATION_GAP_MS = 300
  // section contentWindows currently watched for blur/focus -> their handlers
  private frameFocusWatch = new Map<Window, { blur: () => void; focus: () => void }>()
  private markActivationActivity = () => {
    this.lastActivationActivityAt = performance.now()
    if (!this.awaitingActivationClick) {
      this.lastBlurAt = 0
      this.lastBlurFromFrame = false
      this.activationReturnPending = false
    }
  }
  private handleWindowBlur = () => this.handleActivationBlur(document, false)
  private handleWindowFocus = () => this.handleActivationRefocus(false)
  private handleActivationVisibilityChange = () => {
    if (document.hidden || !this.activationGuardReady) return
    this.awaitingActivationClick = false
    this.lastBlurAt = 0
    this.lastBlurFromFrame = false
    this.activationReturnPending = false
  }
  private handleActivationBlur = (blurredDoc: Document, fromFrame: boolean) => {
    const now = performance.now()
    const topHasFocus = document.hasFocus()
    if (!this.activationGuardReady) return
    if (now - this.lastActivationActivityAt < FoliateReader.ACTIVATION_GAP_MS) return
    this.lastBlurAt = now
    this.lastBlurFromFrame = fromFrame
    const topLost = !topHasFocus
    // A frame blur only counts when the whole app lost focus (Firefox leave);
    // in Chromium top hasFocus stays true, so its frame blurs never arm —
    // the return-focus path covers Chromium instead
    if (fromFrame ? topLost && !blurredDoc.hasFocus() : topLost) {
      this.startupClickPending = false
      this.awaitingActivationClick = true
    }
  }
  private handleActivationRefocus = (fromFrame = false) => {
    const now = performance.now()
    if (!this.activationGuardReady) return
    const gap = now - this.lastBlurAt
    if (this.lastBlurAt === 0) return
    if (gap <= FoliateReader.ACTIVATION_GAP_MS) {
      if (fromFrame && this.awaitingActivationClick && !this.lastBlurFromFrame && !this.activationReturnPending) {
        this.awaitingActivationClick = false
        this.lastBlurAt = 0
        this.lastBlurFromFrame = false
        this.markActivationActivity()
        return
      }
      // Back-to-back blur+focus: this focus says nothing about the arm — an
      // in-app shuffle blur never armed, and Firefox's real deactivate is
      // followed by a spurious frame focus 0ms later. Keep a possible frame
      // blur pending so a later top-level focus can still confirm Chromium's
      // return from another app; a confirmed arm may safely discard its stamp.
      if (!fromFrame && this.awaitingActivationClick) this.activationReturnPending = true
      if (!fromFrame || this.awaitingActivationClick) this.lastBlurAt = 0
      return
    }
    // A book iframe can regain focus during normal rendering or chapter
    // switches while the browser window remains active. It is not enough to
    // identify a return from another app, and arming here swallows the first
    // click after refresh. Firefox is covered by the blur path above; on
    // Chromium the top-level focus event is the activation signal.
    if (fromFrame) return
    this.startupClickPending = false
    this.awaitingActivationClick = true
    this.activationReturnPending = true
  }
  private handleActivationPointerDown = () => {
    this.startupClickPending = false
    this.awaitingActivationClick = false
    this.lastBlurAt = 0
    this.activationReturnPending = false
    this.markActivationActivity()
  }
  private watchFrameFocus(win: Window) {
    if (win === window || this.frameFocusWatch.has(win)) return
    const blur = () => this.handleActivationBlur(win.document, true)
    const focus = () => this.handleActivationRefocus(true)
    win.addEventListener('blur', blur)
    win.addEventListener('focus', focus)
    this.frameFocusWatch.set(win, { blur, focus })
  }
  private unwatchFrameFocus(win: Window | null) {
    if (!win) return
    const handlers = this.frameFocusWatch.get(win)
    if (!handlers) return
    win.removeEventListener('blur', handlers.blur)
    win.removeEventListener('focus', handlers.focus)
    this.frameFocusWatch.delete(win)
  }

  private invalidateFootnoteRequests() {
    this.footnoteGeneration += 1
    for (const requestId of this.footnoteRequests.keys()) this.footnoteHandler?.cancel?.(requestId)
    this.footnoteRequests.clear()
  }

  private disposeFootnoteView(view: HTMLElement) {
    view.removeEventListener('link', this.handleFootnoteLink)
    if (this.footnoteHandler?.dispose) this.footnoteHandler.dispose(view)
    else {
      try { (view as any).close?.() } catch { /* partial init */ }
      view.remove()
    }
  }

  private disposeFootnoteEntries() {
    for (const entry of this.footnoteEntries) this.disposeFootnoteView(entry.view)
    this.footnoteEntries = []
  }

  closeFootnote() {
    const hadSession = this.footnoteEntries.length > 0 || this.footnoteRequests.size > 0
    this.invalidateFootnoteRequests()
    this.footnoteHandler?.disposeAll?.()
    this.disposeFootnoteEntries()
    if (hadSession) this.emit('footnoteClose')
  }

  backFootnote() {
    if (this.footnoteEntries.length < 2) return
    this.invalidateFootnoteRequests()
    const current = this.footnoteEntries.pop()
    if (current) this.disposeFootnoteView(current.view)
    const previous = this.footnoteEntries[this.footnoteEntries.length - 1]
    if (previous) this.emit('footnoteOpen', { ...previous, canGoBack: this.footnoteEntries.length > 1 })
  }

  private footnoteAnchorRect(anchor: any): PopupRect | undefined {
    try {
      const doc = anchor?.ownerDocument as Document | undefined
      if (!doc) return undefined
      const range = doc.createRange()
      range.selectNode(anchor)
      return this.popupRect(doc, range)
    } catch {
      return undefined
    }
  }

  private handleFootnoteBeforeRender = (event: Event) => {
    const detail = (event as CustomEvent).detail ?? {}
    const requestId = detail.requestId
    const generation = this.footnoteRequests.get(requestId)
    if (generation !== undefined && (generation !== this.footnoteGeneration || this.destroyed)) {
      this.footnoteHandler?.cancel?.(requestId)
      return
    }
    this.applyFootnoteStyles(detail.view, Boolean(detail.hidden))
  }

  private handleFootnoteLink = (event: Event) => {
    const detail = (event as CustomEvent).detail ?? {}
    const href = typeof detail.href === 'string' ? detail.href : ''
    const sourceView = event.currentTarget as HTMLElement
    const mainView = this.view
    const isMainView = sourceView === mainView
    if (!href || !this.footnoteHandler || !this.book) return

    const request = this.footnoteHandler.handle(this.book, event) as (Promise<any> & { requestId?: number }) | undefined
    if (!request) {
      if (!isMainView || this.footnoteEntries.length > 0) {
        event.preventDefault()
        if (this.footnoteEntries.length > 0) this.closeFootnote()
        void this.display(href)
      }
      return
    }

    if (isMainView && this.footnoteEntries.length > 0) this.closeFootnote()
    const generation = ++this.footnoteGeneration
    const requestId = request.requestId as number | undefined
    if (requestId !== undefined) this.footnoteRequests.set(requestId, generation)
    void Promise.resolve(request).then((result) => {
      if (requestId !== undefined) this.footnoteRequests.delete(requestId)
      if (!result || result.kind === 'cancelled') return
      if (generation !== this.footnoteGeneration || this.destroyed) {
        this.disposeFootnoteView(result.view)
        return
      }
      if (result.kind === 'fallback') {
        if (this.footnoteEntries.length > 0) this.closeFootnote()
        void this.display(href)
        return
      }
      const view = result.view as HTMLElement
      view.style.display = 'block'
      view.style.width = '100%'
      view.style.height = '100%'
      view.addEventListener('link', this.handleFootnoteLink)
      if (isMainView) this.disposeFootnoteEntries()
      const entry: FootnoteEntry = {
        id: ++this.footnoteEntryId,
        href: result.href,
        type: result.type ?? null,
        hidden: Boolean(result.hidden),
        view,
        anchorRect: this.footnoteAnchorRect(detail.a),
        canGoBack: !isMainView && this.footnoteEntries.length > 0,
      }
      this.footnoteEntries.push(entry)
      this.emit('footnoteOpen', entry)
    }).catch(() => {
      if (generation !== this.footnoteGeneration || this.destroyed) return
      if (this.footnoteEntries.length > 0) this.closeFootnote()
      void this.display(href)
    })
  }

  private applyFootnoteStyles(view: any, hidden: boolean) {
    const renderer = view?.renderer
    if (!renderer) return
    renderer.setAttribute('flow', 'scrolled')
    renderer.setAttribute('max-inline-size', '100000')
    renderer.setAttribute('gutter', '0')
    renderer.setAttribute('top-margin', '0')
    renderer.setAttribute('bottom-margin', '0')
    renderer.removeAttribute('snap-turn')
    renderer.removeAttribute('continuous')
    renderer.removeAttribute('show-header')
    renderer.removeAttribute('show-footer')
    const fontStack = this.font.fontStack ?? FONT_OPTIONS[0].value
    renderer.setStyles?.(`
      ${this.font.fontCss ?? ''}
      html, body {
        font-family: ${fontStack} !important;
        font-size: ${this.font.size}px !important;
        line-height: ${this.font.lineHeight} !important;
        font-weight: ${this.font.fontWeight} !important;
        letter-spacing: ${this.paragraph.letterSpacing}px !important;
        color: ${this.theme.text} !important;
        background: ${this.theme.bg} !important;
        background-color: ${this.theme.bg} !important;
        --bd-tts-highlight: ${ttsHighlightColor(this.theme)} !important;
        --bd-search-highlight: ${searchHighlightColor(this.theme)} !important;
        --bd-search-active-highlight: ${searchActiveHighlightColor(this.theme)} !important;
        --bd-search-active-border: ${searchActiveBorderColor(this.theme)} !important;
      }
     body {
       box-sizing: border-box !important;
       margin: 0 !important;
       padding: 8px !important;
       overflow-wrap: anywhere !important;
     }
      a:any-link {
        text-decoration: none;
        padding: unset;
        margin: unset;
      }
      ol {
        margin: 0;
        padding: 0;
      }
      p, li, blockquote, dd {
        margin: unset !important;
        text-indent: unset !important;
      }
      div {
        margin: unset !important;
        padding: unset !important;
      }
      dt {
        font-weight: bold;
        line-height: 1.6;
      }
      .epubtype-footnote,
      aside[*|type~="endnote"],
      aside[*|type~="footnote"],
      aside[*|type~="note"],
      aside[*|type~="rearnote"] {
        display: block !important;
      }
     p {
        text-indent: ${this.paragraph.indent}em !important;
        margin-bottom: ${this.paragraph.paragraphSpacing}em !important;
        text-align: ${this.paragraph.textAlignJustify ? 'justify' : 'start'} !important;
      }
      img { max-width: 100% !important; height: auto !important; }
      audio, video, object, embed { max-width: 100% !important; box-sizing: border-box !important; }
      table { max-width: 100% !important; overflow-x: auto !important; }
      ${hidden ? 'aside { display: block !important; }' : ''}
    `)
  }

  private handleClickView = (event: Event) => {
    if (this.startupClickPending) {
      this.startupClickPending = false
      this.awaitingActivationClick = false
      this.lastBlurAt = 0
      this.lastBlurFromFrame = false
      this.activationReturnPending = false
    }
    if (this.activationGuardReady && this.awaitingActivationClick) {
      if (performance.now() - this.lastBlurAt > FoliateReader.ACTIVATION_GAP_MS) {
        this.awaitingActivationClick = false
        this.lastBlurAt = 0
        this.lastBlurFromFrame = false
        this.activationReturnPending = false
        this.markActivationActivity()
        return
      }
      // blur younger than the gap: same-gesture iframe focus steal, not an
      // OS reactivation — let the click through and disarm
      this.awaitingActivationClick = false
      this.lastBlurAt = 0
    }
    // Every handled click anchors the activity window: blur/focus fallout
    // from the resulting page turn must not re-arm the guard
    this.markActivationActivity()
    if (this.selectionDismissPending) {
      this.selectionDismissPending = false
      return
    }
    if (this.popupGuardCount > 0) {
      if (this.footnoteEntries.length > 0) this.closeFootnote()
      return
    }
    const rect = this.container?.getBoundingClientRect()
    if (!rect) return
    const detail = (event as CustomEvent).detail
    const direction = resolveClickDirection(Number(detail?.x), rect.left, rect.width, this.clickAreaMode)
    if (direction === 'prev') {
      this.emit('userInteraction')
      if (this.readingMode === 'page') void this.prev()
      else void this.scrollByPages(-1)
    } else if (direction === 'next') {
      this.emit('userInteraction')
      if (this.readingMode === 'page') void this.next()
      else void this.scrollByPages(1)
    } else if (direction === 'toggle') {
      this.emit('chromeToggle')
    }
  }

  applyClickSettings(mode: ClickAreaMode) {
    this.clickAreaMode = mode
  }

  // Header/footer info bar (F4): fields per L/C/R position, composed from the
  // latest relocate state; the time field refreshes on a minute-aligned timer.
  private marginalConfig: MarginalConfig = DEFAULT_MARGINAL_CONFIG
  private lastTocLabel = ''
  private lastChapterFraction: number | undefined
  private chapterWordCounts: (number | undefined)[] = []
  private marginalTimer: ReturnType<typeof setTimeout> | null = null

  applyMarginals(config: MarginalConfig) {
    this.marginalConfig = config
    this.updateMarginals()
  }

  setChapterWordCounts(counts: (number | undefined)[]) {
    this.chapterWordCounts = counts
    this.updateMarginals()
  }

  // Byte-weight section boundaries mirroring foliate's SectionProgress sizes
  // (`linear != 'no' && size > 0`), i.e. the exact model the seek and relocate
  // use — the progress strip's drag preview must be consistent with it.
  getSectionFractions(): number[] | null {
    if (!this.book?.sections) return null
    return sectionFractionBoundaries(
      this.book.sections.map((s: any) => (s.linear !== 'no' && s.size > 0 ? s.size : 0)),
    )
  }

  getSectionTocLabels(): string[] | null {
    if (!this.book?.sections || !this.view?.getProgressOf) return null
    return this.book.sections.map((_: unknown, index: number) => {
      try {
        const label = this.view.getProgressOf(index)?.tocItem?.label
        return typeof label === 'string' ? label : ''
      } catch {
        return ''
      }
    })
  }

  private handleOpenMedia = (event: Event) => {
    const detail = (event as CustomEvent).detail as Partial<ImageMediaInfo> | undefined
    if (!detail || typeof detail.sectionIndex !== 'number' || typeof detail.src !== 'string' || !detail.src) return
    this.emit('imageClicked', {
      sectionIndex: detail.sectionIndex,
      cfi: typeof detail.cfi === 'string' ? detail.cfi : '',
      src: detail.src,
      alt: typeof detail.alt === 'string' ? detail.alt : '',
      title: typeof detail.title === 'string' ? detail.title : '',
      kind: detail.kind === 'svg-image' ? 'svg-image' : 'image',
    })
  }

  private handleOpenMediaMenu = (event: Event) => {
    const detail = (event as CustomEvent).detail as Partial<ImageMediaContextInfo> | undefined
    if (!detail || typeof detail.sectionIndex !== 'number' || typeof detail.src !== 'string' || !detail.src) return
    if (typeof detail.x !== 'number' || typeof detail.y !== 'number') return
    this.emit('imageContextMenu', {
      sectionIndex: detail.sectionIndex,
      cfi: typeof detail.cfi === 'string' ? detail.cfi : '',
      src: detail.src,
      alt: typeof detail.alt === 'string' ? detail.alt : '',
      title: typeof detail.title === 'string' ? detail.title : '',
      kind: detail.kind === 'svg-image' ? 'svg-image' : 'image',
      x: detail.x,
      y: detail.y,
    })
  }

  private handleMediaError = (event: Event) => {
    const detail = (event as CustomEvent).detail as Partial<MediaErrorInfo> | undefined
    if (!detail || typeof detail.sectionIndex !== 'number') return
    const kind = detail.kind === 'video' || detail.kind === 'object' || detail.kind === 'embed'
      ? detail.kind
      : 'audio'
    this.emit('mediaError', {
      sectionIndex: detail.sectionIndex,
      kind,
      src: typeof detail.src === 'string' ? detail.src : '',
    })
  }

  private handleMediaPlay = (event: Event) => {
    const detail = (event as CustomEvent).detail as Partial<MediaPlayInfo> | undefined
    if (!detail || typeof detail.sectionIndex !== 'number') return
    const kind = detail.kind === 'video' ? 'video' : 'audio'
    this.emit('mediaPlay', {
      sectionIndex: detail.sectionIndex,
      kind,
    })
  }

  private updateMarginals() {
    if (!this.view?.renderer?.setMarginals) return
    const ctx = {
      bookTitle: this.bookTitle(),
      chapterTitle: this.lastTocLabel,
      chapterFraction: this.lastChapterFraction,
      bookFraction: this.lastFraction ?? undefined,
      chapterWordCount: this.currentSectionIndex != null
        ? this.chapterWordCounts[this.currentSectionIndex]
        : undefined,
    }
    try {
      this.view.renderer.setMarginals({
        header: composeMarginalLine(this.marginalConfig.header, ctx),
        footer: composeMarginalLine(this.marginalConfig.footer, ctx),
        fontSize: this.marginalConfig.fontSize,
      })
    } catch {
      // renderer not ready
    }
  }

  // The first tick aligns to the next minute boundary so the displayed time
  // doesn't lag by up to 60s after mount.
  private scheduleMarginalTick() {
    if (this.marginalTimer !== null) return
    const msToNextMinute = (60 - new Date().getSeconds()) * 1000
    this.marginalTimer = setTimeout(() => {
      this.marginalTimer = null
      if (this.destroyed) return
      this.updateMarginals()
      this.marginalTimer = setInterval(() => {
        if (this.destroyed) return
        this.updateMarginals()
      }, 60000)
    }, msToNextMinute)
  }

  private destroyed = false

  constructor(url: string, bookId = '', bookSize?: number) {
    this.url = url
    this.bookId = bookId
    this.bookSize = bookSize
  }

  async mount(container: HTMLElement, initialTarget?: string, initialFraction?: number, onReady?: () => void) {
    this.container = container
    // [bd] mount timing: the first open pays the one-time costs below (module
    // load, zip open, parse); re-entries hit the parse cache and only rebuild
    // the view. Summary line below isolates a slow open.
    const tMount0 = performance.now()
    try {
      const foliate = await this.loadFoliateScript()
      this.foliateOverlayer = foliate.Overlayer
      const FootnoteHandler = foliate.FootnoteHandler
      if (FootnoteHandler) {
        this.footnoteHandler = new FootnoteHandler()
        this.footnoteHandler.addEventListener('before-render', this.handleFootnoteBeforeRender)
      }
      const tMount1 = performance.now()

      const epub = await getParsedBook(this.url, foliate, this.bookSize)
      const tMount2 = performance.now()
      // StrictMode mounts twice: the first instance is destroyed while its
      // async mount is still in flight — bail out instead of becoming a
      // zombie view stacked on top of the surviving one
      if (this.destroyed) return
      this.book = epub
      // Snapshot the rules in force at open time; later rule changes go
      // through applyTextReplacements, which detects the diff and reloads.
      this.replacementsJson = JSON.stringify(activeReplacements)
      // Point patches report their invalid ids here (P2); the module-level
      // listener is shared with the load-time data pipeline.
      setReplacementInvalidListener((ids) => this.emit('replacementInvalid', { ids }))
      attachBookDataTransform(epub)
      await applyTocConversion(epub, this.conversion)

      const view = document.createElement('foliate-view') as any
      view.style.display = 'block'
      view.style.width = '100%'
      view.style.height = '100%'
      this.view = view
      view.addEventListener('link', this.handleFootnoteLink)

      view.addEventListener('relocate', (event: Event) => {
        this.handleRelocate((event as CustomEvent).detail)
        this.syncDoc()
      })
      view.addEventListener('load', () => this.syncDoc())
      view.addEventListener('click-view', this.handleClickView)
      view.addEventListener('open-media', this.handleOpenMedia)
      view.addEventListener('open-media-menu', this.handleOpenMediaMenu)
      view.addEventListener('media-error', this.handleMediaError)
      view.addEventListener('media-play', this.handleMediaPlay)
      view.addEventListener('wheel', () => this.emit('userInteraction'), { passive: true })
      view.addEventListener('doctouchstart', () => this.emit('userInteraction'))
      view.addEventListener('doctouchend', () => this.emit('userInteractionEnd'))
      view.addEventListener('docwheel', () => this.emit('userInteraction'), { passive: true })
      view.addEventListener('dockeydown', () => this.emit('userInteraction'))
      view.addEventListener('draw-annotation', (event: Event) =>
        this.handleDrawAnnotation((event as CustomEvent).detail))
      view.addEventListener('show-annotation', (event: Event) =>
        this.handleShowAnnotation((event as CustomEvent).detail))
      // Newly rendered sections get their annotations re-applied. Bucketed by
      // spine prefix so only the current section's annotations are re-resolved
      // (CFI parsing per annotation dominates once the note count grows).
      view.addEventListener('create-overlay', (event: Event) => {
        const index = (event as CustomEvent).detail?.index
        const reapply = new Set<string>()
        if (typeof index === 'number') {
          const bucket = this.annotationBuckets.get(sectionSpinePrefix(index))
          if (bucket) {
            for (const value of bucket) {
              if (this.renderedAnnotations.has(value)) reapply.add(value)
            }
          }
        }
        for (const value of this.uncategorizedAnnotations) {
          if (this.renderedAnnotations.has(value)) reapply.add(value)
        }
        for (const value of reapply) {
          this.addAnnotationValue(value)
        }
        // …and any pending search highlights for that section
        const matches = this.searchMatchOffsets.get(index)
        if (matches?.length) this.drawSearchHighlights(index, matches)
      })
      view.addEventListener('stabilized', () => {
        const reapply = new Set<string>()
        const contents = (this.view?.renderer?.getContents?.() ?? []) as Array<{ index?: number }>
        for (const content of contents) {
          if (typeof content.index !== 'number') continue
          const bucket = this.annotationBuckets.get(sectionSpinePrefix(content.index))
          if (!bucket) continue
          for (const value of bucket) {
            if (this.renderedAnnotations.has(value)) reapply.add(value)
          }
        }
        for (const value of reapply) this.addAnnotationValue(value)
      })

      container.appendChild(view)
      this.resizeObserver = new ResizeObserver(() => {
        if (this.destroyed || this.readingMode !== 'scroll') return
        if (this.scrollBlockPadding() !== this.lastScrollVPad) this.applyStyles()
      })
      this.resizeObserver.observe(container)
      await view.open(epub)
      if (this.destroyed) {
        try { view.close() } catch { /* partial init */ }
        view.remove()
        return
      }
      // Registered past the destroyed bails so a StrictMode zombie instance
      // can never leave listeners behind (destroy() has already run by then)
      window.addEventListener('blur', this.handleWindowBlur)
      window.addEventListener('focus', this.handleWindowFocus)
      document.addEventListener('visibilitychange', this.handleActivationVisibilityChange)
      document.addEventListener('pointerdown', this.handleActivationPointerDown, true)
      this.emitTocReady()

      this.applyAllSettings()
      // The view is live (TOC emitted, settings applied). Hand control back to
      // the host before the initial navigation so directory jumps execute
      // immediately even while the first chapter is still loading — the
      // paginator's display-generation bump supersedes the in-flight open.
      onReady?.()
      // Navigate to saved position before mount completes, so the user never
      // sees the default chapter. Internal: the initial open is not a "jump".
      if (initialTarget) {
        const ok = await this.display(initialTarget, { internal: true })
        if (this.destroyed) return
        if (ok === false && initialFraction != null && initialFraction > 0) {
          // Saved position unresolvable against the current book — land on
          // the book fraction instead of leaving the view at the book start
          await this.view?.goToFraction(Math.max(0, Math.min(1, initialFraction)))
          if (this.destroyed) return
        }
      } else if (initialFraction != null && initialFraction > 0) {
        // Stale CFI after a re-TOC: land on the book fraction instead
        await this.view?.goToFraction(Math.max(0, Math.min(1, initialFraction)))
        if (this.destroyed) return
      } else {
        // Ensure first section is visible after applyAllSettings re-render
        await this.view?.renderer?.goTo?.({ index: 0 })
      }
      // Initial view creation and saved-position navigation can move focus
      // between the host document and book iframes. Do not let that startup
      // choreography consume the first real user click; subsequent focus
      // changes are handled by the activation guard above.
      this.awaitingActivationClick = false
      this.lastBlurAt = 0
      this.lastBlurFromFrame = false
      this.activationReturnPending = false
      this.activationGuardReady = true
      this.startupClickPending = true
      // Do not treat renderer readiness as user activity. A real window blur
      // immediately after opening the book must still arm reactivation guard.
      this.lastActivationActivityAt = 0
      const tMount3 = performance.now()
      console.debug(
        `[bd] reader mount: foliate ${(tMount1 - tMount0).toFixed(0)}ms, ` +
        `parse ${(tMount2 - tMount1).toFixed(0)}ms, view+display ${(tMount3 - tMount2).toFixed(0)}ms, ` +
        `total ${(tMount3 - tMount0).toFixed(0)}ms`,
      )
      this.syncAnnotations()
      this.scheduleMarginalTick()
      this.emit('rendered')
      this.syncDoc()
    } catch (err) {
      console.error('[FoliateReader] mount error:', err)
      throw err
    }
  }

  private async loadFoliateScript(): Promise<any> {
    if (typeof window === 'undefined') throw new Error('FoliateReader requires a browser environment')
    const existing = (window as any).FoliateReader
    if (existing) return existing

    try {
      const dynamicImport = new Function('url', 'return import(url)') as (url: string) => Promise<Record<string, unknown>>
      const mod = await dynamicImport('/foliate-js/reader-entry.js')
      const fr = (window as any).FoliateReader ?? mod?.FoliateReader
      if (!fr) throw new Error('FoliateReader global not set — module may have thrown during evaluation')
      return fr
    } catch (e) {
      console.error('[FoliateReader] dynamic import error:', e)
      throw e
    }
  }

  private handleRelocate(detail: any) {
    const { cfi, fraction, startFraction, tocItem, section, chapterLocation, range } = detail
    // The content has become visible at this point. Do not keep a spinner up
    // while a paginator background-fill or font/layout promise finishes.
    this.navigationPending.settle()
    // Firefox can report the old section iframe losing focus while a user
    // jump is loading. Once the destination is visible, that blur belongs to
    // the internal section swap, not to an OS reactivation.
    this.awaitingActivationClick = false
    this.lastBlurAt = 0
    this.lastBlurFromFrame = false
    this.activationReturnPending = false
    if (this.startupClickPending) this.lastActivationActivityAt = 0
    else this.markActivationActivity()
    this.lastRange = range ?? null
    // fraction is NaN on transient relocate paths (section reload with zero viewSize)
    // Paginated foliate progress includes the visible page tail in `fraction`.
    // Product progress is a viewport-start coordinate, matching goToFraction;
    // using the tail here made the slider display a different point than the
    // point it navigated to.
    const frac = Number.isFinite(startFraction)
      ? startFraction
      : Number.isFinite(fraction) ? fraction : this.lastFraction
    if (frac != null) this.lastFraction = frac
    // Foliate's section index is a spine-resource coordinate. It is not the
    // server chapter/TOC index: one XHTML resource may contain multiple TOC
    // entries, and a TOC entry may share a resource with its neighbors.
    const chapterIndex = Number.isFinite(section?.current) ? section.current : undefined
    const contentCfi = typeof cfi === 'string' && cfi ? cfi : undefined
    if (chapterIndex !== undefined) {
      this.currentSectionIndex = chapterIndex
      this.scheduleTextPrefetch(chapterIndex)
    }
    const chapterTotal = Number.isFinite(section?.total) ? section.total : undefined
    let pageInChapter = chapterLocation?.current
    let effectiveCfi = cfi ?? ''
    let chapterFraction: number | undefined
    let movedScreens = 0
    try {
      const r = this.view?.renderer
      const scrolled = r?.getAttribute?.('flow') === 'scrolled'
      const start = scrolled && Number.isFinite(r.start) ? (r.start as number) : undefined
      const page = !scrolled && Number.isFinite(chapterLocation?.current) ? (chapterLocation.current as number) : undefined
      const prev = this.lastRelocatePos
      if (prev) {
        if (chapterIndex !== undefined && prev.chapterIndex !== undefined && chapterIndex !== prev.chapterIndex) {
          // a cross-chapter move counts as one screen — the auto-hide tracker
          // gates on the chapter change itself
          movedScreens = 1
        } else if (start !== undefined && prev.start !== undefined && r.size > 0) {
          // renderer.size is the paginator's viewport size (height when scrolled)
          movedScreens = Math.abs(start - prev.start) / r.size
        } else if (page !== undefined && prev.page !== undefined) {
          movedScreens = Math.abs(page - prev.page)
        }
      }
      this.lastRelocatePos = { chapterIndex, start, page }
      if (scrolled && r.size > 0) {
        // in scrolled flow chapterLocation is the section index, not a page —
        // approximate pages-into-chapter by container screens instead
        pageInChapter = Math.floor(r.start / r.size)
        // CFI-based restore pinpoints to an element's bounding rect, putting
        // it at the viewport top — that shifts the position down vs. where the
        // user actually was.  Encode the viewport-relative scroll fraction so
        // goTo({ index, anchor }) restores the exact scrollTop.
        if (chapterIndex !== undefined) {
          // Use r.viewSize (iframe content height), not r.size (viewport height)
          // — scrollToAnchor(anchor) does anchor * viewSize on restore.
          const viewSize = r.viewSize
          if (viewSize > 0) {
            const scrollFrac = r.start / viewSize
            chapterFraction = scrollFrac
            effectiveCfi = `chapter:${chapterIndex}:${scrollFrac.toFixed(6)}`
          }
        }
      }
    } catch {
      // renderer not ready
    }
    if (chapterFraction === undefined && chapterLocation && Number.isFinite(chapterLocation.current) && Number.isFinite(chapterLocation.total) && chapterLocation.total > 0) {
      chapterFraction = chapterLocation.current / chapterLocation.total
    }
    if (effectiveCfi) this.lastCfi = effectiveCfi
    // Confirm a pending jump only when the position actually moved — a no-op
    // navigation (target resolved to the current location) must not enter the
    // history. Cleared either way so a failed navigation cannot leak into the
    // next relocate.
    if (this.pendingJumpFrom !== null) {
      if (effectiveCfi && effectiveCfi !== this.pendingJumpFrom) {
        this.emit('jumpConfirmed', { cfi: this.pendingJumpFrom })
      }
      this.pendingJumpFrom = null
    }
    const location: ReaderLocation = {
      cfi: effectiveCfi,
      contentCfi,
      percent: frac != null ? Math.round(frac * 100) : 0,
      fraction: frac ?? undefined,
      chapter: tocItem?.label,
      chapterHref: typeof tocItem?.href === 'string' ? tocItem.href : undefined,
      chapterIndex,
      chapterFraction,
      page: chapterIndex != null ? chapterIndex + 1 : undefined,
      total: chapterTotal,
      pageInChapter,
      movedScreens,
      source: this.ttsNavigation ? 'tts' : 'reader',
    }
    this.lastTocLabel = tocItem?.label ?? ''
    this.lastChapterFraction = chapterFraction
    if (frac != null) this.lastFraction = frac
    this.updateMarginals()
    this.emit('relocated', location)
  }

  // Debounced prefetch of the sections adjacent to the current one: rapid
  // chapter hops restart the timer so only the section the user settles on
  // gets its neighbors warmed in the text memo.
  private scheduleTextPrefetch(chapterIndex: number) {
    if (this.prefetchTimer !== null) clearTimeout(this.prefetchTimer)
    this.prefetchTimer = setTimeout(() => {
      this.prefetchTimer = null
      if (this.destroyed) return
      try { this.book?.textPrefetch?.(chapterIndex) } catch { /* prefetch is best-effort */ }
    }, 300)
  }

  // Destination hint of a user navigation, resolvable synchronously at
  // navigation start. fraction is only known for a chapter start/seek landing
  // (byte-boundary model); a CFI's in-chapter position cannot be pre-computed.
  private resolveNavigationTarget(target?: string): NavigationTarget | null {
    const replacementHit = parseReplacementHitTarget(target)
    let index = resolveNavigationSectionIndex(target)
    const hrefTarget = replacementHit?.spineHref ?? target
    if (index === null && hrefTarget && this.book) {
      const resolved = this.book.resolveHref?.(hrefTarget) ?? this.book.resolveHref?.(decodeURI(hrefTarget))
      const viaMap = this.tocHrefToIndex.get(hrefTarget)
      const hrefIndex = resolved?.index ?? viaMap
      index = typeof hrefIndex === 'number' ? hrefIndex : null
    }
    if (index === null || index < 0 || index >= (this.book?.sections?.length ?? 0)) return null
    return { sectionIndex: index, isJump: true }
  }

  // Arm the loading indicator and publish the destination hint immediately —
  // the pre-update must not wait for the anti-flicker flip.
  private beginPendingNavigation(target?: NavigationTarget) {
    // Keep consumers such as auto-reading blocked immediately, while the
    // Reader UI waits for NavigationPending's anti-flicker timer. Otherwise a
    // fast relocate can leave a pre-update spinner with no matching false
    // event because the visible phase never started.
    this.emit('navigatePending', { pending: true, started: true, ...(target ? { target } : {}) })
    return this.navigationPending.begin()
  }

  async display(target?: string, opts?: { internal?: boolean; showPending?: boolean }) {
    if (!this.view) return
    // History back/forward is user-initiated but marks itself internal so it
    // doesn't re-enter the back stack; showPending re-arms the indicator.
    if (!opts?.internal || opts?.showPending) {
      const resolvedTarget = this.resolveNavigationTarget(target) ?? undefined
      const intent = ++this.navigationIntent
      const gen = this.beginPendingNavigation(resolvedTarget)
      try {
        await this.navigateTo(target, opts)
      } catch (err) {
        // User-triggered navigation is commonly fire-and-forget from React
        // handlers. Keep a failed chapter load from becoming an unhandled
        // rejection; initial internal navigation still reaches mount's error
        // path below.
        const error = err instanceof Error ? err : new Error(String(err))
        console.warn('[FoliateReader] navigation failed:', error)
        if (intent === this.navigationIntent) {
          this.emit('navigateError', {
            target,
            ...(resolvedTarget ? { sectionIndex: resolvedTarget.sectionIndex } : {}),
            error,
          })
        }
        if (opts?.internal && !opts.showPending) throw err
      } finally {
        this.navigationPending.end(gen)
      }
      return
    }
    return this.navigateTo(target, opts)
  }

  private resolveSearchMatchRange(
    doc: Document,
    index: number,
    match: SearchMatch,
    matchIndex?: number,
  ): Range | null {
    const matchTexts = this.searchMatchTexts.get(index)
    if (matchIndex !== undefined && matchIndex >= 0 && matchTexts?.length) {
      const liveText = extractChapterText(doc).text
      const liveRanges = mapMatchTextsToOffsets(liveText, matchTexts.slice(0, matchIndex + 1))
      const liveMatch = liveRanges[matchIndex]
      if (liveMatch) return offsetsToRange(doc, liveMatch.start, liveMatch.end)
    }
    return offsetsToRange(doc, match.start, match.end)
  }

  private async navigateTo(target?: string, opts?: { internal?: boolean; showPending?: boolean }) {
    if (!this.view) return
    // Only explicit caller-driven navigation counts as a jump; internal
    // re-displays (initial open, history back/forward) pass `internal: true`.
    // The entry is not pushed yet — handleRelocate confirms it once the
    // position actually changed.
    if (!opts?.internal) {
      this.pendingJumpFrom = this.lastCfi ?? ''
      // explicit jump: close the reading segment so the jump stretch never
      // enters the read-union (history back/forward closes in Reader itself)
      this.emit('userJump')
    }
    const renderer = this.view.renderer
    if (!target) {
      if (renderer) return renderer.goTo({ index: 0 })
      return this.view.goTo(0)
    }
    if (target.startsWith('chapter:')) {
      const parts = target.split(':')
      const index = Number(parts[1])
      // Out-of-range section (e.g. after a re-conversion): report failure so
      // the caller can fall back — foliate's own clamp would silently land
      // the view somewhere else and the first relocate would overwrite the
      // saved position with it
      if (Number.isNaN(index) || index >= (this.book?.sections?.length ?? Infinity)) return false
      // chapter:{index}:{scrollFrac} — restore exact scroll proportion
      if (parts[2] !== undefined) {
        const anchor = Number(parts[2])
        if (!Number.isNaN(anchor) && renderer) {
          await renderer.goTo({ index, anchor })
          return true
        }
      }
      // chapter:{index} — navigate to section start (backward compat)
      if (renderer) {
        await renderer.goTo({ index })
        return true
      }
      return false
    }

    const replacementHit = parseReplacementHitTarget(target)
    if (replacementHit) {
      let resolved = this.book?.resolveHref?.(replacementHit.spineHref)
      if (!resolved) resolved = this.book?.resolveHref?.(decodeURI(replacementHit.spineHref))
      const index = resolved?.index ?? this.tocHrefToIndex.get(replacementHit.spineHref)
      if (typeof index !== 'number' || index < 0 || index >= (this.book?.sections?.length ?? Infinity)) return false
      this.activeSearchTarget = null
      this.clearActiveSearchHighlight()
      if (renderer) {
        return renderer.goTo({
          index,
          anchor: (doc: Document) => {
            const range = textContentRangeNearOffset(doc, replacementHit.replacement, replacementHit.textOffset)
            if (range) {
              this.setActiveSearchRange(index, range)
              this.scheduleActiveSearchHighlightClear(2200)
            }
            return range
          },
        })
      }
      return false
    }

    // search-hit-chapter:{chapterIndex}:{start}:{end} — AI citation target.
    // AI chapter indexes follow the visible TOC corpus, not raw Foliate sections.
    if (target.startsWith('search-hit-chapter:')) {
      const parts = target.split(':')
      const chapterIndex = Number(parts[1])
      const start = Number(parts[2])
      const end = Number(parts[3])
      const sectionIndex = this.aiCorpusSectionIndices()[chapterIndex]
      if (![chapterIndex, start, end, sectionIndex].every(Number.isFinite)) return
      if (renderer) {
        return renderer.goTo({
          index: sectionIndex,
          anchor: (doc: Document) => {
            const range = offsetsToRange(doc, start, end)
            if (range) {
              this.setActiveSearchRange(sectionIndex, range)
              this.scheduleActiveSearchHighlightClear(4000)
            }
            return range
          },
        })
      }
      return
    }

    // search-hit:{sectionIndex}:{start}:{end} — lazy jump target for reader search results.
    // No CFI is computed at search time; the anchor resolves the plain-text
    // span to a Range on the freshly loaded section document, so both reading
    // modes land on the exact match (paginator treats Range anchors uniformly).
    if (target.startsWith('search-hit:')) {
      const parts = target.split(':')
      const index = Number(parts[1])
      const start = Number(parts[2])
      const end = Number(parts[3])
      if (![index, start, end].every(Number.isFinite)) return
      this.activeSearchTarget = { index, start, end }
      if (renderer) {
        const match = { start, end }
        const matchIndex = this.searchMatchOffsets
          .get(index)
          ?.findIndex((item) => item.start === start && item.end === end)
        return renderer.goTo({
          index,
          anchor: (doc: Document) => {
            const range = this.resolveSearchMatchRange(doc, index, match, matchIndex)
            if (range) this.setActiveSearchRange(index, range)
            return range
          },
        })
      }
      return
    }

    // CFI locations (search results, bookmarks, selections) go straight to
    // View.goTo — href resolution would mangle or reject them
    if (/^epubcfi\(/.test(target)) {
      try {
        const resolved = await this.view.goTo(target)
        if (!resolved) {
          console.warn('[FoliateReader] CFI navigation returned nothing:', target)
          return false
        }
        return true
      } catch (err) {
        console.error('[FoliateReader] CFI navigation failed:', target, err)
        return false
      }
    }

    // Try EPUB's built-in href resolver (handles path normalization)
    let resolved = this.book?.resolveHref?.(target)
    if (!resolved) {
      // Try decoding the path — sometimes there's an encoding mismatch
      resolved = this.book?.resolveHref?.(decodeURI(target))
    }
    if (!resolved) {
      // Fallback: look up TOC href in our index map
      const index = this.tocHrefToIndex.get(target)
      if (index !== undefined) resolved = { index }
    }
    if (resolved && renderer) {
      return renderer.goTo(resolved)
    }

    // Last resort: let View.goTo handle it (silently catches errors)
    return this.view.goTo(target)
  }

  // Page turns only arm the indicator when they will cross a chapter
  // boundary — an animated intra-chapter turn alone takes >200ms, which would
  // flash the spinner on every page flip. Crossing turns arm it only when the
  // adjacent chapter's text is cold (prefetch miss) — warm turns load too
  // fast to need the spinner (see shouldArmPending).
  async next() {
    if (!this.view) return
    this.navigationIntent++
    this.emit('userInteraction')
    if (this.readingMode === 'page'
      && !turnsCrossChapter(1, this.view.renderer?.page, this.view.renderer?.pages)) {
      try {
        await this.view.next()
      } catch (err) {
        console.warn('[FoliateReader] next-page navigation failed:', err)
      }
      return
    }
    // scroll-mode chapter switch skips the current chapter's tail — an explicit
    // jump, so close the reading segment; a page-mode turn merely crossing the
    // boundary is continuous reading (that page was read) and must not close
    if (this.readingMode === 'scroll') this.emit('userJump')
    const nextIndex = this.currentSectionIndex + 1
    const armTarget = nextIndex < (this.book?.sections?.length ?? 0) ? { sectionIndex: nextIndex } : undefined
    const pending = shouldArmPending(1, this.book, this.currentSectionIndex) || armTarget
      ? this.beginPendingNavigation(armTarget)
      : null
    try {
      if (this.readingMode === 'page') {
        await this.view?.next()
      } else {
        await this.view?.renderer?.nextSection()
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.warn('[FoliateReader] next navigation failed:', error)
      this.emit('navigateError', { target: `chapter:${nextIndex}`, sectionIndex: nextIndex, error })
    } finally {
      if (pending !== null) this.navigationPending.end(pending)
    }
  }

  async prev() {
    if (!this.view) return
    this.navigationIntent++
    this.emit('userInteraction')
    if (this.readingMode === 'page'
      && !turnsCrossChapter(-1, this.view.renderer?.page, this.view.renderer?.pages)) {
      try {
        await this.view.prev()
      } catch (err) {
        console.warn('[FoliateReader] previous-page navigation failed:', err)
      }
      return
    }
    if (this.readingMode === 'scroll') this.emit('userJump')
    const prevIndex = this.currentSectionIndex - 1
    const armTarget = prevIndex >= 0 ? { sectionIndex: prevIndex } : undefined
    const pending = shouldArmPending(-1, this.book, this.currentSectionIndex) || armTarget
      ? this.beginPendingNavigation(armTarget)
      : null
    try {
      if (this.readingMode === 'page') {
        await this.view?.prev()
      } else {
        await this.view?.renderer?.prevSection()
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      console.warn('[FoliateReader] previous navigation failed:', error)
      this.emit('navigateError', { target: `chapter:${prevIndex}`, sectionIndex: prevIndex, error })
    } finally {
      if (pending !== null) this.navigationPending.end(pending)
    }
  }

  applyReadingMode(mode: ReadingMode) {
    this.readingMode = mode
    this.emit('readingSettingsChanged')
    if (!this.view?.renderer) return
    this.view.renderer.setAttribute('flow', mode === 'page' ? 'paginated' : 'scrolled')
    this.updateLayout()
    this.applyStyles()
  }

  applyPageColumns(columns: number) {
    this.pageColumns = Math.max(1, Math.min(3, columns))
    this.emit('readingSettingsChanged')
    if (!this.view?.renderer) return
    this.view.renderer.setAttribute('max-column-count', String(this.pageColumns))
  }

  applyColumnGap(gapPercent: number) {
    this.columnGap = Math.max(0, Math.min(15, gapPercent))
    this.emit('readingSettingsChanged')
    if (!this.view?.renderer) return
    this.view.renderer.setAttribute('gap', `${this.columnGap}%`)
  }

  applyPageAnimation(enabled: boolean) {
    this.pageAnimation = enabled
    this.emit('readingSettingsChanged')
    if (!this.view?.renderer) return
    this.view.renderer.toggleAttribute('animated', enabled)
  }

  applyShowHeader(enabled: boolean) {
    this.showHeader = enabled
    this.emit('readingSettingsChanged')
    if (!this.view?.renderer) return
    this.view.renderer.toggleAttribute('show-header', enabled)
  }

  applyShowFooter(enabled: boolean) {
    this.showFooter = enabled
    this.emit('readingSettingsChanged')
    if (!this.view?.renderer) return
    this.view.renderer.toggleAttribute('show-footer', enabled)
  }

  private bookTitle(): string {
    const title = this.book?.metadata?.title
    return typeof title === 'string' ? title : ''
  }

  applyReadingTheme(theme: { bg: string; text: string; primary?: string }) {
    this.theme = theme
    this.emit('readingSettingsChanged')
    if (!this.view?.renderer) return
    this.view.renderer.style.setProperty('--bd-tts-highlight', ttsHighlightColor(theme))
    this.view.renderer.style.setProperty('--bd-search-highlight', searchHighlightColor(theme))
    this.view.renderer.style.setProperty('--bd-search-active-highlight', searchActiveHighlightColor(theme))
    this.view.renderer.style.setProperty('--bd-search-active-border', searchActiveBorderColor(theme))
    this.view.renderer.style.setProperty('background-color', theme.bg)
    if (this.view.isFixedLayout) {
      const contents = this.view.renderer.getContents?.() as Array<{ doc?: Document }> | undefined
      for (const { doc } of contents ?? []) {
        if (doc) this.applyFixedLayoutDocumentStyles(doc)
      }
    }
    this.view.renderer.setAttribute('background-color', theme.bg)
    this.applyStyles()
  }

  applyFont(cfg: FontConfig) {
    this.font = cfg
    this.emit('readingSettingsChanged')
    this.applyStyles()
  }

  applyParagraphStyle(cfg: ParagraphStyle) {
    this.paragraph = cfg
    this.emit('readingSettingsChanged')
    for (const doc of this.activeDocs) setEpubParagraphWhitespace(doc, cfg.overrideBookLayout)
    this.applyStyles()
    this.updateLayout()
  }

  applyPageWidth(width: number) {
    this.pageWidth = width
    this.emit('readingSettingsChanged')
    this.updateLayout()
  }

  // Width semantics are shared between modes: effective content width =
  // min(pageWidth, viewport - 2 * horizontalPadding), pageWidth = 0 means
  // "auto" (no cap). In page mode the paginator resolves this from two
  // independent inputs — `max-inline-size` (the cap; a huge sentinel for
  // auto) and `gutter` (the minimum distance to the viewport edges) —
  // because body padding inside the iframe only applies to the first/last
  // page of the fragmented flow. In scrolled mode the same formula falls
  // out of body max-width + body padding (body stays content-box, so
  // max-width caps the text and the padding sits outside it). Vertical
  // insets in page mode go through the paginator's top/bottom-margin.
  private updateLayout() {
    if (!this.view?.renderer) return
    const isPage = this.readingMode === 'page'
    const cap = this.pageWidth > 0 ? Math.max(320, this.pageWidth) : 100000
    this.view.renderer.setAttribute('max-inline-size', String(cap))
    this.view.renderer.setAttribute('gutter', `${this.paragraph.horizontalPadding}px`)
    const vPad = isPage ? this.paragraph.verticalPadding : 0
    this.view.renderer.setAttribute('top-margin', `${vPad}px`)
    this.view.renderer.setAttribute('bottom-margin', `${vPad}px`)
  }

  private conversionReload: Promise<void> = Promise.resolve()

  applyChineseConversion(mode: ChineseConversion): Promise<void> {
    if (mode === this.conversion) return this.conversionReload
    this.conversion = mode
    this.emit('readingSettingsChanged')
    conversionMode = mode
    if (!this.view || !this.book) return Promise.resolve()
    // Serialize reloads: rapid toggles must not interleave close/open, or two
    // renderer elements would stack inside the view.
    this.conversionReload = this.conversionReload
      .catch(() => {})
      .then(() => this.reloadViewForConversion())
    return this.conversionReload
  }

  // Text replacements (文本替换 P1): same load-time caching as Chinese
  // conversion, so a rule-set change takes effect via the same close/reopen
  // reload. The module-level rules are always updated — they are what the
  // transformTarget listener reads for sections loaded after this call.
  applyTextReplacements(rules: TextReplacementRule[]): Promise<void> {
    this.replacements = rules
    const json = JSON.stringify(rules)
    if (json === this.replacementsJson) return this.conversionReload
    this.replacementsJson = json
    this.emit('readingSettingsChanged')
    setActiveReplacements(rules)
    if (!this.view || !this.book) return Promise.resolve()
    this.conversionReload = this.conversionReload
      .catch(() => {})
      .then(() => this.reloadViewForConversion())
    return this.conversionReload
  }

  private async reloadViewForConversion() {
    // Load-time content replacements (text replacements, Chinese conversion) are
    // cached per section URL, so a change only takes effect by tearing the
    // view down — paginator
    // destroy() unloads every loaded section (adjacent preloads in continuous
    // mode included), clearing the loader cache — and reopening it.
    this.emit('ttsInvalidated')
    this.clearTtsHighlight()
    const cfi = this.lastCfi
    const fraction = this.lastFraction
    try { this.view.close() } catch { /* partial init */ }
    if (this.destroyed) return
    await applyTocConversion(this.book, this.conversion)
    await this.view.open(this.book)
    if (this.destroyed) return
    this.emitTocReady()
    // close() drops the renderer element, so renderer-level attributes and
    // styles must be re-applied.
    this.applyAllSettings()
    try {
      if (cfi) await this.display(cfi, { internal: true })
      else if (fraction != null) await this.view.goToFraction(fraction)
    } catch {
      // position may no longer resolve after conversion
    }
  }

  applyContinuousScroll(mode: ContinuousScroll) {
    this.continuousScroll = mode
    this.emit('readingSettingsChanged')
    if (mode === 'seamless') this.applyReadingMode('scroll')
    const renderer = this.view?.renderer
    if (!renderer) return
    // snap-turn and continuous are mutually exclusive in the paginator
    if (mode === 'snap') {
      renderer.setAttribute('snap-turn', '')
      renderer.removeAttribute('continuous')
      renderer.setAttribute('no-continuous-scroll', '')
    } else if (mode === 'seamless') {
      renderer.removeAttribute('snap-turn')
      renderer.setAttribute('continuous', '')
      renderer.removeAttribute('no-continuous-scroll')
    } else {
      renderer.removeAttribute('snap-turn')
      renderer.removeAttribute('continuous')
      renderer.setAttribute('no-continuous-scroll', '')
    }
  }

  async scrollToPercent(percent: number) {
    // The progress-strip drag is a user jump — record the position being left,
    // confirmed by handleRelocate once the position actually changed
    this.pendingJumpFrom = this.lastCfi ?? ''
    // …and close the reading segment so the seek stretch never joins the union
    this.emit('userJump')
    const clamped = Math.max(0, Math.min(1, percent / 100))
    const boundaries = this.getSectionFractions()
    const index = chapterIndexAtFraction(boundaries, clamped * 100)
    const target = index === null ? undefined : {
      sectionIndex: index,
      fraction: clamped,
      isJump: true,
    }
    const gen = this.beginPendingNavigation(target)
    try {
      await this.view?.goToFraction(clamped)
    } catch (err) {
      console.warn('[FoliateReader] progress seek failed:', err)
    } finally {
      this.navigationPending.end(gen)
    }
  }

  async scrollByPages(delta: number, distanceOverride?: number, opts?: { internal?: boolean }) {
    if (!opts?.internal) this.emit('userInteraction')
    // In scrolled mode a full-viewport jump drops the half line at the page
    // edge; overlap 8% so the old page's last line reappears on the new one.
    // renderer.size is the paginator's viewport size (height when scrolled).
    const size = this.view?.renderer?.size
    const pageDistance = this.readingMode === 'scroll' && size ? Math.round(size * 0.92) : undefined
    const distance = this.readingMode === 'scroll'
      ? distanceOverride ?? pageDistance
      : undefined
    const steps = Math.abs(delta)
    const renderer = this.view?.renderer
    if (this.readingMode === 'scroll' && !opts?.internal
      && typeof renderer?.scrollByViewport === 'function') {
      for (let i = 0; i < steps; i++)
        await renderer.scrollByViewport(delta > 0 ? 1 : -1, distance)
      return
    }
    for (let i = 0; i < steps; i++) {
      if (delta > 0) await this.view?.next(distance)
      else await this.view?.prev(distance)
    }
  }

  async scrollByPixels(delta: number) {
    const renderer = this.view?.renderer
    if (!renderer || this.readingMode !== 'scroll' || !Number.isFinite(delta) || delta === 0) return false
    if (typeof renderer.scrollByPixels === 'function') {
      const result = await renderer.scrollByPixels(delta)
      return result !== false
    }
    const before = renderer.containerPosition
    renderer.containerPosition = before + scrollForwardSign(renderer.scrollProp) * delta
    const moved = renderer.containerPosition !== before
    if (moved) return true
    if (renderer.hasAttribute('continuous')) {
      // A continuous buffer can be temporarily exhausted while the next
      // section is still inflating. Explicitly advance in that stalled case;
      // otherwise auto-reading reaches a chapter boundary and silently stops.
      if (delta > 0 && !renderer.atEnd) {
        await renderer.next(0)
        return true
      }
      if (delta < 0 && !renderer.atStart) {
        await renderer.prev(0)
        return true
      }
      return false
    }
    if (renderer.hasAttribute('snap-turn')
      && delta > 0 && renderer.start + renderer.size >= renderer.viewSize - 2) {
      await renderer.next(0)
      return true
    } else if (renderer.hasAttribute('snap-turn') && delta < 0 && renderer.start <= 2) {
      await renderer.prev(0)
      return true
    }
    return false
  }

  isAtEnd(): boolean {
    const renderer = this.view?.renderer
    if (!renderer) return false
    return Boolean(renderer.atBookEnd ?? renderer.atEnd)
  }

  setAutoReadingActive(active: boolean) {
    if (active === this.autoReadingActive) return
    this.autoReadingActive = active
    const renderer = this.view?.renderer
    if (active) {
      if (this.continuousScroll !== 'snap' || this.readingMode !== 'scroll' || !renderer) return
      this.autoReadingSnapTurn = renderer.hasAttribute('snap-turn')
      // Keep snap-turn enabled. Paginator owns the same-direction boundary
      // accumulation for both wheel input and smooth auto-reading frames.
      return
    }
    if (this.autoReadingSnapTurn !== null && renderer) {
      if (this.autoReadingSnapTurn) renderer.setAttribute('snap-turn', '')
      else renderer.removeAttribute('snap-turn')
    }
    this.autoReadingSnapTurn = null
  }

  private async ensureTts(): Promise<any | null> {
    if (!this.view?.renderer?.getContents) return null
    try {
      return await this.view.initTTS(false) ?? this.view.tts ?? null
    } catch {
      return null
    }
  }

  async getMediaOverlayCues(sectionIndex = this.currentSectionIndex): Promise<MediaOverlayCue[]> {
    const section = this.book?.sections?.[sectionIndex]
    const mediaOverlayHref = section?.mediaOverlay?.href
    const loadText = this.book?.loadSectionText ?? this.book?.loadText
    if (!section?.id || typeof mediaOverlayHref !== 'string' || typeof loadText !== 'function') return []
    let adapter = this.mediaOverlaySections.get(sectionIndex)
    if (!adapter) {
      adapter = new MediaOverlaySection({
        sectionIndex,
        sectionHref: section.id,
        mediaOverlayHref,
        loadText: (href) => loadText.call(this.book, href),
      })
      this.mediaOverlaySections.set(sectionIndex, adapter)
    }
    return adapter.load()
  }

  hasMediaOverlay(): boolean {
    return Boolean(this.book?.sections?.some((section: any) => section.mediaOverlay))
  }

  async getMediaOverlayCueRange(sectionIndex: number, cueIndex: number): Promise<Range | null> {
    const cues = await this.getMediaOverlayCues(sectionIndex)
    const cue = cues[cueIndex]
    if (!cue) return null
    const content = this.view?.renderer?.getContents?.().find((item: any) => item.index === sectionIndex)
    if (!content?.doc) return null
    const adapter = this.mediaOverlaySections.get(sectionIndex)
    return adapter?.resolveRange(cue, content.doc) ?? null
  }

  private async mediaOverlaySegmentAt(sectionIndex: number, cueIndex: number): Promise<TtsSegment | null> {
    const cues = await this.getMediaOverlayCues(sectionIndex)
    const cue = cues[cueIndex]
    const adapter = this.mediaOverlaySections.get(sectionIndex)
    if (!cue || !adapter) return null
    let range = await this.getMediaOverlayCueRange(sectionIndex, cueIndex)
    if (!range && this.view?.renderer?.goTo) {
      this.ttsNavigation = true
      try {
        await this.view.renderer.goTo({
          index: sectionIndex,
          anchor: (doc: Document) => adapter.resolveRange(cue, doc),
        })
      } finally {
        this.ttsNavigation = false
      }
      range = await this.getMediaOverlayCueRange(sectionIndex, cueIndex)
    }
    if (!range) return null
    const text = range.toString().replace(/\s+/g, ' ').trim()
    if (!text) return null
    let cfi = ''
    try {
      cfi = this.view?.getCFI?.(sectionIndex, range) ?? ''
    } catch {
      cfi = ''
    }
    if (!cfi) return null
    return {
      id: `${this.bookId}:${sectionIndex}:media-overlay:${cueIndex}:${ttsTextHash(text)}`,
      text,
      cfi,
      chapterIndex: sectionIndex,
      mediaOverlay: { sectionIndex, cueIndex, cue },
    }
  }

  async getMediaOverlaySegment(startCfi?: string): Promise<TtsSegment | null> {
    let startIndex = this.currentSectionIndex
    if (startCfi?.startsWith('epubcfi(')) {
      startIndex = this.view?.resolveCFI?.(startCfi)?.index ?? startIndex
    }
    for (let sectionIndex = Math.max(0, startIndex); sectionIndex < (this.book?.sections?.length ?? 0); sectionIndex++) {
      const cues = await this.getMediaOverlayCues(sectionIndex)
      for (let cueIndex = 0; cueIndex < cues.length; cueIndex++) {
        const segment = await this.mediaOverlaySegmentAt(sectionIndex, cueIndex)
        if (segment) return segment
      }
    }
    return null
  }

  async nextMediaOverlaySegment(segment: TtsSegment): Promise<TtsSegment | null> {
    const metadata = segment.mediaOverlay
    if (!metadata) return this.getMediaOverlaySegment()
    const sectionCount = this.book?.sections?.length ?? 0
    for (let sectionIndex = metadata.sectionIndex; sectionIndex < sectionCount; sectionIndex++) {
      const cues = await this.getMediaOverlayCues(sectionIndex)
      const firstCue = sectionIndex === metadata.sectionIndex ? metadata.cueIndex + 1 : 0
      for (let cueIndex = firstCue; cueIndex < cues.length; cueIndex++) {
        const next = await this.mediaOverlaySegmentAt(sectionIndex, cueIndex)
        if (next) return next
      }
    }
    return null
  }

  async previousMediaOverlaySegment(segment: TtsSegment): Promise<TtsSegment | null> {
    const metadata = segment.mediaOverlay
    if (!metadata) return this.getMediaOverlaySegment()
    for (let sectionIndex = metadata.sectionIndex; sectionIndex >= 0; sectionIndex--) {
      const cues = await this.getMediaOverlayCues(sectionIndex)
      const firstCue = sectionIndex === metadata.sectionIndex ? metadata.cueIndex - 1 : cues.length - 1
      for (let cueIndex = firstCue; cueIndex >= 0; cueIndex--) {
        const previous = await this.mediaOverlaySegmentAt(sectionIndex, cueIndex)
        if (previous) return previous
      }
    }
    return null
  }

  async getMediaOverlayAudio(segment: TtsSegment): Promise<Blob | null> {
    const cue = segment.mediaOverlay?.cue
    return cue ? this.getMediaOverlayAudioByHref(cue.audioHref) : null
  }

  async getMediaOverlayAudioByHref(audioHref: string): Promise<Blob | null> {
    const loadBlob = this.book?.loadBlob
    if (!audioHref || typeof loadBlob !== 'function') return null
    return loadBlob.call(this.book, audioHref)
  }

  private ttsDetailToSegment(detail: any): TtsSegment | null {
    const text = typeof detail?.text === 'string' ? detail.text.replace(/\s+/g, ' ').trim() : ''
    const cfi = typeof detail?.cfi === 'string' ? detail.cfi : ''
    if (!text || !cfi) return null
    return {
      id: `${this.bookId}:${this.currentSectionIndex}:${cfi}:${ttsTextHash(text)}`,
      text,
      cfi,
      chapterIndex: this.currentSectionIndex,
    }
  }

  private rangeForTtsCfi(cfi: string): Range | null {
    const resolved = this.book?.resolveCFI?.(cfi)
    if (!resolved?.anchor) return null
    const contents = this.view?.renderer?.getContents?.() ?? []
    const content = contents.find((item: any) => item.index === resolved.index)
    if (!content?.doc) return null
    try {
      return resolved.anchor(content.doc) as Range
    } catch {
      return null
    }
  }

  private ttsSegmentBounds(segment: TtsSegment): { top: number; bottom: number } | null {
    const range = this.rangeForTtsCfi(segment.cfi)
    const doc = range?.startContainer.ownerDocument
    if (!range || !doc) return null
    let top = Number.POSITIVE_INFINITY
    let bottom = Number.NEGATIVE_INFINITY
    for (const rect of Array.from(range.getClientRects())) {
      const mapped = this.popupRect(doc, range, rect)
      if (!mapped || mapped.height <= 0) continue
      top = Math.min(top, mapped.top)
      bottom = Math.max(bottom, mapped.top + mapped.height)
    }
    return Number.isFinite(top) && Number.isFinite(bottom) ? { top, bottom } : null
  }

  async getTtsSegment(startCfi?: string): Promise<TtsSegment | null> {
    let tts = await this.ensureTts()
    if (!tts) return null
    let detail: any = null
    if (startCfi?.startsWith('epubcfi(')) {
      const range = this.rangeForTtsCfi(startCfi)
      if (range) {
        tts.from(range, { highlight: false })
        detail = tts.currentDetail?.()
      } else {
        this.ttsNavigation = true
        try { await this.view?.goTo(startCfi) } finally { this.ttsNavigation = false }
        tts = await this.ensureTts()
        detail = tts?.currentDetail?.()
      }
    } else if (this.lastRange) {
      try {
        tts.from(this.lastRange.cloneRange(), { highlight: false })
        const currentDetail = tts.currentDetail?.()
        const viewport = this.container?.getBoundingClientRect()
        const details = tts.collectDetails?.(24, { includeCurrent: true, offset: 1 }) ?? (currentDetail ? [currentDetail] : [])
        let fallbackDetail = currentDetail
        for (const candidate of details) {
          const segment = this.ttsDetailToSegment(candidate)
          if (!segment) continue
          fallbackDetail ??= candidate
          if (!viewport || viewport.height <= 0) {
            detail = candidate
            break
          }
          const bounds = this.ttsSegmentBounds(segment)
          if (bounds && bounds.top >= viewport.top + TTS_START_VIEWPORT_INSET && bounds.bottom <= viewport.bottom - TTS_START_VIEWPORT_INSET) {
            detail = candidate
            break
          }
        }
        detail ??= fallbackDetail
      } catch { /* stale iframe range */ }
    }
    detail ??= tts.currentDetail?.()
    return this.ttsDetailToSegment(detail)
  }

  async getTtsChapterStartSegment(): Promise<TtsSegment | null> {
    const tts = await this.ensureTts()
    if (!tts) return null
    tts.start?.({ highlight: false })
    return this.ttsDetailToSegment(tts.currentDetail?.())
  }

  async peekTtsSegments(count = 4): Promise<TtsSegment[]> {
    const tts = await this.ensureTts()
    if (!tts?.collectDetails) return []
    const details = tts.collectDetails(count, { offset: 1 })
    return details.map((detail: any) => this.ttsDetailToSegment(detail)).filter((segment: TtsSegment | null): segment is TtsSegment => Boolean(segment))
  }

  private async moveTtsChapter(direction: 'next' | 'previous'): Promise<boolean> {
    const renderer = this.view?.renderer
    if (!renderer) return false
    const before = this.currentSectionIndex
    this.clearTtsHighlight()
    this.ttsNavigation = true
    try {
      if (direction === 'next') await renderer.nextSection?.()
      else await renderer.prevSection?.()
    } finally {
      this.ttsNavigation = false
    }
    return this.currentSectionIndex !== before
  }

  async nextTtsSegment(): Promise<TtsSegment | null> {
    const tts = await this.ensureTts()
    if (!tts) return null
    const nextText = tts.next?.()
    let detail = nextText ? tts.currentDetail?.() : null
    if (!nextText && await this.moveTtsChapter('next')) {
      detail = (await this.ensureTts())?.currentDetail?.()
    }
    return this.ttsDetailToSegment(detail)
  }

  async previousTtsSegment(): Promise<TtsSegment | null> {
    const tts = await this.ensureTts()
    if (!tts) return null
    const previousText = tts.prev?.()
    let detail = previousText ? tts.currentDetail?.() : null
    if (!previousText && await this.moveTtsChapter('previous')) {
      const previous = await this.ensureTts()
      previous?.end?.({ highlight: false })
      detail = previous?.currentDetail?.()
    }
    return this.ttsDetailToSegment(detail)
  }

  async revealTtsSegment(segment: TtsSegment): Promise<void> {
    const range = this.rangeForTtsCfi(segment.cfi)
    const viewport = this.container?.getBoundingClientRect()
    const rangeDocument = range?.startContainer.ownerDocument
    const firstLineClientRect = range?.getClientRects?.()[0]
    const segmentRect = range && rangeDocument
      ? this.popupRect(rangeDocument, range)
      : undefined
    const segmentStartRect = range && rangeDocument && firstLineClientRect
      ? this.popupRect(rangeDocument, range, firstLineClientRect)
      : undefined
    if (segmentRect && viewport && viewport.height > 0) {
      const action = ttsViewportAction(
        { top: segmentRect.top, bottom: segmentRect.top + segmentRect.height },
        viewport,
        segmentStartRect
          ? { top: segmentStartRect.top, bottom: segmentStartRect.top + segmentStartRect.height }
          : { top: segmentRect.top, bottom: segmentRect.top + segmentRect.height },
      )
      if (action === 'stay') return
      if (action === 'advance') {
        const topInset = 16
        const safeDistance = segmentStartRect
          ? Math.max(1, Math.round(segmentStartRect.top - viewport.top - topInset))
          : undefined
        const size = this.view?.renderer?.size
        const pageDistance = this.readingMode === 'scroll' && size ? Math.round(size * 0.92) : undefined
        const distance = pageDistance !== undefined && safeDistance !== undefined
          ? Math.min(pageDistance, safeDistance)
          : undefined
        this.ttsNavigation = true
        try { await this.scrollByPages(1, distance, { internal: true }) } finally { this.ttsNavigation = false }
        return
      }
    }
    this.ttsNavigation = true
    try { await this.view?.goTo(segment.cfi) } finally { this.ttsNavigation = false }
  }

  async highlightTtsSegment(segment: TtsSegment): Promise<void> {
    ;(await this.ensureTts())?.highlightCfi?.(segment.cfi)
  }

  clearTtsHighlight() {
    try { this.view?.initTTS?.(true) } catch { /* view may be between reloads */ }
  }

  pauseInlineMedia(): void {
    for (const doc of this.activeDocs) {
      for (const el of doc.querySelectorAll('audio, video')) {
        try {
          const media = el as HTMLMediaElement
          if (!media.paused) media.pause()
        } catch { /* ignore */ }
      }
    }
  }

  setMediaOverlayHighlight(range: Range | null): void {
    if (!range) {
      this.clearMediaOverlayHighlight()
      return
    }
    try {
      const cfi = this.view?.getCFI?.(this.currentSectionIndex, range)
      if (cfi) {
        this.view?.tts?.highlightCfi?.(cfi)
      }
    } catch { /* ignore */ }
  }

  clearMediaOverlayHighlight(): void {
    this.clearTtsHighlight()
  }

  // --- Selection & annotations -------------------------------------------

  private popupRect(doc: Document, range: Range, clientRect?: DOMRect): PopupRect | undefined {
    try {
      const frame = doc.defaultView?.frameElement as HTMLElement | null
      if (!frame) return undefined
      const transform = getComputedStyle(frame).transform
      const matrix = transform?.match(/matrix\((.+)\)/)
      const [sx, , , sy] = matrix?.[1]?.split(/\s*,\s*/)?.map(Number) ?? []
      const scaleX = Number.isFinite(sx) ? sx! : 1
      const scaleY = Number.isFinite(sy) ? sy! : 1
      const frameRect = frame.getBoundingClientRect()
      const rect = clientRect ?? range.getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) return undefined
      return {
        left: scaleX * rect.left + frameRect.left,
        top: scaleY * rect.top + frameRect.top,
        width: scaleX * rect.width,
        height: scaleY * rect.height,
      }
    } catch {
      return undefined
    }
  }

  private handleSelection(doc: Document, index: number) {
    // The selection is not final yet on the commit event — read it after this tick.
    setTimeout(() => {
      try {
        const sel = doc.defaultView?.getSelection?.()
        const range = sel && !sel.isCollapsed && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
        const text = range?.toString().replace(/\s+/g, ' ').trim() ?? ''
        const rawText = sel?.toString().trim() ?? ''
        if (!range || !text) {
          if (this.selectionActive) {
            this.selectionActive = false
            this.emit('selected', null)
          }
          return
        }
        const cfiRange = this.view?.getCFI?.(index, range)
        if (!cfiRange) return
        this.selectionActive = true
        const startNode = range.startContainer
        const beforeText = textBeforeSelection(doc, range)
        const paragraphText = textParagraphSelection(range)
        const info: SelectionInfo = {
          cfiRange,
          text: text.slice(0, 500),
          rawText,
          chapterIndex: index,
          ...(beforeText ? { beforeText } : {}),
          ...(paragraphText ? { paragraphText } : {}),
          rect: this.popupRect(doc, range),
          pointText: textContentSelection(doc, range),
          // Point-patch anchors (P2): the offset is counted on the rendered
          // document (conversion is length-preserving, so it equals the
          // engine's coordinate system); pointText preserves cross-node text.
          startOffset: startNode.nodeType === Node.TEXT_NODE
            ? textContentOffset(doc, startNode as Text, range.startOffset) ?? undefined
            : undefined,
          sectionHref: this.book?.sections?.[index]?.id as string | undefined,
          singleTextNode: startNode === range.endContainer && startNode.nodeType === Node.TEXT_NODE,
        }
        if (autoMarkSelectionMode) {
          // 选中即划: create immediately but keep the toolbar open (restyle)
          this.emit('instantAnnotation', { ...info, keepSelection: true })
        }
        this.emit('selected', info)
      } catch {
        // ignore selection errors
      }
    }, 0)
  }

  private handleSelectionChange(doc: Document) {
    const sel = doc.defaultView?.getSelection?.()
    if (sel && !sel.isCollapsed && sel.rangeCount > 0 && !this.selectionActive) {
      this.selectionDismissPending = false
      this.emit('textSelectionStart')
    }
    if ((!sel || sel.isCollapsed || sel.rangeCount === 0) && this.selectionActive) {
      this.selectionActive = false
      this.emit('selected', null)
    }
  }

  deselect() {
    // Silent on purpose: without clearing the flag first the doc's
    // selectionchange listener emits ('selected', null) and unmounts the
    // toolbar before it can show the fresh highlight's restyle state.
    // Callers that DO want the bubble gone emit the event themselves.
    this.selectionActive = false
    try { this.view?.deselect?.() } catch { /* view may be gone */ }
  }

  clearSelection() {
    const wasActive = this.selectionActive
    this.deselect()
    if (wasActive) this.emit('selected', null)
  }

  setAnnotations(annotations: ReaderAnnotation[]) {
    performance.mark('bd:ann:set')
    this.annotationMap = new Map(annotations.map((a) => [`${a.cfiRange}|${a.type}`, a]))
    const { buckets, uncategorized } = buildAnnotationBuckets(annotations)
    this.annotationBuckets = buckets
    this.uncategorizedAnnotations = uncategorized
    this.syncAnnotations()
  }

  private syncAnnotations() {
    if (!this.view) return
    const next = new Map<string, string>(
      Array.from(this.annotationMap.values(), (a) => [`${a.cfiRange}|${a.type}`, `${a.type}|${a.color}|${a.style ?? ''}`] as const),
    )
    for (const value of Array.from(this.renderedAnnotations.keys())) {
      if (!next.has(value)) {
        this.renderedAnnotations.delete(value)
        Promise.resolve(this.view.deleteAnnotation({ value })).catch(() => {})
      }
    }
    for (const [value, key] of next) {
      if (this.renderedAnnotations.get(value) === key) continue
      if (this.renderedAnnotations.has(value)) {
        Promise.resolve(this.view.deleteAnnotation({ value })).catch(() => {})
      }
      this.renderedAnnotations.set(value, key)
      this.addAnnotationValue(value)
    }
  }

  // addAnnotation with orphan detection (P2): the promise resolves with
  // `{ index: -1 }` when the CFI's spine part cannot be resolved, and rejects
  // when the text offset overflows the section (CFI.toRange throws) — both
  // mean the annotation can never be drawn again. Deletion and search
  // highlights keep the fire-and-forget path: a delete of an unresolvable
  // annotation would otherwise report a false orphan.
  private addAnnotationValue(value: string, detectOrphan = true) {
    const promise = Promise.resolve(this.view?.addAnnotation({ value }))
    if (!detectOrphan) {
      promise.catch(() => {})
      return
    }
    promise
      .then((res: unknown) => {
        const r = res as { index?: number } | null
        if (r && typeof r.index === 'number' && r.index < 0) this.reportOrphan(value)
      })
      .catch(() => this.reportOrphan(value))
  }

  private reportOrphan(value: string) {
    const ann = this.annotationMap.get(value)
    if (!ann) return
    this.emit('annotationOrphaned', { cfiRange: ann.cfiRange, type: ann.type })
  }

  private handleDrawAnnotation(detail: any) {
    const { draw, annotation } = detail ?? {}
    if (!draw || !annotation?.value || !this.foliateOverlayer) return
    const ann = this.annotationMap.get(annotation.value)
    if (!ann) return // skip if annotation data isn't in map yet — syncAnnotations will re-trigger
    const color = ANNOTATION_COLORS[ann.color ?? ''] ?? DEFAULT_ANNOTATION_COLOR
    if (ann.type === 'note') {
      // Ideas always render as a dashed underline in their theme color (WeChat Reading style)
      draw(this.foliateOverlayer.dashedUnderline, { color })
    } else if (ann.style === 'highlight') {
      draw(this.foliateOverlayer.highlight, { color: `${color}55` })
    } else {
      draw(ann.style === 'squiggly' ? this.foliateOverlayer.squiggly : this.foliateOverlayer.underline, { color })
    }
    performance.mark('bd:ann:draw')
    this.reportHighlightTiming()
  }

  // Segment timing for highlight creation: click → POST done → cache pushed
  // into the renderer → drawn. Reports once per highlight click, then clears.
  private reportHighlightTiming() {
    if (!performance.getEntriesByName('bd:hl:click').length) return
    const segments: string[] = []
    const measure = (name: string, from: string, to: string) => {
      try {
        const m = performance.measure(name, from, to)
        if (m.duration >= 0) segments.push(`${name}=${m.duration.toFixed(1)}ms`)
      } catch { /* one of the marks is missing */ }
    }
    measure('bd:click→post', 'bd:hl:click', 'bd:hl:post-done')
    measure('bd:click→set', 'bd:hl:click', 'bd:ann:set')
    measure('bd:click→draw', 'bd:hl:click', 'bd:ann:draw')
    if (segments.length) console.debug(`[bd] highlight ${segments.join(' ')}`)
    for (const name of ['bd:hl:click', 'bd:hl:post-done', 'bd:ann:set', 'bd:ann:draw']) performance.clearMarks(name)
    for (const name of ['bd:click→post', 'bd:click→set', 'bd:click→draw']) performance.clearMeasures(name)
  }

  private handleShowAnnotation(detail: any) {
    const { value, range } = detail ?? {}
    if (!value) return
    // values are `${cfiRange}|${type}`; strip the type suffix before emitting
    const cfiRange = typeof value === 'string' && value.includes('|')
      ? value.slice(0, value.lastIndexOf('|'))
      : value
    try {
      const doc = range && (range as Range).startContainer?.ownerDocument as Document | undefined
      const rect = doc && range ? this.popupRect(doc, range as Range) : undefined
      this.emit('annotationClicked', { cfiRange, rect })
    } catch {
      this.emit('annotationClicked', { cfiRange })
    }
  }

  async search(
    query: string,
    opts?: SearchOptions,
    onProgress?: (results: SearchResult[], progress: number | null) => void,
  ): Promise<SearchResult[]> {
    const q = query.trim()
    if (!q || !this.view || !this.book) return []
    // New search supersedes any in-flight one: the old loop observes the
    // generation bump and stops consuming chapters at the next boundary
    const gen = ++this.searchGen
    this.clearSearchHighlights()

    // Session cache hit: replay the results and restore highlight state for
    // the currently rendered sections (chapter-scoped searches are instant and
    // their key would need the section index, so they're never cached)
    const cacheable = opts?.scope !== 'chapter'
    const replacementKey = JSON.stringify(this.replacements)
    const cacheKey = cacheable
      ? `${this.url}|${opts?.scope ?? 'book'}|${opts?.mode ?? 'contains'}|${opts?.matchCase ?? false}|${this.conversion}|${replacementKey}|${q}`
      : ''
    const cached = cacheable ? searchCache.get(cacheKey) : undefined
    if (cached) {
      // refresh recency
      searchCache.delete(cacheKey)
      searchCache.set(cacheKey, cached)
      for (const [index, matches] of cached.matches) {
        this.searchMatchOffsets.set(index, matches)
        this.searchMatchTexts.set(index, cached.matchTexts.get(index) ?? [])
        this.drawSearchHighlights(index, matches)
      }
      if (onProgress) onProgress(cached.results, 1)
      return cached.results
    }

    const sections: any[] = this.book.sections ?? []
    const indices: number[] = []
    if (opts?.scope === 'chapter') {
      if (sections[this.currentSectionIndex]?.id) indices.push(this.currentSectionIndex)
    } else {
      for (let i = 0; i < sections.length; i++) {
        // sections[i].id is the manifest href — the loadSectionText key;
        // non-linear sections (cover pages etc.) are skipped
        if (sections[i]?.id && sections[i].linear !== 'no') indices.push(i)
      }
    }

    const results: SearchResult[] = []
    let progress: number | null = null
    let lastEmit = 0
    // Throttle partial-result emits: hundreds of matches arrive in quick bursts
    const emit = (force = false) => {
      if (!onProgress) return
      const now = Date.now()
      if (!force && now - lastEmit < 80) return
      lastEmit = now
      onProgress([...results], progress)
    }
    const stale = () => gen !== this.searchGen || this.destroyed

    for (let done = 0; done < indices.length; done++) {
      if (stale()) break
      const index = indices[done]!
      const chapterText = await getChapterText(this.book, index, {
        chineseConversion: this.conversion,
        replacements: this.replacements,
      })
      if (stale()) break
      if (chapterText?.text) {
        const matches = findMatches(chapterText.text, q, { mode: opts?.mode, matchCase: opts?.matchCase })
        if (matches.length) {
          const chapter = this.chapterLabel(index)
          for (const m of matches) {
            const excerpt = makeExcerpt(chapterText.text, m.start, m.end)
            results.push({
              // not a CFI — a lazy jump target resolved by display()
              cfi: `search-hit:${index}:${m.start}:${m.end}`,
              text: `${excerpt.pre}${excerpt.match}${excerpt.post}`,
              index: results.length,
              chapter,
              excerpt,
            })
          }
          this.searchMatchTexts.set(
            index,
            matches.map((match) => chapterText.text.slice(match.start, match.end)),
          )
          this.searchMatchOffsets.set(index, matches)
          this.drawSearchHighlights(index, matches)
        }
      }
      progress = (done + 1) / indices.length
      emit()
    }
    if (!stale()) {
      if (cacheable) {
        const entry: SearchCacheEntry = {
          results: results.slice(),
          matches: new Map(this.searchMatchOffsets),
          matchTexts: new Map(
            [...this.searchMatchTexts].map(([index, matchTexts]) => [index, [...matchTexts]]),
          ),
        }
        searchCache.set(cacheKey, entry)
        while (searchCache.size > SEARCH_CACHE_MAX) {
          const oldest = searchCache.keys().next().value
          if (oldest === undefined) break
          searchCache.delete(oldest)
        }
      }
      emit(true)
    }
    return results
  }

  // Search highlights are drawn only for currently rendered sections:
  // computing a CFI needs a live Range, and the paginator drops sections it
  // isn't showing. Best-effort while an unloaded section is waiting to render.
  private drawSearchHighlights(index: number, matches: SearchMatch[]) {
    try {
      const contents = (this.view?.renderer?.getContents?.() ?? []) as Array<{ index: number; doc?: Document }>
      const content = contents.find((c) => c.index === index && c.doc)
      if (!content?.doc) return
      const values: string[] = []
      const liveText = extractChapterText(content.doc).text
      const liveRanges = mapMatchTextsToOffsets(liveText, this.searchMatchTexts.get(index) ?? [])
      let activeRange: Range | null = null
      for (const [matchIndex, m] of matches.entries()) {
        const liveMatch = liveRanges[matchIndex]
        const range = liveMatch
          ? offsetsToRange(content.doc, liveMatch.start, liveMatch.end)
          : offsetsToRange(content.doc, m.start, m.end)
        if (!range) continue
        const cfi = this.view.getCFI(index, range)
        if (cfi) values.push(`${SEARCH_ANNOTATION_PREFIX}${cfi}`)
        if (
          this.activeSearchTarget &&
          this.activeSearchTarget.index === index &&
          this.activeSearchTarget.start === m.start &&
          this.activeSearchTarget.end === m.end
        ) {
          activeRange = range
        }
      }
      for (const value of values) {
        Promise.resolve(this.view?.addAnnotation({ value })).catch(() => {})
      }
      this.drawnSearchValues.set(index, values)
      if (activeRange) {
        this.setActiveSearchRange(index, activeRange)
      }
    } catch {
      // highlight drawing is best-effort
    }
  }

  private setActiveSearchRange(index: number, range: Range) {
    try {
      if (this.activeSearchValue) {
        Promise.resolve(this.view?.deleteAnnotation?.({ value: this.activeSearchValue })).catch(() => {})
        this.activeSearchValue = null
      }
      const cfi = this.view.getCFI(index, range)
      if (cfi) {
        const activeValue = `${SEARCH_ACTIVE_ANNOTATION_PREFIX}${cfi}`
        this.activeSearchValue = activeValue
        Promise.resolve(this.view?.addAnnotation({ value: activeValue })).catch(() => {})
      }
    } catch {
      // highlight drawing is best-effort
    }
  }

  private scheduleActiveSearchHighlightClear(delayMs: number) {
    if (this.activeSearchClearTimer) clearTimeout(this.activeSearchClearTimer)
    this.activeSearchClearTimer = setTimeout(() => {
      this.activeSearchClearTimer = null
      this.clearActiveSearchHighlight()
    }, delayMs)
  }

  clearActiveSearchHighlight() {
    if (this.activeSearchClearTimer) {
      clearTimeout(this.activeSearchClearTimer)
      this.activeSearchClearTimer = null
    }
    if (this.activeSearchValue) {
      Promise.resolve(this.view?.deleteAnnotation?.({ value: this.activeSearchValue })).catch(() => {})
      this.activeSearchValue = null
    }
  }

  private clearSearchHighlights() {
    this.clearActiveSearchHighlight()
    this.activeSearchTarget = null
    for (const values of this.drawnSearchValues.values()) {
      for (const value of values) {
        Promise.resolve(this.view?.deleteAnnotation?.({ value })).catch(() => {})
      }
    }
    this.drawnSearchValues.clear()
    this.searchMatchOffsets.clear()
    this.searchMatchTexts.clear()
  }

  clearSearch() {
    // bump the generation so an in-flight search loop stops feeding results
    this.searchGen++
    this.clearSearchHighlights()
    try { this.view?.clearSearch?.() } catch { /* view may be partially initialized */ }
  }

  /** Best-effort chapter label for a section index: TOC item label */
  private chapterLabel(index: number): string | undefined {
    try {
      return this.view?.getProgressOf?.(index)?.tocItem?.label ?? undefined
    } catch {
      return undefined
    }
  }

  // Match counts per pattern rule across the whole book ("N 处" badges in the
  // reader's per-book dialog). Reads the raw section markup through the same
  // memoized loader the render pipeline uses (original text, pre-replacements),
  // so counting never re-applies the rules. Cost: one parse per section, so
  // the caller shows it async and caches by rule signature.
  async countReplacementMatches(rules: TextReplacementRule[]): Promise<Record<string, number>> {
    const book = this.book
    if (!book) return {}
    const patternRules = rules.filter((r) => r.matchType === 'pattern' && r.pattern && r.id)
    if (!patternRules.length) return {}
    const counts = Object.fromEntries(patternRules.map((r) => [r.id, 0]))
    const indices: number[] = []
    for (let i = 0; i < (book.sections ?? []).length; i++) {
      const section = book.sections[i]
      if (section?.id && section.linear !== 'no') indices.push(i)
    }
    for (const index of indices) {
      if (this.destroyed) break
      let markup: unknown
      try {
        markup = await book.loadSectionText?.(book.sections[index].id)
      } catch {
        continue
      }
      if (typeof markup !== 'string') continue
      const per = countPatternMatches(markup, patternRules, 'application/xhtml+xml')
      for (const [id, n] of Object.entries(per)) counts[id] = (counts[id] ?? 0) + n
    }
    return counts
  }

  private aiCorpusSectionIndices(): number[] {
    const sections: any[] = this.book?.sections ?? []
    const sectionByHref = new Map<string, number>()
    for (let index = 0; index < sections.length; index++) {
      const href = sections[index]?.id
      if (typeof href !== 'string' || !href) continue
      const normalized = normalizeBookHref(href)
      if (!sectionByHref.has(normalized)) sectionByHref.set(normalized, index)
    }

    const indices: number[] = []
    let tocHrefCount = 0
    const visit = (items: any[]) => {
      for (const item of items) {
        if (typeof item?.href === 'string' && item.href) {
          tocHrefCount++
          const index = sectionByHref.get(normalizeBookHref(item.href))
          if (index !== undefined) indices.push(index)
        }
        if (Array.isArray(item?.subitems)) visit(item.subitems)
      }
    }
    if (Array.isArray(this.book?.toc)) visit(this.book.toc)
    if (tocHrefCount > 0 && indices.length === tocHrefCount) return indices

    return sections.flatMap((section, index) => section?.id ? [index] : [])
  }

  getAiCorpusVersion(): string {
    return readerTextVersion(this.conversion, this.replacements)
  }

  async getAiCorpus(signal?: AbortSignal): Promise<AiIndexCorpus> {
    const book = this.book
    if (!book) throw new Error('Reader is not ready')
    const indices = this.aiCorpusSectionIndices()
    const chapters = []
    for (const [chapterIndex, sectionIndex] of indices.entries()) {
      if (signal?.aborted || this.destroyed) throw new DOMException('The reader corpus request was aborted', 'AbortError')
      const chapterText = await getChapterText(book, sectionIndex, {
        chineseConversion: this.conversion,
        replacements: this.replacements,
      })
      if (signal?.aborted || this.destroyed) throw new DOMException('The reader corpus request was aborted', 'AbortError')
      if (!chapterText) throw new Error('Reader chapter content is not available')
      chapters.push({ chapterIndex, text: chapterText.text })
    }
    return { visibleTextVersion: this.getAiCorpusVersion(), chapters }
  }

  async getAiChapterText(chapterIndex: number, signal?: AbortSignal): Promise<string> {
    const book = this.book
    if (!book) throw new Error('Reader is not ready')
    const sectionIndex = this.aiCorpusSectionIndices()[chapterIndex]
    if (sectionIndex === undefined) throw new Error('Reader chapter is not available')
    if (signal?.aborted || this.destroyed) throw new DOMException('The reader chapter request was aborted', 'AbortError')
    const chapterText = await getChapterText(book, sectionIndex, {
      chineseConversion: this.conversion,
      replacements: this.replacements,
    })
    if (signal?.aborted || this.destroyed) throw new DOMException('The reader chapter request was aborted', 'AbortError')
    if (!chapterText) throw new Error('Reader chapter content is not available')
    return chapterText.text
  }

  getSnippet(cfi: string, maxLength = 80): string {
    try {
      // chapter:{index}:{fraction} — scrolled-mode positions without a content CFI
      if (cfi.startsWith('chapter:')) {
        return this.lastRange ? this.snippetFromRange(this.lastRange, maxLength) : ''
      }
      const resolved = this.book?.resolveCFI?.(cfi)
      if (!resolved) return ''
      const contents = this.view?.renderer?.getContents?.() ?? []
      // the bookmark is always created on a currently rendered section
      const match = contents.find((c: any) => c.index === resolved.index)
      if (!match?.doc) return ''
      const range = resolved.anchor(match.doc)
      // the range comes from the iframe's realm, so instanceof checks fail;
      // duck-type it instead
      if (!range?.startContainer || typeof range.toString !== 'function') return ''
      return this.snippetFromRange(range, maxLength)
    } catch {
      return ''
    }
  }

  getCurrentParagraphText(maxLength = 8_000): string {
    return this.lastRange ? textParagraphSelection(this.lastRange, maxLength) : ''
  }

  // Text starting at the range's start point. Location CFIs collapse to a
  // point, so walk forward through text nodes when the range itself is empty.
  private snippetFromRange(range: Range, maxLength: number): string {
    const direct = range.toString().replace(/\s+/g, ' ').trim()
    if (direct) return direct.slice(0, maxLength)
    const doc = range.startContainer.ownerDocument
    if (!doc?.body) return ''
    let text = ''
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      text += (range.startContainer.textContent ?? '').slice(range.startOffset)
      walker.currentNode = range.startContainer
    } else {
      const node = range.startContainer.childNodes[range.startOffset] ?? range.startContainer
      walker.currentNode = node
    }
    let next: Node | null
    while (text.length < maxLength && (next = walker.nextNode())) {
      text += next.textContent ?? ''
    }
    return text.replace(/\s+/g, ' ').trim().slice(0, maxLength)
  }

  private buildTocIndex() {
    this.tocHrefToIndex.clear()
    const visit = (items: any[], baseIndex: number) => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.href) this.tocHrefToIndex.set(item.href, baseIndex + i)
        if (item.subitems) visit(item.subitems, baseIndex + i + 1)
      }
    }
    if (this.book?.toc) visit(this.book.toc, 0)
  }

  private tocItems(): { label: string; href: string; level: number }[] {
    const result: { label: string; href: string; level: number }[] = []
    const visit = (items: FoliateTocItem[], level: number) => {
      for (const item of items) {
        if (typeof item.label === 'string' && typeof item.href === 'string') {
          result.push({ label: item.label, href: item.href, level })
        }
        if (Array.isArray(item.subitems)) visit(item.subitems, level + 1)
      }
    }
    if (Array.isArray(this.book?.toc)) visit(this.book.toc, 1)
    return result
  }

  private emitTocReady() {
    this.buildTocIndex()
    this.emit('tocReady', this.tocItems())
  }

  on<K extends keyof RendererEvents>(type: K, fn: RendererEvents[K]) {
    this.listeners.push({ type, fn: fn as (...args: unknown[]) => void })
    if (type === 'tocReady' && this.book) this.emitTocReady()
    return () => {
      this.listeners = this.listeners.filter((l) => l.fn !== fn)
    }
  }

  private syncDoc() {
    try {
      const contents = this.view?.renderer?.getContents?.() as Array<{ doc: Document; index: number }> | undefined
      if (!contents?.length) return

      const docs = new Set<Document>(contents.map((c) => c.doc).filter(Boolean))
      for (const doc of this.activeDocs) {
        if (!docs.has(doc)) {
          doc.removeEventListener('click', this.handleDocInteraction)
          this.unwatchFrameFocus(doc.defaultView)
          const sel = this.selectionDocs.get(doc)
          if (sel) {
            doc.removeEventListener('pointerdown', sel.startHandler)
            doc.removeEventListener('mouseup', sel.handler)
            doc.removeEventListener('keyup', sel.handler)
            doc.removeEventListener('selectionchange', sel.selectionChangeHandler)
            doc.removeEventListener('touchend', sel.handler)
            doc.removeEventListener('dblclick', sel.dblHandler)
            doc.removeEventListener('keydown', sel.escHandler)
            this.selectionDocs.delete(doc)
          }
        }
      }
      for (const { doc, index } of contents) {
        if (!doc || this.activeDocs.has(doc)) continue
        this.applyFixedLayoutDocumentStyles(doc)
        setEpubParagraphWhitespace(doc, this.paragraph.overrideBookLayout)
        normalizeEpubDocumentImages(doc, {
          section: this.book?.sections?.[index],
          onMediaError: (detail) => this.emit('mediaError', detail),
        })
        doc.addEventListener('click', this.handleDocInteraction)
        if (doc.defaultView) this.watchFrameFocus(doc.defaultView)
        const handler = () => this.handleSelection(doc, index)
        const selectionChangeHandler = () => this.handleSelectionChange(doc)
        const startHandler = () => {
          if (this.selectionActive) {
            this.selectionDismissPending = true
            this.selectionActive = false
            this.emit('selected', null)
          }
        }
        doc.addEventListener('pointerdown', startHandler)
        doc.addEventListener('mouseup', handler)
        doc.addEventListener('keyup', handler)
        doc.addEventListener('selectionchange', selectionChangeHandler)
        doc.addEventListener('touchend', handler, { passive: true })
        const dblHandler = () => {
          setTimeout(() => {
            try {
              const sel = doc.defaultView?.getSelection?.()
              if (!sel || sel.isCollapsed || sel.rangeCount === 0 || typeof Intl.Segmenter !== 'function') return
              const range = sel.getRangeAt(0)
              const node = range.startContainer
              if (node.nodeType !== Node.TEXT_NODE || range.startContainer !== range.endContainer) return
              const text = node.textContent ?? ''
              const lang = doc.documentElement.lang || undefined
              const segmenter = new Intl.Segmenter(lang, { granularity: 'word' })
              for (const seg of segmenter.segment(text)) {
                if (!seg.isWordLike) continue
                if (seg.index <= range.startOffset && seg.index + seg.segment.length >= range.endOffset) {
                  const newRange = doc.createRange()
                  newRange.setStart(node, seg.index)
                  newRange.setEnd(node, seg.index + seg.segment.length)
                  sel.removeAllRanges()
                  sel.addRange(newRange)
                  this.handleSelection(doc, index)
                  break
                }
              }
            } catch { /* segmenter may fail */ }
          }, 0)
        }
        doc.addEventListener('dblclick', dblHandler)
        // Focus lives inside the section iframe, so parent-window keydown
        // listeners (popup Esc handlers, the boss key) never fire. Re-dispatch
        // Escape on a deep parent element with bubbles: dispatching on
        // `document` directly would NOT reach window-level listeners — the
        // event path is built from the parentNode chain, which stops at the
        // document (document.parentNode is null, window is never appended).
        const escHandler = (e: KeyboardEvent) => {
          if (e.key !== 'Escape') return
          const host = this.container ?? document.body
          if (host) {
            host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          }
        }
        doc.addEventListener('keydown', escHandler)
        this.selectionDocs.set(doc, { index, handler, selectionChangeHandler, startHandler, dblHandler, escHandler })
      }
      this.activeDocs = docs
    } catch {
      // ignore sync errors — the renderer may not be fully initialized yet
    }
  }

  private applyFixedLayoutDocumentStyles(doc: Document) {
    if (!this.view?.isFixedLayout) return
    doc.documentElement.style.setProperty('background-color', this.theme.bg, 'important')
    doc.body?.style.setProperty('background-color', this.theme.bg, 'important')
    doc.body?.style.setProperty('position', 'relative')
  }

  destroy() {
    this.setAutoReadingActive(false)
    this.destroyed = true
    // stop any in-flight search loop at the next chapter boundary; the
    // highlight overlays die with the view, so only the bookkeeping is dropped
    this.searchGen++
    this.activeSearchTarget = null
    this.activeSearchValue = null
    if (this.activeSearchClearTimer) clearTimeout(this.activeSearchClearTimer)
    this.activeSearchClearTimer = null
    this.drawnSearchValues.clear()
    this.searchMatchOffsets.clear()
    this.searchMatchTexts.clear()
    this.invalidateFootnoteRequests()
    this.footnoteHandler?.disposeAll?.()
    this.disposeFootnoteEntries()
    this.footnoteHandler?.removeEventListener?.('before-render', this.handleFootnoteBeforeRender)
    this.footnoteHandler = null
    setReplacementInvalidListener(null)
    this.navigationPending.dispose()
    window.removeEventListener('blur', this.handleWindowBlur)
    window.removeEventListener('focus', this.handleWindowFocus)
    document.removeEventListener('visibilitychange', this.handleActivationVisibilityChange)
    document.removeEventListener('pointerdown', this.handleActivationPointerDown, true)
    for (const win of this.frameFocusWatch.keys()) this.unwatchFrameFocus(win)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (this.prefetchTimer !== null) { clearTimeout(this.prefetchTimer); this.prefetchTimer = null }
    if (this.marginalTimer !== null) { clearTimeout(this.marginalTimer); this.marginalTimer = null }
    this.view?.removeEventListener('link', this.handleFootnoteLink)
    this.view?.removeEventListener('open-media', this.handleOpenMedia)
    this.view?.removeEventListener('open-media-menu', this.handleOpenMediaMenu)
    this.view?.removeEventListener('media-error', this.handleMediaError)
    this.view?.removeEventListener('media-play', this.handleMediaPlay)
    try { this.view?.close() } catch { /* view may be partially initialized */ }
    try { this.view?.remove() } catch { /* ignore */ }
    for (const doc of this.activeDocs) {
      doc.removeEventListener('click', this.handleDocInteraction)
      const sel = this.selectionDocs.get(doc)
      if (sel) {
        doc.removeEventListener('mouseup', sel.handler)
        doc.removeEventListener('keyup', sel.handler)
        doc.removeEventListener('selectionchange', sel.handler)
        doc.removeEventListener('touchend', sel.handler)
        doc.removeEventListener('dblclick', sel.dblHandler)
      }
    }
    this.selectionDocs.clear()
    this.activeDocs.clear()
    this.mediaOverlaySections.clear()
    this.listeners = []
    this.view = null
    this.book = null
    this.container = null
  }

  private applyAllSettings() {
    this.applyReadingMode(this.readingMode)
    this.applyPageColumns(this.pageColumns)
    this.applyColumnGap(this.columnGap)
    // re-apply the current width — applyPageWidth(0) would mean "auto"
    this.applyPageWidth(this.pageWidth)
    this.applyReadingTheme(this.theme)
    this.applyPageAnimation(this.pageAnimation)
    this.applyShowHeader(this.showHeader)
    this.applyShowFooter(this.showFooter)
    this.applyContinuousScroll(this.continuousScroll)
    this.applyStyles()
  }

  // Scrolled-flow chapter boundaries need breathing room proportional to the
  // viewport, like the horizontal gap (a percentage of container width) — a
  // fixed px value reads as cramped on large windows. Quantized to 8px steps
  // so window drags don't re-apply styles every frame. The user's vertical
  // padding setting is added on top.
  private scrollBlockPadding(): number {
    const height = this.container?.clientHeight ?? 0
    return this.paragraph.verticalPadding + Math.round(height / 100) * 8
  }

  private applyStyles() {
    if (!this.view?.renderer?.setStyles) return
    const fontStack = this.font.fontStack ?? FONT_OPTIONS[0].value
    const vPad = this.readingMode === 'page' ? 0 : this.scrollBlockPadding()
    this.lastScrollVPad = vPad
    const fontCss = this.font.fontCss ?? ''
    const isDarkTheme = !isLightCssColor(this.theme.bg)
    const forceBookdockFont = this.font.overrideBookFont
    const forceBookdockLayout = this.paragraph.overrideBookLayout
    const fontDeclarations = `
        font-size: ${this.font.size}px !important;
        font-weight: ${this.font.fontWeight};
        -webkit-text-size-adjust: none;
        text-size-adjust: none;
        ${forceBookdockFont ? `font-family: ${fontStack} !important;` : ''}`
    const fontDescendantStyles = forceBookdockFont
      ? `
      body *:not(pre, code, kbd, .code):not(pre *, code *, kbd *, .code *) {
        font-family: ${fontStack} !important;
      }`
      : ''
    const fontLegacySizeStyles = `
      font[size="1"] { font-size: 8px; }
      font[size="2"] { font-size: 12px; }
      font[size="3"] { font-size: ${this.font.size}px; }
      font[size="4"] { font-size: ${Number((this.font.size * 1.2).toFixed(2))}px; }
      font[size="5"] { font-size: ${Number((this.font.size * 1.5).toFixed(2))}px; }
      font[size="6"] { font-size: ${Number((this.font.size * 2).toFixed(2))}px; }
      font[size="7"] { font-size: ${Number((this.font.size * 3).toFixed(2))}px; }
      [style*="font-size: 16px"], [style*="font-size:16px"] { font-size: 1rem !important; }`
    const layoutDeclarations = forceBookdockLayout ? `
        line-height: ${this.font.lineHeight} !important;
        letter-spacing: ${this.paragraph.letterSpacing}px !important;` : ''
    const paragraphStyles = forceBookdockLayout ? (`
      p {
        line-height: ${this.font.lineHeight} !important;
        letter-spacing: ${this.paragraph.letterSpacing}px !important;
        text-indent: ${this.paragraph.indent}em !important;
        margin-bottom: ${this.paragraph.paragraphSpacing}em !important;
        text-align: ${this.paragraph.textAlignJustify ? 'justify' : 'start'} !important;
      }`
      + `
      html {
        hanging-punctuation: allow-end last;
        orphans: 2;
        widows: 2;
      }
      p {
        -webkit-hyphens: manual !important;
        hyphens: manual !important;
        -webkit-hyphenate-limit-before: 3;
        -webkit-hyphenate-limit-after: 2;
        -webkit-hyphenate-limit-lines: 2;
      }`
      + `
      blockquote, dd, li, div:not(:has(*:not(b, a, em, i, strong, u, span))) {
        line-height: ${this.font.lineHeight} !important;
        letter-spacing: ${this.paragraph.letterSpacing}px !important;
        text-indent: ${this.paragraph.indent}em !important;
        margin-bottom: ${this.paragraph.paragraphSpacing}em !important;
        text-align: ${this.paragraph.textAlignJustify ? 'justify' : 'start'} !important;
        hanging-punctuation: allow-end last;
        widows: 2;
        orphans: 2;
        hyphens: manual;
        -webkit-hyphenate-limit-before: 3;
        -webkit-hyphenate-limit-after: 2;
        -webkit-hyphenate-limit-lines: 2;
      }
      [align="left"] { text-align: left !important; }
      [align="right"] { text-align: right !important; }
      [align="center"] { text-align: center !important; }
      [align="justify"] { text-align: justify !important; }
      .aligned-left { ${this.paragraph.textAlignJustify ? 'text-align: justify !important;' : ''} }
      .aligned-center { text-align: center !important; }
      .aligned-right { text-align: right !important; }
      .aligned-justify { text-align: justify !important; }
      p > font:only-child {
        display: flow-root;
      }
      .nonindent, .noindent {
        text-indent: unset !important;
      }
      :is(hgroup, header) p {
        text-align: unset;
        hyphens: unset;
      }
      :lang(zh), :lang(ja), :lang(ko) {
        widows: 1;
        orphans: 1;
      }
      div.left *, p.left * { text-align: left; }
      div.right *, p.right * { text-align: right; }
      div.center *, p.center * { text-align: center; }
      div.justify *, p.justify * { text-align: justify; }
      li p, ol p, ul p, td p,
      p:has(> img:only-child),
      p:has(> span:only-child > img:only-child),
      p:has(> img:not(.has-text-siblings)),
      p:has(> a:first-child + img:last-child),
      blockquote[align="center"], div[align="center"], p[align="center"], dd[align="center"],
      .aligned-center {
        text-indent: 0 !important;
      }`
      ) : ''
    const contentOverflowStyles = this.view?.isFixedLayout
      ? ''
      : `
      html, body {
        box-sizing: border-box;
        max-height: none;
        -webkit-touch-callout: none;
        -webkit-user-select: text;
      }
      body {
        margin: 0 !important;
        overflow: unset;
        ${forceBookdockLayout ? 'line-height: unset !important;' : ''}
      }
      img {
        -webkit-touch-callout: none;
        -webkit-user-drag: none;
      }
      img, svg, video, audio, canvas, object, embed, iframe {
        max-width: 100% !important;
        object-fit: contain;
        break-inside: avoid;
        page-break-inside: avoid;
        box-sizing: border-box;
      }
      img:not([width]), svg:not([width]) {
        width: auto;
      }
      img:not([height]), svg:not([height]) {
        height: auto;
      }
      video {
        max-height: calc(var(--bd-available-height, 100%) * 1px);
        height: auto;
        cursor: pointer;
      }
      .ie6 img {
        width: unset;
        height: unset;
      }
      a {
        position: relative !important;
      }
      a::before {
        content: '';
        position: absolute;
        inset: -10px;
      }
      a:any-link {
        color: var(--bd-theme-primary) !important;
        text-decoration: none;
      }
      .vertical-writing img.pi {
        transform: rotate(90deg);
        transform-origin: center;
        height: 2em;
        width: ${this.font.lineHeight}em;
        vertical-align: unset;
      }
      img.has-text-siblings {
        height: 1em;
      }
      img.has-text-siblings-vertical {
        width: 1em;
        height: auto;
      }
      img.has-text-siblings-baseline {
        vertical-align: baseline;
      }
      :is(div) > img.has-text-siblings[style*="object-fit"] {
        display: block;
        height: auto;
        vertical-align: unset;
      }
      .duokan-image-gallery-cell {
        height: calc(var(--bd-available-height, 100%) * 1px);
      }
      .duokan-image-gallery-cell img {
        height: 90%;
      }
      .duokan-footnote img:not([class]) {
        width: 0.8em;
        height: 0.8em;
      }
      sup img {
        height: 1em;
      }
      div:has(img.singlepage) {
        position: relative;
        width: auto;
        height: auto;
      }
      p[width][height] > img:only-child {
        width: unset !important;
        height: unset !important;
      }
      figure > div:has(img) {
        height: auto !important;
      }
      figure.code {
        overflow: unset !important;
      }
      div:has(> img, > svg) {
        max-width: 100% !important;
      }
      p img.has-text-siblings, span img.has-text-siblings, sup img.has-text-siblings {
        mix-blend-mode: ${isDarkTheme ? 'screen' : 'multiply'};
      }
      p[width][height] > img:only-child {
        mix-blend-mode: ${isDarkTheme ? 'screen' : 'multiply'};
      }
      p {
        display: block;
      }
      .br {
        display: flow-root;
      }
      .h5_mainbody {
        overflow: unset !important;
      }
      pre, code, math {
        white-space: pre-wrap !important;
        overflow-wrap: anywhere;
        scrollbar-width: none;
      }
      math {
        overflow: auto;
      }
      .epubtype-footnote,
      .duokan-footnote-content,
      .duokan-footnote-item,
      aside[*|type~="endnote"],
      aside[*|type~="footnote"],
      aside[*|type~="note"],
      aside[*|type~="rearnote"] {
        display: none;
      }
      table, math {
        max-width: 100% !important;
      }
      [style*="page-break-after: always"], [style*="page-break-after:always"] {
        margin-bottom: var(--bd-page-break-margin, 100vh) !important;
      }
      table {
        overflow-x: auto !important;
        max-height: calc(var(--bd-available-height, 100%) * 1px);
      }
      body.paginated-mode td:has(img), body.paginated-mode td :has(img) {
        max-height: calc(var(--bd-available-height, 100%) * 0.8 * 1px);
      }
      table:has(> colgroup) {
        table-layout: fixed;
      }
      td, th {
        word-break: break-word;
        overflow-wrap: anywhere;
      }
      *:has(> hr.background-img):not(body) {
        background-color: var(--bd-theme-bg) !important;
      }
      hr.background-img {
        mix-blend-mode: multiply;
      }
      math {
        max-height: calc(var(--bd-available-height, 100%) * 1px);
      }`
    const templateCompatibilityStyles = `
      #pg-header * {
        color: inherit !important;
      }
      .x-ebookmaker, .x-ebookmaker-cover, .x-ebookmaker-coverpage {
        background-color: unset !important;
      }
      .chapterHeader, .chapterHeader * {
        border-color: unset;
        background-color: var(--bd-theme-bg) !important;
      }
      .calibre {
        color: unset;
        background-color: unset;
      }
      /* Legacy cover float-hack reset */
      .wedge {
        display: none !important;
        float: none !important;
        height: 0 !important;
        margin: 0 !important;
      }
      .wedge ~ .container,
      .container:has(table img) {
        height: auto !important;
        min-height: auto !important;
        position: static !important;
      }
      .wedge ~ .container table,
      .wedge ~ .container tr,
      .wedge ~ .container th,
      .wedge ~ .container td,
      .container:has(table img) table,
      .container:has(table img) tr,
      .container:has(table img) th,
      .container:has(table img) td {
        height: auto !important;
      }
      /* Video card styling and play overlay */
      .bd-video-wrapper {
        position: relative !important;
        display: inline-block !important;
        width: fit-content !important;
        max-width: 100% !important;
        margin: 0.8em auto !important;
        line-height: 0 !important;
        text-align: center !important;
        border-radius: 8px !important;
        overflow: hidden !important;
        box-shadow: 0 4px 16px -2px rgba(0, 0, 0, 0.12), 0 2px 6px -1px rgba(0, 0, 0, 0.08) !important;
        outline: 1px solid rgba(128, 128, 128, 0.18) !important;
        background-color: #0b0f19 !important;
      }
      .bd-video-wrapper.is-empty-placeholder {
        min-width: 240px !important;
        min-height: 135px !important;
        aspect-ratio: 16 / 9;
      }
      .bd-video-wrapper video {
        display: block !important;
        width: 100% !important;
        max-width: 100% !important;
        max-height: calc(var(--bd-available-height, 100%) * 1px) !important;
        height: auto !important;
        border-radius: 8px !important;
        accent-color: var(--bd-theme-primary) !important;
        cursor: pointer !important;
      }
      /* Suppress native browser overlay play buttons in favor of custom .bd-video-play-btn */
      video::-webkit-media-controls-overlay-play-button,
      .bd-video-wrapper video::-webkit-media-controls-overlay-play-button {
        display: none !important;
        -webkit-appearance: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      video::-webkit-media-controls-start-playback-button,
      .bd-video-wrapper video::-webkit-media-controls-start-playback-button {
        display: none !important;
        -webkit-appearance: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      video::-webkit-media-controls-overlay-enclosure,
      .bd-video-wrapper video::-webkit-media-controls-overlay-enclosure {
        display: none !important;
      }
      .bd-video-play-btn {
        position: absolute !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        width: 54px !important;
        height: 54px !important;
        border-radius: 50% !important;
        border: none !important;
        padding: 0 !important;
        margin: 0 !important;
        background: rgba(0, 0, 0, 0.5) !important;
        backdrop-filter: blur(8px) !important;
        -webkit-backdrop-filter: blur(8px) !important;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35) !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        transition: opacity 0.2s ease, transform 0.2s ease, background-color 0.2s ease !important;
        pointer-events: auto !important;
        z-index: 5 !important;
      }
      .bd-video-play-btn:hover {
        background: rgba(0, 0, 0, 0.72) !important;
        transform: translate(-50%, -50%) scale(1.08) !important;
      }
      .bd-video-play-btn svg {
        margin-left: 3px !important;
        width: 24px !important;
        height: 24px !important;
        fill: #ffffff !important;
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.4)) !important;
      }
      .bd-video-wrapper.is-playing .bd-video-play-btn {
        opacity: 0 !important;
        pointer-events: none !important;
        transform: translate(-50%, -50%) scale(0.85) !important;
      }
      .bd-video-wrapper.is-media-loading .bd-video-play-btn,
      .bd-video-wrapper.is-media-error .bd-video-play-btn,
      .bd-video-wrapper:has(.bd-video-spinner) .bd-video-play-btn,
      .bd-video-wrapper:has(.bd-video-error-badge) .bd-video-play-btn {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        transition: none !important;
      }
      .bd-video-spinner {
        position: absolute !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 8px !important;
        z-index: 6 !important;
        pointer-events: none !important;
        background: rgba(10, 15, 26, 0.76) !important;
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
        padding: 8px 16px !important;
        border-radius: 9999px !important;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4) !important;
        border: 1px solid rgba(255, 255, 255, 0.15) !important;
        transition: opacity 0.25s ease !important;
        box-sizing: border-box !important;
        line-height: 1 !important;
      }
      .bd-video-spinner.is-fade-out {
        opacity: 0 !important;
      }
      .bd-video-spinner-ring {
        box-sizing: border-box !important;
        width: 16px !important;
        height: 16px !important;
        flex-shrink: 0 !important;
        border-radius: 50% !important;
        border: 2px solid rgba(255, 255, 255, 0.25) !important;
        border-top-color: #ffffff !important;
        animation: bd-media-spin 0.8s linear infinite !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .bd-video-spinner-label {
        box-sizing: border-box !important;
        display: inline-flex !important;
        align-items: center !important;
        height: 16px !important;
        font-size: 13px !important;
        line-height: 1 !important;
        color: #ffffff !important;
        font-family: system-ui, -apple-system, sans-serif !important;
        font-weight: 500 !important;
        letter-spacing: 0.02em !important;
        white-space: nowrap !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .bd-video-error-badge {
        position: absolute !important;
        top: 50% !important;
        left: 50% !important;
        transform: translate(-50%, -50%) !important;
        display: flex !important;
        flex-direction: row !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 8px !important;
        z-index: 6 !important;
        pointer-events: auto !important;
        background: rgba(220, 38, 38, 0.85) !important;
        backdrop-filter: blur(10px) !important;
        -webkit-backdrop-filter: blur(10px) !important;
        padding: 8px 16px !important;
        border-radius: 9999px !important;
        border: 1px solid rgba(255, 255, 255, 0.25) !important;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35) !important;
        color: #ffffff !important;
        cursor: pointer !important;
        transition: background-color 0.2s ease, transform 0.2s ease !important;
        box-sizing: border-box !important;
        line-height: 1 !important;
      }
      .bd-video-error-badge:hover {
        background: rgba(185, 28, 28, 0.95) !important;
        transform: translate(-50%, -50%) scale(1.04) !important;
      }
      .bd-video-error-icon {
        box-sizing: border-box !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        width: 16px !important;
        height: 16px !important;
        border-radius: 50% !important;
        background: rgba(255, 255, 255, 0.2) !important;
        font-size: 11px !important;
        font-weight: bold !important;
        line-height: 1 !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      .bd-video-error-text {
        box-sizing: border-box !important;
        display: inline-flex !important;
        align-items: center !important;
        height: 16px !important;
        font-size: 12px !important;
        font-family: system-ui, -apple-system, sans-serif !important;
        font-weight: 500 !important;
        line-height: 1 !important;
        white-space: nowrap !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      @keyframes bd-media-spin {
        to { transform: rotate(360deg); }
      }
      audio.bd-audio-loading {
        opacity: 0.6 !important;
        filter: grayscale(0.5) !important;
        pointer-events: none !important;
      }
      /* Embedded video container compatibility */
      .videoplay {
        max-width: 100% !important;
        box-sizing: border-box !important;
        text-align: center !important;
      }`
    const themeCompatibilityStyles = isDarkTheme
      ? `
      html { color-scheme: dark; }
      body { background-color: transparent !important; }
      blockquote {
        background: color-mix(in srgb, var(--bd-theme-bg) 80%, #000);
        background-color: color-mix(in srgb, var(--bd-theme-bg) 80%, #000);
      }
      code {
        color: color-mix(in srgb, var(--bd-theme-text) 80%, transparent);
        background-color: color-mix(in srgb, var(--bd-theme-bg) 90%, #000);
      }`
      + `
      body.pbg {
        background-color: var(--bd-theme-bg) !important;
      }`
      : ''
    const fontVariables = `
      html {
        --bd-serif: ${fontStack};
        --bd-sans-serif: ${fontStack};
        --bd-monospace: ui-monospace, SFMono-Regular, Consolas, monospace;
        --bd-font-size: ${this.font.size}px;
        --bd-min-font-size: 8px;
        --bd-font-weight: ${this.font.fontWeight};
        --bd-theme-bg: ${this.theme.bg};
        --bd-theme-text: ${this.theme.text};
        --bd-theme-primary: ${this.theme.primary ?? this.theme.text};
        color-scheme: ${isDarkTheme ? 'dark' : 'light'};
      }`
    const inlineThemeStyles = `
      *[style*="color: black"], *[style*="color:black"],
      *[style*="color: #000"], *[style*="color:#000"],
      *[style*="color: rgb(0"], *[style*="color:rgb(0"] {
        color: var(--bd-theme-text) !important;
      }
      *[style*="background: white"], *[style*="background:white"],
      *[style*="background-color: white"], *[style*="background-color:white"],
      *[style*="background: #fff"], *[style*="background:#fff"],
      *[style*="background: #ffffff"], *[style*="background:#ffffff"],
      *[style*="background-color: #fff"], *[style*="background-color:#fff"] {
        background-color: var(--bd-theme-bg) !important;
      }
      *[style*="background: rgb(255"], *[style*="background:rgb(255"],
      *[style*="background-color: rgb(255"], *[style*="background-color:rgb(255"] {
        background-color: var(--bd-theme-bg) !important;
      }
      font[color="#000000"], font[color="#000"], font[color="black"],
      font[color="rgb(0,0,0)"], font[color="rgb(0, 0, 0)"] {
        color: var(--bd-theme-text) !important;
      }`
    // fontCss (@import/@font-face) must precede all rules or the at-rules
    // are ignored; the paginator re-lays out on document.fonts.ready
    const css = `
      ${fontCss}
      ${fontVariables}
      html {
        font-family: ${fontStack};
      }
      html, body {
        ${fontDeclarations}
        ${layoutDeclarations}
        color: ${this.theme.text} !important;
        background: ${this.theme.bg} !important;
        background-color: ${this.theme.bg} !important;
        --bd-tts-highlight: ${ttsHighlightColor(this.theme)} !important;
        --bd-search-highlight: ${searchHighlightColor(this.theme)} !important;
        --bd-search-active-highlight: ${searchActiveHighlightColor(this.theme)} !important;
        --bd-search-active-border: ${searchActiveBorderColor(this.theme)} !important;
      }
      pre, code, kbd {
        font-family: var(--bd-monospace, ui-monospace, SFMono-Regular, Consolas, monospace);
        font-variant-ligatures: none;
      }
      ::selection {
        background: ${this.theme.text}19 !important;
        color: inherit !important;
      }
      ${fontDescendantStyles}
      ${fontLegacySizeStyles}
      ${inlineThemeStyles}
      ${paragraphStyles}
      ${contentOverflowStyles}
      ${themeCompatibilityStyles}
      ${templateCompatibilityStyles}
      body {
        padding-top: ${vPad}px !important;
        padding-bottom: ${vPad}px !important;
        padding-left: ${this.readingMode === 'page' ? 0 : this.paragraph.horizontalPadding}px !important;
        padding-right: ${this.readingMode === 'page' ? 0 : this.paragraph.horizontalPadding}px !important;
      }
    `
    this.view.renderer.setStyles(css)
  }

  private emit<K extends keyof RendererEvents>(type: K, data?: Parameters<RendererEvents[K]>[0]) {
    this.listeners
      .filter((l) => l.type === type)
      .forEach((l) => l.fn(data))
  }
}
