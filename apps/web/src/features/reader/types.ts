export interface ReaderLocation {
  cfi: string
  percent: number
  /** Book-wide position 0-1 from the engine, for read-interval tracking */
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
}

/** Rect in main-viewport client coordinates, used to position popups */
export interface PopupRect {
  left: number
  top: number
  width: number
  height: number
}

export interface SelectionInfo {
  cfiRange: string
  text: string
  // Selection.toString() keeps block-level line breaks (Range.toString() does
  // not) — used by copy so pasted text keeps its paragraphs
  rawText?: string
  anchor?: string
  rect?: PopupRect
  /** When set on instantAnnotation, the selection toolbar stays open so the
   * user can restyle right after auto-marking ("选中即划" mode). */
  keepSelection?: boolean
}

export interface RendererEvents {
  relocated: (e: ReaderLocation) => void
  selected: (e: SelectionInfo | null) => void
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
}

export interface TocItem {
  label: string
  href: string
  level?: number
}

export interface BookReader {
  mount(container: HTMLElement): Promise<void>
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
  applyContinuousScroll(mode: ContinuousScroll): void
  applyClickSettings(mode: ClickAreaMode): void
  applyMarginals(config: MarginalConfig): void
  /** Per-chapter word counts, indexed by chapter (for the chapterWordCount field) */
  setChapterWordCounts(counts: (number | undefined)[]): void
  /**
   * Cumulative byte-fraction boundaries of the book's sections (foliate's own
   * progress model) — the drag preview must derive chapters from these so it
   * matches where the seek actually lands.
   */
  getSectionFractions(): number[] | null
  scrollToPercent(percent: number): Promise<void>
  scrollByPages(delta: number): Promise<void>
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
  /** Render highlight/note annotations on the content and keep them in sync */
  setAnnotations(annotations: ReaderAnnotation[]): void
  /** Collapse any in-content text selection (e.g. after a toolbar action) */
  clearSelection(): void
  /** Remove all search result highlights from the page */
  clearSearch(): void
  /** Clear the DOM selection without emitting events — keeps React toolbar state */
  deselect(): void
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

export type NavTab = 'toc' | 'notes' | 'stats'
export type PageWidth = number

export type FontFamily = 'serif' | 'sans-serif' | 'kaiti' | 'fangsong'

export const FONT_OPTIONS: { id: FontFamily; name: string; value: string }[] = [
  { id: 'serif', name: '宋体', value: '"Noto Serif SC", "Source Han Serif SC", "Source Han Serif", "Songti SC", "SimSun", serif' },
  { id: 'sans-serif', name: '黑体', value: '"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif' },
  { id: 'kaiti', name: '楷体', value: '"KaiTi", "KaiTi_GB2312", "STKaiti", "BiauKai", serif' },
  { id: 'fangsong', name: '仿宋', value: '"FangSong", "FangSong_GB2312", "STFangsong", serif' },
]

export interface FontConfig {
  fontFamily: FontFamily
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
