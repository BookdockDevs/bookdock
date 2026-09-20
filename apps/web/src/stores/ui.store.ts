import { create } from 'zustand'
import type { FontPreferences, TtsEngine } from '@bookdock/shared'
import type { AutoReadingMode, FontFamily, ReadingMode, ChineseConversion, ContinuousScroll, ClickAreaMode, MarginalField, NavTab } from '../features/reader/types'
import type { CustomReadingTheme } from '../lib/reading-theme'
import {
  CONFIG_STORAGE_KEY,
  READING_PROFILE_KEYS,
  createReadingPreset as createPreset,
  deleteReadingPreset as deletePreset,
  emptyConfig,
  foldReadingChange,
  parseReadingConfig,
  pickReadingSnapshot,
  renameReadingPreset as renamePreset,
  resolveSnapshot,
  serializeReadingConfig,
  type ReadingConfig,
} from '../features/reader/lib/reading-profiles'

export type UiTheme = 'system' | 'light' | 'dark'
export type UiSection = 'font' | 'layout' | 'display' | 'theme'

/** Cover fill mode inside the grid card: object-cover vs object-contain. */
export type CoverFit = 'crop' | 'full'

/** Recently-read strip presentation: hidden, large cover row, or card carousel. */
export type RecentlyReadStyle = 'off' | 'covers' | 'cards'

/** Optional info items on the right side of a list-view row */
export type ListInfoItem = 'progress' | 'size' | 'lastRead' | 'shelf' | 'tags' | 'createdAt'
/** Fixed display order: the row renders enabled items in this sequence */
export const LIST_INFO_ITEMS: ListInfoItem[] = ['progress', 'size', 'lastRead', 'shelf', 'tags', 'createdAt']

const CUSTOM_THEMES_KEY = 'bd-read-custom-themes'

function getInitialCustomThemes(): CustomReadingTheme[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(CUSTOM_THEMES_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (t): t is CustomReadingTheme =>
        !!t && typeof t.id === 'string' && typeof t.name === 'string'
        && typeof t.colors?.bg === 'string' && typeof t.colors?.fg === 'string' && typeof t.colors?.primary === 'string',
    )
  } catch {
    return []
  }
}

function persistCustomThemes(themes: CustomReadingTheme[]) {
  try {
    window.localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes))
  } catch {
    // ignore localStorage errors in private/incognito modes
  }
}

interface UiState {
  uiTheme: UiTheme
  readingThemeId: string
  lightReadingThemeId: string
  customThemes: CustomReadingTheme[]
  fontFamily: FontFamily
  fontPreferences: FontPreferences
  fontOrder: string[]
  fontSize: number
  fontWeight: number
  lineHeight: number
  paragraphSpacing: number
  letterSpacing: number
  indent: number

  // Flat values (always reflect current readingMode)
  pageWidth: number
  horizontalPadding: number
  verticalPadding: number

  // Page-mode only flat values
  pageColumns: number
  columnGap: number

  // Mode-specific backing stores
  scrollPageWidth: number
  scrollHorizontalPadding: number
  scrollVerticalPadding: number
  pagePageWidth: number
  pageHorizontalPadding: number
  pageVerticalPadding: number
  pagePageColumns: number
  columnGapPage: number

  textAlignJustify: boolean
  overrideBookFont: boolean
  overrideBookLayout: boolean
  readingMode: ReadingMode
  showHeader: boolean
  showFooter: boolean
  chineseConversion: ChineseConversion
  continuousScroll: ContinuousScroll
  pageAnimation: boolean
  autoMarkSelection: boolean
  setAutoMarkSelection: (v: boolean) => void

  // Click-to-turn zones (page mode): single mode enum — 'none' = disabled.
  clickAreaMode: ClickAreaMode
  setClickAreaMode: (m: ClickAreaMode) => void

  // Header/footer info bar fields (F4), one field per L/C/R position
  headerLeft: MarginalField
  headerCenter: MarginalField
  headerRight: MarginalField
  footerLeft: MarginalField
  footerCenter: MarginalField
  footerRight: MarginalField
  /** 0 = auto (follow .75em of the reading font) */
  marginalFontSize: number
  setHeaderLeft: (v: MarginalField) => void
  setHeaderCenter: (v: MarginalField) => void
  setHeaderRight: (v: MarginalField) => void
  setFooterLeft: (v: MarginalField) => void
  setFooterCenter: (v: MarginalField) => void
  setFooterRight: (v: MarginalField) => void
  setMarginalFontSize: (v: number) => void

