import { useCallback, useMemo, useState } from 'react'

import { useTranslation } from '@/hooks/useTranslation'
import { blendColors, cn } from '@/lib/utils'
import { resolveReadingTheme, PRESET_READING_THEMES } from '@/lib/reading-theme'
import { useUiStore } from '@/stores/ui.store'
import { useViewSettings } from '../view-settings-context'
import { MARGINAL_FIELDS } from '../lib/marginals'
import type { MarginalField } from '../types'
import type { PerBookSettingKey } from '../lib/view-settings'
import { FONT_OPTIONS } from '../types'

type Section = 'font' | 'layout' | 'display' | 'behavior' | 'theme'

interface ThemeDraft {
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
  onChange: (value: number) => void
}

function SliderRow({ label, value, min, max, step = 1, suffix = '', formatValue, onChange }: SliderRowProps) {
  // While dragging, only the local draft moves �?committing to the store on
  // every input event would re-layout the whole book on every tick
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value
  const commit = () => {
    if (draft !== null && draft !== value) onChange(draft)
    setDraft(null)
  }
  const pct = Math.round(((shown - min) / (max - min)) * 100)
  const shownText = formatValue ? formatValue(shown) : `${shown}${suffix}`
  return (
    <div className="mb-5">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="text-[var(--bd-read-sub)]">{label}</span>
        <span className="tabular-nums text-current">{shownText}</span>
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
        className="bd-slider"
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
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex-1">
        <div className="text-sm text-current">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-[var(--bd-read-sub)]">{hint}</div>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className="relative h-6 w-10 shrink-0 rounded-full transition-colors"
        style={{ backgroundColor: checked ? 'var(--toggle-on-bg)' : 'var(--toggle-off-bg)' }}
        aria-checked={checked}
        aria-label={label}
        role="switch"
      >
        <span
          className={cn(
            'absolute top-1 h-4 w-4 rounded-full bg-[var(--bd-read-bg)] transition-transform',
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

function FieldSelect({ value, onChange }: { value: MarginalField; onChange: (v: MarginalField) => void }) {
  const _ = useTranslation()
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as MarginalField)}
      className="w-full rounded-md border border-stone-200 bg-transparent px-1 py-1 text-xs outline-none dark:border-stone-800"
      aria-label={_('reader.marginalField')}
    >
      {MARGINAL_FIELDS.map((f) => (
        <option key={f} value={f}>
          {_(`reader.marginalField.${f}` as const)}
        </option>
      ))}
    </select>
  )
}

function ButtonGroup<T extends string | number>({ options, value, onChange }: ButtonGroupProps<T>) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          onClick={() => onChange(opt.value)}
          title={opt.label}
          aria-label={opt.label}
          className={cn(
            'flex items-center justify-center rounded-lg border px-2 py-1.5 text-xs transition-colors',
            value === opt.value
              ? 'border-current bg-current/10 text-current'
              : 'border-stone-200 text-[var(--bd-read-sub)] hover:text-current dark:border-stone-800',
          )}
        >
          {opt.icon ?? opt.label}
        </button>
      ))}
    </div>
  )
}

// Click-area glyphs: two line arrows (matching the reader's stroke style)
// whose relative positions imply the screen zones; the gap is the neutral
// middle. standard: ← · →, fullscreen: → · →, swap: → · ←.
const GLYPH_LEFT_PREV = 'M10.5 3.5l-7 2.5 7 2.5'
const GLYPH_LEFT_NEXT = 'M3.5 3.5l7 2.5-7 2.5'
const GLYPH_RIGHT_PREV = 'M24.5 3.5l-7 2.5 7 2.5'
const GLYPH_RIGHT_NEXT = 'M17.5 3.5l7 2.5-7 2.5'

