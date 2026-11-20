import { create } from 'zustand'
import type { FontPreferences, HighlightRuleDef, TtsEngine, SelectionToolbarActionKey } from '@bookdock/shared'
import { DEFAULT_SELECTION_TOOLBAR_ORDER, SELECTION_TOOLBAR_ACTION_KEYS } from '@bookdock/shared'
import type { AutoReadingMode, FontFamily, ReadingMode, IdeaDisplayMode, ChineseConversion, ContinuousScroll, ClickAreaMode, MarginalField, NavTab, ParagraphStyle } from '../features/reader/types'
import {
  findReadingTheme,
  isReadingThemeMode,
  readingThemeSlot,
  resolveEffectiveHighlightRules,
  resolveEffectiveReadingTheme,
  resolveEffectiveReadingThemeId,
  resolveEffectiveThemeCss,
  type CustomReadingTheme,
  type EffectiveThemeCss,
  type ReadingTheme,
  type ReadingThemeMode,
  type ReadingThemeSlot,
  type ReadingTone,
  type SystemTheme,
} from '../lib/reading-theme'
import { isDark } from '../lib/color'
import {
  CONFIG_STORAGE_KEY,
  READING_PROFILE_DEFAULTS,
  READING_PROFILE_KEYS,
  createReadingPreset as createPreset,
  deleteReadingPreset as deletePreset,
  emptyConfig,
  foldReadingChange,
  parseReadingConfig,
  pickReadingPresetSnapshot,
  pickReadingSnapshot,
  renameReadingPreset as renamePreset,
  resolveSnapshot,
  serializeReadingConfig,
  type ReadingConfig,
  type ReadingSnapshot,
} from '../features/reader/lib/reading-profiles'
import { useProfilePrefs } from '@/features/profile/profile-prefs'
import { canPersistDeviceReadingConfig, DEVICE_READING_CONFIG_KEY, readingPreferenceAccountId, withReadingPreferenceHydration } from '@/features/reader/lib/reading-preference-owner'
import type { StatsModuleKey } from '../features/stats/stats-modules'
import {
  STATS_MODULE_DEFAULTS,
  getInitialStatsHiddenModules,
  getInitialStatsModuleOrder,
  persistStatsHiddenModules,
  persistStatsModuleOrder,
} from '../features/stats/stats-modules'

import { findThemeCombination, INITIAL_THEME_LIBRARY, materializeTheme, readThemeLibrary, resolveDefaultThemeChoice, savePortableTheme, serializeThemeLibrary, undoThemeLibraryDeletion, type ReadingThemeLibrary } from '@/features/reading-theme/theme-library'

/** Cover fill mode inside the grid card: object-cover vs object-contain. */
export type CoverFit = 'crop' | 'full'
/** Cover aspect ratio in grid cards. */
export type CoverRatio = '2:3' | '3:4'

/** Optional info items on the right side of a list-view row */
export type ListInfoItem = 'progress' | 'size' | 'lastRead' | 'shelf' | 'tags' | 'createdAt'
/** Fixed display order: the row renders enabled items in this sequence */
export const LIST_INFO_ITEMS: ListInfoItem[] = ['progress', 'lastRead', 'shelf', 'tags', 'size', 'createdAt']

export const LIBRARY_PAGE_SIZES = [24, 48, 96] as const

const CUSTOM_THEMES_KEY = 'bd-read-custom-themes'
/**
 * Unsynced settings snapshot for the reload-before-PUT race. Owned by
 * SettingsSync, but the logout reset must clear it too: a reset written here
 * would replay as a user edit on the next login and wipe the server config.
 */
export const PENDING_SETTINGS_STORAGE_KEY = 'bd-settings-pending'
const READING_THEME_MODE_KEY = 'bd-read-theme-mode'
const READING_THEME_MODE_ORDER: readonly ReadingThemeMode[] = ['system', 'light', 'dark']

/**
 * Everything a theme deletion can change: the library itself (other themes'
 * cards get re-pointed by `normalizeThemeCards`) plus the global theme IDs.
 */
export interface ThemeLibrarySnapshot {
  library: ReadingThemeLibrary
  lightReadingThemeId: string
  darkReadingThemeId: string
}

export function getThemeLibrarySnapshot(): ThemeLibrarySnapshot {
  const { themeLibrary, lightReadingThemeId, darkReadingThemeId } = useUiStore.getState()
  return { library: themeLibrary, lightReadingThemeId, darkReadingThemeId }
}

function getInitialThemeLibrary(): ReadingThemeLibrary {
  if (typeof window === 'undefined') return INITIAL_THEME_LIBRARY
  try {
    return readThemeLibrary(localStorage.getItem(CUSTOM_THEMES_KEY)) ?? INITIAL_THEME_LIBRARY
  } catch {
    return INITIAL_THEME_LIBRARY
  }
}

const initialThemeLibrary = getInitialThemeLibrary()

function persistThemeLibrary(library: ReadingThemeLibrary) {
  try {
    window.localStorage.setItem(CUSTOM_THEMES_KEY, serializeThemeLibrary(library))
  } catch {
    // Private browsing can disable localStorage.
  }
}

