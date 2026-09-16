import type { AiIndexChapter } from '@bookdock/shared'

import type { TextReplacementRule } from './lib/text-replacements'

export interface ReaderLocation {
  cfi: string
  /** Stable visible-content CFI for annotations; unlike cfi, this is not rewritten to a scroll fraction */
  anchorCfi?: string
  percent: number
  /** Book-wide viewport-start position 0-1 from the engine, for seek and read-interval tracking */
  fraction?: number
  chapter?: string
  chapterIndex?: number
  /** Position within the current chapter 0-1, when the engine exposes one */
  chapterFraction?: number
  /** Chapter number (1-based) within the book, for the progress text */
  page?: number
  total?: number
  /** Page within the current chapter, for chapter-start detection */
  pageInChapter?: number
  /** Viewport screens moved since the previous relocate (1 for a cross-chapter move), for jump-history auto-hide */
  movedScreens?: number
  /** Internal relocation caused by TTS chapter navigation. */
  source?: 'reader' | 'tts'
}

/** Rect in main-viewport client coordinates, used to position popups */
export interface PopupRect {
  left: number
  top: number
  width: number
  height: number
}

export interface FootnoteEntry {
  id: number
  href: string
  type: string | null
  hidden: boolean
  view: HTMLElement
  anchorRect?: PopupRect
  canGoBack: boolean
}

export interface SelectionInfo {
  cfiRange: string
  text: string
  /** Captured reader location when the selection is handed to AI. */
  chapterIndex?: number
  chapterTitle?: string
  /** Visible text immediately before the selection, captured for opt-in AI context. */
  beforeText?: string
  /** Visible paragraph containing the selection, used by AI quick-command templates. */
  paragraphText?: string
  // Selection.toString() keeps block-level line breaks (Range.toString() does
  // not) — preferred over `text` for annotation excerpts and copy so quotes
  // keep their paragraphs
  rawText?: string
  anchor?: string
  rect?: PopupRect
  /** Point-patch anchor: character offset of the selection start in the
   * section's text content (same traversal applyReplacements counts). */
  startOffset?: number
  /** Point-patch anchor: current section's manifest href (book.sections[index].id) */
  sectionHref?: string
  /** Point-patch snapshot using the selected text nodes' concatenated content. */
  pointText?: string
  /** Kept for compatibility with callers that need to know the selection shape. */
  singleTextNode?: boolean
  /** When set on instantAnnotation, the selection toolbar stays open so the
   * user can restyle right after auto-marking ("选中即划" mode). */
  keepSelection?: boolean
}

export interface AiIndexCorpus {
  visibleTextVersion: string
  chapters: AiIndexChapter[]
}

export interface TtsSegment {
  id: string
  text: string
  cfi: string
  chapterIndex: number
}

export interface RendererEvents {
  relocated: (e: ReaderLocation) => void
  selected: (e: SelectionInfo | null) => void
  /** A non-collapsed text selection has started in the reading content. */
  textSelectionStart: () => void
  annotationClicked: (e: { cfiRange: string; rect?: PopupRect }) => void
  instantAnnotation: (e: SelectionInfo) => void
  rendered: () => void
  tocReady: (items: { label: string; href: string; level?: number }[]) => void
  /**
   * Fired after a user-initiated jump (TOC/note/search/progress-drag) actually
   * moved the position, carrying the position being left. Chokepoint for the
   * jump-history back stack — internal navigation (initial open, history
   * back/forward) opts out via `display(target, { internal: true })`.
   */
  jumpConfirmed: (e: { cfi: string }) => void
  /**
   * A user-initiated navigation has been slow enough to show the chapter
   * loading indicator (true), or the latest navigation has settled (false).
   */
  navigatePending: (e: { pending: boolean }) => void
  /**
   * Middle click-area zone tapped (tap-to-reveal the top/bottom chrome; the
   * click-area setting only governs page turning, so this fires in every mode).
   */
  chromeToggle: () => void
  /**
   * An explicit user navigation is about to happen (TOC click, progress seek,
   * search/bookmark jump, scroll-mode chapter switch) — the reader must close
   * its reading segment so the jump stretch never counts as read coverage.
   */
  userJump: () => void
  /**
   * Point patches (文本替换) that could not be applied to a loaded section —
   * snapshot not found at/around the recorded offset. Emitted per section load;
   * the reader dedupes by patch id.
   */
  replacementInvalid: (e: { ids: string[] }) => void
  /**
   * An annotation whose CFI no longer resolves in the book's spine (or whose
   * text offset overflows the section) — it can never be drawn again.
   */
  annotationOrphaned: (e: { cfiRange: string; type: string }) => void
  footnoteOpen: (e: FootnoteEntry) => void
  footnoteClose: () => void
  ttsInvalidated: () => void
  /** A direct user gesture changed or intends to change the reading position. */
  userInteraction: () => void
  /** A touch gesture that changed the reading position has ended. */
  userInteractionEnd: () => void
  /** A live reader setting changed and may invalidate the current layout. */
  readingSettingsChanged: () => void
}