  // Reading-time accounting: automatic heuristics, the manual timer pill,
  // or off — no reading data is recorded and the reader stats tab is hidden
  readingTimerMode: 'auto' | 'manual' | 'off'
  manualTimerGraceMinutes: 1 | 5 | 10 | 30
  ttsEngine: TtsEngine
  ttsServiceId: string | null
  ttsVoiceId: string
  ttsRate: number
  ttsAutoNext: boolean
  ttsFollow: boolean
  autoReadingMode: AutoReadingMode
  autoReadingSpeed: number
  autoReadingProgressBar: boolean
  setReadingTimerMode: (v: 'auto' | 'manual' | 'off') => void
  setManualTimerGraceMinutes: (v: 1 | 5 | 10 | 30) => void
  setTtsEngine: (v: TtsEngine) => void
  setTtsServiceId: (v: string | null) => void
  setTtsVoiceId: (v: string) => void
  setTtsRate: (v: number) => void
  setTtsAutoNext: (v: boolean) => void
  setTtsFollow: (v: boolean) => void
  setAutoReadingMode: (v: AutoReadingMode) => void
  setAutoReadingSpeed: (v: number) => void
  setAutoReadingProgressBar: (v: boolean) => void

  // Named reading-setting profiles (阅读设置预设): serialized JSON of the
  // multi-config blob (`{ global, presets[] }`). The blob syncs across
  // devices; activation does not (intents sync, outcomes stay local):
  // `activePresetId` is the device-local pointer (own localStorage key,
  // BroadcastChannel only), `boundPresetId` is the session-only binding of
  // the currently open book (set by Reader from book.meta.boundPresetId).
  // Resolution chain: bound preset > device active > global; the flat fields
  // above always hold the resolved config's values.
  readingConfig: string
  activePresetId: string | null
  boundPresetId: string | null
  createReadingPreset: (name: string, perBookOverlay?: Record<string, unknown>) => void
  renameReadingPreset: (id: string, name: string) => void
  deleteReadingPreset: (id: string) => void
  activateReadingPreset: (id: string | null) => void
  setBoundPresetId: (id: string | null) => void
  /** Re-apply the resolution chain to the flat fields (sync receive, book
   * open/close, preset deletion). Clears a dangling device active. */
  applyReadingResolution: () => void

  // Library UI prefs
  coverText: boolean
  coverFit: CoverFit
  gridColumns: string
  recentlyReadStyle: RecentlyReadStyle
  listInfoItems: ListInfoItem[]
  sortBy: string
  sortOrder: 'asc' | 'desc'
  view: 'grid' | 'list'
  setCoverText: (v: boolean) => void
  setCoverFit: (v: CoverFit) => void
  setGridColumns: (v: string) => void
  setRecentlyReadStyle: (v: RecentlyReadStyle) => void
  setListInfoItems: (v: ListInfoItem[]) => void
  setSortBy: (v: string) => void
  setSortOrder: (v: 'asc' | 'desc') => void
  setView: (v: 'grid' | 'list') => void

  // Reader sidebar prefs
  toolbarLocked: boolean
  sidebarWidth: number
  /** Last explicit open/closed choice while locked; seeds the sidebar on book
   *  open (locked + open). Device-local like toolbarLocked. */
  sidebarRememberedOpen: boolean
  /** Last sidebar tab the user picked explicitly; seeds the tab on book open.
   *  Device-local like toolbarLocked. */
  navTabRemembered: NavTab
  setToolbarLocked: (v: boolean) => void
  setSidebarWidth: (v: number) => void
  setSidebarRememberedOpen: (v: boolean) => void
  setNavTabRemembered: (v: NavTab) => void

  setUiTheme: (t: UiTheme) => void
  setReadingThemeId: (id: string) => void
  saveCustomTheme: (theme: CustomReadingTheme) => void
  deleteCustomTheme: (id: string) => void
  /** Replace the whole list (settings sync); persists without theme side effects */
  setCustomThemes: (themes: CustomReadingTheme[]) => void
  setFontFamily: (f: FontFamily) => void
  setFontPreference: (id: string, preference: FontPreferences[string]) => void
  removeFontPreference: (id: string) => void
  setFontOrder: (order: string[]) => void
  setFontSize: (n: number) => void
  setFontWeight: (n: number) => void
  setLineHeight: (n: number) => void
  setParagraphSpacing: (n: number) => void
  setLetterSpacing: (n: number) => void
  setIndent: (n: number) => void
  setPageWidth: (w: number) => void
  setHorizontalPadding: (n: number) => void
  setVerticalPadding: (n: number) => void
  setTextAlignJustify: (v: boolean) => void
  setOverrideBookFont: (v: boolean) => void
  setOverrideBookLayout: (v: boolean) => void
  setReadingMode: (m: ReadingMode) => void
  setPageColumns: (n: number) => void
  setColumnGap: (n: number) => void
  setShowHeader: (v: boolean) => void
  setShowFooter: (v: boolean) => void
  setChineseConversion: (v: ChineseConversion) => void
  setContinuousScroll: (v: ContinuousScroll) => void
  setPageAnimation: (v: boolean) => void
}

