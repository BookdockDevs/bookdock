import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { useDismissiblePopup } from '@/hooks/useDismissiblePopup'
import { useTranslation } from '@/hooks/useTranslation'
import { blendColors, cn } from '@/lib/utils'
import { resolveReadingTheme, PRESET_READING_THEMES, type CustomReadingTheme } from '@/lib/reading-theme'
import { useUiStore } from '@/stores/ui.store'
import { useFonts } from '@/api/hooks/useFonts'
import { useBookTransforms } from '@/api/hooks/useTransforms'
import { useViewSettings } from '../view-settings-context'
import { MARGINAL_FIELDS } from '../lib/marginals'
import type { MarginalField } from '../types'
import type { PerBookSettingKey } from '../lib/view-settings'
import { buildFontOptions, ensureBuiltinFontLoaded, ensureBuiltinFontsLoaded, ensureUploadedFontLoaded, useFontLoaderStore, type FontOption } from '../fonts'
import { useReaderState } from '../state/reader-state'
import { DownloadIcon, SpinnerIcon } from './annotation-icons'
import ReadingPresetPicker from './ReadingPresetPicker'
import BookTransformsDialog from './BookTransformsDialog'

type Section = 'font' | 'layout' | 'display' | 'behavior' | 'theme'

interface ThemeDraft {
  id?: string
  name: string
  bg: string
  fg: string
  primary: string
}

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  /** Overrides the trailing value text entirely (e.g. "自动" instead of "0自动") */
  formatValue?: (value: number) => string
  stepper?: {
    decLabel?: React.ReactNode
    incLabel?: React.ReactNode
    decAria?: string
    incAria?: string
  }
  onChange: (value: number) => void
}

function SliderRow({ label, value, min, max, step = 1, suffix = '', formatValue, stepper, onChange }: SliderRowProps) {
  // While dragging, only the local draft moves — committing to the store on
  // every input event would re-layout the whole book on every tick
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value
  const commit = () => {
    if (draft !== null && draft !== value) onChange(draft)
    setDraft(null)
  }
  const pct = Math.round(((shown - min) / (max - min)) * 100)
  const shownText = formatValue ? formatValue(shown) : `${shown}${suffix}`

  const handleStep = (delta: number) => {
    const next = Math.min(max, Math.max(min, Math.round((value + delta) * 100) / 100))
    if (next !== value) onChange(next)
  }

  return (
    <div className="mb-4">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-[var(--bd-read-sub)]">{label}</span>
        {stepper ? (
          <div className="flex items-center rounded-md bg-stone-500/10 p-0.5 text-current dark:bg-stone-500/15">
            <button
              type="button"
              disabled={value <= min}
              onClick={() => handleStep(-step)}
              aria-label={stepper.decAria ?? 'Decrease'}
              className="flex h-5 w-5 items-center justify-center rounded text-xs text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/15 hover:text-current active:scale-90 disabled:pointer-events-none disabled:opacity-30"
            >
              {stepper.decLabel ?? <span className="text-[13px] font-semibold leading-none">−</span>}
            </button>
            <span className="min-w-[2.75rem] px-1 text-center font-medium tabular-nums text-current">
              {shownText}
            </span>
            <button
              type="button"
              disabled={value >= max}
              onClick={() => handleStep(step)}
              aria-label={stepper.incAria ?? 'Increase'}
              className="flex h-5 w-5 items-center justify-center rounded text-xs text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/15 hover:text-current active:scale-90 disabled:pointer-events-none disabled:opacity-30"
            >
              {stepper.incLabel ?? <span className="text-[13px] font-semibold leading-none">+</span>}
            </button>
          </div>
        ) : (
          <span className="tabular-nums font-medium text-current">{shownText}</span>
        )}
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="bd-slider w-full"
        style={{ '--slider-fill': `${pct}%` } as React.CSSProperties}
      />
    </div>
  )
}

interface ToggleRowProps {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function ToggleRow({ label, hint, checked, onChange }: ToggleRowProps) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className="group flex cursor-pointer select-none items-start justify-between gap-3 py-1.5 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-current">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-normal text-[var(--bd-read-sub)]">{hint}</div>}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onChange(!checked)
        }}
        className="relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        style={{ backgroundColor: checked ? 'var(--toggle-on-bg)' : 'var(--toggle-off-bg)' }}
        aria-checked={checked}
        aria-label={label}
        role="switch"
      >
        <span
          className={cn(
            'absolute top-1 h-4 w-4 rounded-full bg-[var(--bd-read-bg)] shadow-sm transition-transform',
            checked ? 'left-5' : 'left-1',
          )}
        />
      </button>
    </div>
  )
}