export interface TocItem {
  label: string
  href: string
  level?: number
}

export interface BookReader {
  mount(container: HTMLElement, initialTarget?: string, initialFraction?: number): Promise<void>
  display(target?: string, opts?: { internal?: boolean; showPending?: boolean }): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
  applyReadingMode(mode: ReadingMode): void
  applyShowHeader(enabled: boolean): void
  applyShowFooter(enabled: boolean): void
  applyPageColumns(columns: number): void
  applyColumnGap(gapPercent: number): void
  applyPageAnimation(enabled: boolean): void
  applyReadingTheme(theme: { bg: string; text: string }): void
  applyFont(cfg: FontConfig): void
  applyParagraphStyle(cfg: ParagraphStyle): void
  applyPageWidth(width: number): void
  applyChineseConversion(mode: ChineseConversion): Promise<void>
  applyTextReplacements(rules: TextReplacementRule[]): Promise<void>
  applyContinuousScroll(mode: ContinuousScroll): void
  applyClickSettings(mode: ClickAreaMode): void
  /** While >0, click-to-turn and chrome-toggle are swallowed: the click that
   *  dismisses a floating UI (selection bubble, context menu…) must not also
   *  turn a page or toggle the header. Push/pop in pairs. */
  pushPopupGuard(): void
  popPopupGuard(): void
  closeFootnote(): void
  backFootnote(): void
  applyMarginals(config: MarginalConfig): void
  /** Per-chapter word counts, indexed by chapter (for the chapterWordCount field) */
  setChapterWordCounts(counts: (number | undefined)[]): void
  /**
   * Cumulative byte-fraction boundaries of the book's sections (foliate's own
   * progress model) — the drag preview must derive chapters from these so it
   * matches where the seek actually lands.
   */
  getSectionFractions(): number[] | null
  /** TOC labels resolved by Foliate for each spine section; section and TOC indexes are not interchangeable. */
  getSectionTocLabels?(): string[] | null
  scrollToPercent(percent: number): Promise<void>
  scrollByPages(delta: number, distanceOverride?: number, opts?: { internal?: boolean }): Promise<void>
  /** Returns false when the active reading mode blocks further auto movement. */
  scrollByPixels(delta: number): Promise<boolean>
  isAtEnd(): boolean
  /** Coordinates smooth auto reading with the paginator's snap boundary state. */
  setAutoReadingActive(active: boolean): void
  /**
   * Search the book. onProgress fires with partial results and the fraction of
   * the book covered so far (throttled), so callers can stream them to the UI.
   */
  search(
    query: string,
    opts?: SearchOptions,
    onProgress?: (results: SearchResult[], progress: number | null) => void,
  ): Promise<SearchResult[]>
  getSnippet(cfi: string, maxLength?: number): string
  /** Read the visible paragraph at the current reading position. */
  getCurrentParagraphText(maxLength?: number): string
  /** Build the same transformed plain-text corpus used by the visible reader. */
  getAiCorpus(signal?: AbortSignal): Promise<AiIndexCorpus>
  /** Read one transformed chapter for an explicit AI composer reference. */
  getAiChapterText(chapterIndex: number, signal?: AbortSignal): Promise<string>
  /** Stable fingerprint for the current visible text replacement and conversion settings. */
  getAiCorpusVersion(): string
  /**
   * Match counts per pattern rule across the whole book ("N 处" badges).
   * Counts against the original section markup, one parse per section.
   */
  countReplacementMatches(rules: TextReplacementRule[]): Promise<Record<string, number>>
  /** Render highlight/note annotations on the content and keep them in sync */
  setAnnotations(annotations: ReaderAnnotation[]): void
  /** Collapse any in-content text selection (e.g. after a toolbar action) */
  clearSelection(): void
  /** Remove all search result highlights from the page */
  clearSearch(): void
  /** Clear the DOM selection without emitting events — keeps React toolbar state */
  deselect(): void
  getTtsSegment(startCfi?: string): Promise<TtsSegment | null>
  getTtsChapterStartSegment(): Promise<TtsSegment | null>
  /** Return following segments without moving the foliate TTS cursor or viewport. */
  peekTtsSegments(count?: number): Promise<TtsSegment[]>
  nextTtsSegment(): Promise<TtsSegment | null>
  previousTtsSegment(): Promise<TtsSegment | null>
  revealTtsSegment(segment: TtsSegment): Promise<void>
  highlightTtsSegment(segment: TtsSegment): Promise<void>
  clearTtsHighlight(): void
  on<K extends keyof RendererEvents>(type: K, fn: RendererEvents[K]): () => void
  destroy(): void
}