interface UiState {
  systemTheme: SystemTheme
  readingThemeMode: ReadingThemeMode
  readingThemeId: string
  lightReadingThemeId: string
  darkReadingThemeId: string
  customThemes: CustomReadingTheme[]
  themeLibrary: ReadingThemeLibrary
  readerThemeComposition: CustomReadingTheme | null
  // Session-only effective-theme layer for the open book (仅本书 selection or
  // the editor's trial draft). Never persisted, never synced; the Reader owns
  // the lifecycle and clears it on book switch/unmount.
  readerThemeOverrideBookKey: string | null
  readerThemeOverrideId: string | null
  readerThemeTrialBookKey: string | null
  readerThemeTrial: CustomReadingTheme | null
  fontFamily: FontFamily
  cjkFontFamily: FontFamily
  fontPreferences: FontPreferences
  fontOrder: string[]
  fontSize: number
  fontWeight: number
  lineHeight: number
  paragraphSpacing: number
  chapterTitleAlign: ParagraphStyle['chapterTitleAlign']
  chapterTitleSize: number
  chapterTitleTopSpacing: number
  chapterTitleBottomSpacing: number
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
  cleanReading: boolean
  setCleanReading: (cleanReading: boolean) => void
  overrideBookFont: boolean
  overrideBookLayout: boolean
  /** Account-local display preference; never synced or used as authorization. */
  revealHidden: boolean
  revealHiddenUserId: string | null
  bindRevealHiddenUser: (userId: string | null) => void
  readingMode: ReadingMode
  showHeader: boolean
  showFooter: boolean
  showFriendIdeas: boolean
  setShowFriendIdeas: (value: boolean) => void
  ideaDisplayMode: IdeaDisplayMode
  setIdeaDisplayMode: (value: IdeaDisplayMode) => void
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
  readingTimerMode: 'auto' | 'manual' | 'both' | 'off'
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
  setReadingTimerMode: (v: 'auto' | 'manual' | 'both' | 'off') => void
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
  statsModuleOrder: StatsModuleKey[]
  statsHiddenModules: StatsModuleKey[]
  setStatsModuleOrder: (order: StatsModuleKey[]) => void
  toggleStatsModuleVisible: (key: StatsModuleKey) => void
  resetStatsModules: () => void
  selectionToolbarOrder: SelectionToolbarActionKey[]
  selectionToolbarHidden: SelectionToolbarActionKey[]
  setSelectionToolbarOrder: (order: SelectionToolbarActionKey[]) => void
  toggleSelectionToolbarActionVisible: (key: SelectionToolbarActionKey) => void
  resetSelectionToolbar: () => void

  // Named reading-setting profiles (阅读设置预设): serialized JSON of the
  // multi-config blob (`{ global, presets[] }`). The blob syncs across
  // devices; activation does not (intents sync, outcomes stay local):
  // `activePresetId` is the device-local pointer (own localStorage key,
  // BroadcastChannel only), `boundPresetId` is the session-only binding of
  // the currently open book (set by Reader from book.readerSettings.boundPresetId).
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
  coverFit: CoverFit
  coverRatio: CoverRatio
  gridColumns: string
  listInfoItems: ListInfoItem[]
  sortBy: string
  sortOrder: 'asc' | 'desc'
  view: 'grid' | 'list'
  libraryPageSize: number
  setLibraryPageSize: (v: number) => void
  setCoverFit: (v: CoverFit) => void
  setCoverRatio: (v: CoverRatio) => void
  setGridColumns: (v: string) => void
  /** Unified shelf: where the add-book main button sends files. Device preference. */
  defaultAddDestination: 'server' | 'local'
  setDefaultAddDestination: (v: 'server' | 'local') => void
  /** Device import preference for guests (no server /settings account). */
  deviceNormalizeTitle: boolean
  setDeviceNormalizeTitle: (v: boolean) => void
  setListInfoItems: (v: ListInfoItem[]) => void
  setSortBy: (v: string) => void
  setSortOrder: (v: 'asc' | 'desc') => void
  setView: (v: 'grid' | 'list') => void

  // Reader sidebar prefs
  toolbarLocked: boolean
  sidebarWidth: number
  /** Last explicit open/closed choice for the desktop sidebar (pinned or floating);
   *  seeds the sidebar on book open. Device-local like toolbarLocked. */
  sidebarRememberedOpen: boolean
  /** Last sidebar tab the user picked explicitly; seeds the tab on book open.
   *  Device-local like toolbarLocked. */
  navTabRemembered: NavTab
  setToolbarLocked: (v: boolean) => void
  setSidebarWidth: (v: number) => void
  ideaSidebarWidth: number
  setIdeaSidebarWidth: (v: number) => void
  setSidebarRememberedOpen: (v: boolean) => void
  setNavTabRemembered: (v: NavTab) => void

