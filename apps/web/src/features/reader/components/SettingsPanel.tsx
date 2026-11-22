import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import Select from '@/components/ui/Select'
import { useDismissiblePopup } from '@/hooks/useDismissiblePopup'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { selectEffectiveReadingTheme, selectGlobalAppearanceState, selectReadingThemeSlot, useUiStore } from '@/stores/ui.store'
import { resolveAppearance, toggleAppearanceHighlight } from '@/features/reading-theme/appearance'
import { useAuthStore } from '@/stores/auth.store'
import { useFonts } from '@/api/hooks/useFonts'
import { useInstanceInfo } from '@/features/auth/hooks'
import { useDeviceFontStore } from '@/features/device-fonts/store'
import i18n from '@/i18n/i18n'
import { useLocalReader } from '../../reading-data/reader-source-context'
import { useBookReplacements } from '@/api/hooks/useReplacements'
import { useViewSettings } from '../view-settings-context'
import { MARGINAL_FIELDS } from '../lib/marginals'
import type { MarginalField } from '../types'
import type { BookSettingsGroup } from '../lib/view-settings'
import { buildFontOptions, useFontLoaderStore, type FontOption } from '../fonts'
import { useReaderFontPreviews, type ReaderFontPreviews } from '../hooks/useReaderFontPreviews'
import { useReaderState } from '../state/reader-state'
import { DownloadIcon, SpinnerIcon } from './annotation-icons'
import ReadingPresetPicker from './ReadingPresetPicker'
import ReadingThemePanel from '@/features/reading-theme/ReadingThemePanel'
import ThemeIcon from '@/features/reading-theme/ThemeIcon'
import BookReplacementsDialog from './BookReplacementsDialog'
import ReaderKeyboardShortcuts from './ReaderKeyboardShortcuts'
import { readerPanelVars } from '../lib/reader-panel-vars'
import {
  ButtonGroup,
  InlineControlRow,
  PanelSection,
  PanelSectionList,
  SliderRow,
  ToggleRow,
} from './ReaderPanelPrimitives'

type Section = 'font' | 'layout' | 'display' | 'behavior' | 'theme'

function FieldSelect({
  value,
  onChange,
  disabled = false,
  ariaLabel,
}: {
  value: MarginalField
  onChange: (v: MarginalField) => void
  disabled?: boolean
  ariaLabel?: string
}) {
  const _ = useTranslation()
  const isNone = value === 'none'
  return (
    <Select
      variant="reader"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel ?? _('reader.marginalField')}
      onValueChange={(next) => onChange(next as MarginalField)}
      options={MARGINAL_FIELDS.map((f) => ({
        value: f,
        label: _(`reader.marginalField.${f}` as const),
      }))}
      containerClassName="min-w-0 flex-1"
      minMenuWidth={0}
      chevronClassName="right-1.5 text-[var(--bd-read-sub)] opacity-50"
      className={cn(
        'h-7.5 rounded-none border-0 bg-transparent pl-2 pr-5 text-center text-xs hover:bg-stone-500/10 focus-visible:bg-stone-500/10 focus-visible:ring-1 focus-visible:ring-current/40 dark:bg-transparent',
        isNone ? 'font-normal text-[var(--bd-read-sub)] opacity-70' : 'font-medium text-current',
      )}
    />
  )
}

const FONT_CHIPS_VISIBLE = 8

function visibleFontChips(options: FontOption[], collapsed: boolean, selectedId: string): FontOption[] {
  if (!collapsed) return options
  const index = options.findIndex((option) => option.id === selectedId)
  // Keep an active font from the collapsed tail in the last visible slot.
  return index < FONT_CHIPS_VISIBLE ? options.slice(0, FONT_CHIPS_VISIBLE)
    : [...options.slice(0, FONT_CHIPS_VISIBLE - 1), options[index]!]
}

function fontChipClass(active: boolean) {
  return cn(
    'flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg border-[1.5px] px-2.5 text-[13.5px] transition-[background-color,border-color,color,opacity] duration-150 select-none outline-none active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--bd-sel-border-on)',
    active
      ? 'border-(--bd-sel-border-on) bg-(--bd-sel-bg-on) font-medium text-(--bd-sel-text-on)'
      : 'border-(--bd-sel-border) bg-(--bd-sel-bg) font-normal text-(--bd-sel-text) hover:border-(--bd-sel-border-hover) hover:bg-(--bd-sel-bg-hover) hover:text-(--bd-sel-text-on)',
  )
}

function ClickAreaZoneWireframe({ left, right }: { left: 'prev' | 'next'; right: 'prev' | 'next' }) {
  return (
    <div className="flex h-6 w-14 shrink-0 items-stretch overflow-hidden rounded border border-stone-300/80 bg-stone-500/5 text-[11px] text-[var(--bd-read-sub)] select-none dark:border-stone-700/80">
      <span className="flex flex-1 items-center justify-center font-mono text-[10px]">
        {left === 'prev' ? '←' : '→'}
      </span>
      <span className="flex w-3.5 items-center justify-center border-x border-stone-300/60 dark:border-stone-700/60">
        <span className="h-2 w-1.5 rounded-[1px] border border-current opacity-70" />
      </span>
      <span className="flex flex-1 items-center justify-center font-mono text-[10px]">
        {right === 'prev' ? '←' : '→'}
      </span>
    </div>
  )
}

function SectionIcon({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        'flex h-8 w-full items-center justify-center rounded-lg transition-all',
        active
          ? 'bg-[var(--bd-read-bg)] text-current shadow-xs ring-1 ring-current/10'
          : 'text-current/65 hover:text-current',
      )}
    >
      {children}
    </button>
  )
}

const SETTINGS_SECTION_KEY = 'bd-settings-section'

function getInitialSection(): Section {
  if (typeof window === 'undefined') return 'font'
  const stored = localStorage.getItem(SETTINGS_SECTION_KEY) as Section | null
  if (stored === 'font' || stored === 'layout' || stored === 'display' || stored === 'behavior' || stored === 'theme') return stored
  return 'font'
}