// UI theme is fixed to follow the system preference.
export function getEffectiveTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getInitialNumber(key: string, fallback: number, min?: number, max?: number): number {
  if (typeof window === 'undefined') return fallback
  const raw = localStorage.getItem(key)
  if (raw === null) return fallback
  const num = Number(raw)
  if (Number.isNaN(num)) return fallback
  if (min !== undefined && num < min) return min
  if (max !== undefined && num > max) return max
  return num
}

function getInitial<T extends string>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  const v = localStorage.getItem(key)
  return (v as T) || fallback
}

function getInitialUiTheme(): UiTheme {
  if (typeof window === 'undefined') return 'system'
  const stored = localStorage.getItem('bd-ui-theme')
  if (stored === 'system' || stored === 'dark' || stored === 'light') return stored
  return 'system'
}

const MANUAL_GRACE_OPTIONS = [1, 5, 10, 30] as const

function getInitialTimerMode(): 'auto' | 'manual' | 'off' {
  if (typeof window === 'undefined') return 'auto'
  const stored = localStorage.getItem('bd-reading-timer-mode')
  return stored === 'manual' || stored === 'off' ? stored : 'auto'
}

function getInitialGraceMinutes(): 1 | 5 | 10 | 30 {
  if (typeof window === 'undefined') return 5
  const n = Number(localStorage.getItem('bd-manual-timer-grace'))
  return (MANUAL_GRACE_OPTIONS as readonly number[]).includes(n) ? n as 1 | 5 | 10 | 30 : 5
}

function getInitialBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(key)
  if (raw === null) return fallback
  return raw === 'true'
}

function getInitialListInfoItems(): ListInfoItem[] {
  if (typeof window === 'undefined') return ['progress']
  try {
    const raw = localStorage.getItem('bd-list-info-items')
    if (raw === null) return ['progress']
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return ['progress']
    return parsed.filter((v): v is ListInfoItem => (LIST_INFO_ITEMS as string[]).includes(v as string))
  } catch {
    return ['progress']
  }
}

function setStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore localStorage errors in private/incognito modes
  }
}

const ACTIVE_PRESET_STORAGE_KEY = 'bd-reading-active-preset'

function getInitialActivePresetId(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(ACTIVE_PRESET_STORAGE_KEY)
}

function getInitialReadingConfig(): ReadingConfig | null {
  if (typeof window === 'undefined') return null
  return parseReadingConfig(localStorage.getItem(CONFIG_STORAGE_KEY))
}
const initialReadingConfig = getInitialReadingConfig()

const initialReadingMode = getInitial<ReadingMode>('bd-reading-mode', 'scroll')

function getInitialAutoReadingMode(): AutoReadingMode {
  if (typeof window === 'undefined') return initialReadingMode === 'page' ? 'timed' : 'smooth'
  const stored = localStorage.getItem('bd-auto-reading-mode')
  if (stored === 'smooth' || stored === 'timed') return stored
  return initialReadingMode === 'page' ? 'timed' : 'smooth'
}

function getInitialClickAreaMode(): ClickAreaMode {
  if (typeof window === 'undefined') return 'standard'
  const stored = localStorage.getItem('bd-click-area-mode')
  if (stored === 'standard' || stored === 'fullscreen' || stored === 'swap' || stored === 'none') return stored
  return 'standard'
}

function initMarginalDefaultsMigration() {
  if (typeof window === 'undefined') return
  try {
    if (!localStorage.getItem('bd-marginal-defaults-v2')) {
      localStorage.setItem('bd-marginal-defaults-v2', 'true')
      const oldHeaderCenter = localStorage.getItem('bd-header-center')
      const oldHeaderLeft = localStorage.getItem('bd-header-left')
      if ((!oldHeaderCenter || oldHeaderCenter === 'bookTitle') && (!oldHeaderLeft || oldHeaderLeft === 'none')) {
        localStorage.setItem('bd-header-left', 'bookTitle')
        localStorage.setItem('bd-header-center', 'none')
      }
      const oldFooterCenter = localStorage.getItem('bd-footer-center')
      const oldFooterLeft = localStorage.getItem('bd-footer-left')
      if ((!oldFooterCenter || oldFooterCenter === 'chapter') && (!oldFooterLeft || oldFooterLeft === 'none')) {
        localStorage.setItem('bd-footer-left', 'chapter')
        localStorage.setItem('bd-footer-center', 'none')
        if (!localStorage.getItem('bd-footer-right') || localStorage.getItem('bd-footer-right') === 'none') {
          localStorage.setItem('bd-footer-right', 'bookProgress')
        }
      }
    }
  } catch {
    // ignore localStorage errors
  }
}
initMarginalDefaultsMigration()

const initialScrollPageWidth = getInitialNumber('bd-page-width', 800, 400, 1800)