  setSystemTheme: (t: SystemTheme) => void
  setReadingThemeMode: (mode: ReadingThemeMode) => void
  cycleReadingThemeMode: () => void
  setReadingThemeId: (id: string) => void
  /** Save (create/update) a custom theme definition; never changes the selection */
  saveCustomTheme: (theme: CustomReadingTheme) => void
  deleteCustomTheme: (id: string) => void
  /** 仅本书 theme override for the open book; bookKey guards a stale write */
  setReaderThemeOverride: (bookKey: string | null, themeId: string | null, composition?: CustomReadingTheme | null) => void
  /** Editor trial draft for the open book; bookKey guards a stale write */
  setReaderThemeTrial: (bookKey: string | null, draft: CustomReadingTheme | null) => void
  /** Write the global default theme (never the bound/active preset snapshot) */
  setGlobalReadingTheme: (themeId: string) => void
  setGlobalDefaultTheme: (mode: 'light' | 'dark', themeId: string) => void
  /** Write the theme keys of one preset's snapshot */
  /** Replace the whole list (settings sync); persists without theme side effects */
  setCustomThemes: (themes: CustomReadingTheme[]) => void
  setThemeLibrary: (library: ReadingThemeLibrary) => void
  /** Undo a theme deletion: library and global slots come back together */
  undoThemeDeletion: (before: ThemeLibrarySnapshot, after: ThemeLibrarySnapshot) => void
  /**
   * Return every server-owned preference to its built-in default. Called on
   * logout so a shared browser never hands the next account the previous one's
   * reading choices. Device-adaptation keys are deliberately untouched.
   */
  resetUserScopedPrefs: () => void
  setFontFamily: (f: FontFamily) => void
  setCjkFontFamily: (f: FontFamily) => void
  setFontPreference: (id: string, preference: FontPreferences[string]) => void
  removeFontPreference: (id: string) => void
  setFontOrder: (order: string[]) => void
  setFontSize: (n: number) => void
  setFontWeight: (n: number) => void
  setLineHeight: (n: number) => void
  setParagraphSpacing: (n: number) => void
  setChapterTitleAlign: (value: ParagraphStyle['chapterTitleAlign']) => void
  setChapterTitleSize: (value: number) => void
  setChapterTitleTopSpacing: (value: number) => void
  setChapterTitleBottomSpacing: (value: number) => void
  setLetterSpacing: (n: number) => void
  setIndent: (n: number) => void
  setPageWidth: (w: number) => void
  setHorizontalPadding: (n: number) => void
  setVerticalPadding: (n: number) => void
  setTextAlignJustify: (v: boolean) => void
  setOverrideBookFont: (v: boolean) => void
  setOverrideBookLayout: (v: boolean) => void
  setRevealHidden: (v: boolean) => void
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

export function selectEffectiveReadingThemeId(state: UiState): string {
  const { readingThemeMode, systemTheme, lightReadingThemeId, darkReadingThemeId } = state
  const id = resolveEffectiveReadingThemeId(readingThemeMode, systemTheme, lightReadingThemeId, darkReadingThemeId)
  const initialId = resolveEffectiveReadingThemeId(readingThemeMode, systemTheme, 'paper')
  return resolveDefaultThemeChoice(state.themeLibrary, id, initialId) ?? initialId
}

/** The day/night slot the reader resolves against: manual lock wins, only
 *  `system` delegates to the device. */
export function selectReadingThemeSlot(state: UiState): ReadingThemeSlot {
  return readingThemeSlot(state.readingThemeMode, state.systemTheme)
}

/** Session theme override for the open book: the trial draft wins over the
 * 仅本书 selection; ids resolve against presets + custom themes so the theme
 * follows later edits. Returns a stable reference (store arrays/objects). */
export function selectReaderThemeOverride(state: UiState): CustomReadingTheme | null {
  if (state.readerThemeTrial) return state.readerThemeTrial
  if (state.readerThemeComposition) return state.readerThemeComposition
  const id = state.readerThemeOverrideId
  if (id) {
    const found = findReadingTheme(id, state.customThemes)
    if (found) return found
    const fromLib = findThemeCombination(state.themeLibrary, id)
    if (fromLib) return materializeTheme(state.themeLibrary, fromLib)
  }
  return null
}

/** Effective reading theme: override (trial/仅本书) shadows the global chain. */
export function selectEffectiveReadingTheme(state: UiState): ReadingTheme {
  return resolveEffectiveReadingTheme(selectReaderThemeOverride(state), selectEffectiveReadingThemeId(state), state.customThemes)
}

export function selectReadingTone(state: UiState): ReadingTone {
  return isDark(selectEffectiveReadingTheme(state).bg) ? 'bd-tone-dark' : 'bd-tone-light'
}

/** The effective theme whose CSS the book follows (override wins over chain). */
function selectCssFollowTheme(state: UiState): CustomReadingTheme | null {
  const override = selectReaderThemeOverride(state)
  if (override) return override
  const fallbackId = selectEffectiveReadingThemeId(state)
  const found = findReadingTheme(fallbackId, state.customThemes)
  if (found) return found
  const fromLib = findThemeCombination(state.themeLibrary, fallbackId)
  if (fromLib) return materializeTheme(state.themeLibrary, fromLib)
  return null
}

/** The effective theme as a full definition (phase-4 asset fields ride along). */
export function selectEffectiveCustomTheme(state: UiState): CustomReadingTheme | null {
  return selectCssFollowTheme(state)
}

/**
 * Effective custom CSS for the open book: the editor's trial carries CSS with
 * its colors; otherwise the book follows the effective theme chain. Colors
 * never route through here — they stay on the phase-1 theme resolution.
 */
export function selectEffectiveReadingCss(state: UiState): EffectiveThemeCss {
  return resolveEffectiveThemeCss(state.readerThemeTrial, selectCssFollowTheme(state))
}

/**
 * Effective highlight rules for the open book: the editor's trial carries its
 * own rules; otherwise the book follows the effective theme chain.
 */
export function selectEffectiveHighlightRules(state: UiState): HighlightRuleDef[] {
  return resolveEffectiveHighlightRules(state.readerThemeTrial, selectCssFollowTheme(state))
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

function getInitialReadingThemeMode(): ReadingThemeMode {
  if (typeof window === 'undefined') return 'system'
  const stored = localStorage.getItem(READING_THEME_MODE_KEY)
  if (isReadingThemeMode(stored)) return stored
  return 'system'
}

const MANUAL_GRACE_OPTIONS = [1, 5, 10, 30] as const

function getInitialTimerMode(): 'auto' | 'manual' | 'both' | 'off' {
  if (typeof window === 'undefined') return 'auto'
  const stored = localStorage.getItem('bd-reading-timer-mode')
  return stored === 'manual' || stored === 'both' || stored === 'off' ? stored : 'auto'
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

function getInitialSelectionToolbarOrder(): SelectionToolbarActionKey[] {
  if (typeof window === 'undefined') return [...DEFAULT_SELECTION_TOOLBAR_ORDER]
  try {
    const raw = localStorage.getItem('bd-selection-toolbar-order')
    if (!raw) return [...DEFAULT_SELECTION_TOOLBAR_ORDER]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return [...DEFAULT_SELECTION_TOOLBAR_ORDER]
    const valid = parsed.filter((k): k is SelectionToolbarActionKey => (SELECTION_TOOLBAR_ACTION_KEYS as readonly string[]).includes(k))
    const missing = DEFAULT_SELECTION_TOOLBAR_ORDER.filter((k) => !valid.includes(k))
    return [...valid, ...missing]
  } catch {
    return [...DEFAULT_SELECTION_TOOLBAR_ORDER]
  }
}

function getInitialSelectionToolbarHidden(): SelectionToolbarActionKey[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem('bd-selection-toolbar-hidden')
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((k): k is SelectionToolbarActionKey => (SELECTION_TOOLBAR_ACTION_KEYS as readonly string[]).includes(k))
  } catch {
    return []
  }
}

function persistSelectionToolbarOrder(order: SelectionToolbarActionKey[]) {
  setStorage('bd-selection-toolbar-order', JSON.stringify(order))
}

function persistSelectionToolbarHidden(hidden: SelectionToolbarActionKey[]) {
  setStorage('bd-selection-toolbar-hidden', JSON.stringify(hidden))
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
  if (!readingPreferenceAccountId()) {
    const device = parseReadingConfig(localStorage.getItem(DEVICE_READING_CONFIG_KEY))
    if (device) return device
  }
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

const initialScrollPageWidth = getInitialNumber('bd-page-width', 800, 400, 1800)

function getInitialLibraryPageSize(): number {
  if (typeof window === 'undefined') return 24
  const stored = localStorage.getItem('bd-library-page-size')
  const num = Number(stored)
  return [24, 48, 96].includes(num) ? num : 24
}

function getInitialCoverFit(): CoverFit {
  if (typeof window === 'undefined') return 'crop'
  const stored = localStorage.getItem('bd-cover-fit')
  return stored === 'full' ? 'full' : 'crop'
}

function getInitialCoverRatio(): CoverRatio {
  if (typeof window === 'undefined') return '2:3'
  const stored = localStorage.getItem('bd-cover-ratio')
  return stored === '3:4' ? '3:4' : '2:3'
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
const initialPageVerticalPadding = getInitialNumber('bd-page-vertical-padding', 28, 0, 120)
const initialPagePageColumns = getInitialNumber('bd-page-columns', 2, 1, 3)
const initialColumnGapPage = getInitialNumber('bd-column-gap', 5, 0, 15)

const initialPageWidth = initialReadingMode === 'page' ? initialPagePageWidth : initialScrollPageWidth
const initialHorizontalPadding = initialReadingMode === 'page' ? initialPageHorizontalPadding : initialScrollHorizontalPadding
const initialVerticalPadding = initialReadingMode === 'page' ? initialPageVerticalPadding : initialScrollVerticalPadding

export const useUiStore = create<UiState>((set, get) => ({
  systemTheme: getEffectiveTheme(),
  readingThemeMode: getInitialReadingThemeMode(),
  readingThemeId: getInitial<string>('bd-read-theme', 'paper'),
  lightReadingThemeId: getInitial<string>('bd-read-theme-light', 'paper'),
  darkReadingThemeId: 'night',
  themeLibrary: initialThemeLibrary,
  customThemes: initialThemeLibrary.themes.map((theme) => materializeTheme(initialThemeLibrary, theme)),
  readerThemeComposition: null,
  readerThemeOverrideBookKey: null,
  readerThemeOverrideId: null,
  readerThemeTrialBookKey: null,
  readerThemeTrial: null,
  fontFamily: getInitial<FontFamily>('bd-font-family', 'sans-serif'),
  cjkFontFamily: getInitial<FontFamily>('bd-cjk-font-family', 'sans-serif'),
  fontPreferences: {},
  fontOrder: [],
  fontSize: getInitialNumber('bd-font-size', 18, 12, 64),
  fontWeight: getInitialNumber('bd-font-weight', 400, 100, 900),
  lineHeight: getInitialNumber('bd-line-height', 1.8, 1.2, 2.5),
  paragraphSpacing: getInitialNumber('bd-paragraph-spacing', 0.5, 0, 3),
  chapterTitleAlign: getInitial<ParagraphStyle['chapterTitleAlign']>('bd-chapter-title-align', READING_PROFILE_DEFAULTS.chapterTitleAlign),
  chapterTitleSize: getInitialNumber('bd-chapter-title-size', READING_PROFILE_DEFAULTS.chapterTitleSize, 1, 2),
  chapterTitleTopSpacing: getInitialNumber('bd-chapter-title-top-spacing', READING_PROFILE_DEFAULTS.chapterTitleTopSpacing, 0, 6),
  chapterTitleBottomSpacing: getInitialNumber('bd-chapter-title-bottom-spacing', READING_PROFILE_DEFAULTS.chapterTitleBottomSpacing, 0, 6),
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
  cleanReading: READING_PROFILE_DEFAULTS.cleanReading,
  overrideBookFont: getInitialBoolean('bd-override-book-font', false),
  overrideBookLayout: getInitialBoolean('bd-override-book-layout', false),
  revealHidden: false,
  revealHiddenUserId: null,
  bindRevealHiddenUser: (userId) => {
    if (get().revealHiddenUserId === userId) return
    let revealHidden = false
    try {
      revealHidden = userId !== null && window.localStorage.getItem(`bd-reveal-hidden:${userId}`) === 'true'
    } catch {
      // Storage may be unavailable; the session still starts collapsed.
    }
    set({ revealHiddenUserId: userId, revealHidden })
  },
  readingMode: initialReadingMode,
  showHeader: getInitialBoolean('bd-show-header', true),
  showFooter: getInitialBoolean('bd-show-footer', true),
  showFriendIdeas: getInitialBoolean('bd-show-friend-ideas', true),
  ideaDisplayMode: getInitial<IdeaDisplayMode>('bd-idea-display-mode', 'sidebar'),
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
  statsModuleOrder: getInitialStatsModuleOrder(),
  statsHiddenModules: getInitialStatsHiddenModules(),
  selectionToolbarOrder: getInitialSelectionToolbarOrder(),
  selectionToolbarHidden: getInitialSelectionToolbarHidden(),
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
  // Restore the config before resolving the active preset below.
  readingConfig: initialReadingConfig ? serializeReadingConfig(initialReadingConfig) : '',
  activePresetId: getInitialActivePresetId(),
  boundPresetId: null,

  coverFit: getInitialCoverFit(),
  coverRatio: getInitialCoverRatio(),
  gridColumns: getInitial<string>('bd-grid-columns', 'auto'),
  defaultAddDestination: (() => { try { return localStorage.getItem('bd-default-add-destination') === 'local' ? 'local' as const : 'server' as const } catch { return 'server' as const } })(),
  deviceNormalizeTitle: (() => { try { return localStorage.getItem('bd-device-normalize-title') !== 'false' } catch { return true } })(),
  libraryPageSize: getInitialLibraryPageSize(),
  listInfoItems: getInitialListInfoItems(),
  sortBy: getInitial<string>('bd-sort-by', 'createdAt'),
  sortOrder: getInitial<string>('bd-sort-order', 'desc') === 'asc' ? ('asc' as const) : ('desc' as const),
  view: getInitial<string>('bd-library-view', 'grid') === 'list' ? ('list' as const) : ('grid' as const),
  toolbarLocked: getInitialBoolean('bd-reader-toolbar-locked', true),
  sidebarWidth: getInitialNumber('bd-sidebar-width', 288, 200, 640),
  ideaSidebarWidth: getInitialNumber('bd-idea-sidebar-width', 380, 260, 720),
  sidebarRememberedOpen: getInitialBoolean('bd-reader-sidebar-open', true),
  navTabRemembered: getInitialNavTab(),

  setCoverFit: (coverFit) => {
    setStorage('bd-cover-fit', coverFit)
    set({ coverFit })
  },
  setCoverRatio: (coverRatio) => {
    setStorage('bd-cover-ratio', coverRatio)
    set({ coverRatio })
  },
  setGridColumns: (gridColumns) => {
    setStorage('bd-grid-columns', gridColumns)
    set({ gridColumns })
  },
  setDefaultAddDestination: (destination) => {
    try { localStorage.setItem('bd-default-add-destination', destination) } catch { /* ignore */ }
    set({ defaultAddDestination: destination })
  },
  setDeviceNormalizeTitle: (enabled) => {
    try { localStorage.setItem('bd-device-normalize-title', String(enabled)) } catch { /* ignore */ }
    set({ deviceNormalizeTitle: enabled })
  },
  setLibraryPageSize: (libraryPageSize) => {
    setStorage('bd-library-page-size', String(libraryPageSize))
    set({ libraryPageSize })
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
  setIdeaSidebarWidth: (ideaSidebarWidth) => {
    setStorage('bd-idea-sidebar-width', String(ideaSidebarWidth))
    set({ ideaSidebarWidth })
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
  setStatsModuleOrder: (statsModuleOrder) => {
    persistStatsModuleOrder(statsModuleOrder)
    set({ statsModuleOrder })
  },
  toggleStatsModuleVisible: (key) => {
    const current = get().statsHiddenModules
    const next = current.includes(key)
      ? current.filter((k) => k !== key)
      : [...current, key]
    persistStatsHiddenModules(next)
    set({ statsHiddenModules: next })
  },
  resetStatsModules: () => {
    persistStatsModuleOrder(STATS_MODULE_DEFAULTS)
    persistStatsHiddenModules([])
    set({ statsModuleOrder: [...STATS_MODULE_DEFAULTS], statsHiddenModules: [] })
  },
  setSelectionToolbarOrder: (selectionToolbarOrder) => {
    persistSelectionToolbarOrder(selectionToolbarOrder)
    set({ selectionToolbarOrder })
  },
  toggleSelectionToolbarActionVisible: (key) => {
    const current = get().selectionToolbarHidden
    const isHidden = current.includes(key)
    const all = get().selectionToolbarOrder
    if (!isHidden) {
      const visibleCount = all.filter((k) => !current.includes(k)).length
      if (visibleCount <= 1) return
    }
    const next = isHidden ? current.filter((k) => k !== key) : [...current, key]
    persistSelectionToolbarHidden(next)
    set({ selectionToolbarHidden: next })
  },
  resetSelectionToolbar: () => {
    persistSelectionToolbarOrder([...DEFAULT_SELECTION_TOOLBAR_ORDER])
    persistSelectionToolbarHidden([])
    set({ selectionToolbarOrder: [...DEFAULT_SELECTION_TOOLBAR_ORDER], selectionToolbarHidden: [] })
  },

  setSystemTheme: (systemTheme) => {
    set({ systemTheme })
  },
  setReadingThemeMode: (readingThemeMode) => {
    setStorage(READING_THEME_MODE_KEY, readingThemeMode)
    if (readingThemeMode === 'light') {
      const lightReadingThemeId = get().lightReadingThemeId
      setStorage('bd-read-theme', lightReadingThemeId)
      set({ readingThemeMode, readingThemeId: lightReadingThemeId })
    } else if (readingThemeMode === 'dark') {
      const readingThemeId = get().darkReadingThemeId
      setStorage('bd-read-theme', readingThemeId)
      set({ readingThemeMode, readingThemeId })
    } else {
      set({ readingThemeMode })
    }
  },
  cycleReadingThemeMode: () => {
    const currentIndex = READING_THEME_MODE_ORDER.indexOf(get().readingThemeMode)
    const nextMode = READING_THEME_MODE_ORDER[(currentIndex + 1) % READING_THEME_MODE_ORDER.length]
    get().setReadingThemeMode(nextMode)
  },
  // A theme pick is a choice *inside* the current tone, not a mode switch:
  // with the reader following the system, a daytime pick must stay on the
  // daytime slot so the device flipping to dark still lands on the night slot.
  setReadingThemeId: (readingThemeId) => {
    const state = get()
    const slot = readingThemeSlot(state.readingThemeMode, state.systemTheme)
    const patch: Partial<UiState> = { readingThemeId }
    setStorage('bd-read-theme', readingThemeId)
    if (slot === 'light') {
      setStorage('bd-read-theme-light', readingThemeId)
      patch.lightReadingThemeId = readingThemeId
    } else {
      patch.darkReadingThemeId = readingThemeId
    }
    set(patch)
  },
  // Saving writes the definition only. Selection is an explicit apply action
  // (global/preset/per-book), so creating or editing a theme keeps the current
  // book's choice untouched.
  saveCustomTheme: (theme) => {
    get().setThemeLibrary(savePortableTheme(get().themeLibrary, theme))
  },
  setReaderThemeOverride: (bookKey, themeId, composition = null) => {
    set({
      readerThemeOverrideBookKey: bookKey && (themeId || composition) ? bookKey : null,
      readerThemeOverrideId: themeId,
      readerThemeComposition: composition,
    })
  },
  setReaderThemeTrial: (bookKey, draft) => {
    set(bookKey === null || draft === null
      ? { readerThemeTrialBookKey: null, readerThemeTrial: null }
      : { readerThemeTrialBookKey: bookKey, readerThemeTrial: draft })
  },
  // Slot-scoped like setReadingThemeId, but folded into the target snapshot
  // instead of the resolved one, so "设为全局默认" writes global even while a
  // preset is active.
  setGlobalReadingTheme: (themeId) => {
    const cfg = parseReadingConfig(get().readingConfig)
    if (!cfg) {
      // No config blob yet (a fresh account whose readingConfig never seeded):
      // fall back to the flat store write so the choice still lands somewhere.
      get().setReadingThemeId(themeId)
      return
    }
    persistReadingConfig(foldThemeKeys(cfg, themeId, null))
    applyResolutionFlat()
  },
  setGlobalDefaultTheme: (mode, themeId) => {
    const state = get()
    if (!state.themeLibrary.themes.some(({ id }) => id === themeId)) return
    const config = parseReadingConfig(state.readingConfig) ?? emptyConfig(pickReadingSnapshot(state))
    const key = mode === 'light' ? 'lightReadingThemeId' : 'darkReadingThemeId'
    let next = foldReadingChange(config, key, themeId, null)
    if (themeSlot(config.global.readingThemeMode, state.systemTheme) === key) {
      next = foldReadingChange(next, 'readingThemeId', themeId, null)
    }
    persistReadingConfig(next)
    applyResolutionFlat()
  },
  deleteCustomTheme: (id) => {
    const library = get().themeLibrary
    get().setThemeLibrary({ ...library, themes: library.themes.filter((theme) => theme.id !== id) })
    const state = get()
    const patch: Partial<UiState> = {}
    if (state.lightReadingThemeId === id) {
      patch.lightReadingThemeId = 'paper'
      setStorage('bd-read-theme-light', 'paper')
    }
    if (state.darkReadingThemeId === id) patch.darkReadingThemeId = 'night'
    if (Object.keys(patch).length > 0) set(patch)
    // Resolve the flat id only after the day/night slots moved: reading it
    // before the patch resolved to the deleted id itself and left it dangling.
    const settled = get()
    if (settled.readingThemeId === id) set({ readingThemeId: selectEffectiveReadingThemeId(settled) })
  },
  undoThemeDeletion: (before, after) => {
    get().setThemeLibrary(undoThemeLibraryDeletion(before.library, after.library, get().themeLibrary))
    const state = get()
    const patch: Partial<UiState> = {}
    for (const key of ['lightReadingThemeId', 'darkReadingThemeId'] as const) {
      if (before[key] !== after[key] && state[key] === after[key]) patch[key] = before[key]
    }
    if (Object.keys(patch).length === 0) return
    patch.readingThemeId = selectEffectiveReadingThemeId({ ...state, ...patch })
    set(patch)
    if (patch.lightReadingThemeId) setStorage('bd-read-theme-light', patch.lightReadingThemeId)
  },
  setCustomThemes: (themes) => {
    get().setThemeLibrary(themes.reduce(savePortableTheme, INITIAL_THEME_LIBRARY))
  },
  setThemeLibrary: (themeLibrary) => {
    if (serializeThemeLibrary(get().themeLibrary) === serializeThemeLibrary(themeLibrary)) return
    persistThemeLibrary(themeLibrary)
    set({ themeLibrary, customThemes: themeLibrary.themes.map((theme) => materializeTheme(themeLibrary, theme)) })
  },
  setFontFamily: (fontFamily) => {
    setStorage('bd-font-family', fontFamily)
    set({ fontFamily })
  },
  setCjkFontFamily: (cjkFontFamily) => {
    setStorage('bd-cjk-font-family', cjkFontFamily)
    set({ cjkFontFamily })
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
  setChapterTitleAlign: (chapterTitleAlign) => {
    setStorage('bd-chapter-title-align', chapterTitleAlign)
    set({ chapterTitleAlign })
  },
  setChapterTitleSize: (chapterTitleSize) => {
    setStorage('bd-chapter-title-size', String(chapterTitleSize))
    set({ chapterTitleSize })
  },
  setChapterTitleTopSpacing: (chapterTitleTopSpacing) => {
    setStorage('bd-chapter-title-top-spacing', String(chapterTitleTopSpacing))
    set({ chapterTitleTopSpacing })
  },
  setChapterTitleBottomSpacing: (chapterTitleBottomSpacing) => {
    setStorage('bd-chapter-title-bottom-spacing', String(chapterTitleBottomSpacing))
    set({ chapterTitleBottomSpacing })
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
  setCleanReading: (cleanReading) => {
    set({ cleanReading })
  },
  setOverrideBookFont: (overrideBookFont) => {
    setStorage('bd-override-book-font', String(overrideBookFont))
    set({ overrideBookFont })
  },
  setOverrideBookLayout: (overrideBookLayout) => {
    setStorage('bd-override-book-layout', String(overrideBookLayout))
    set({ overrideBookLayout })
  },
  setRevealHidden: (revealHidden) => {
    const userId = get().revealHiddenUserId
    if (!userId) return
    setStorage(`bd-reveal-hidden:${userId}`, String(revealHidden))
    set({ revealHidden })
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
  setShowFriendIdeas: (showFriendIdeas) => {
    setStorage('bd-show-friend-ideas', String(showFriendIdeas))
    set({ showFriendIdeas })
  },
  setIdeaDisplayMode: (ideaDisplayMode) => {
    setStorage('bd-idea-display-mode', ideaDisplayMode)
    set({ ideaDisplayMode })
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
    const state = get()
    const current = pickReadingSnapshot(state)
    const cfg = parseReadingConfig(state.readingConfig) ?? emptyConfig(current)
    // Creation activates immediately: the snapshot is picked from the current
    // values, so the flat fields stay as-is and only the active pointer moves.
    // An active 仅本书 diff is overlaid key-by-key so the preset captures the
    // effective (WYSIWYG) values; per-book edits never touch the config itself.
    const snapshot = { ...current }
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
  resetUserScopedPrefs: () => {
    // Every server-owned preference returns to its built-in default so a shared
    // browser never hands the next account the previous one's choices. The
    // config is rewritten rather than dropped, so preset names and the active
    // pointer survive; only the values inside each snapshot are reset.
    const config = parseReadingConfig(get().readingConfig)
    // Replace outright rather than backfill: this is a reset, so every key takes
    // the built-in default, not whatever the stored snapshot happened to hold.
    const defaults = { ...READING_PROFILE_DEFAULTS } as ReadingSnapshot
    persistReadingConfig(config
      ? { global: defaults, presets: config.presets.map((preset) => ({ ...preset, snapshot: pickReadingPresetSnapshot(defaults) })) }
      : emptyConfig(defaults))
    // A reset is not a user edit: drop any unsynced snapshot so the next login
    // cannot replay these defaults over the server config.
    try {
      localStorage.removeItem(PENDING_SETTINGS_STORAGE_KEY)
      localStorage.removeItem('bd-selection-toolbar-order')
      localStorage.removeItem('bd-selection-toolbar-hidden')
    } catch {
      // ignore localStorage errors in private/incognito modes
    }
    useUiStore.setState({
      fontPreferences: {},
      fontOrder: [],
      coverFit: 'crop',
      coverRatio: '2:3',
      readingTimerMode: 'auto',
      manualTimerGraceMinutes: 5,
      ttsEngine: 'system',
      ttsServiceId: null,
      ttsVoiceId: '',
      ttsRate: 1,
      ttsAutoNext: true,
      ttsFollow: true,
      customThemes: INITIAL_THEME_LIBRARY.themes.map((theme) => materializeTheme(INITIAL_THEME_LIBRARY, theme)),
      themeLibrary: INITIAL_THEME_LIBRARY,
      readerThemeComposition: null,
      readerThemeOverrideBookKey: null,
      readerThemeOverrideId: null,
      readerThemeTrialBookKey: null,
      readerThemeTrial: null,
      selectionToolbarOrder: [...DEFAULT_SELECTION_TOOLBAR_ORDER],
      selectionToolbarHidden: [],
    })
    applyResolutionFlat()
    useProfilePrefs.getState().resetProfilePrefs()
  },
}))

// Persist + publish the config; the routing subscription skips the update
// (readingConfig changed) so transitions never fold their own values back.
function persistReadingConfig(config: ReadingConfig) {
  const raw = serializeReadingConfig(config)
  setStorage(CONFIG_STORAGE_KEY, raw)
  if (canPersistDeviceReadingConfig()) setStorage(DEVICE_READING_CONFIG_KEY, raw)
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
// Fold a theme selection into the resolved target: null = global snapshot, a
// preset id = that preset's snapshot. The pick only fills the slot of the tone
// the reader is in; the mode is left alone, since choosing a scheme is not the
// same decision as locking the reader to day or night.
function foldThemeKeys(cfg: ReadingConfig, themeId: string, targetId: string | null): ReadingConfig {
  const state = useUiStore.getState()
  const slot = readingThemeSlot(state.readingThemeMode, state.systemTheme)
  const slotKey = slot === 'dark' ? 'darkReadingThemeId' : 'lightReadingThemeId'
  const next = foldReadingChange(cfg, slotKey, themeId, targetId)
  return foldReadingChange(next, 'readingThemeId', themeId, targetId)
}

function themeSlot(mode: unknown, systemTheme: SystemTheme): 'lightReadingThemeId' | 'darkReadingThemeId' {
  return mode === 'dark' || (mode === 'system' && systemTheme === 'dark') ? 'darkReadingThemeId' : 'lightReadingThemeId'
}

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
    // A stored value that is not a valid mode (a config written by an older
    // build, or a hand-edited blob) keeps the device's current mode rather than
    // blanking the theme.
    const value = key === 'readingThemeMode' && !isReadingThemeMode(snapshot[key])
      ? state.readingThemeMode
      : snapshot[key]
    if (state[key] !== value) flat[key] = value
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
    withReadingPreferenceHydration(() => persistReadingConfig(emptyConfig(pickReadingSnapshot(useUiStore.getState()))))
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
