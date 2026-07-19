export interface ReaderLocation {
  cfi: string
  percent: number
  chapter?: string
  chapterIndex?: number
  /** Chapter number (1-based) within the book, for the progress text */
  page?: number
  total?: number
  /** Page within the current chapter, for chapter-start detection */
  pageInChapter?: number
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
  anchor?: string
  rect?: PopupRect
}

export interface RendererEvents {
  relocated: (e: ReaderLocation) => void
  selected: (e: SelectionInfo | null) => void
  annotationClicked: (e: { cfiRange: string; rect?: PopupRect }) => void
  rendered: () => void
  tocReady: (items: { label: string; href: string; level?: number }[]) => void
}

export interface TocItem {
  label: string
  href: string
  level?: number
}

export interface BookReader {
  mount(container: HTMLElement): Promise<void>
  display(target?: string): Promise<void>
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
  applyChineseConversion(mode: ChineseConversion): void
  applyContinuousScroll(mode: ContinuousScroll): void
  scrollToPercent(percent: number): Promise<void>
  scrollByPages(delta: number): Promise<void>
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>
  getSnippet(cfi: string, maxLength?: number): string
  /** Render highlight/note annotations on the content and keep them in sync */
  setAnnotations(annotations: ReaderAnnotation[]): void
  /** Collapse any in-content text selection (e.g. after a toolbar action) */
  clearSelection(): void
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
  excerpt?: { pre: string; match: string; post: string }
}

export type NavTab = 'toc' | 'bookmarks' | 'notes' | 'search'
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