function getInitialCoverText(): boolean {
  if (typeof window === 'undefined') return true
  const stored = localStorage.getItem('bd-cover-text')
  return stored === null ? true : stored === 'true'
}

function getInitialCoverFit(): CoverFit {
  if (typeof window === 'undefined') return 'crop'
  const stored = localStorage.getItem('bd-cover-fit')
  return stored === 'full' ? 'full' : 'crop'
}

function getInitialRecentlyReadStyle(): RecentlyReadStyle {
  if (typeof window === 'undefined') return 'off'
  const stored = localStorage.getItem('bd-recently-read-style')
  return stored === 'covers' || stored === 'cards' ? stored : 'off'
}
function getInitialNavTab(): NavTab {
  if (typeof window === 'undefined') return 'toc'
  const stored = localStorage.getItem('bd-reader-nav-tab')
  return stored === 'notes' || stored === 'stats' || stored === 'ai' ? stored : 'toc'
}
const initialScrollHorizontalPadding = getInitialNumber('bd-horizontal-padding', 0, 0, 120)
const initialScrollVerticalPadding = getInitialNumber('bd-vertical-padding', 0, 0, 120)

const initialPagePageWidth = getInitialNumber('bd-page-page-width', 0, 0, 1800)
const initialPageHorizontalPadding = getInitialNumber('bd-page-horizontal-padding', 40, 0, 120)
const initialPageVerticalPadding = getInitialNumber('bd-page-vertical-padding', 0, 0, 120)
const initialPagePageColumns = getInitialNumber('bd-page-columns', 2, 1, 3)
const initialColumnGapPage = getInitialNumber('bd-column-gap', 5, 0, 15)

const initialPageWidth = initialReadingMode === 'page' ? initialPagePageWidth : initialScrollPageWidth
const initialHorizontalPadding = initialReadingMode === 'page' ? initialPageHorizontalPadding : initialScrollHorizontalPadding
const initialVerticalPadding = initialReadingMode === 'page' ? initialPageVerticalPadding : initialScrollVerticalPadding