interface ButtonGroupProps<T extends string | number> {
  options: { value: T; label: string; icon?: React.ReactNode }[]
  value: T
  onChange: (value: T) => void
}

function FieldSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: MarginalField
  onChange: (v: MarginalField) => void
  disabled?: boolean
}) {
  const _ = useTranslation()
  const isNone = value === 'none'
  return (
    <div className="relative min-w-0 flex-1">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as MarginalField)}
        className={cn(
          'h-8 w-full appearance-none truncate bg-transparent pl-2 pr-5 text-center text-xs outline-none transition-colors cursor-pointer hover:bg-stone-500/10 focus-visible:bg-stone-500/10 disabled:cursor-not-allowed',
          isNone ? 'font-normal text-[var(--bd-read-sub)] opacity-70' : 'font-medium text-current',
        )}
        aria-label={_('reader.marginalField')}
      >
        {MARGINAL_FIELDS.map((f) => (
          <option key={f} value={f} className="bg-[var(--bd-read-bg)] text-[var(--bd-read-text)]">
            {_(`reader.marginalField.${f}` as const)}
          </option>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--bd-read-sub)] opacity-50"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  )
}

function ButtonGroup<T extends string | number>({ options, value, onChange }: ButtonGroupProps<T>) {
  return (
    <div
      className="grid gap-1 rounded-xl bg-stone-500/10 p-1 dark:bg-stone-500/15"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((opt) => {
        const isSelected = value === opt.value
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => onChange(opt.value)}
            title={opt.label}
            aria-label={opt.label}
            className={cn(
              'flex min-h-[2.125rem] items-center justify-center rounded-lg px-2.5 py-1.5 text-[13px] tracking-wide transition-all duration-150 select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current/40 active:scale-[0.98]',
              isSelected
                ? 'bg-[var(--bd-read-bg)] font-medium text-current shadow-sm'
                : 'font-normal text-current/60 hover:text-current hover:bg-stone-500/5',
            )}
          >
            {opt.icon ?? opt.label}
          </button>
        )
      })}
    </div>
  )
}


const FONT_CHIPS_VISIBLE = 7

