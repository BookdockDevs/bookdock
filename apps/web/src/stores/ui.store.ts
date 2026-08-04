import { create } from 'zustand'
import type { FontFamily, ReadingMode, ChineseConversion, ContinuousScroll, ClickAreaMode, MarginalField } from '../features/reader/types'
import type { CustomReadingTheme } from '../lib/reading-theme'

export type UiTheme = 'system' | 'light' | 'dark'
export type UiSection = 'font' | 'layout' | 'display' | 'theme'

export const SETTINGS_VERSION = 1
const VERSION_KEY = 'bd-settings-version'

function migrateSettings(): number {
  if (typeof window === 'undefined') return SETTINGS_VERSION
  const currentVer = Number(localStorage.getItem(VERSION_KEY)) || 0
  if (currentVer >= SETTINGS_VERSION) return currentVer

  let v = currentVer
  // Future migrations: while (v < SETTINGS_VERSION) { v = migrate_v${v}_to_${v + 1}() }
  localStorage.setItem(VERSION_KEY, String(v))
  return v
}

const initialSettingsVersion = migrateSettings()

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
  settingsVersion: number
  uiTheme: UiTheme
  readingThemeId: string
  lightReadingThemeId: string
  customThemes: CustomReadingTheme[]
  fontFamily: FontFamily
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

  // Library UI prefs
  coverMode: boolean
  coverFit: boolean
  gridColumns: string
  showRecentlyRead: boolean
  setCoverMode: (v: boolean) => void
  setCoverFit: (v: boolean) => void
  setGridColumns: (v: string) => void
  setShowRecentlyRead: (v: boolean) => void

  // Reader sidebar prefs
  toolbarLocked: boolean
  sidebarWidth: number
  setToolbarLocked: (v: boolean) => void
  setSidebarWidth: (v: number) => void

  setUiTheme: (t: UiTheme) => void
  setReadingThemeId: (id: string) => void
  saveCustomTheme: (theme: CustomReadingTheme) => void
  deleteCustomTheme: (id: string) => void
  setFontFamily: (f: FontFamily) => void
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

// UI theme is fixed to follow the system preference; the stored `uiTheme`
// field remains only for settings-sync schema compatibility.
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

function getInitialBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const raw = window.localStorage.getItem(key)
  if (raw === null) return fallback
  return raw === 'true'
}

function setStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // ignore localStorage errors in private/incognito modes
  }
}

const initialReadingMode = getInitial<ReadingMode>('bd-reading-mode', 'scroll')

// Click-area mode migrated from the pre-rework three booleans: the old keys
// win while present, otherwise the mode defaults to the standard three zones.
function getInitialClickAreaMode(): ClickAreaMode {
  if (typeof window === 'undefined') return 'standard'
  if (localStorage.getItem('bd-click-disable') === 'true') return 'none'
  if (localStorage.getItem('bd-click-fullscreen-area') === 'true') return 'fullscreen'
  if (localStorage.getItem('bd-click-swap-area') === 'true') return 'swap'
  const stored = localStorage.getItem('bd-click-area-mode')
  if (stored === 'standard' || stored === 'fullscreen' || stored === 'swap' || stored === 'none') return stored
  return 'standard'
}

const initialScrollPageWidth = getInitialNumber('bd-page-width', 800, 400, 1800)
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
  settingsVersion: initialSettingsVersion,
  uiTheme: getInitialUiTheme(),
  readingThemeId: getInitial<string>('bd-read-theme', 'paper'),
  lightReadingThemeId: getInitial<string>('bd-read-theme-light', 'paper'),
  customThemes: getInitialCustomThemes(),
  fontFamily: getInitial<FontFamily>('bd-font-family', 'serif'),
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
  headerLeft: getInitial<MarginalField>('bd-header-left', 'none'),
  headerCenter: getInitial<MarginalField>('bd-header-center', 'bookTitle'),
  headerRight: getInitial<MarginalField>('bd-header-right', 'none'),
  footerLeft: getInitial<MarginalField>('bd-footer-left', 'none'),
  footerCenter: getInitial<MarginalField>('bd-footer-center', 'chapter'),
  footerRight: getInitial<MarginalField>('bd-footer-right', 'none'),
  marginalFontSize: getInitialNumber('bd-marginal-font-size', 0, 0, 24),

  coverMode: getInitialBoolean('bd-cover-mode', false),
  coverFit: getInitialBoolean('bd-cover-fit', false),
  gridColumns: getInitial<string>('bd-grid-columns', 'auto'),
  showRecentlyRead: getInitialBoolean('bd-show-recently-read', false),
  toolbarLocked: getInitialBoolean('bd-reader-toolbar-locked', false),
  sidebarWidth: getInitialNumber('bd-sidebar-width', 288, 200, 500),

  setCoverMode: (coverMode) => {
    setStorage('bd-cover-mode', String(coverMode))
    set({ coverMode })
  },
  setCoverFit: (coverFit) => {
    setStorage('bd-cover-fit', String(coverFit))
    set({ coverFit })
  },
  setGridColumns: (gridColumns) => {
    setStorage('bd-grid-columns', gridColumns)
    set({ gridColumns })
  },
  setToolbarLocked: (toolbarLocked) => {
    setStorage('bd-reader-toolbar-locked', String(toolbarLocked))
    set({ toolbarLocked })
  },
  setSidebarWidth: (sidebarWidth) => {
    setStorage('bd-sidebar-width', String(sidebarWidth))
    set({ sidebarWidth })
  },
  setShowRecentlyRead: (showRecentlyRead) => {
    setStorage('bd-show-recently-read', String(showRecentlyRead))
    set({ showRecentlyRead })
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
  setFontFamily: (fontFamily) => {
    setStorage('bd-font-family', fontFamily)
    set({ fontFamily })
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
}))