export const useUiStore = create<UiState>((set, get) => ({
  uiTheme: getInitialUiTheme(),
  readingThemeId: getInitial<string>('bd-read-theme', 'paper'),
  lightReadingThemeId: getInitial<string>('bd-read-theme-light', 'paper'),
  customThemes: getInitialCustomThemes(),
  fontFamily: getInitial<FontFamily>('bd-font-family', 'serif'),
  fontPreferences: {},
  fontOrder: [],
  fontSize: getInitialNumber('bd-font-size', 18, 12, 64),
  fontWeight: getInitialNumber('bd-font-weight', 400, 100, 900),
  lineHeight: getInitialNumber('bd-line-height', 1.8, 1.2, 2.5),
  paragraphSpacing: getInitialNumber('bd-paragraph-spacing', 0.5, 0, 3),
  letterSpacing: getInitialNumber('bd-letter-spacing', 0, -1, 3),
  indent: getInitialNumber('bd-indent', 2, 0, 4),

  pageWidth: initialPageWidth,
  horizontalPadding: initialHorizontalPadding,
  verticalPadding: initialVerticalPadding,
  pageColumns: initialPagePageColumns,
  columnGap: initialColumnGapPage,

  scrollPageWidth: initialScrollPageWidth,
  scrollHorizontalPadding: initialScrollHorizontalPadding,
  scrollVerticalPadding: initialScrollVerticalPadding,
  pagePageWidth: initialPagePageWidth,
  pageHorizontalPadding: initialPageHorizontalPadding,
  pageVerticalPadding: initialPageVerticalPadding,
  pagePageColumns: initialPagePageColumns,
  columnGapPage: initialColumnGapPage,

  textAlignJustify: getInitialBoolean('bd-text-align-justify', false),
  overrideBookFont: getInitialBoolean('bd-override-book-font', false),
  overrideBookLayout: getInitialBoolean('bd-override-book-layout', false),
  readingMode: initialReadingMode,
  showHeader: getInitialBoolean('bd-show-header', true),
  showFooter: getInitialBoolean('bd-show-footer', true),
  chineseConversion: getInitial<ChineseConversion>('bd-chinese-conversion', 'off'),
  continuousScroll: getInitial<ContinuousScroll>('bd-continuous-scroll', 'off'),
  pageAnimation: getInitialBoolean('bd-page-animation', true),
  autoMarkSelection: getInitialBoolean('bd-auto-mark-selection', false),
  clickAreaMode: getInitialClickAreaMode(),
  headerLeft: getInitial<MarginalField>('bd-header-left', 'bookTitle'),
  headerCenter: getInitial<MarginalField>('bd-header-center', 'none'),
  headerRight: getInitial<MarginalField>('bd-header-right', 'none'),
  footerLeft: getInitial<MarginalField>('bd-footer-left', 'chapter'),
  footerCenter: getInitial<MarginalField>('bd-footer-center', 'none'),
  footerRight: getInitial<MarginalField>('bd-footer-right', 'bookProgress'),
  marginalFontSize: getInitialNumber('bd-marginal-font-size', 0, 0, 24),
  readingTimerMode: getInitialTimerMode(),
  manualTimerGraceMinutes: getInitialGraceMinutes(),
  ttsEngine: getInitial<string>('bd-tts-engine', 'system') === 'edge' ? 'edge' : getInitial<string>('bd-tts-engine', 'system') === 'service' ? 'service' : 'system',
  ttsServiceId: getInitial<string>('bd-tts-service', '') || null,
  ttsVoiceId: getInitial<string>('bd-tts-voice', ''),
  ttsRate: getInitialNumber('bd-tts-rate', 1, 0.5, 3),
  ttsAutoNext: getInitialBoolean('bd-tts-auto-next', true),
  ttsFollow: getInitialBoolean('bd-tts-follow', true),
  autoReadingMode: getInitialAutoReadingMode(),
  autoReadingSpeed: getInitialNumber('bd-auto-reading-speed', 30, 1, 100),
  autoReadingProgressBar: getInitialBoolean('bd-auto-reading-progress-bar', true),
  // Seeded right after store creation (initialReadingConfig, or a fresh config
  // picked from the flat values); '' only during that same module tick.
  readingConfig: '',
  activePresetId: getInitialActivePresetId(),
  boundPresetId: null,

  coverText: getInitialCoverText(),
  coverFit: getInitialCoverFit(),
  gridColumns: getInitial<string>('bd-grid-columns', 'auto'),
  recentlyReadStyle: getInitialRecentlyReadStyle(),
  listInfoItems: getInitialListInfoItems(),
  sortBy: getInitial<string>('bd-sort-by', 'createdAt'),
  sortOrder: getInitial<string>('bd-sort-order', 'desc') === 'asc' ? ('asc' as const) : ('desc' as const),
  view: getInitial<string>('bd-library-view', 'grid') === 'list' ? ('list' as const) : ('grid' as const),
  toolbarLocked: getInitialBoolean('bd-reader-toolbar-locked', false),
  sidebarWidth: getInitialNumber('bd-sidebar-width', 288, 200, 640),
  sidebarRememberedOpen: getInitialBoolean('bd-reader-sidebar-open', true),
  navTabRemembered: getInitialNavTab(),

  setCoverText: (coverText) => {
    setStorage('bd-cover-text', String(coverText))
    set({ coverText })
  },
  setCoverFit: (coverFit) => {
    setStorage('bd-cover-fit', coverFit)
    set({ coverFit })
  },
  setGridColumns: (gridColumns) => {
    setStorage('bd-grid-columns', gridColumns)
    set({ gridColumns })
  },
  setSortBy: (sortBy) => {
    setStorage('bd-sort-by', sortBy)
    set({ sortBy })
  },
  setSortOrder: (sortOrder) => {
    setStorage('bd-sort-order', sortOrder)
    set({ sortOrder })
  },
  setView: (view) => {
    setStorage('bd-library-view', view)
    set({ view })
  },
  setToolbarLocked: (toolbarLocked) => {
    setStorage('bd-reader-toolbar-locked', String(toolbarLocked))
    set({ toolbarLocked })
  },
  setSidebarRememberedOpen: (sidebarRememberedOpen) => {
    setStorage('bd-reader-sidebar-open', String(sidebarRememberedOpen))
    set({ sidebarRememberedOpen })
  },
  setNavTabRemembered: (navTabRemembered) => {
    setStorage('bd-reader-nav-tab', navTabRemembered)
    set({ navTabRemembered })
  },
  setSidebarWidth: (sidebarWidth) => {
    setStorage('bd-sidebar-width', String(sidebarWidth))
    set({ sidebarWidth })
  },
  setRecentlyReadStyle: (recentlyReadStyle) => {
    setStorage('bd-recently-read-style', recentlyReadStyle)
    set({ recentlyReadStyle })
  },
  setListInfoItems: (listInfoItems) => {
    setStorage('bd-list-info-items', JSON.stringify(listInfoItems))
    set({ listInfoItems })
  },
  setAutoMarkSelection: (autoMarkSelection) => {
    setStorage('bd-auto-mark-selection', String(autoMarkSelection))
    set({ autoMarkSelection })
  },
  setClickAreaMode: (clickAreaMode) => {
    setStorage('bd-click-area-mode', clickAreaMode)
    set({ clickAreaMode })
  },
  setHeaderLeft: (headerLeft) => {
    setStorage('bd-header-left', headerLeft)
    set({ headerLeft })
  },
  setHeaderCenter: (headerCenter) => {
    setStorage('bd-header-center', headerCenter)
    set({ headerCenter })
  },
  setHeaderRight: (headerRight) => {
    setStorage('bd-header-right', headerRight)
    set({ headerRight })
  },
  setFooterLeft: (footerLeft) => {
    setStorage('bd-footer-left', footerLeft)
    set({ footerLeft })
  },
  setFooterCenter: (footerCenter) => {
    setStorage('bd-footer-center', footerCenter)
    set({ footerCenter })
  },
  setFooterRight: (footerRight) => {
    setStorage('bd-footer-right', footerRight)
    set({ footerRight })
  },
  setMarginalFontSize: (marginalFontSize) => {
    setStorage('bd-marginal-font-size', String(marginalFontSize))
    set({ marginalFontSize })
  },
  setReadingTimerMode: (readingTimerMode) => {
    setStorage('bd-reading-timer-mode', readingTimerMode)
    set({ readingTimerMode })
  },
  setManualTimerGraceMinutes: (manualTimerGraceMinutes) => {
    setStorage('bd-manual-timer-grace', String(manualTimerGraceMinutes))
    set({ manualTimerGraceMinutes })
  },
  setTtsEngine: (ttsEngine) => {
    setStorage('bd-tts-engine', ttsEngine)
    set({ ttsEngine })
  },
  setTtsServiceId: (ttsServiceId) => {
    setStorage('bd-tts-service', ttsServiceId ?? '')
    set({ ttsServiceId })
  },
  setTtsVoiceId: (ttsVoiceId) => {
    setStorage('bd-tts-voice', ttsVoiceId)
    set({ ttsVoiceId })
  },
  setTtsRate: (ttsRate) => {
    setStorage('bd-tts-rate', String(ttsRate))
    set({ ttsRate })
  },
  setTtsAutoNext: (ttsAutoNext) => {
    setStorage('bd-tts-auto-next', String(ttsAutoNext))
    set({ ttsAutoNext })
  },
  setTtsFollow: (ttsFollow) => {
    setStorage('bd-tts-follow', String(ttsFollow))
    set({ ttsFollow })
  },
  setAutoReadingMode: (autoReadingMode) => {
    setStorage('bd-auto-reading-mode', autoReadingMode)
    set({ autoReadingMode })
  },
  setAutoReadingSpeed: (autoReadingSpeed) => {
    const next = Math.max(1, Math.min(100, Math.round(autoReadingSpeed)))
    setStorage('bd-auto-reading-speed', String(next))
    set({ autoReadingSpeed: next })
  },
  setAutoReadingProgressBar: (autoReadingProgressBar) => {
    setStorage('bd-auto-reading-progress-bar', String(autoReadingProgressBar))
    set({ autoReadingProgressBar })
  },

  setUiTheme: (uiTheme) => {
    setStorage('bd-ui-theme', uiTheme)
    set({ uiTheme })
  },
  setReadingThemeId: (readingThemeId) => {
    setStorage('bd-read-theme', readingThemeId)
    if (readingThemeId !== 'night') {
      setStorage('bd-read-theme-light', readingThemeId)
      set({ readingThemeId, lightReadingThemeId: readingThemeId })
    } else {
      set({ readingThemeId })
    }
  },
  saveCustomTheme: (theme) => {
    const existing = get().customThemes
    const next = existing.some((t) => t.id === theme.id)
      ? existing.map((t) => (t.id === theme.id ? theme : t))
      : [...existing, theme]
    persistCustomThemes(next)
    set({ customThemes: next })
    get().setReadingThemeId(theme.id)
  },
  deleteCustomTheme: (id) => {
    const next = get().customThemes.filter((t) => t.id !== id)
    persistCustomThemes(next)
    set({ customThemes: next })
    if (get().readingThemeId === id) get().setReadingThemeId('paper')
  },
  setCustomThemes: (themes) => {
    persistCustomThemes(themes)
    set({ customThemes: themes })
  },
  setFontFamily: (fontFamily) => {
    setStorage('bd-font-family', fontFamily)
    set({ fontFamily })
  },
  setFontPreference: (id, preference) => {
    const current = get().fontPreferences[id] ?? {}
    const next = { ...get().fontPreferences, [id]: { ...current, ...preference } }
    set({ fontPreferences: next })
  },
  removeFontPreference: (id) => {
    const next = { ...get().fontPreferences }
    delete next[id]
    set({ fontPreferences: next })
  },
  setFontOrder: (order) => {
    set({ fontOrder: [...new Set(order)] })
  },
  setFontSize: (fontSize) => {
    setStorage('bd-font-size', String(fontSize))
    set({ fontSize })
  },
  setFontWeight: (fontWeight) => {
    setStorage('bd-font-weight', String(fontWeight))
    set({ fontWeight })
  },
  setLineHeight: (lineHeight) => {
    setStorage('bd-line-height', String(lineHeight))
    set({ lineHeight })
  },
  setParagraphSpacing: (paragraphSpacing) => {
    setStorage('bd-paragraph-spacing', String(paragraphSpacing))
    set({ paragraphSpacing })
  },
  setLetterSpacing: (letterSpacing) => {
    setStorage('bd-letter-spacing', String(letterSpacing))
    set({ letterSpacing })
  },
  setIndent: (indent) => {
    setStorage('bd-indent', String(indent))
    set({ indent })
  },
  setPageWidth: (pageWidth) => {
    const mode = get().readingMode
    if (mode === 'page') {
      setStorage('bd-page-page-width', String(pageWidth))
      set({ pageWidth, pagePageWidth: pageWidth })
    } else {
      setStorage('bd-page-width', String(pageWidth))
      set({ pageWidth, scrollPageWidth: pageWidth })
    }
  },
  setHorizontalPadding: (horizontalPadding) => {
    const mode = get().readingMode
    if (mode === 'page') {
      setStorage('bd-page-horizontal-padding', String(horizontalPadding))
      set({ horizontalPadding, pageHorizontalPadding: horizontalPadding })
    } else {
      setStorage('bd-horizontal-padding', String(horizontalPadding))
      set({ horizontalPadding, scrollHorizontalPadding: horizontalPadding })
    }
  },
  setVerticalPadding: (verticalPadding) => {
    const mode = get().readingMode
    if (mode === 'page') {
      setStorage('bd-page-vertical-padding', String(verticalPadding))
      set({ verticalPadding, pageVerticalPadding: verticalPadding })
    } else {
      setStorage('bd-vertical-padding', String(verticalPadding))
      set({ verticalPadding, scrollVerticalPadding: verticalPadding })
    }
  },
  setTextAlignJustify: (textAlignJustify) => {
    setStorage('bd-text-align-justify', String(textAlignJustify))
    set({ textAlignJustify })
  },
  setOverrideBookFont: (overrideBookFont) => {
    setStorage('bd-override-book-font', String(overrideBookFont))
    set({ overrideBookFont })
  },
  setOverrideBookLayout: (overrideBookLayout) => {
    setStorage('bd-override-book-layout', String(overrideBookLayout))
    set({ overrideBookLayout })
  },
  setReadingMode: (readingMode) => {
    const s = get()
    if (readingMode === s.readingMode) return
    setStorage('bd-reading-mode', readingMode)

    const updates: Partial<UiState> = { readingMode }
    if (s.readingMode === 'scroll') {
      updates.scrollPageWidth = s.pageWidth
      updates.scrollHorizontalPadding = s.horizontalPadding
      updates.scrollVerticalPadding = s.verticalPadding
      updates.pageWidth = s.pagePageWidth
      updates.horizontalPadding = s.pageHorizontalPadding
      updates.verticalPadding = s.pageVerticalPadding
      updates.pageColumns = s.pagePageColumns
      updates.columnGap = s.columnGapPage
    } else {
      updates.pagePageWidth = s.pageWidth
      updates.pageHorizontalPadding = s.horizontalPadding
      updates.pageVerticalPadding = s.verticalPadding
      updates.pageWidth = s.scrollPageWidth
      updates.horizontalPadding = s.scrollHorizontalPadding
      updates.verticalPadding = s.scrollVerticalPadding
    }

    set(updates)
  },
  setPageColumns: (pageColumns) => {
    setStorage('bd-page-columns', String(pageColumns))
    set({ pageColumns, pagePageColumns: pageColumns })
  },
  setColumnGap: (columnGap) => {
    setStorage('bd-column-gap', String(columnGap))
    set({ columnGap, columnGapPage: columnGap })
  },
  setShowHeader: (showHeader) => {
    setStorage('bd-show-header', String(showHeader))
    set({ showHeader })
  },
  setShowFooter: (showFooter) => {
    setStorage('bd-show-footer', String(showFooter))
    set({ showFooter })
  },
  setChineseConversion: (chineseConversion) => {
    setStorage('bd-chinese-conversion', chineseConversion)
    set({ chineseConversion })
  },
  setContinuousScroll: (continuousScroll) => {
    setStorage('bd-continuous-scroll', continuousScroll)
    set({ continuousScroll })
  },
  setPageAnimation: (pageAnimation) => {
    setStorage('bd-page-animation', String(pageAnimation))
    set({ pageAnimation })
  },

  createReadingPreset: (name, perBookOverlay) => {
    const cfg = parseReadingConfig(get().readingConfig)
    if (!cfg) return
    // Creation activates immediately: the snapshot is picked from the current
    // values, so the flat fields stay as-is and only the active pointer moves.
    // An active 仅本书 diff is overlaid key-by-key so the preset captures the
    // effective (WYSIWYG) values; per-book edits never touch the config itself.
    const snapshot = pickReadingSnapshot(get())
    if (perBookOverlay) {
      for (const [key, value] of Object.entries(perBookOverlay)) {
        if ((READING_PROFILE_KEYS as readonly string[]).includes(key)) {
          ;(snapshot as Record<string, unknown>)[key] = value
        }
      }
    }
    const { config, preset } = createPreset(cfg, name.trim(), snapshot)
    persistReadingConfig(config)
    persistActivePresetId(preset.id)
  },
  renameReadingPreset: (id, name) => {
    const cfg = parseReadingConfig(get().readingConfig)
    if (!cfg) return
    persistReadingConfig(renamePreset(cfg, id, name.trim()))
  },
  deleteReadingPreset: (id) => {
    const cfg = parseReadingConfig(get().readingConfig)
    if (!cfg) return
    persistReadingConfig(deletePreset(cfg, id))
    // Dangling pointers (device active here, per-book bindings elsewhere)
    // fall back at resolution — no cross-book cleanup by design.
    get().applyReadingResolution()
  },
  activateReadingPreset: (id) => {
    const cfg = parseReadingConfig(get().readingConfig)
    if (!cfg || id === get().activePresetId) return
    if (id !== null && !cfg.presets.some((p) => p.id === id)) return
    persistActivePresetId(id)
    applyResolutionFlat()
  },
  setBoundPresetId: (id) => {
    set({ boundPresetId: id })
  },
  applyReadingResolution: () => {
    const cfg = parseReadingConfig(get().readingConfig)
    if (!cfg) return
    // A device active pointing at a preset deleted on another device clears
    // and falls back to the global config.
    const activeId = get().activePresetId
    if (activeId && !cfg.presets.some((p) => p.id === activeId)) {
      persistActivePresetId(null)
    }
    applyResolutionFlat()
  },
}))