function fontChipClass(active: boolean) {
  return cn(
    'flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-2 text-[13.5px] transition-all duration-150 select-none active:scale-[0.98]',
    active
      ? 'border border-stone-400/40 bg-[var(--bd-read-bg)] font-medium text-current shadow-sm ring-1 ring-stone-400/20 dark:border-stone-600/40 dark:ring-stone-600/20'
      : 'border border-stone-200/70 bg-stone-500/5 font-normal text-[var(--bd-read-sub)] hover:border-stone-300/80 hover:bg-stone-500/10 hover:text-current dark:border-stone-800/80 dark:hover:border-stone-700/80',
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
          ? 'bg-[var(--bd-read-bg)] text-current shadow-sm'
          : 'text-[var(--bd-read-sub)] hover:text-current',
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

export function SettingsPanel({ bookId }: { bookId?: string }) {
  const [section, setSection] = useState<Section>(getInitialSection)
  const onSetSection = useCallback((s: Section) => {
    setSection(s)
    try { localStorage.setItem(SETTINGS_SECTION_KEY, s) } catch { /* ignore */ }
  }, [])
  const _ = useTranslation()

  const { data: fontsData } = useFonts()
  const uploadedFonts = useMemo(() => fontsData?.data ?? [], [fontsData])
  const fontLoadedIds = useFontLoaderStore((s) => s.loadedIds)
  const fontLoadingIds = useFontLoaderStore((s) => s.loadingIds)

  const {
    fontFamily,
    setFontFamily,
    fontPreferences,
    fontOrder,
    fontSize,
    setFontSize,
    fontWeight,
    setFontWeight,
    lineHeight,
    setLineHeight,
    paragraphSpacing,
    setParagraphSpacing,
    letterSpacing,
    setLetterSpacing,
    indent,
    setIndent,
    readingThemeId,
    setReadingThemeId,
    customThemes,
    saveCustomTheme,
    deleteCustomTheme,
    pageWidth,
    setPageWidth,
    verticalPadding,
    setVerticalPadding,
    horizontalPadding,
    setHorizontalPadding,
    textAlignJustify,
    setTextAlignJustify,
    overrideBookFont,
    setOverrideBookFont,
    overrideBookLayout,
    setOverrideBookLayout,
    readingMode,
    setReadingMode,
    pageColumns,
    setPageColumns,
    columnGap,
    setColumnGap,
    showHeader,
    setShowHeader,
    showFooter,
    setShowFooter,
    chineseConversion,
    setChineseConversion,
    continuousScroll,
    setContinuousScroll,
    autoMarkSelection,
    setAutoMarkSelection,
    clickAreaMode,
    setClickAreaMode,
    headerLeft,
    setHeaderLeft,
    headerCenter,
    setHeaderCenter,
    headerRight,
    setHeaderRight,
    footerLeft,
    setFooterLeft,
    footerCenter,
    setFooterCenter,
    footerRight,
    setFooterRight,
    marginalFontSize,
    setMarginalFontSize,
    pageAnimation,
    setPageAnimation,
  } = useUiStore()

  const fontOptions = useMemo(
    () => buildFontOptions(uploadedFonts, { loadedIds: fontLoadedIds, loadingIds: fontLoadingIds }, fontPreferences, fontOrder),
    // loaded/loading ids feed a builtin option's status icon
    [uploadedFonts, fontLoadedIds, fontLoadingIds, fontPreferences, fontOrder],
  )
  const enabledFontOptions = useMemo(() => fontOptions.filter((option) => option.enabled), [fontOptions])
  const [fontsExpanded, setFontsExpanded] = useState(false)

  // Selecting applies immediately (font-display: swap renders the fallback
  // first); the click only kicks off the download as visual feedback
  function onSelectFont(opt: FontOption) {
    setFontFamily(opt.id)
    if (opt.source === 'builtin') ensureBuiltinFontLoaded(opt.id)
  }

  // Mount the public builtin stylesheets when the font list is visible. The
  // browser fetches each font file only when a rendered chip needs that face.
  useEffect(() => {
    if (section !== 'font') return
    ensureBuiltinFontsLoaded()
    uploadedFonts.forEach((f) => void ensureUploadedFontLoaded(f))
  }, [section, uploadedFonts])

  useEffect(() => {
    if (enabledFontOptions.some((option) => option.id === fontFamily)) return
    const fallback = enabledFontOptions[0]
    if (fallback) setFontFamily(fallback.id)
  }, [enabledFontOptions, fontFamily, setFontFamily])

  let visibleFontOptions = fontsExpanded ? enabledFontOptions : enabledFontOptions.slice(0, FONT_CHIPS_VISIBLE)
  if (!fontsExpanded) {
    const selectedIndex = enabledFontOptions.findIndex((o) => o.id === fontFamily)
    if (selectedIndex >= FONT_CHIPS_VISIBLE) {
      // The selection must stay visible: it takes the last visible slot and
      // the original occupant shifts into the hidden tail
      visibleFontOptions = [...enabledFontOptions.slice(0, FONT_CHIPS_VISIBLE - 1), enabledFontOptions[selectedIndex]]
    }
  }

  // Per-book layer (F1): when inside the reader, the first-batch settings
  // display the merged effective values and writes route to the per-book diff
  // (or the global store, depending on the "This book only" switch). Outside the
  // reader (no context) everything falls back to the global store.
  const viewSettings = useViewSettings()
  const bindSetting = (key: PerBookSettingKey, storeValue: number, storeSetter: (v: number) => void) => ({
    value: viewSettings ? viewSettings.effective[key] : storeValue,
    onChange: (v: number) => (viewSettings ? viewSettings.updateSetting(key, v) : storeSetter(v)),
  })
  const fontSizeBinding = bindSetting('fontSize', fontSize, setFontSize)
  const lineHeightBinding = bindSetting('lineHeight', lineHeight, setLineHeight)
  const pageWidthBinding = bindSetting('pageWidth', pageWidth, setPageWidth)
  const horizontalPaddingBinding = bindSetting('horizontalPadding', horizontalPadding, setHorizontalPadding)
  const verticalPaddingBinding = bindSetting('verticalPadding', verticalPadding, setVerticalPadding)
  const pageColumnsBinding = bindSetting('pageColumns', pageColumns, setPageColumns)
  const columnGapBinding = bindSetting('columnGap', columnGap, setColumnGap)

  const currentTheme = resolveReadingTheme(readingThemeId, customThemes)
  const [showClickAreaHint, setShowClickAreaHint] = useState(false)
  const clickAreaHintRef = useRef<HTMLDivElement>(null)
  useDismissiblePopup(showClickAreaHint, clickAreaHintRef, () => setShowClickAreaHint(false))
  const [themeDraft, setThemeDraft] = useState<ThemeDraft | null>(null)
  const openThemeDraft = useCallback(() => {
    setThemeDraft({ name: `${_('reader.customTheme')}${customThemes.length + 1}`, bg: '#F4F4F4', fg: '#1c1917', primary: '#57534e' })
  }, [customThemes.length, _])
  const editThemeDraft = useCallback((custom: CustomReadingTheme) => {
    setThemeDraft({
      id: custom.id,
      name: custom.name,
      bg: custom.colors.bg,
      fg: custom.colors.fg,
      primary: custom.colors.primary,
    })
  }, [])
  const saveThemeDraft = useCallback(() => {
    if (!themeDraft) return
    saveCustomTheme({
      id: themeDraft.id ?? `custom-${Date.now()}`,
      name: themeDraft.name.trim() || _('reader.customTheme'),
      colors: { bg: themeDraft.bg, fg: themeDraft.fg, primary: themeDraft.primary },
    })
    setThemeDraft(null)
  }, [themeDraft, saveCustomTheme, _])
  const handleDeleteDraft = useCallback(() => {
    if (themeDraft?.id) {
      deleteCustomTheme(themeDraft.id)
      setThemeDraft(null)
    }
  }, [themeDraft, deleteCustomTheme])
  const sliderVars = useMemo(() => {
    return {
      '--slider-accent': blendColors(currentTheme.bg, currentTheme.text, 0.65),
      '--slider-track': blendColors(currentTheme.bg, currentTheme.text, 0.15),
      '--toggle-on-bg': blendColors(currentTheme.bg, currentTheme.text, 0.65),
      '--toggle-off-bg': blendColors(currentTheme.bg, currentTheme.text, 0.20),
    } as React.CSSProperties
  }, [currentTheme])

  return (
    <div className="p-4 text-sm" style={sliderVars}>
      <div className="mb-4 grid grid-cols-5 gap-1 rounded-xl bg-stone-500/10 p-1">
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
        <SectionIcon active={section === 'behavior'} onClick={() => onSetSection('behavior')} label={_('reader.sectionBehavior')}>
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
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
      </div>

      {section === 'font' && (
        <div>
          <div className="mb-5">
            <label className="mb-2 block text-xs text-[var(--bd-read-sub)]">{_('reader.sectionFont')}</label>
            <div className="grid grid-cols-2 gap-2">
              {visibleFontOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => onSelectFont(opt)}
                  className={fontChipClass(fontFamily === opt.id)}
                  style={{ fontFamily: opt.stack }}
                >
                  {opt.name}
                  {opt.status === 'idle' && <DownloadIcon size={12} />}
                  {opt.status === 'loading' && <SpinnerIcon size={12} />}
                </button>
              ))}
              {enabledFontOptions.length > FONT_CHIPS_VISIBLE && (
                <button onClick={() => setFontsExpanded((v) => !v)} className={fontChipClass(false)}>
                  {_(fontsExpanded ? 'reader.fontsCollapse' : 'reader.fontsMore')}
                </button>
              )}
            </div>
          </div>

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
          {(showHeader || showFooter) && (
            <SliderRow
              label={_('reader.marginalFontSize')}
              value={marginalFontSize}
              min={0}
              max={24}
              step={1}
              formatValue={(v) => (v === 0 ? _('reader.marginalFontSizeAuto') : `${v}px`)}
              onChange={setMarginalFontSize}
            />
          )}
          <SliderRow label={_('reader.fontWeight')} value={fontWeight} min={100} max={900} step={100} onChange={setFontWeight} />

          <div className="border-t border-[var(--bd-read-accent)] pt-3">
            <ToggleRow
              label={_('reader.textAlignJustify')}
              hint={_('reader.textAlignJustifyHint')}
              checked={textAlignJustify}
              onChange={setTextAlignJustify}
            />
            <ToggleRow
              label={_('reader.overrideBookFont')}
              hint={_('reader.overrideBookFontHint')}
              checked={overrideBookFont}
              onChange={setOverrideBookFont}
            />
          </div>
        </div>
      )}

      {section === 'layout' && (
        <div className="space-y-4">
          <div>
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--bd-read-sub)]">
              {_('reader.layoutPageGroup')}
            </div>
            <SliderRow
              label={_('reader.pageWidth')}
              value={pageWidthBinding.value}
              min={readingMode === 'page' ? 0 : 400}
              max={1800}
              step={50}
              suffix="px"
              formatValue={(v) => (v === 0 ? _('reader.pageWidthAuto') : `${v}px`)}
              onChange={pageWidthBinding.onChange}
            />
            <SliderRow label={_('reader.horizontalPadding')} value={horizontalPaddingBinding.value} min={0} max={120} step={4} suffix="px" onChange={horizontalPaddingBinding.onChange} />
            <SliderRow label={_('reader.verticalPadding')} value={verticalPaddingBinding.value} min={0} max={120} step={4} suffix="px" onChange={verticalPaddingBinding.onChange} />
          </div>

          <div className="border-t border-[var(--bd-read-accent)] pt-3">
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--bd-read-sub)]">
              {_('reader.layoutTextGroup')}
            </div>
            <SliderRow label={_('reader.lineHeight')} value={lineHeightBinding.value} min={1.2} max={2.5} step={0.1} onChange={lineHeightBinding.onChange} />
            <SliderRow label={_('reader.paragraphSpacing')} value={paragraphSpacing} min={0} max={3} step={0.1} suffix="em" onChange={setParagraphSpacing} />
            <SliderRow label={_('reader.letterSpacing')} value={letterSpacing} min={-1} max={3} step={0.5} suffix="px" onChange={setLetterSpacing} />
            <SliderRow label={_('reader.indent')} value={indent} min={0} max={4} step={0.5} suffix="em" onChange={setIndent} />
          </div>

          <div className="border-t border-[var(--bd-read-accent)] pt-1">
            <ToggleRow
              label={_('reader.overrideBookLayout')}
              hint={_('reader.overrideBookLayoutHint')}
              checked={overrideBookLayout}
              onChange={setOverrideBookLayout}
            />
          </div>
        </div>
      )}

      {section === 'display' && (
        <div>
          <div className="mb-2.5">
            <label className="mb-1.5 block text-xs text-[var(--bd-read-sub)]">{_('reader.readingMode')}</label>
            <ButtonGroup
              options={[
                { value: 'scroll', label: _('reader.readingModeScroll') },
                { value: 'page', label: _('reader.readingModePage') },
              ]}
              value={readingMode}
              onChange={setReadingMode}
            />
          </div>

          {readingMode === 'page' && (
            <>
              <div className="mb-3.5">
                <label className="mb-1.5 block text-xs text-[var(--bd-read-sub)]">{_('reader.columnCount')}</label>
                <ButtonGroup
                  options={[
                    { value: 1, label: '1' },
                    { value: 2, label: '2' },
                    { value: 3, label: '3' },
                  ]}
                  value={pageColumnsBinding.value}
                  onChange={pageColumnsBinding.onChange}
                />
              </div>
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

          {readingMode === 'scroll' && (
            <div className="mb-4">
              <label className="mb-1.5 block text-xs text-[var(--bd-read-sub)]">{_('reader.continuousScroll')}</label>
              <ButtonGroup
                options={[
                  { value: 'off', label: _('reader.continuousScrollOff') },
                  { value: 'snap', label: _('reader.continuousScrollSnap') },
                  { value: 'seamless', label: _('reader.continuousScrollSeamless') },
                ]}
                value={continuousScroll}
                onChange={setContinuousScroll}
              />
            </div>
          )}

          <div className="mb-3">
            <ToggleRow
              label={_('reader.pageAnimation')}
              checked={pageAnimation}
              onChange={setPageAnimation}
            />
          </div>

          <div className="mb-4">
            <label className="mb-1.5 block text-xs text-[var(--bd-read-sub)]">{_('reader.chineseConversion')}</label>
            <ButtonGroup
              options={[
                { value: 'off', label: _('reader.chineseConversionOff') },
                { value: 'simplified', label: _('reader.chineseConversionSimplified') },
                { value: 'traditional', label: _('reader.chineseConversionTraditional') },
              ]}
              value={chineseConversion}
              onChange={(v) => setChineseConversion(v === chineseConversion ? 'off' : v)}
            />
          </div>

          <div className="mb-3 border-t border-[var(--bd-read-accent)] pt-3">
            <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--bd-read-sub)]">
              {_('reader.infoBar')}
            </div>
            <ToggleRow label={_('reader.header')} checked={showHeader} onChange={setShowHeader} />
            <div
              className={cn(
                'mb-3.5 flex overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-stone-500/5 divide-x divide-[var(--bd-read-accent)] transition-all duration-150',
                !showHeader && 'pointer-events-none opacity-35 grayscale',
              )}
            >
              <FieldSelect value={headerLeft} onChange={setHeaderLeft} disabled={!showHeader} />
              <FieldSelect value={headerCenter} onChange={setHeaderCenter} disabled={!showHeader} />
              <FieldSelect value={headerRight} onChange={setHeaderRight} disabled={!showHeader} />
            </div>

            <ToggleRow label={_('reader.footer')} checked={showFooter} onChange={setShowFooter} />
            <div
              className={cn(
                'mb-3 flex overflow-hidden rounded-xl border border-[var(--bd-read-accent)] bg-stone-500/5 divide-x divide-[var(--bd-read-accent)] transition-all duration-150',
                !showFooter && 'pointer-events-none opacity-35 grayscale',
              )}
            >
              <FieldSelect value={footerLeft} onChange={setFooterLeft} disabled={!showFooter} />
              <FieldSelect value={footerCenter} onChange={setFooterCenter} disabled={!showFooter} />
              <FieldSelect value={footerRight} onChange={setFooterRight} disabled={!showFooter} />
            </div>
          </div>
        </div>
      )}

      {section === 'behavior' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div>
              <div className="mb-2 flex items-center justify-between">
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
                      role="dialog"
                      aria-label={_('reader.clickAreaHintTitle')}
                      className="absolute left-0 top-7 z-30 w-72 max-w-[calc(100vw-3rem)] rounded-xl border border-stone-300/90 bg-[var(--bd-read-bg)] p-3 text-xs shadow-xl dark:border-stone-700/90 animate-in fade-in zoom-in-95 duration-100"
                      style={{
                        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                      }}
                    >
                      <div className="mb-2 flex items-center justify-between border-b border-stone-200/60 pb-1.5 dark:border-stone-800/60">
                        <span className="font-semibold text-current">
                          {_('reader.clickAreaHintTitle')}
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowClickAreaHint(false)}
                          className="flex h-5 w-5 items-center justify-center rounded text-[var(--bd-read-sub)] hover:bg-stone-500/10 hover:text-current active:scale-90"
                          aria-label={_('annotation.cancel')}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      <div className="flex flex-col gap-1 text-xs">
                        <div
                          className={cn(
                            'flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors',
                            clickAreaMode === 'standard' ? 'bg-stone-500/15 font-medium text-current' : 'text-[var(--bd-read-sub)]',
                          )}
                        >
                          <span className="w-10 shrink-0 font-medium text-current">{_('reader.clickAreaStandard')}</span>
                          <span className="opacity-90">{_('reader.clickAreaStandardDesc')}</span>
                        </div>

                        <div
                          className={cn(
                            'flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors',
                            clickAreaMode === 'fullscreen' ? 'bg-stone-500/15 font-medium text-current' : 'text-[var(--bd-read-sub)]',
                          )}
                        >
                          <span className="w-10 shrink-0 font-medium text-current">{_('reader.clickAreaFullscreen')}</span>
                          <span className="opacity-90">{_('reader.clickAreaFullscreenDesc')}</span>
                        </div>

                        <div
                          className={cn(
                            'flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors',
                            clickAreaMode === 'swap' ? 'bg-stone-500/15 font-medium text-current' : 'text-[var(--bd-read-sub)]',
                          )}
                        >
                          <span className="w-10 shrink-0 font-medium text-current">{_('reader.clickAreaSwap')}</span>
                          <span className="opacity-90">{_('reader.clickAreaSwapDesc')}</span>
                        </div>
                      </div>

                      <div className="mt-2 border-t border-stone-200/60 pt-1.5 text-[11px] text-[var(--bd-read-sub)] opacity-80 dark:border-stone-800/60">
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
          </div>

          <div className="flex flex-col gap-3.5 border-t border-[var(--bd-read-accent)]/20 pt-3.5">
            {viewSettings && (
              <ToggleRow
                label={_('reader.perBookOnly')}
                hint={_('reader.perBookOnlyHint')}
                checked={viewSettings.perBookActive}
                onChange={viewSettings.setPerBookActive}
              />
            )}

            <ReadingPresetPicker />
          </div>

          {bookId && (
            <div className="border-t border-[var(--bd-read-accent)]/20 pt-1">
              <TransformsEntryRow bookId={bookId} />
            </div>
          )}
        </div>
      )}

      {section === 'theme' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-current">{_('reader.sectionTheme')}</span>
            <button
              type="button"
              onClick={openThemeDraft}
              title={_('reader.newTheme')}
              aria-label={_('reader.newTheme')}
              className="flex h-6.5 items-center gap-1 rounded-md border border-stone-200/80 bg-stone-500/5 px-2 text-xs font-normal text-[var(--bd-read-sub)] transition-all hover:border-stone-300/90 hover:bg-stone-500/10 hover:text-current active:scale-95 dark:border-stone-800/80"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>{_('reader.newTheme')}</span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {PRESET_READING_THEMES.map((preset) => {
              const th = resolveReadingTheme(preset.id, customThemes)
              const isSelected = readingThemeId === preset.id
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setReadingThemeId(preset.id)}
                  className={cn(
                    'group relative flex h-11 items-center gap-2.5 rounded-xl border px-3 text-left transition-all select-none active:scale-[0.98]',
                    isSelected
                      ? 'border-current/60 shadow-sm ring-2 ring-current/25 font-medium'
                      : 'border-stone-300/60 opacity-85 hover:opacity-100 hover:border-stone-400/80 shadow-xs dark:border-stone-700/60',
                  )}
                  style={{ backgroundColor: th.bg, color: th.text }}
                >
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full border border-current/20 shadow-inner"
                    style={{ backgroundColor: th.primary }}
                  />
                  <span className="text-xs">{preset.name}</span>
                  {isSelected && (
                    <span className="ml-auto text-xs font-bold text-current">✓</span>
                  )}
                </button>
              )
            })}
            {customThemes.map((custom) => {
              const th = resolveReadingTheme(custom.id, customThemes)
              const isSelected = readingThemeId === custom.id
              const isEditing = themeDraft?.id === custom.id
              return (
                <div
                  key={custom.id}
                  onClick={() => setReadingThemeId(custom.id)}
                  className={cn(
                    'group relative flex h-11 items-center gap-2 rounded-xl border px-3 text-left transition-all select-none cursor-pointer active:scale-[0.98]',
                    isSelected
                      ? 'border-current/60 shadow-sm ring-2 ring-current/25 font-medium'
                      : 'border-stone-300/60 opacity-85 hover:opacity-100 hover:border-stone-400/80 shadow-xs dark:border-stone-700/60',
                    isEditing && 'ring-2 ring-stone-400/60',
                  )}
                  style={{ backgroundColor: th.bg, color: th.text }}
                >
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full border border-current/20 shadow-inner"
                    style={{ backgroundColor: th.primary }}
                  />
                  <span className="truncate text-xs flex-1 min-w-0">{custom.name}</span>
                  {isSelected && (
                    <span className="text-xs font-bold text-current shrink-0">✓</span>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      editThemeDraft(custom)
                    }}
                    title={_('reader.editTheme')}
                    aria-label={_('reader.editTheme')}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-current/50 transition-colors hover:bg-black/10 hover:text-current active:scale-90"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>

          {themeDraft && (
            <div className="rounded-2xl border border-stone-300/70 bg-stone-500/5 p-4 shadow-sm dark:border-stone-800/80">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--bd-read-sub)]">
                  {themeDraft.id ? _('reader.editTheme') : _('reader.newTheme')}
                </span>
                {themeDraft.id && (
                  <button
                    type="button"
                    onClick={handleDeleteDraft}
                    className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-red-500 transition-colors hover:bg-red-500/10 active:scale-95"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
                    </svg>
                    <span>{_('reader.deleteTheme')}</span>
                  </button>
                )}
              </div>

              <input
                value={themeDraft.name}
                onChange={(e) => setThemeDraft({ ...themeDraft, name: e.target.value })}
                placeholder={_('reader.themeName')}
                className="mb-3.5 w-full rounded-xl border border-stone-300/70 bg-[var(--bd-read-bg)] px-3 py-2 text-xs font-medium text-current outline-none shadow-xs placeholder:text-[var(--bd-read-sub)] focus:border-current focus:ring-1 focus:ring-current/30 dark:border-stone-700/70"
              />
              <div className="flex flex-col gap-2.5 mb-3.5">
                {([
                  ['bg', _('reader.themeBg')],
                  ['fg', _('reader.themeText')],
                  ['primary', _('reader.themePrimary')],
                ] as const).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between text-xs text-[var(--bd-read-sub)]">
                    <span>{label}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] uppercase opacity-70">{themeDraft[key]}</span>
                      <label className="relative flex h-7 w-9 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-stone-300/80 shadow-xs transition-transform hover:scale-105 active:scale-95 dark:border-stone-700">
                        <span className="absolute inset-0" style={{ backgroundColor: themeDraft[key] }} />
                        <input
                          type="color"
                          value={themeDraft[key]}
                          onChange={(e) => setThemeDraft({ ...themeDraft, [key]: e.target.value })}
                          className="absolute inset-0 cursor-pointer opacity-0"
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>

              <div
                className="mb-3.5 rounded-xl border border-stone-300/50 p-3 shadow-inner"
                style={{ backgroundColor: themeDraft.bg, color: themeDraft.fg }}
              >
                <div className="mb-1 flex items-center justify-between text-xs font-medium">
                  <span>{themeDraft.name || _('reader.customTheme')}</span>
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: themeDraft.primary }}
                  />
                </div>
                <p className="text-[11px] leading-relaxed opacity-85">
                  白日依山尽，黄河入海流。欲穷千里目，更上一层楼。
                </p>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setThemeDraft(null)}
                  className="rounded-lg px-3 py-1.5 text-xs text-[var(--bd-read-sub)] transition-colors hover:bg-stone-500/10 hover:text-current active:scale-95"
                >
                  {_('annotation.cancel')}
                </button>
                <button
                  type="button"
                  onClick={saveThemeDraft}
                  className="rounded-lg px-4 py-1.5 text-xs font-medium shadow-sm transition-all active:scale-95"
                  style={{ backgroundColor: themeDraft.primary, color: themeDraft.bg }}
                >
                  {_('reader.saveTheme')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// 正文变换 entry (P2): low-frequency per-book management lives behind a row in
// the behavior section instead of a dedicated tab — the badge shows how many
// rules are active for this book plus any invalid point patches, and the
// dialog reuses the book-detail per-book view.
function TransformsEntryRow({ bookId }: { bookId: string }) {
  const _ = useTranslation()
  const [open, setOpen] = useState(false)
  const { data } = useBookTransforms(bookId)
  const invalidCount = useReaderState((s) => s.invalidTransformIds.length)
  const effectiveCount = useMemo(
    () => (data?.data ?? []).filter((r) => (r.effectiveEnabled ?? r.enabled)).length,
    [data],
  )
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-stone-200/70 bg-stone-500/5 px-3.5 py-2.5 text-left transition-all duration-150 hover:border-stone-300/80 hover:bg-stone-500/10 active:scale-[0.99] dark:border-stone-800/80 dark:hover:border-stone-700/80"
      >
        <span className="text-[13.5px] font-medium text-current">{_('reader.transforms')}</span>
        <div className="flex shrink-0 items-center gap-1.5 text-xs">
          <span className="tabular-nums text-[var(--bd-read-sub)]">
            {_('reader.transformsEffectiveCount', { count: effectiveCount })}
          </span>
          {invalidCount > 0 && (
            <span className="tabular-nums text-red-500">
              {_('reader.transformsInvalidCount', { count: invalidCount })}
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
        <BookTransformsDialog bookId={bookId} onClose={() => setOpen(false)} />,
        document.body,
      )}
    </>
  )
}