interface SettingsPanelProps {
  bookId?: string
  cleanReadingSupported?: boolean
  /** 「覆盖书籍字体/布局」 only applies to normal reflowable EPUB; TXT and
   *  fixed-layout books always read with the ordinary settings. */
  overrideSupported?: boolean
  fontPreviews?: ReaderFontPreviews
}

export function SettingsPanel({ bookId, cleanReadingSupported = false, overrideSupported = false, fontPreviews }: SettingsPanelProps) {
  const localFontPreviews = useReaderFontPreviews(!fontPreviews)
  const requestFontPreviews = fontPreviews ?? localFontPreviews
  const [section, setSection] = useState<Section>(getInitialSection)
  const onSetSection = useCallback((s: Section) => {
    setSection(s)
    try { localStorage.setItem(SETTINGS_SECTION_KEY, s) } catch { /* ignore */ }
  }, [])
  const _ = useTranslation()

  const local = useLocalReader()
  const serviceAccount = useAuthStore((state) => state.user)
  // Members of instances that keep resource uploads off must not see (or
  // trigger) the upstream download of never-fetched builtin fonts; owners and
  // unrestricted instances are unaffected. Unknown policy stays permissive.
  const { data: instanceInfo } = useInstanceInfo({ enabled: !local })
  const builtinDownloadsAllowed = serviceAccount?.role === 'owner' || instanceInfo?.data.allowUserResourceUpload !== false
  const { data: fontsData } = useFonts(!local || Boolean(serviceAccount))
  const uploadedFonts = useMemo(() => local && !serviceAccount ? [] : fontsData?.data ?? [], [fontsData, local, serviceAccount])
  // Device fonts load independently of the server font list, login state and
  // library source.
  const deviceFontStatus = useDeviceFontStore((s) => s.status)
  const deviceFonts = useDeviceFontStore((s) => s.fonts)
  const devicePreferences = useDeviceFontStore((s) => s.preferences)
  const deviceOrder = useDeviceFontStore((s) => s.order)
  const deviceSelection = useDeviceFontStore((s) => s.selection)
  useEffect(() => {
    void useDeviceFontStore.getState().ensureLoaded()
  }, [])
  const deviceCatalog = useMemo(
    () => ({ fonts: deviceFonts, preferences: devicePreferences, order: deviceOrder }),
    [deviceFonts, devicePreferences, deviceOrder],
  )
  const fontLoadedIds = useFontLoaderStore((s) => s.loadedIds)
  const fontLoadingIds = useFontLoaderStore((s) => s.loadingIds)
  const fontLatinIds = useFontLoaderStore((s) => s.latinIds)

  // One whole-store subscription: the panel is reader-scoped and small, and
  // every control's non-context fallback reads from it.
  const {
    fontFamily,
    setFontFamily,
    cjkFontFamily,
    setCjkFontFamily,
    fontPreferences,
    fontOrder,
    fontSize,
    fontWeight,
    readingMode: storeReadingMode,
    marginalFontSize,
    textAlignJustify,
    pageWidth,
    horizontalPadding,
    verticalPadding,
    lineHeight,
    paragraphSpacing,
    letterSpacing,
    indent,
    chapterTitleAlign,
    chapterTitleSize,
    chapterTitleTopSpacing,
    chapterTitleBottomSpacing,
    overrideBookFont,
    overrideBookLayout,
    pageColumns,
    columnGap,
    continuousScroll,
    pageAnimation,
    chineseConversion,
    cleanReading,
    headerLeft,
    headerCenter,
    headerRight,
    footerLeft,
    footerCenter,
    footerRight,
    showFriendIdeas,
    ideaDisplayMode,
    showHeader,
    showFooter,
    clickAreaMode,
    setClickAreaMode,
    autoMarkSelection,
    setAutoMarkSelection,
  } = useUiStore()

  // Rebuild the catalog when the UI language changes: localized font names
  const uiLanguage = i18n.language
  const fontOptions = useMemo(
    () => buildFontOptions(uploadedFonts, { loadedIds: fontLoadedIds, loadingIds: fontLoadingIds, latinIds: fontLatinIds }, fontPreferences, fontOrder, deviceCatalog, builtinDownloadsAllowed),
    // loaded/loading ids feed a builtin option's status icon
    // uiLanguage: buildFontOptions resolves localized names per UI language
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uploadedFonts, fontLoadedIds, fontLoadingIds, fontLatinIds, fontPreferences, fontOrder, deviceCatalog, builtinDownloadsAllowed, uiLanguage],
  )
  const enabledFontOptions = useMemo(() => fontOptions.filter((option) => option.enabled), [fontOptions])
  const enabledCjkOptions = useMemo(() => enabledFontOptions.filter((option) => !option.latin), [enabledFontOptions])
  const [fontsExpanded, setFontsExpanded] = useState(false)
  const [cjkExpanded, setCjkExpanded] = useState(false)

  // Per-book layer: inside the reader every control shows the merged effective
  // value and writes route by the tab's group toggle; outside the reader
  // (no context) everything falls back to the global store.
  const viewSettings = useViewSettings()
  const effective = viewSettings?.effective
  const groups = viewSettings?.groups
  const groupOn = (group: BookSettingsGroup) =>
    effective ? (group === 'font' ? viewSettings!.groups.font != null
      : group === 'layout' ? viewSettings!.groups.layout != null
        : viewSettings!.groups.display != null) : false
  const updateField = (key: string, value: number | boolean | string) => {
    if (viewSettings) viewSettings.updateField(key, value)
    else useUiStore.getState().setReadingSetting(key, value)
  }

  // Effective font ids follow the same chain the renderer resolves: the book's
  // device pick, its synced id, the global device pick, the global synced id —
  // first candidate this device can actually resolve wins. The last candidate
  // is the store value (not the merged effective one): a per-book id that this
  // device cannot resolve must fall through to the global font, not repeat
  // itself.
  const enabledFontIds = useMemo(() => new Set(enabledFontOptions.map((option) => option.id)), [enabledFontOptions])
  const pickAvailableFont = (...candidates: Array<string | null | undefined>): string | null =>
    candidates.find((id): id is string => !!id && enabledFontIds.has(id)) ?? candidates.find((id): id is string => !!id) ?? null
  const effectiveFontFamily = pickAvailableFont(
    viewSettings?.bookDeviceFonts?.primary,
    groups?.font?.fontFamily,
    deviceSelection.primary,
    fontFamily,
  )
  const effectiveCjkFontFamily = pickAvailableFont(
    viewSettings?.bookDeviceFonts?.cjk,
    groups?.font?.cjkFontFamily,
    deviceSelection.cjk,
    cjkFontFamily,
  )

  function onSelectFont(opt: FontOption) {
    if (effective && groupOn('font')) {
      // Device picks stay on this device; synced ids write into the group.
      if (opt.source === 'device') viewSettings!.setBookDeviceFont('primary', opt.id)
      else {
        viewSettings!.setBookDeviceFont('primary', null)
        updateField('fontFamily', opt.id)
      }
    } else if (opt.source === 'device') {
      useDeviceFontStore.getState().selectPrimary(opt.id)
    } else {
      if (deviceSelection.primary) useDeviceFontStore.getState().selectPrimary(null)
      setFontFamily(opt.id)
    }
    if (opt.source === 'builtin') requestFontPreviews([opt], true)
  }

  function onSelectCjkFont(opt: FontOption) {
    if (effective && groupOn('font')) {
      if (opt.source === 'device') viewSettings!.setBookDeviceFont('cjk', opt.id)
      else {
        viewSettings!.setBookDeviceFont('cjk', null)
        updateField('cjkFontFamily', opt.id)
      }
    } else if (opt.source === 'device') {
      useDeviceFontStore.getState().selectCjk(opt.id)
    } else {
      if (deviceSelection.cjk) useDeviceFontStore.getState().selectCjk(null)
      setCjkFontFamily(opt.id)
    }
    if (opt.source === 'builtin') requestFontPreviews([opt], true)
  }

  // A dangling global device selection (font deleted/disabled on this device)
  // clears itself; the synced selection resumes. Per-book picks are not
  // cleared — the chain falls through at resolution instead.
  useEffect(() => {
    if (deviceFontStatus !== 'ready') return
    if (deviceSelection.primary && !enabledFontOptions.some((option) => option.id === deviceSelection.primary) && !(viewSettings?.groups.font != null)) {
      useDeviceFontStore.getState().selectPrimary(null)
    }
    if (deviceSelection.cjk && !enabledCjkOptions.some((option) => option.id === deviceSelection.cjk) && !(viewSettings?.groups.font != null)) {
      useDeviceFontStore.getState().selectCjk(null)
    }
  }, [deviceFontStatus, deviceSelection, enabledFontOptions, enabledCjkOptions, viewSettings])

  const perBookFontGroupOn = viewSettings?.groups.font != null
  // Auto-fallback routes by the fallback's source: a device fallback becomes
  // the device selection (never the synced account ids), a server/system
  // fallback clears the device override and writes the account settings. A
  // per-book font group resolves its own chain without writing the globals.
  useEffect(() => {
    if (perBookFontGroupOn) return
    if (enabledFontOptions.some((option) => option.id === effectiveFontFamily)) return
    const fallback = enabledFontOptions[0]
    if (!fallback || deviceFontStatus !== 'ready') return
    if (fallback.source === 'device') {
      if (deviceSelection.primary !== fallback.id) useDeviceFontStore.getState().selectPrimary(fallback.id)
    } else {
      if (deviceSelection.primary) useDeviceFontStore.getState().selectPrimary(null)
      setFontFamily(fallback.id)
    }
  }, [perBookFontGroupOn, enabledFontOptions, effectiveFontFamily, setFontFamily, deviceFontStatus, deviceSelection])

  useEffect(() => {
    if (perBookFontGroupOn) return
    if (enabledCjkOptions.some((option) => option.id === effectiveCjkFontFamily)) return
    // No CJK candidate at all (every non-latin font disabled): leave the cjk
    // selection untouched instead of writing a latin font into it — the
    // dangling-clear effect would immediately undo it, and the two effects
    // would ping-pong forever. The renderer's resolution already falls back.
    const fallback = enabledCjkOptions[0]
    if (!fallback || deviceFontStatus !== 'ready') return
    if (fallback.source === 'device') {
      if (deviceSelection.cjk !== fallback.id) useDeviceFontStore.getState().selectCjk(fallback.id)
    } else {
      if (deviceSelection.cjk) useDeviceFontStore.getState().selectCjk(null)
      setCjkFontFamily(fallback.id)
    }
  }, [perBookFontGroupOn, enabledCjkOptions, effectiveCjkFontFamily, setCjkFontFamily, deviceFontStatus, deviceSelection])

  const shouldCollapsePrimary = enabledFontOptions.length > FONT_CHIPS_VISIBLE
  const visibleFontOptions = useMemo(
    () => visibleFontChips(enabledFontOptions, shouldCollapsePrimary && !fontsExpanded, effectiveFontFamily ?? ''),
    [enabledFontOptions, shouldCollapsePrimary, fontsExpanded, effectiveFontFamily],
  )
  const shouldCollapseCjk = enabledCjkOptions.length > FONT_CHIPS_VISIBLE
  const visibleCjkOptions = useMemo(
    () => visibleFontChips(enabledCjkOptions, shouldCollapseCjk && !cjkExpanded, effectiveCjkFontFamily ?? ''),
    [enabledCjkOptions, shouldCollapseCjk, cjkExpanded, effectiveCjkFontFamily],
  )

  const selectedPrimaryFont = enabledFontOptions.find((o) => o.id === effectiveFontFamily)
  const showCjkFontPicker = selectedPrimaryFont?.latin ?? false

  useEffect(() => {
    if (section !== 'font') return
    requestFontPreviews(visibleFontOptions)
    if (showCjkFontPicker) requestFontPreviews(visibleCjkOptions)
  }, [section, requestFontPreviews, visibleFontOptions, showCjkFontPicker, visibleCjkOptions])

  const renderFontChip = (option: FontOption, selectedId: string | null, onSelect: (option: FontOption) => void) => (
    <button
      key={option.id}
      type="button"
      title={option.name}
      aria-pressed={selectedId === option.id}
      onClick={() => onSelect(option)}
      className={fontChipClass(selectedId === option.id)}
      style={{ fontFamily: option.stack }}
    >
      <span className="min-w-0 truncate">{option.name}</span>
      {option.status === 'idle' && <span className="shrink-0"><DownloadIcon size={12} /></span>}
      {option.status === 'loading' && <span className="shrink-0"><SpinnerIcon size={12} /></span>}
    </button>
  )

  const currentTheme = useUiStore(selectEffectiveReadingTheme)
  const [showClickAreaHint, setShowClickAreaHint] = useState(false)
  const clickAreaHintRef = useRef<HTMLDivElement>(null)
  useDismissiblePopup(showClickAreaHint, clickAreaHintRef, () => setShowClickAreaHint(false))

  const sliderVars = useMemo(() => readerPanelVars(currentTheme), [currentTheme])

  // Numeric/boolean/string control binding: the effective value when inside
  // the reader, the global store otherwise.
  const num = (key: string, storeValue: number) => ({
    value: effective ? (effective as unknown as Record<string, number>)[key] : storeValue,
    onChange: (v: number) => updateField(key, v),
  })
  const bool = (key: string, storeValue: boolean) => ({
    checked: effective ? (effective as unknown as Record<string, boolean>)[key] : storeValue,
    onChange: (v: boolean) => updateField(key, v),
  })
  const text = (key: string, storeValue: string) => ({
    value: effective ? (effective as unknown as Record<string, string>)[key] : storeValue,
    onChange: (v: string) => updateField(key, v),
  })

  const fontSizeBinding = num('fontSize', fontSize)
  const fontWeightBinding = num('fontWeight', fontWeight)
  const marginalFontSizeBinding = num('marginalFontSize', marginalFontSize)
  const overrideBookFontBinding = bool('overrideBookFont', overrideBookFont)
  const lineHeightBinding = num('lineHeight', lineHeight)
  const paragraphSpacingBinding = num('paragraphSpacing', paragraphSpacing)
  const letterSpacingBinding = num('letterSpacing', letterSpacing)
  const indentBinding = num('indent', indent)
  const textAlignJustifyBinding = bool('textAlignJustify', textAlignJustify)
  const overrideBookLayoutBinding = bool('overrideBookLayout', overrideBookLayout)
  const pageWidthBinding = num('pageWidth', pageWidth)
  const horizontalPaddingBinding = num('horizontalPadding', horizontalPadding)
  const verticalPaddingBinding = num('verticalPadding', verticalPadding)
  const chapterTitleAlignBinding = text('chapterTitleAlign', chapterTitleAlign)
  const chapterTitleSizeBinding = num('chapterTitleSize', chapterTitleSize)
  const chapterTitleTopSpacingBinding = num('chapterTitleTopSpacing', chapterTitleTopSpacing)
  const chapterTitleBottomSpacingBinding = num('chapterTitleBottomSpacing', chapterTitleBottomSpacing)
  const readingModeBinding = text('readingMode', storeReadingMode)
  const pageColumnsBinding = num('pageColumns', pageColumns)
  const columnGapBinding = num('columnGap', columnGap)
  const continuousScrollBinding = text('continuousScroll', continuousScroll)
  const pageAnimationBinding = bool('pageAnimation', pageAnimation)
  const chineseConversionBinding = text('chineseConversion', chineseConversion)
  const cleanReadingBinding = bool('cleanReading', cleanReading)
  const showHeaderBinding = bool('showHeader', showHeader)
  const showFooterBinding = bool('showFooter', showFooter)
  const headerLeftBinding = text('headerLeft', headerLeft)
  const headerCenterBinding = text('headerCenter', headerCenter)
  const headerRightBinding = text('headerRight', headerRight)
  const footerLeftBinding = text('footerLeft', footerLeft)
  const footerCenterBinding = text('footerCenter', footerCenter)
  const footerRightBinding = text('footerRight', footerRight)
  const showFriendIdeasBinding = bool('showFriendIdeas', showFriendIdeas)
  const ideaDisplayModeBinding = text('ideaDisplayMode', ideaDisplayMode)

  // 强制覆盖只在普通流式 EPUB 可用；纯净阅读开启时由它接管原书样式与媒体，
  // 两项隐藏。Guests on server books cannot PATCH the groups; the theme group
  // stays available (browser-local for them).
  const overrideVisible = overrideSupported && !(cleanReadingBinding.checked && cleanReadingSupported)
  const canWriteGroups = Boolean(local || serviceAccount)

  const themeLibrary = useUiStore((s) => s.themeLibrary)
  const globalAppearanceState = useUiStore(selectGlobalAppearanceState)
  const themePanelSlot = useUiStore(selectReadingThemeSlot)
  const standaloneAppearance = useMemo(
    () => resolveAppearance(themeLibrary, globalAppearanceState, undefined, themePanelSlot),
    [themeLibrary, globalAppearanceState, themePanelSlot],
  )
  const themePanelAppearance = viewSettings?.appearance ?? standaloneAppearance

  return (
    <div className="p-4 text-sm" style={sliderVars}>
      <div className="mb-4 grid grid-cols-5 gap-1 rounded-xl bg-current/[0.06] p-1">
        <SectionIcon active={section === 'font'} onClick={() => onSetSection('font')} label={_('reader.sectionFont')}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 7V4h16v3M9 20h6M12 4v16" />
          </svg>
        </SectionIcon>
        <SectionIcon active={section === 'layout'} onClick={() => onSetSection('layout')} label={_('reader.sectionLayout')}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
          </svg>
        </SectionIcon>
        <SectionIcon active={section === 'display'} onClick={() => onSetSection('display')} label={_('reader.sectionDisplay')}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </SectionIcon>
        <SectionIcon active={section === 'theme'} onClick={() => onSetSection('theme')} label={_('reader.sectionTheme')}>
          <svg className="h-4 w-4" viewBox="-1 -1 26 26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11.98 0C12.48 0 12.98 0 13.48 0C13.63 0.07 13.81 0.04 13.97 0.06C14.3 0.1 14.63 0.14 14.96 0.2C15.92 0.36 16.86 0.66 17.75 1.04C21 2.44 23.54 5.47 23.22 9.17C23.13 10.15 22.88 11.13 22.25 11.9C21.4 12.94 20.09 13.27 18.87 13.63C17.73 13.96 16.57 14.3 16 15.44C15.86 15.71 15.79 15.99 15.72 16.27C15.32 17.92 17 19.22 17.71 20.5C18.3 21.58 17.99 22.69 16.95 23.33C16.44 23.64 15.86 23.78 15.28 23.89C15.05 23.94 14.72 23.89 14.5 24C13.98 24 13.46 24 12.94 24C12.75 23.91 12.2 23.92 11.97 23.9C11.35 23.83 10.74 23.71 10.14 23.57C8.16 23.1 6.23 22.08 4.71 20.71C3.4 19.53 2.33 18.08 1.65 16.46C-0.39 11.58 1.14 6.01 5.17 2.68C6.49 1.59 8.06 0.83 9.7 0.39C10.17 0.26 10.66 0.16 11.15 0.1C11.37 0.07 11.79 0.09 11.98 0Z" />
            <circle cx="15.84" cy="5.48" r="1" fill="currentColor" stroke="none" />
            <circle cx="8.86" cy="6.09" r="1" fill="currentColor" stroke="none" />
            <circle cx="5.81" cy="12.66" r="1" fill="currentColor" stroke="none" />
            <circle cx="9.94" cy="18.38" r="1" fill="currentColor" stroke="none" />
          </svg>
        </SectionIcon>
        <SectionIcon active={section === 'behavior'} onClick={() => onSetSection('behavior')} label={_('reader.sectionBehavior')}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </SectionIcon>
      </div>

      {section === 'font' && (
        <PanelSectionList>
          <PanelSection>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-current/75">
                  {showCjkFontPicker ? _('reader.primaryFont') : _('reader.sectionFont')}
                </label>
                {shouldCollapsePrimary && (
                  <button
                    type="button"
                    className={cn(
                      '-my-1 flex h-6 w-6 items-center justify-center rounded-md text-current/60 transition-transform hover:bg-current/10 hover:text-current',
                      fontsExpanded && 'rotate-180',
                    )}
                    aria-expanded={fontsExpanded}
                    aria-label={_(fontsExpanded ? 'reader.fontsCollapse' : 'reader.fontsMore')}
                    title={_(fontsExpanded ? 'reader.fontsCollapse' : 'reader.fontsMore')}
                    onClick={() => setFontsExpanded((v) => !v)}
                  >
                    <ThemeIcon name="more" size={13} />
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {visibleFontOptions.map((option) => renderFontChip(option, effectiveFontFamily, onSelectFont))}
              </div>
            </div>
            {showCjkFontPicker && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-current/75">{_('reader.cjkFont')}</label>
                  {shouldCollapseCjk && (
                    <button
                      type="button"
                      className={cn(
                        '-my-1 flex h-6 w-6 items-center justify-center rounded-md text-current/60 transition-transform hover:bg-current/10 hover:text-current',
                        cjkExpanded && 'rotate-180',
                      )}
                      aria-expanded={cjkExpanded}
                      aria-label={_(cjkExpanded ? 'reader.fontsCollapse' : 'reader.fontsMore')}
                      title={_(cjkExpanded ? 'reader.fontsCollapse' : 'reader.fontsMore')}
                      onClick={() => setCjkExpanded((v) => !v)}
                    >
                      <ThemeIcon name="more" size={13} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {visibleCjkOptions.map((option) => renderFontChip(option, effectiveCjkFontFamily, onSelectCjkFont))}
                </div>
              </div>
            )}

            <SliderRow
              label={_('reader.fontSize')}
              value={fontSizeBinding.value}
              min={12}
              max={64}
              suffix="px"
              stepper={{
                decAria: _('reader.fontSizeDec'),
                incAria: _('reader.fontSizeInc'),
              }}
              onChange={fontSizeBinding.onChange}
            />
            <SliderRow label={_('reader.fontWeight')} value={fontWeightBinding.value} min={100} max={900} step={100} onChange={fontWeightBinding.onChange} />
          </PanelSection>

          {overrideVisible && (
            <PanelSection>
              <ToggleRow
                label={_('reader.overrideBookFont')}
                hint={_('reader.overrideBookFontHint')}
                checked={overrideBookFontBinding.checked}
                onChange={overrideBookFontBinding.onChange}
              />
            </PanelSection>
          )}

          {viewSettings && canWriteGroups && (
            <PanelSection>
              <ToggleRow
                label={_('reader.perBookFont')}
                hint={_('reader.perBookGroupHint')}
                checked={groupOn('font')}
                onChange={(v) => viewSettings.setGroupEnabled('font', v)}
              />
            </PanelSection>
          )}
        </PanelSectionList>
      )}

      {section === 'layout' && (
        <PanelSectionList>
          <PanelSection title={_('reader.layoutPageGroup')}>
            <SliderRow
              label={_('reader.pageWidth')}
              value={pageWidthBinding.value}
              min={readingModeBinding.value === 'page' ? 0 : 400}
              max={1800}
              step={50}
              suffix="px"
              formatValue={(v) => (v === 0 ? _('reader.pageWidthAuto') : `${v}px`)}
              onChange={pageWidthBinding.onChange}
            />
            <SliderRow label={_('reader.horizontalPadding')} value={horizontalPaddingBinding.value} min={0} max={120} step={4} suffix="px" onChange={horizontalPaddingBinding.onChange} />
            <SliderRow label={_('reader.verticalPadding')} value={verticalPaddingBinding.value} min={0} max={120} step={4} suffix="px" onChange={verticalPaddingBinding.onChange} />
          </PanelSection>

          <PanelSection title={_('reader.layoutTextGroup')}>
            <SliderRow label={_('reader.lineHeight')} value={lineHeightBinding.value} min={1.2} max={2.5} step={0.1} onChange={lineHeightBinding.onChange} />
            <SliderRow label={_('reader.paragraphSpacing')} value={paragraphSpacingBinding.value} min={0} max={3} step={0.1} suffix="em" onChange={paragraphSpacingBinding.onChange} />
            <SliderRow label={_('reader.letterSpacing')} value={letterSpacingBinding.value} min={-1} max={3} step={0.5} suffix="px" onChange={letterSpacingBinding.onChange} />
            <SliderRow label={_('reader.indent')} value={indentBinding.value} min={0} max={4} step={0.5} suffix="em" onChange={indentBinding.onChange} />
            <ToggleRow label={_('reader.textAlignJustify')} hint={_('reader.textAlignJustifyHint')} checked={textAlignJustifyBinding.checked} onChange={textAlignJustifyBinding.onChange} />
          </PanelSection>

          <PanelSection title={_('reader.chapterTitleGroup')}>
            <InlineControlRow label={_('reader.chapterTitleAlign')}>
              <ButtonGroup
                inline
                options={[
                  {
                    value: 'start',
                    label: _('reader.chapterTitleStart'),
                    icon: (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M4 6h16M4 12h10M4 18h14" />
                      </svg>
                    ),
                  },
                  {
                    value: 'center',
                    label: _('reader.chapterTitleCenter'),
                    icon: (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M4 6h16M7 12h10M5 18h14" />
                      </svg>
                    ),
                  },
                  {
                    value: 'end',
                    label: _('reader.chapterTitleEnd'),
                    icon: (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <path d="M4 6h16M10 12h10M6 18h14" />
                      </svg>
                    ),
                  },
                ]}
                value={(chapterTitleAlignBinding.value as 'start' | 'center' | 'end')}
                onChange={chapterTitleAlignBinding.onChange}
              />
            </InlineControlRow>
            <SliderRow label={_('reader.chapterTitleSize')} value={chapterTitleSizeBinding.value} min={1} max={2} step={0.1} suffix="×" stepper={{ decAria: _('reader.chapterTitleSizeDec'), incAria: _('reader.chapterTitleSizeInc') }} onChange={chapterTitleSizeBinding.onChange} />
            <SliderRow label={_('reader.chapterTitleTopSpacing')} value={chapterTitleTopSpacingBinding.value} min={0} max={6} step={0.25} suffix="em" onChange={chapterTitleTopSpacingBinding.onChange} />
            <SliderRow label={_('reader.chapterTitleBottomSpacing')} value={chapterTitleBottomSpacingBinding.value} min={0} max={6} step={0.25} suffix="em" onChange={chapterTitleBottomSpacingBinding.onChange} />
          </PanelSection>

          {overrideVisible && (
            <PanelSection>
              <ToggleRow
                label={_('reader.overrideBookLayout')}
                hint={_('reader.overrideBookLayoutHint')}
                checked={overrideBookLayoutBinding.checked}
                onChange={overrideBookLayoutBinding.onChange}
              />
            </PanelSection>
          )}

          {viewSettings && canWriteGroups && (
            <PanelSection>
              <ToggleRow
                label={_('reader.perBookLayout')}
                hint={_('reader.perBookGroupHint')}
                checked={groupOn('layout')}
                onChange={(v) => viewSettings.setGroupEnabled('layout', v)}
              />
            </PanelSection>
          )}
        </PanelSectionList>
      )}

      {section === 'display' && (
        <PanelSectionList>
          <PanelSection title={_('reader.displayReadingMethodGroup')}>
            <InlineControlRow label={_('reader.readingMode')}>
              <ButtonGroup
                inline
                options={[
                  { value: 'scroll', label: _('reader.readingModeScroll') },
                  { value: 'page', label: _('reader.readingModePage') },
                ]}
                value={(readingModeBinding.value as 'scroll' | 'page')}
                onChange={readingModeBinding.onChange}
              />
            </InlineControlRow>

            {readingModeBinding.value === 'page' && (
              <>
                <InlineControlRow label={_('reader.columnCount')}>
                  <ButtonGroup
                    inline
                    options={[
                      { value: 1, label: '1' },
                      { value: 2, label: '2' },
                      { value: 3, label: '3' },
                    ]}
                    value={pageColumnsBinding.value}
                    onChange={pageColumnsBinding.onChange}
                  />
                </InlineControlRow>
                {pageColumnsBinding.value > 1 && (
                  <SliderRow
                    label={_('reader.columnGap')}
                    value={columnGapBinding.value}
                    min={0}
                    max={15}
                    step={1}
                    suffix="%"
                    onChange={columnGapBinding.onChange}
                  />
                )}
              </>
            )}

            {readingModeBinding.value === 'scroll' && (
              <InlineControlRow label={_('reader.continuousScroll')}>
                <ButtonGroup
                  inline
                  options={[
                    { value: 'off', label: _('reader.continuousScrollOff') },
                    { value: 'snap', label: _('reader.continuousScrollSnap') },
                    { value: 'seamless', label: _('reader.continuousScrollSeamless') },
                  ]}
                  value={(continuousScrollBinding.value as 'off' | 'snap' | 'seamless')}
                  onChange={continuousScrollBinding.onChange}
                />
              </InlineControlRow>
            )}

            <ToggleRow label={_('reader.pageAnimation')} checked={pageAnimationBinding.checked} onChange={pageAnimationBinding.onChange} />
          </PanelSection>

          <PanelSection title={_('reader.displayTextGroup')}>
            <InlineControlRow label={_('reader.chineseConversion')}>
              <ButtonGroup
                inline
                options={[
                  { value: 'off', label: _('reader.chineseConversionOff') },
                  { value: 'simplified', label: _('reader.chineseConversionSimplified') },
                  { value: 'traditional', label: _('reader.chineseConversionTraditional') },
                ]}
                value={(chineseConversionBinding.value as 'off' | 'simplified' | 'traditional')}
                onChange={(v) => updateField('chineseConversion', v === chineseConversionBinding.value ? 'off' : v)}
              />
            </InlineControlRow>

            {cleanReadingSupported && (
              <ToggleRow
                label={_('reader.cleanReading')}
                checked={cleanReadingBinding.checked}
                onChange={cleanReadingBinding.onChange}
              />
            )}
          </PanelSection>

          <PanelSection title={_('reader.displayAidsGroup')}>
            <div className="flex flex-col gap-2">
              <ToggleRow label={_('reader.header')} checked={showHeaderBinding.checked} onChange={showHeaderBinding.onChange} />
              {showHeaderBinding.checked && (
                <div className="flex overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-stone-500/5 divide-x divide-[var(--bd-read-accent)]">
                  <FieldSelect value={(headerLeftBinding.value as MarginalField)} onChange={headerLeftBinding.onChange} ariaLabel={_('reader.marginalFieldAria', { section: _('reader.header'), position: _('reader.marginalPositionLeft') })} />
                  <FieldSelect value={(headerCenterBinding.value as MarginalField)} onChange={headerCenterBinding.onChange} ariaLabel={_('reader.marginalFieldAria', { section: _('reader.header'), position: _('reader.marginalPositionCenter') })} />
                  <FieldSelect value={(headerRightBinding.value as MarginalField)} onChange={headerRightBinding.onChange} ariaLabel={_('reader.marginalFieldAria', { section: _('reader.header'), position: _('reader.marginalPositionRight') })} />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <ToggleRow label={_('reader.footer')} checked={showFooterBinding.checked} onChange={showFooterBinding.onChange} />
              {showFooterBinding.checked && (
                <div className="flex overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-stone-500/5 divide-x divide-[var(--bd-read-accent)]">
                  <FieldSelect value={(footerLeftBinding.value as MarginalField)} onChange={footerLeftBinding.onChange} ariaLabel={_('reader.marginalFieldAria', { section: _('reader.footer'), position: _('reader.marginalPositionLeft') })} />
                  <FieldSelect value={(footerCenterBinding.value as MarginalField)} onChange={footerCenterBinding.onChange} ariaLabel={_('reader.marginalFieldAria', { section: _('reader.footer'), position: _('reader.marginalPositionCenter') })} />
                  <FieldSelect value={(footerRightBinding.value as MarginalField)} onChange={footerRightBinding.onChange} ariaLabel={_('reader.marginalFieldAria', { section: _('reader.footer'), position: _('reader.marginalPositionRight') })} />
                </div>
              )}
            </div>

            {(showHeaderBinding.checked || showFooterBinding.checked) && (
              <SliderRow
                label={_('reader.marginalFontSize')}
                value={marginalFontSizeBinding.value}
                min={0}
                max={24}
                step={1}
                formatValue={(v) => (v === 0 ? _('reader.marginalFontSizeAuto') : `${v}px`)}
                onChange={marginalFontSizeBinding.onChange}
              />
            )}

            <InlineControlRow label={_('reader.ideaDisplayMode')}>
              <ButtonGroup
                inline
                options={[
                  { value: 'sidebar', label: _('reader.ideaDisplaySidebar') },
                  { value: 'modal', label: _('reader.ideaDisplayModal') },
                ]}
                value={(ideaDisplayModeBinding.value as 'sidebar' | 'modal')}
                onChange={ideaDisplayModeBinding.onChange}
              />
            </InlineControlRow>

            <ToggleRow label={_('reader.showFriendIdeas')} checked={showFriendIdeasBinding.checked} onChange={showFriendIdeasBinding.onChange} />
          </PanelSection>

          {viewSettings && canWriteGroups && (
            <PanelSection>
              <ToggleRow
                label={_('reader.perBookDisplay')}
                hint={_('reader.perBookGroupHint')}
                checked={groupOn('display')}
                onChange={(v) => viewSettings.setGroupEnabled('display', v)}
              />
            </PanelSection>
          )}
        </PanelSectionList>
      )}

      {section === 'theme' && (
        <PanelSectionList>
          <div className="pb-3.5 last:pb-0">
            <ReadingThemePanel
              key={bookId}
              appearance={themePanelAppearance}
              bookTheme={viewSettings?.bookTheme}
              onPickTheme={viewSettings?.pickTheme ?? ((themeId) => useUiStore.getState().setGlobalReadingTheme(themeId, themePanelSlot))}
              onPickPalette={viewSettings?.pickPalette ?? ((paletteId) => useUiStore.getState().setGlobalSlotPalette(themePanelSlot, paletteId))}
              onSetCss={viewSettings?.setCss ?? ((mode, cssId) => useUiStore.getState().setGlobalAppearanceCss(mode, cssId))}
              onToggleHighlight={viewSettings?.toggleHighlight ?? ((ruleId) => {
                const layers = toggleAppearanceHighlight(themeLibrary, globalAppearanceState, undefined, themePanelSlot, ruleId)
                if (layers) useUiStore.getState().setGlobalHighlightLayers(layers)
              })}
              bookId={bookId}
            />
          </div>
          {viewSettings && (
            <PanelSection>
              <ToggleRow
                label={_('reader.perBookTheme')}
                hint={_('reader.perBookGroupHint')}
                checked={viewSettings.groups.theme != null}
                onChange={(v) => viewSettings.setGroupEnabled('theme', v)}
              />
            </PanelSection>
          )}
        </PanelSectionList>
      )}

      {section === 'behavior' && (
        <PanelSectionList>
          <PanelSection>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div ref={clickAreaHintRef} className="relative flex w-fit items-center gap-1.5">
                  <span className="text-sm font-medium text-current">{_('reader.clickArea')}</span>
                  <button
                    type="button"
                    onClick={() => setShowClickAreaHint((v) => !v)}
                    title={_('reader.clickAreaHintTitle')}
                    aria-label={_('reader.clickAreaHintTitle')}
                    aria-expanded={showClickAreaHint}
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded-full transition-colors active:scale-90',
                      showClickAreaHint
                        ? 'text-current bg-stone-500/15'
                        : 'text-[var(--bd-read-sub)]/60 hover:text-current hover:bg-stone-500/10',
                    )}
                  >
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="M12 8v4M12 16h.01" />
                    </svg>
                  </button>

                  {showClickAreaHint && (
                    <div
                      className="pointer-events-none absolute right-1 top-[26px] z-40 h-3 w-3 rotate-45 border-l border-t border-stone-300/90 bg-[var(--bd-read-bg)] dark:border-stone-700/90"
                      aria-hidden="true"
                    />
                  )}
                  {showClickAreaHint && (
                    <div
                      role="dialog"
                      aria-label={_('reader.clickAreaHintTitle')}
                      className="absolute left-0 top-8 z-30 w-72 max-w-[calc(100vw-3rem)] rounded-xl border border-stone-300/90 bg-[var(--bd-read-bg)] p-3 text-xs shadow-xl dark:border-stone-700/90 animate-in fade-in zoom-in-95 duration-100"
                      style={{
                        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                      }}
                    >
                      <div className="flex flex-col gap-2 text-xs">
                        <div className="flex items-center gap-2.5">
                          <ClickAreaZoneWireframe left="prev" right="next" />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-current">{_('reader.clickAreaStandard')}</span>
                              {clickAreaMode === 'standard' && (
                                <span className="inline-flex items-center rounded bg-stone-500/15 px-1 text-[10px] text-current">
                                  {_('reader.clickAreaActiveTag')}
                                </span>
                              )}
                            </div>
                            <span className="text-xs leading-snug text-current/70">
                              {_('reader.clickAreaStandardDesc')}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <ClickAreaZoneWireframe left="next" right="next" />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-current">{_('reader.clickAreaFullscreen')}</span>
                              {clickAreaMode === 'fullscreen' && (
                                <span className="inline-flex items-center rounded bg-stone-500/15 px-1 text-[10px] text-current">
                                  {_('reader.clickAreaActiveTag')}
                                </span>
                              )}
                            </div>
                            <span className="text-xs leading-snug text-current/70">
                              {_('reader.clickAreaFullscreenDesc')}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <ClickAreaZoneWireframe left="next" right="prev" />
                          <div className="flex min-w-0 flex-1 flex-col">
                            <div className="flex items-center gap-1.5">
                              <span className="font-medium text-current">{_('reader.clickAreaSwap')}</span>
                              {clickAreaMode === 'swap' && (
                                <span className="inline-flex items-center rounded bg-stone-500/15 px-1 text-[10px] text-current">
                                  {_('reader.clickAreaActiveTag')}
                                </span>
                              )}
                            </div>
                            <span className="text-xs leading-snug text-current/70">
                              {_('reader.clickAreaSwapDesc')}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-2.5 border-t border-stone-200/60 pt-2 text-xs leading-snug text-current/70 dark:border-stone-800/60">
                        {clickAreaMode === 'none'
                          ? _('reader.clickAreaNoneDesc')
                          : _('reader.clickAreaToggleHint')}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <ButtonGroup
                options={[
                  { value: 'standard', label: _('reader.clickAreaStandard') },
                  { value: 'fullscreen', label: _('reader.clickAreaFullscreen') },
                  { value: 'swap', label: _('reader.clickAreaSwap') },
                ]}
                value={clickAreaMode}
                onChange={(v) => setClickAreaMode(v === clickAreaMode ? 'none' : v)}
              />
            </div>

            <ToggleRow
              label={_('reader.autoMarkSelection')}
              hint={_('reader.autoMarkSelectionHint')}
              checked={autoMarkSelection}
              onChange={setAutoMarkSelection}
            />
          </PanelSection>

          <PanelSection>
            <ReadingPresetPicker />
          </PanelSection>

          <PanelSection gap="compact">
            {bookId && <ReplacementsEntryRow bookId={bookId} />}
            <KeyboardShortcutsEntryRow />
          </PanelSection>
        </PanelSectionList>
      )}
    </div>
  )
}

function KeyboardShortcutsEntryRow() {
  const _ = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border-[1.5px] border-(--bd-sel-border) bg-(--bd-sel-bg) px-3.5 py-2.5 text-left transition-all duration-150 hover:border-(--bd-sel-border-hover) hover:bg-(--bd-sel-bg-hover) active:scale-[0.99]"
      >
        <span className="text-[13.5px] font-medium text-current">{_('reader.keyboardShortcuts')}</span>
        <div className="flex shrink-0 items-center gap-1.5 text-xs text-[var(--bd-read-sub)]">
          <svg
            className="h-3.5 w-3.5 opacity-60"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </button>
      {open && <ReaderKeyboardShortcuts onClose={() => setOpen(false)} />}
    </>
  )
}

// 文本替换 entry (P2): low-frequency per-book management lives behind a row in
// the behavior section instead of a dedicated tab — the badge shows how many
// rules are active for this book plus any invalid point patches, and the
// dialog reuses the book-detail per-book view.
function ReplacementsEntryRow({ bookId }: { bookId: string }) {
  const _ = useTranslation()
  const [open, setOpen] = useState(false)
  const { data } = useBookReplacements(bookId)
  const invalidCount = useReaderState((s) => s.invalidReplacementIds.length)
  const effectiveCount = useMemo(
    () => (data?.data ?? []).filter((r) => (r.effectiveEnabled ?? r.enabled) && r.locationAvailable !== false).length,
    [data],
  )
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border-[1.5px] border-(--bd-sel-border) bg-(--bd-sel-bg) px-3.5 py-2.5 text-left transition-all duration-150 hover:border-(--bd-sel-border-hover) hover:bg-(--bd-sel-bg-hover) active:scale-[0.99]"
      >
        <span className="text-[13.5px] font-medium text-current">{_('reader.replacements')}</span>
        <div className="flex shrink-0 items-center gap-1.5 text-xs">
          <span className="tabular-nums text-[var(--bd-read-sub)]">
            {_('reader.replacementsEffectiveCount', { count: effectiveCount })}
          </span>
          {invalidCount > 0 && (
            <span className="tabular-nums text-red-500">
              {_('reader.replacementsInvalidCount', { count: invalidCount })}
            </span>
          )}
          <svg
            className="h-3.5 w-3.5 text-[var(--bd-read-sub)] opacity-60"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </div>
      </button>
      {open && createPortal(
        <BookReplacementsDialog bookId={bookId} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  )
}