// Persist + publish the config; the routing subscription skips the update
// (readingConfig changed) so transitions never fold their own values back.
function persistReadingConfig(config: ReadingConfig) {
  const raw = serializeReadingConfig(config)
  setStorage(CONFIG_STORAGE_KEY, raw)
  useUiStore.setState({ readingConfig: raw })
}

// Device-local active pointer: own localStorage key, BroadcastChannel via
// SettingsSync, never part of the server sync payload.
function persistActivePresetId(id: string | null) {
  if (id === null) {
    try { window.localStorage.removeItem(ACTIVE_PRESET_STORAGE_KEY) } catch { /* ignore */ }
  } else {
    setStorage(ACTIVE_PRESET_STORAGE_KEY, id)
  }
  useUiStore.setState({ activePresetId: id })
}

// Resolution chain: the open book's bound preset wins over the device active;
// dangling ids fall back (a binding whose preset was deleted resolves to the
// device active, a dangling active to the global config).
function resolvedTargetId(cfg: ReadingConfig, state: { boundPresetId: string | null; activePresetId: string | null }): string | null {
  if (state.boundPresetId && cfg.presets.some((p) => p.id === state.boundPresetId)) return state.boundPresetId
  if (state.activePresetId && cfg.presets.some((p) => p.id === state.activePresetId)) return state.activePresetId
  return null
}