function ClickAreaGlyph({ mode }: { mode: 'standard' | 'fullscreen' | 'swap' }) {
  const left = mode === 'standard' ? GLYPH_LEFT_PREV : GLYPH_LEFT_NEXT
  const right = mode === 'swap' ? GLYPH_RIGHT_PREV : GLYPH_RIGHT_NEXT
  return (
    <svg viewBox="0 0 28 12" className="h-3.5 w-8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={left} />
      <path d={right} />
    </svg>
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
      onClick={onClick}
      title={label}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
        active
          ? 'border-current bg-current/10 text-current'
          : 'border-stone-200 text-[var(--bd-read-sub)] hover:text-current dark:border-stone-800',
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

export function SettingsPanel() {
  const [section, setSection] = useState<Section>(getInitialSection)
  const onSetSection = useCallback((s: Section) => {
    setSection(s)
    try { localStorage.setItem(SETTINGS_SECTION_KEY, s) } catch { /* ignore */ }
  }, [])
  const _ = useTranslation()

  const {
    fontFamily,
    setFontFamily,
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

  // Per-book layer (F1): when inside the reader, the first-batch settings
  // display the merged effective values and writes route to the per-book diff
  // (or the global store, depending on the "仅本�? switch). Outside the
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
  const [themeDraft, setThemeDraft] = useState<ThemeDraft | null>(null)
  const openThemeDraft = useCallback(() => {
    setThemeDraft({ name: `${_('reader.customTheme')}${customThemes.length + 1}`, bg: '#F4F4F4', fg: '#1c1917', primary: '#57534e' })
  }, [customThemes.length, _])
  const saveThemeDraft = useCallback(() => {
    if (!themeDraft) return
    saveCustomTheme({
      id: `custom-${Date.now()}`,
      name: themeDraft.name.trim() || _('reader.customTheme'),
      colors: { bg: themeDraft.bg, fg: themeDraft.fg, primary: themeDraft.primary },
    })
    setThemeDraft(null)
  }, [themeDraft, saveCustomTheme, _])
  const sliderVars = useMemo(() => {
    return {
      '--slider-accent': blendColors(currentTheme.bg, currentTheme.text, 0.55),
      '--slider-track': blendColors(currentTheme.bg, currentTheme.text, 0.15),
      '--toggle-on-bg': blendColors(currentTheme.bg, currentTheme.text, 0.55),
      '--toggle-off-bg': blendColors(currentTheme.bg, currentTheme.text, 0.10),
    } as React.CSSProperties
  }, [currentTheme])

  return (
    <div className="p-4 text-sm" style={sliderVars}>
      <style>{`
.bd-slider {
  -webkit-appearance: none;
  appearance: none;
  background: transparent;
  cursor: pointer;
  width: 100%;
  height: 20px;
}
.bd-slider::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, var(--slider-accent) 0%, var(--slider-accent) var(--slider-fill, 50%), var(--slider-track) var(--slider-fill, 50%), var(--slider-track) 100%);
}
.bd-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--slider-accent);
  margin-top: -5px;
}
.bd-slider::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right, var(--slider-accent) 0%, var(--slider-accent) var(--slider-fill, 50%), var(--slider-track) var(--slider-fill, 50%), var(--slider-track) 100%);
  border: none;
}
.bd-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--slider-accent);
  border: none;
}
.bd-slider:focus-visible {
  outline: 2px solid var(--slider-accent);
  outline-offset: 2px;
}
`}</style>
      <div className="mb-4 flex items-center justify-between border-b border-stone-200/60 pb-3 dark:border-stone-800/60">
        <h3 className="font-medium">{_('reader.settings')}</h3>
        <div className="flex items-center gap-2">
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
      </div>

      {section === 'font' && (
        <div>
          <div className="mb-5">
            <label className="mb-2 block text-xs text-[var(--bd-read-sub)]">{_('reader.sectionFont')}</label>
            <div className="grid grid-cols-2 gap-2">
              {FONT_OPTIONS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFontFamily(f.id)}
                  className={cn(
                    'rounded-lg border px-2 py-1.5 text-xs transition-colors',
                    fontFamily === f.id
                      ? 'border-current bg-current/10 text-current'
                      : 'border-stone-200 text-[var(--bd-read-sub)] hover:text-current dark:border-stone-800',
                  )}
                  style={{ fontFamily: f.value }}
                >
                  {f.name}
                </button>
              ))}
            </div>
          </div>

          <SliderRow label={_('reader.fontSize')} value={fontSizeBinding.value} min={12} max={64} suffix="px" onChange={fontSizeBinding.onChange} />
          <div className={cn(!showHeader && !showFooter && 'pointer-events-none opacity-40')}>
            <SliderRow
              label={_('reader.marginalFontSize')}
              value={marginalFontSize}
              min={0}
              max={24}
              step={1}
              formatValue={(v) => (v === 0 ? _('reader.marginalFontSizeAuto') : `${v}px`)}
              onChange={setMarginalFontSize}
            />
          </div>
          <SliderRow label={_('reader.fontWeight')} value={fontWeight} min={100} max={900} step={100} onChange={setFontWeight} />

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
      )}

      {section === 'layout' && (
        <div>
          <SliderRow label={_('reader.pageWidth')} value={pageWidthBinding.value} min={readingMode === 'page' ? 0 : 400} max={1800} step={50} suffix="px" onChange={pageWidthBinding.onChange} />
          <SliderRow label={_('reader.horizontalPadding')} value={horizontalPaddingBinding.value} min={0} max={120} step={4} suffix="px" onChange={horizontalPaddingBinding.onChange} />
          <SliderRow label={_('reader.verticalPadding')} value={verticalPaddingBinding.value} min={0} max={120} step={4} suffix="px" onChange={verticalPaddingBinding.onChange} />

          <SliderRow label={_('reader.paragraphSpacing')} value={paragraphSpacing} min={0} max={3} step={0.1} onChange={setParagraphSpacing} />
          <SliderRow label={_('reader.lineHeight')} value={lineHeightBinding.value} min={1.2} max={2.5} step={0.1} onChange={lineHeightBinding.onChange} />
          <SliderRow label={_('reader.letterSpacing')} value={letterSpacing} min={-1} max={3} step={0.5} suffix="px" onChange={setLetterSpacing} />
          <SliderRow label={_('reader.indent')} value={indent} min={0} max={4} step={0.5} suffix="em" onChange={setIndent} />

          <ToggleRow
            label={_('reader.overrideBookLayout')}
            hint={_('reader.overrideBookLayoutHint')}
            checked={overrideBookLayout}
            onChange={setOverrideBookLayout}
          />
        </div>
      )}

      {section === 'display' && (
        <div>
          <div className="mb-5">
            <label className="mb-2 block text-xs text-[var(--bd-read-sub)]">{_('reader.readingMode')}</label>
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
              <div className="mb-5">
                <label className="mb-2 block text-xs text-[var(--bd-read-sub)]">{_('reader.columnCount')}</label>
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
              <SliderRow
                label={_('reader.columnGap')}
                value={columnGapBinding.value}
                min={0}
                max={15}
                step={1}
                suffix="%"
                onChange={columnGapBinding.onChange}
              />
              <ToggleRow
                label={_('reader.pageAnimation')}
                checked={pageAnimation}
                onChange={setPageAnimation}
              />
            </>
          )}

          {readingMode === 'scroll' && (
            <div className="mb-5">
              <label className="mb-2 block text-xs text-[var(--bd-read-sub)]">{_('reader.continuousScroll')}</label>
              <ButtonGroup
                options={[
                  { value: 'snap', label: _('reader.continuousScrollSnap') },
                  { value: 'seamless', label: _('reader.continuousScrollSeamless') },
                ]}
                value={continuousScroll}
                onChange={(v) => setContinuousScroll(v === continuousScroll ? 'off' : v)}
              />
            </div>
          )}

          <div className="mb-5">
            <label className="mb-2 block text-xs text-[var(--bd-read-sub)]">{_('reader.chineseConversion')}</label>
            <ButtonGroup
              options={[
                { value: 'simplified', label: _('reader.chineseConversionSimplified') },
                { value: 'traditional', label: _('reader.chineseConversionTraditional') },
              ]}
              value={chineseConversion}
              onChange={(v) => setChineseConversion(v === chineseConversion ? 'off' : v)}
            />
          </div>
          <div className="mb-3 border-t border-stone-200/60 pt-3 dark:border-stone-800/60">
            <label className="mb-2 block text-xs text-[var(--bd-read-sub)]">{_('reader.infoBar')}</label>
            <ToggleRow label={_('reader.showHeader')} hint={_('reader.showHeaderHint')} checked={showHeader} onChange={setShowHeader} />
            {showHeader && (
              <div className="mb-4 flex items-center gap-2">
                <span className="w-8 shrink-0 text-xs text-[var(--bd-read-sub)]">{_('reader.header')}</span>
                <FieldSelect value={headerLeft} onChange={setHeaderLeft} />
                <FieldSelect value={headerCenter} onChange={setHeaderCenter} />
                <FieldSelect value={headerRight} onChange={setHeaderRight} />
              </div>
            )}
            <ToggleRow label={_('reader.showFooter')} hint={_('reader.showFooterHint')} checked={showFooter} onChange={setShowFooter} />
            {showFooter && (
              <div className="mb-4 flex items-center gap-2">
                <span className="w-8 shrink-0 text-xs text-[var(--bd-read-sub)]">{_('reader.footer')}</span>
                <FieldSelect value={footerLeft} onChange={setFooterLeft} />
                <FieldSelect value={footerCenter} onChange={setFooterCenter} />
                <FieldSelect value={footerRight} onChange={setFooterRight} />
              </div>
            )}
          </div>
        </div>
      )}

      {section === 'behavior' && (
        <div>
          <ToggleRow
            label={_('reader.autoMarkSelection')}
            hint={_('reader.autoMarkSelectionHint')}
            checked={autoMarkSelection}
            onChange={setAutoMarkSelection}
          />
          <div className="mb-5">
            <label className="mb-2 block text-xs text-[var(--bd-read-sub)]">{_('reader.clickArea')}</label>
            <ButtonGroup
              options={[
                { value: 'standard', label: _('reader.clickAreaStandard'), icon: <ClickAreaGlyph mode="standard" /> },
                { value: 'fullscreen', label: _('reader.clickAreaFullscreen'), icon: <ClickAreaGlyph mode="fullscreen" /> },
                { value: 'swap', label: _('reader.clickAreaSwap'), icon: <ClickAreaGlyph mode="swap" /> },
              ]}
              value={clickAreaMode}
              onChange={(v) => setClickAreaMode(v === clickAreaMode ? 'none' : v)}
            />
            {clickAreaMode === 'none' && (
              <p className="mt-1 text-xs text-[var(--bd-read-sub)]">{_('reader.clickAreaDisabledHint')}</p>
            )}
          </div>
          {viewSettings && (
            <ToggleRow
              label={_('reader.perBookOnly')}
              hint={_('reader.perBookOnlyHint')}
              checked={viewSettings.perBookActive}
              onChange={viewSettings.setPerBookActive}
            />
          )}
        </div>
      )}

      {section === 'theme' && (
        <div>
          <label className="mb-2 block text-xs text-[var(--bd-read-sub)]">{_('reader.sectionTheme')}</label>
          <div className="grid grid-cols-2 gap-2">
            {PRESET_READING_THEMES.map((preset) => {
              const th = resolveReadingTheme(preset.id, customThemes)
              return (
                <button
                  key={preset.id}
                  onClick={() => setReadingThemeId(preset.id)}
                  className="flex items-center gap-2 rounded-lg border border-stone-200/80 px-2 py-2 text-left dark:border-stone-800/80"
                  style={{ backgroundColor: th.bg, color: th.text, borderColor: readingThemeId === preset.id ? th.accent : undefined }}
                >
                  <span className="h-4 w-4 rounded-full border border-stone-300/50" style={{ backgroundColor: th.text }} />
                  <span className="text-xs">{preset.name}</span>
                </button>
              )
            })}
            {customThemes.map((custom) => {
              const th = resolveReadingTheme(custom.id, customThemes)
              return (
                <div key={custom.id} className="group relative">
                  <button
                    onClick={() => setReadingThemeId(custom.id)}
                    className="flex w-full items-center gap-2 rounded-lg border border-stone-200/80 px-2 py-2 text-left dark:border-stone-800/80"
                    style={{ backgroundColor: th.bg, color: th.text, borderColor: readingThemeId === custom.id ? th.accent : undefined }}
                  >
                    <span className="h-4 w-4 rounded-full border border-stone-300/50" style={{ backgroundColor: th.text }} />
                    <span className="truncate text-xs">{custom.name}</span>
                  </button>
                  <button
                    onClick={() => deleteCustomTheme(custom.id)}
                    title={_('reader.deleteTheme')}
                    className="absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-stone-500 text-[10px] leading-none text-white group-hover:flex"
                  >
                    ×
                  </button>
                </div>
              )
            })}
            <button
              onClick={openThemeDraft}
              title={_('reader.customTheme')}
              className="flex items-center justify-center rounded-lg border border-dashed border-stone-300 px-2 py-2 text-[var(--bd-read-sub)] transition-colors hover:text-current dark:border-stone-700"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
          {themeDraft && (
            <div className="mt-3 rounded-lg border border-stone-200/80 p-3 dark:border-stone-800/80">
              <input
                value={themeDraft.name}
                onChange={(e) => setThemeDraft({ ...themeDraft, name: e.target.value })}
                placeholder={_('reader.themeName')}
                className="mb-3 w-full rounded-md border border-stone-200 bg-transparent px-2 py-1 text-xs outline-none dark:border-stone-700"
              />
              {([
                ['bg', _('reader.themeBg')],
                ['fg', _('reader.themeText')],
                ['primary', _('reader.themePrimary')],
              ] as const).map(([key, label]) => (
                <label key={key} className="mb-2 flex items-center justify-between text-xs text-[var(--bd-read-sub)]">
                  {label}
                  <input
                    type="color"
                    value={themeDraft[key]}
                    onChange={(e) => setThemeDraft({ ...themeDraft, [key]: e.target.value })}
                    className="h-6 w-10 cursor-pointer border-none bg-transparent p-0"
                  />
                </label>
              ))}
              <div className="mb-3 flex items-center justify-between rounded-md px-2 py-1.5 text-xs" style={{ backgroundColor: themeDraft.bg, color: themeDraft.fg }}>
                <span>{themeDraft.name || _('reader.customTheme')}</span>
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: themeDraft.primary }} />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setThemeDraft(null)}
                  className="rounded-md px-2 py-1 text-xs text-[var(--bd-read-sub)] hover:text-current"
                >
                  {_('annotation.cancel')}
                </button>
                <button
                  onClick={saveThemeDraft}
                  className="rounded-md px-2 py-1 text-xs"
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
