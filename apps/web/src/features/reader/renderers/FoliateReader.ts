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
  MarginalConfig,
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
import { applyTransforms, countPatternMatches, textContentOffset, type TextTransformRule } from '../lib/text-transforms'
import { NavigationPending } from '../lib/navigation-pending'
import { sectionFractionBoundaries } from '../lib/progress-model'
import {
  findMatches,
  getChapterText,
  makeExcerpt,
  offsetsToRange,
  type SearchMatch,
} from '../lib/book-search'
import { convertChinese } from '@/lib/chinese'
import { mix } from '@/lib/color'

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

function ttsTextHash(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function readerTextVersion(conversion: ChineseConversion, transforms: TextTransformRule[]): string {
  let hash = 2166136261
  const value = JSON.stringify({ conversion, transforms })
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
// chapter crossing. Only cold targets (memo miss — prefetch debounce skipped
// the turn, LRU eviction) arm it; missing/non-linear targets never load.
export function shouldArmPending(
  dir: 1 | -1,
  book: any,
  currentSectionIndex: number,
): boolean {
  const target = book?.sections?.[currentSectionIndex + dir]
  if (!target || target.linear === 'no') return false
  return !book?.loadSectionText?.has?.(target.id)
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

export type ZipLoadStrategy = 'full' | 'range'

// Search results per (book, query, mode): re-searching the same term in a
// session skips the per-chapter matching pass. Keyed by content URL so it
// survives leaving and re-entering the book (parseCache lifecycle), capped by
// LRU — stale entries for evicted books only waste a slot.
const SEARCH_CACHE_MAX = 20
interface SearchCacheEntry {
  results: SearchResult[]
  matches: Map<number, SearchMatch[]>
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
async function openZipEntryMap(url: string, foliate: any) {
  if (selectZipLoadStrategy(await probeFileSize(url)) === 'full') {
    return openZipFromWholeFile(url, foliate)
  }
  try {
    zipConfigure({ useWebWorkers: false })
    // The init probe (Range: bytes=0-0) throws ERR_HTTP_RANGE when the server
    // ignores Range, which lands us in the fallback below.
    const reader = new ZipReader(new HttpReader(url, { useRangeHeader: true }))
    const entries: any[] = await reader.getEntries()
    return {
      map: new Map<string, any>(entries.map((entry) => [entry.filename, entry])),
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
    map: new Map<string, any>(entries.map((entry) => [entry.filename, entry])),
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
  const memo = new Map<string, Promise<string | null>>()
  const memoized = (name: string) => {
    const cached = memo.get(name)
    if (cached) {
      // refresh recency
      memo.delete(name)
      memo.set(name, cached)
      return cached
    }
    const promise = Promise.resolve(loadText(name))
    memo.set(name, promise)
    while (memo.size > TEXT_MEMO_MAX) {
      const oldest = memo.keys().next().value
      if (oldest === undefined) break
      memo.delete(oldest)
    }
    // never memo a failure — the next request must retry
    promise.catch(() => {
      if (memo.get(name) === promise) memo.delete(name)
    })
    return promise
  }
  // Warmth query for the loading indicator: a memo entry means the text was
  // requested (prefetch counts) and hasn't failed — adjacent chapters are
  // normally warm, so their turn doesn't need the spinner.
  memoized.has = (name: string) => memo.has(name)
  return memoized
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

function getParsedBook(url: string, foliate: any): Promise<any> {
  const cached = parseCache.get(url)
  if (cached) {
    // refresh recency
    parseCache.delete(url)
    parseCache.set(url, cached)
    return cached
  }
  const { EPUB } = foliate
  const promise = (async () => {
    const { map, TextWriter, BlobWriter } = await openZipEntryMap(url, foliate)

    const load = (fn: (entry: any, type?: string) => any) => (name: string) => {
      const entry = map.get(name)
      return entry ? fn(entry) : null
    }

    const loadText = memoizeLoadText(load((entry: any) => entry.getData(new TextWriter())))
    const loadBlob = load((entry: any, type?: string) => entry.getData(new BlobWriter(type)))
    const getSize = (name: string) => map.get(name)?.uncompressedSize ?? 0

    const book = await new EPUB({ loadText, loadBlob, getSize }).init()
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

// Chinese conversion runs at the string level, before foliate parses a
// section: the Loader dispatches a `data` event on book.transformTarget
// before caching each resource URL (epub.js createURL), so replacing
// detail.data with converted markup makes the converted string the cached
// content. The parse cache reuses the same book object across view mounts —
// track which books already carry the listener to avoid stacking duplicates.
const transformedBooks = new WeakSet<object>()

// The transform listener outlives any single FoliateReader (the parse cache
// keeps the book alive after destroy), so the current mode is module-level;
// chineseConversion is a global UI setting.
let conversionMode: ChineseConversion = 'off'
// Active text-transform rules (正文变换 P1), module-level for the same reason
// as conversionMode. Rules are per-book/per-user data, not a global setting,
// so Reader clears them on unmount/book switch to avoid leaking across books.
let activeTransforms: TextTransformRule[] = []
export function setActiveTransforms(rules: TextTransformRule[]) {
  activeTransforms = rules
}
// Invalid point-patch reporter (P2): attachChineseTransform runs outside any
// instance (module-level book listener), so the current instance registers a
// callback here on mount and clears it on destroy — same pattern as the rule
// set above. Without a live reader the report is dropped, which is correct.
let transformInvalidListener: ((ids: string[]) => void) | null = null
export function setTransformInvalidListener(fn: ((ids: string[]) => void) | null) {
  transformInvalidListener = fn
}
// "选中即划": auto-create a highlight the moment a selection settles, keeping
// the toolbar open for restyling. Module-level like conversionMode because the
// selection handlers live on iframe documents owned by the renderer.
let autoMarkSelectionMode = false
export function setAutoMarkSelectionMode(enabled: boolean) {
  autoMarkSelectionMode = enabled
}
const CONVERTIBLE_MEDIA_TYPES = new Set(['application/xhtml+xml', 'text/html'])

function attachChineseTransform(book: any) {
  const target = book?.transformTarget as EventTarget | undefined
  if (!target || transformedBooks.has(book)) return
  transformedBooks.add(book)
  target.addEventListener('data', (event: Event) => {
    if (conversionMode === 'off' && activeTransforms.length === 0) return
    const detail = (event as CustomEvent).detail
    // Section markup only — images, fonts and CSS pass through untouched.
    if (!CONVERTIBLE_MEDIA_TYPES.has(detail?.type)) return
    const mode = conversionMode
    const rules = activeTransforms
    const docType = detail.type as DOMParserSupportedType
    // detail.data may be a promise; the Loader awaits it either way.
    // Text transforms run first (rules are written against the original text),
    // then Chinese conversion on the whole string — conversion rewrites
    // script/style/attribute text, an accepted trade-off (same as Readest).
    detail.data = Promise.resolve(detail.data).then(async (data: unknown) => {
      if (typeof data !== 'string') return data
      const transformed = rules.length
        ? applyTransforms(data, rules, docType, detail.name, (ids) => transformInvalidListener?.(ids))
        : data
      return mode === 'off' ? transformed : convertChinese(transformed, mode)
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
    overrideBookFont: true,
  }
  private paragraph: ParagraphStyle = {
    paragraphSpacing: 0.5,
    letterSpacing: 0,
    indent: 2,
    verticalPadding: 0,
    horizontalPadding: 0,
    textAlignJustify: false,
    overrideBookLayout: true,
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
  // the anti-flicker window; the newest navigation always wins
  private navigationPending = new NavigationPending((pending) => {
    this.emit('navigatePending', { pending })
  })
  private lastRange: Range | null = null
  private conversion: ChineseConversion = conversionMode
  // Snapshot of the rules this instance last applied, for change detection —
  // the same rule set re-delivered by a query refetch must not reload the view.
  private transformsJson = JSON.stringify(activeTransforms)
  private transforms: TextTransformRule[] = activeTransforms
  private continuousScroll: ContinuousScroll = 'off'
  private pageAnimation = true
  private showHeader = true
  private showFooter = true
  private currentSectionIndex = 0
  private ttsNavigation = false
  private resizeObserver: ResizeObserver | null = null
  private lastScrollVPad = -1
  private activeDocs = new Set<Document>()
  private selectionDocs = new Map<Document, { index: number; handler: () => void; dblHandler: () => void; escHandler: (e: KeyboardEvent) => void }>()
  private selectionActive = false
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
  // Search-highlight annotation values currently handed to the view, per section
  private drawnSearchValues = new Map<number, string[]>()
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
      }
      body {
        box-sizing: border-box !important;
        margin: 0 !important;
        padding: 8px !important;
        overflow-wrap: anywhere !important;
      }
      p {
        text-indent: ${this.paragraph.indent}em !important;
        margin-bottom: ${this.paragraph.paragraphSpacing}em !important;
        text-align: ${this.paragraph.textAlignJustify ? 'justify' : 'start'} !important;
      }
      img { max-width: 100% !important; height: auto !important; }
      table { max-width: 100% !important; overflow-x: auto !important; }
      ${hidden ? 'aside { display: block !important; }' : ''}
    `)
  }

  private handleClickView = (event: Event) => {
    if (this.popupGuardCount > 0) {
      if (this.footnoteEntries.length > 0) this.closeFootnote()
      return
    }
    const rect = this.container?.getBoundingClientRect()
    if (!rect) return
    const detail = (event as CustomEvent).detail
    const direction = resolveClickDirection(Number(detail?.x), rect.left, rect.width, this.clickAreaMode)
    if (direction === 'prev') {
      if (this.readingMode === 'page') void this.prev()
      else void this.scrollByPages(-1)
    } else if (direction === 'next') {
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

  constructor(url: string, bookId = '') {
    this.url = url
    this.bookId = bookId
  }

  async mount(container: HTMLElement, initialTarget?: string, initialFraction?: number) {
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

      const epub = await getParsedBook(this.url, foliate)
      const tMount2 = performance.now()
      // StrictMode mounts twice: the first instance is destroyed while its
      // async mount is still in flight — bail out instead of becoming a
      // zombie view stacked on top of the surviving one
      if (this.destroyed) return
      this.book = epub
      // Snapshot the rules in force at open time; later rule changes go
      // through applyTextTransforms, which detects the diff and reloads.
      this.transformsJson = JSON.stringify(activeTransforms)
      // Point patches report their invalid ids here (P2); the module-level
      // listener is shared with the load-time data pipeline.
      setTransformInvalidListener((ids) => this.emit('transformInvalid', { ids }))
      attachChineseTransform(epub)

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

      this.applyAllSettings()
      // Navigate to saved position before mount completes, so the user never
      // sees the default chapter. Internal: the initial open is not a "jump".
      if (initialTarget) {
        await this.display(initialTarget, { internal: true })
        if (this.destroyed) return
      } else if (initialFraction != null && initialFraction > 0) {
        // Stale CFI after a re-TOC: land on the book fraction instead
        await this.view?.goToFraction(Math.max(0, Math.min(1, initialFraction)))
        if (this.destroyed) return
      } else {
        // Ensure first section is visible after applyAllSettings re-render
        await this.view?.renderer?.goTo?.({ index: 0 })
      }
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
    const { cfi, fraction, tocItem, section, chapterLocation, range } = detail
    this.lastRange = range ?? null
    // fraction is NaN on transient relocate paths (section reload with zero viewSize)
    const frac = Number.isFinite(fraction) ? fraction : this.lastFraction
    if (frac != null) this.lastFraction = frac
    // chapter progress: foliate sections map 1:1 to the book's chapter list
    const chapterIndex = Number.isFinite(section?.current) ? section.current : undefined
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
      percent: frac != null ? Math.round(frac * 100) : 0,
      fraction: frac ?? undefined,
      chapter: tocItem?.label,
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

  async display(target?: string, opts?: { internal?: boolean; showPending?: boolean }) {
    if (!this.view) return
    // History back/forward is user-initiated but marks itself internal so it
    // doesn't re-enter the back stack; showPending re-arms the indicator.
    if (!opts?.internal || opts?.showPending) {
      const gen = this.navigationPending.begin()
      try {
        await this.navigateTo(target, opts)
      } finally {
        this.navigationPending.end(gen)
      }
      return
    }
    return this.navigateTo(target, opts)
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
      if (Number.isNaN(index)) return
      // chapter:{index}:{scrollFrac} — restore exact scroll proportion
      if (parts[2] !== undefined) {
        const anchor = Number(parts[2])
        if (!Number.isNaN(anchor) && renderer) return renderer.goTo({ index, anchor })
      }
      // chapter:{index} — navigate to section start (backward compat)
      if (renderer) return renderer.goTo({ index })
    }

    // search-hit:{index}:{start}:{end} — lazy jump target for search results.
    // No CFI is computed at search time; the anchor resolves the plain-text
    // span to a Range on the freshly loaded section document, so both reading
    // modes land on the exact match (paginator treats Range anchors uniformly).
    if (target.startsWith('search-hit:')) {
      const parts = target.split(':')
      const index = Number(parts[1])
      const start = Number(parts[2])
      const end = Number(parts[3])
      if (![index, start, end].every(Number.isFinite)) return
      if (renderer) {
        return renderer.goTo({ index, anchor: (doc: Document) => offsetsToRange(doc, start, end) })
      }
      return
    }

    // CFI locations (search results, bookmarks, selections) go straight to
    // View.goTo — href resolution would mangle or reject them
    if (/^epubcfi\(/.test(target)) {
      try {
        const resolved = await this.view.goTo(target)
        if (!resolved) console.warn('[FoliateReader] CFI navigation returned nothing:', target)
      } catch (err) {
        console.error('[FoliateReader] CFI navigation failed:', target, err)
      }
      return
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
    if (this.readingMode === 'page'
      && !turnsCrossChapter(1, this.view.renderer?.page, this.view.renderer?.pages)) {
      await this.view.next()
      return
    }
    // scroll-mode chapter switch skips the current chapter's tail — an explicit
    // jump, so close the reading segment; a page-mode turn merely crossing the
    // boundary is continuous reading (that page was read) and must not close
    if (this.readingMode === 'scroll') this.emit('userJump')
    const pending = shouldArmPending(1, this.book, this.currentSectionIndex)
      ? this.navigationPending.begin()
      : null
    try {
      if (this.readingMode === 'page') {
        await this.view?.next()
      } else {
        await this.view?.renderer?.nextSection()
      }
    } finally {
      if (pending !== null) this.navigationPending.end(pending)
    }
  }

  async prev() {
    if (!this.view) return
    if (this.readingMode === 'page'
      && !turnsCrossChapter(-1, this.view.renderer?.page, this.view.renderer?.pages)) {
      await this.view.prev()
      return
    }
    if (this.readingMode === 'scroll') this.emit('userJump')
    const pending = shouldArmPending(-1, this.book, this.currentSectionIndex)
      ? this.navigationPending.begin()
      : null
    try {
      if (this.readingMode === 'page') {
        await this.view?.prev()
      } else {
        await this.view?.renderer?.prevSection()
      }
    } finally {
      if (pending !== null) this.navigationPending.end(pending)
    }
  }

  applyReadingMode(mode: ReadingMode) {
    this.readingMode = mode
    if (!this.view?.renderer) return
    this.view.renderer.setAttribute('flow', mode === 'page' ? 'paginated' : 'scrolled')
    this.updateLayout()
    this.applyStyles()
  }

  applyPageColumns(columns: number) {
    this.pageColumns = Math.max(1, Math.min(3, columns))
    if (!this.view?.renderer) return
    this.view.renderer.setAttribute('max-column-count', String(this.pageColumns))
  }

  applyColumnGap(gapPercent: number) {
    this.columnGap = Math.max(0, Math.min(15, gapPercent))
    if (!this.view?.renderer) return
    this.view.renderer.setAttribute('gap', `${this.columnGap}%`)
  }

  applyPageAnimation(enabled: boolean) {
    this.pageAnimation = enabled
    if (!this.view?.renderer) return
    this.view.renderer.toggleAttribute('animated', enabled)
  }

  applyShowHeader(enabled: boolean) {
    this.showHeader = enabled
    if (!this.view?.renderer) return
    this.view.renderer.toggleAttribute('show-header', enabled)
  }

  applyShowFooter(enabled: boolean) {
    this.showFooter = enabled
    if (!this.view?.renderer) return
    this.view.renderer.toggleAttribute('show-footer', enabled)
  }

  private bookTitle(): string {
    const title = this.book?.metadata?.title
    return typeof title === 'string' ? title : ''
  }

  applyReadingTheme(theme: { bg: string; text: string; primary?: string }) {
    this.theme = theme
    if (!this.view?.renderer) return
    this.view.renderer.style.setProperty('--bd-tts-highlight', ttsHighlightColor(theme))
    this.view.renderer.setAttribute('background-color', theme.bg)
    this.applyStyles()
  }

  applyFont(cfg: FontConfig) {
    this.font = cfg
    this.applyStyles()
  }

  applyParagraphStyle(cfg: ParagraphStyle) {
    this.paragraph = cfg
    this.applyStyles()
    this.updateLayout()
  }

  applyPageWidth(width: number) {
    this.pageWidth = width
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
    this.view.renderer.setAttribute('gutter', `${isPage ? this.paragraph.horizontalPadding : 0}px`)
    const vPad = isPage ? this.paragraph.verticalPadding : 0
    this.view.renderer.setAttribute('top-margin', `${vPad}px`)
    this.view.renderer.setAttribute('bottom-margin', `${vPad}px`)
  }

  private conversionReload: Promise<void> = Promise.resolve()

  applyChineseConversion(mode: ChineseConversion): Promise<void> {
    if (mode === this.conversion) return this.conversionReload
    this.conversion = mode
    conversionMode = mode
    if (!this.view || !this.book) return Promise.resolve()
    // Serialize reloads: rapid toggles must not interleave close/open, or two
    // renderer elements would stack inside the view.
    this.conversionReload = this.conversionReload
      .catch(() => {})
      .then(() => this.reloadViewForConversion())
    return this.conversionReload
  }

  // Text transforms (正文变换 P1): same load-time caching as Chinese
  // conversion, so a rule-set change takes effect via the same close/reopen
  // reload. The module-level rules are always updated — they are what the
  // transformTarget listener reads for sections loaded after this call.
  applyTextTransforms(rules: TextTransformRule[]): Promise<void> {
    this.transforms = rules
    const json = JSON.stringify(rules)
    if (json === this.transformsJson) return this.conversionReload
    this.transformsJson = json
    setActiveTransforms(rules)
    if (!this.view || !this.book) return Promise.resolve()
    this.conversionReload = this.conversionReload
      .catch(() => {})
      .then(() => this.reloadViewForConversion())
    return this.conversionReload
  }

  private async reloadViewForConversion() {
    // Load-time content transforms (text transforms, Chinese conversion) are
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
    await this.view.open(this.book)
    if (this.destroyed) return
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
    if (mode === 'seamless') this.applyReadingMode('scroll')
    const renderer = this.view?.renderer
    if (!renderer) return
    // snap-turn and continuous are mutually exclusive in the paginator
    if (mode === 'snap') {
      renderer.setAttribute('snap-turn', '')
      renderer.removeAttribute('continuous')
    } else if (mode === 'seamless') {
      renderer.removeAttribute('snap-turn')
      renderer.setAttribute('continuous', '')
    } else {
      renderer.removeAttribute('snap-turn')
      renderer.removeAttribute('continuous')
    }
  }

  async scrollToPercent(percent: number) {
    // The progress-strip drag is a user jump — record the position being left,
    // confirmed by handleRelocate once the position actually changed
    this.pendingJumpFrom = this.lastCfi ?? ''
    // …and close the reading segment so the seek stretch never joins the union
    this.emit('userJump')
    const gen = this.navigationPending.begin()
    try {
      await this.view?.goToFraction(Math.max(0, Math.min(1, percent / 100)))
    } finally {
      this.navigationPending.end(gen)
    }
  }

  async scrollByPages(delta: number, distanceOverride?: number) {
    // In scrolled mode a full-viewport jump drops the half line at the page
    // edge; overlap 8% so the old page's last line reappears on the new one.
    // renderer.size is the paginator's viewport size (height when scrolled).
    const size = this.view?.renderer?.size
    const pageDistance = this.readingMode === 'scroll' && size ? Math.round(size * 0.92) : undefined
    const distance = this.readingMode === 'scroll'
      ? distanceOverride ?? pageDistance
      : undefined
    const steps = Math.abs(delta)
    for (let i = 0; i < steps; i++) {
      if (delta > 0) await this.view?.next(distance)
      else await this.view?.prev(distance)
    }
  }

  private ensureTts(): any | null {
    if (!this.view?.renderer?.getContents) return null
    try {
      this.view.initTTS(false)
      return this.view.tts ?? null
    } catch {
      return null
    }
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
    let tts = this.ensureTts()
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
        tts = this.ensureTts()
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
    const tts = this.ensureTts()
    if (!tts) return null
    tts.start?.({ highlight: false })
    return this.ttsDetailToSegment(tts.currentDetail?.())
  }

  async peekTtsSegments(count = 4): Promise<TtsSegment[]> {
    const tts = this.ensureTts()
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
    const tts = this.ensureTts()
    if (!tts) return null
    const nextText = tts.next?.()
    let detail = nextText ? tts.currentDetail?.() : null
    if (!nextText && await this.moveTtsChapter('next')) {
      detail = this.ensureTts()?.currentDetail?.()
    }
    return this.ttsDetailToSegment(detail)
  }

  async previousTtsSegment(): Promise<TtsSegment | null> {
    const tts = this.ensureTts()
    if (!tts) return null
    const previousText = tts.prev?.()
    let detail = previousText ? tts.currentDetail?.() : null
    if (!previousText && await this.moveTtsChapter('previous')) {
      const previous = this.ensureTts()
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
        try { await this.scrollByPages(1, distance) } finally { this.ttsNavigation = false }
        return
      }
    }
    this.ttsNavigation = true
    try { await this.view?.goTo(segment.cfi) } finally { this.ttsNavigation = false }
  }

  async highlightTtsSegment(segment: TtsSegment): Promise<void> {
    this.ensureTts()?.highlightCfi?.(segment.cfi)
  }

  clearTtsHighlight() {
    try { this.view?.initTTS?.(true) } catch { /* view may be between reloads */ }
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
    // The selection is not final yet on mouseup/keyup — read it after this tick
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
        const info: SelectionInfo = {
          cfiRange,
          text: text.slice(0, 500),
          rawText,
          ...(beforeText ? { beforeText } : {}),
          rect: this.popupRect(doc, range),
          // Point-patch anchors (P2): the offset is counted on the rendered
          // document (conversion is length-preserving, so it equals the
          // engine's coordinate system); singleTextNode gates point creation.
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

  deselect() {
    try { this.view?.deselect?.() } catch { /* view may be gone */ }
  }

  clearSelection() {
    this.deselect()
    if (this.selectionActive) {
      this.selectionActive = false
      this.emit('selected', null)
    }
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
    const transformKey = JSON.stringify(this.transforms)
    const cacheKey = cacheable
      ? `${this.url}|${opts?.scope ?? 'book'}|${opts?.mode ?? 'contains'}|${opts?.matchCase ?? false}|${this.conversion}|${transformKey}|${q}`
      : ''
    const cached = cacheable ? searchCache.get(cacheKey) : undefined
    if (cached) {
      // refresh recency
      searchCache.delete(cacheKey)
      searchCache.set(cacheKey, cached)
      for (const [index, matches] of cached.matches) {
        this.searchMatchOffsets.set(index, matches)
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
        transforms: this.transforms,
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
      for (const m of matches) {
        const range = offsetsToRange(content.doc, m.start, m.end)
        if (!range) continue
        const cfi = this.view.getCFI(index, range)
        if (cfi) values.push(`${SEARCH_ANNOTATION_PREFIX}${cfi}`)
      }
      for (const value of values) {
        Promise.resolve(this.view?.addAnnotation({ value })).catch(() => {})
      }
      this.drawnSearchValues.set(index, values)
    } catch {
      // highlight drawing is best-effort
    }
  }

  private clearSearchHighlights() {
    for (const values of this.drawnSearchValues.values()) {
      for (const value of values) {
        Promise.resolve(this.view?.deleteAnnotation?.({ value })).catch(() => {})
      }
    }
    this.drawnSearchValues.clear()
    this.searchMatchOffsets.clear()
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
  // memoized loader the render pipeline uses (original text, pre-transforms),
  // so counting never re-applies the rules. Cost: one parse per section, so
  // the caller shows it async and caches by rule signature.
  async countTransformMatches(rules: TextTransformRule[]): Promise<Record<string, number>> {
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
    return readerTextVersion(this.conversion, this.transforms)
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
        transforms: this.transforms,
      })
      if (signal?.aborted || this.destroyed) throw new DOMException('The reader corpus request was aborted', 'AbortError')
      if (!chapterText) throw new Error('Reader chapter content is not available')
      chapters.push({ chapterIndex, text: chapterText.text })
    }
    return { visibleTextVersion: this.getAiCorpusVersion(), chapters }
  }

  getSnippet(cfi: string, maxLength = 80): string {
    try {
      // chapter:{index}:{fraction} — scrolled-mode TXT books
      if (cfi.startsWith('chapter:')) {
        const text = this.lastRange?.startContainer?.textContent
        if (text) return text.slice(0, maxLength).replace(/\s+/g, ' ').trim().slice(0, maxLength)
        return ''
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

  on<K extends keyof RendererEvents>(type: K, fn: RendererEvents[K]) {
    this.listeners.push({ type, fn: fn as (...args: unknown[]) => void })
    if (type === 'tocReady') {
      this.buildTocIndex()
      const toc =
        this.book?.toc?.map((item: any) => ({
          label: item.label,
          href: item.href,
          level: item.level ?? 1,
        })) ?? []
      ;(fn as RendererEvents['tocReady'])(toc)
    }
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
          const sel = this.selectionDocs.get(doc)
          if (sel) {
            doc.removeEventListener('mouseup', sel.handler)
            doc.removeEventListener('keyup', sel.handler)
            doc.removeEventListener('dblclick', sel.dblHandler)
            doc.removeEventListener('keydown', sel.escHandler)
            this.selectionDocs.delete(doc)
          }
        }
      }
      for (const { doc, index } of contents) {
        if (!doc || this.activeDocs.has(doc)) continue
        doc.addEventListener('click', this.handleDocInteraction)
        const handler = () => this.handleSelection(doc, index)
        doc.addEventListener('mouseup', handler)
        doc.addEventListener('keyup', handler)
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
        this.selectionDocs.set(doc, { index, handler, dblHandler, escHandler })
      }
      this.activeDocs = docs
    } catch {
      // ignore sync errors — the renderer may not be fully initialized yet
    }
  }

  destroy() {
    this.destroyed = true
    // stop any in-flight search loop at the next chapter boundary; the
    // highlight overlays die with the view, so only the bookkeeping is dropped
    this.searchGen++
    this.drawnSearchValues.clear()
    this.searchMatchOffsets.clear()
    this.invalidateFootnoteRequests()
    this.footnoteHandler?.disposeAll?.()
    this.disposeFootnoteEntries()
    this.footnoteHandler?.removeEventListener?.('before-render', this.handleFootnoteBeforeRender)
    this.footnoteHandler = null
    setTransformInvalidListener(null)
    this.navigationPending.dispose()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    if (this.prefetchTimer !== null) { clearTimeout(this.prefetchTimer); this.prefetchTimer = null }
    if (this.marginalTimer !== null) { clearTimeout(this.marginalTimer); this.marginalTimer = null }
    this.view?.removeEventListener('link', this.handleFootnoteLink)
    try { this.view?.close() } catch { /* view may be partially initialized */ }
    try { this.view?.remove() } catch { /* ignore */ }
    for (const doc of this.activeDocs) {
      doc.removeEventListener('click', this.handleDocInteraction)
      const sel = this.selectionDocs.get(doc)
      if (sel) {
        doc.removeEventListener('mouseup', sel.handler)
        doc.removeEventListener('keyup', sel.handler)
        doc.removeEventListener('dblclick', sel.dblHandler)
      }
    }
    this.selectionDocs.clear()
    this.activeDocs.clear()
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
    // fontCss (@import/@font-face) must precede all rules or the at-rules
    // are ignored; the paginator re-lays out on document.fonts.ready
    const css = `
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
      }
      ::selection {
        background: ${this.theme.text}19 !important;
        color: inherit !important;
      }
      p {
        text-indent: ${this.paragraph.indent}em !important;
        margin-bottom: ${this.paragraph.paragraphSpacing}em !important;
        text-align: ${this.paragraph.textAlignJustify ? 'justify' : 'start'} !important;
      }
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