// Switch the flat profile-key fields to the resolved snapshot, writing only
// when values actually change so resolution never loops with the routing
// subscription below.
function applyResolutionFlat() {
  const state = useUiStore.getState()
  const cfg = parseReadingConfig(state.readingConfig)
  if (!cfg) return
  const snapshot = resolveSnapshot(cfg, resolvedTargetId(cfg, state))
  const flat: Record<string, unknown> = {}
  for (const key of READING_PROFILE_KEYS) {
    if (state[key] !== snapshot[key]) flat[key] = snapshot[key]
  }
  if (Object.keys(flat).length > 0) useUiStore.setState(flat)
}

// Seed the config once: an existing blob wins (its resolved snapshot also
// overrides the flat getInitial* values — the config is authoritative for the
// reading keys), otherwise a fresh config is picked from the current values.
{
  const existing = initialReadingConfig
  if (existing) {
    useUiStore.getState().applyReadingResolution()
  } else {
    persistReadingConfig(emptyConfig(pickReadingSnapshot(useUiStore.getState())))
  }
}

// Route reading-setting edits into the resolved config target (bound preset
// first, then device active, else global): every profile-key change folds
// into the persisted snapshot, so activation switches are always backed by a
// complete, current config.
useUiStore.subscribe((state, prevState) => {
  if (state.readingConfig !== prevState.readingConfig) return
  const changed = READING_PROFILE_KEYS.filter((key) => state[key] !== prevState[key])
  if (changed.length === 0) return
  const cfg = parseReadingConfig(prevState.readingConfig)
  if (!cfg) return
  const targetId = resolvedTargetId(cfg, state)
  let next = cfg
  for (const key of changed) next = foldReadingChange(next, key, state[key], targetId)
  persistReadingConfig(next)
})