export interface ReaderAnnotation {
  cfiRange: string
  type: 'highlight' | 'note'
  color: string
  style?: 'underline' | 'squiggly' | 'highlight'
  note?: string | null
}

export interface SearchOptions {
  scope?: 'book' | 'chapter'
  matchCase?: boolean
  mode?: 'contains' | 'regex'
}

export interface SearchResult {
  cfi: string
  text: string
  index: number
  /** Chapter title the match belongs to, when resolvable */
  chapter?: string
  excerpt?: { pre: string; match: string; post: string }
}

export type NavTab = 'toc' | 'notes' | 'stats' | 'ai'
export type PageWidth = number

// Font ids: the four system stacks below, builtin CDN ids (fonts.ts), or
// uploaded font ids — the registry resolves any id to a concrete stack
export type FontFamily = string

export const FONT_OPTIONS: { id: FontFamily; name: string; value: string }[] = [
  { id: 'serif', name: '宋体', value: '"Noto Serif SC", "Source Han Serif SC", "Source Han Serif", "Songti SC", "SimSun", serif' },
  { id: 'sans-serif', name: '黑体', value: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif' },
  { id: 'kaiti', name: '楷体', value: '"KaiTi", "KaiTi_GB2312", "STKaiti", "BiauKai", serif' },
  { id: 'fangsong', name: '仿宋', value: '"FangSong", "FangSong_GB2312", "STFangsong", serif' },
]

export interface FontConfig {
  fontFamily: FontFamily
  /** Pre-resolved CSS font stack (registry lookup happens at the hook boundary,
   *  the renderer never sees font ids); falls back to FONT_OPTIONS[0] when unset */
  fontStack?: string
  /** @font-face / @import snippet injected at the top of the iframe stylesheet */
  fontCss?: string
  size: number
  lineHeight: number
  fontWeight: number
  overrideBookFont: boolean
}

export interface ParagraphStyle {
  paragraphSpacing: number
  letterSpacing: number
  indent: number
  verticalPadding: number
  horizontalPadding: number
  textAlignJustify: boolean
  overrideBookLayout: boolean
}

export type ReadingMode = 'scroll' | 'page'

export type AutoReadingMode = 'smooth' | 'timed'

export type ChineseConversion = 'off' | 'simplified' | 'traditional'

export type ContinuousScroll = 'off' | 'snap' | 'seamless'

// Fields available on the header/footer info bar (F4).
export type MarginalField = 'none' | 'bookTitle' | 'chapter' | 'chapterProgress' | 'bookProgress' | 'chapterWordCount' | 'time'

// Click-to-turn zone modes (F3): 'none' = no mode selected = disabled.
export type ClickAreaMode = 'standard' | 'fullscreen' | 'swap' | 'none'

export type MarginalConfig = {
  header: [MarginalField, MarginalField, MarginalField]
  footer: [MarginalField, MarginalField, MarginalField]
  /** 0 = auto (.75em of the reading font) */
  fontSize: number
}
