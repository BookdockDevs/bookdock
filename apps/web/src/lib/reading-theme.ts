import { mix, darken, isDark, hexToHsl, hslToHex } from './color'

import type { HighlightRuleDef, HighlightRuleGroup, HighlightRuleLine, HighlightRuleStyle } from '@bookdock/shared'

import { HIGHLIGHT_LIMITS } from './highlight-match'
import { sanitizeThemeCssField } from './theme-css-guard'

export { sanitizeThemeCssField }

export interface BaseThemeColors {
  bg: string
  fg: string
  primary: string
  /**
   * Phase-1 rolling dual colors (书页/页外), only honored in scrolled mode.
   * Absent (preset themes, older custom themes) keeps the legacy single-canvas
   * rendering path untouched.
   */
  pageBg?: string
  outsideBg?: string
}

export interface ReadingTheme {
  bg: string
  pageBg: string
  text: string
  uiText: string
  accent: string
  primary: string
  /** Explicit scrolled dual colors; undefined = legacy single canvas. */
  scrolled?: { page: string; outside: string }
}

export interface CustomReadingTheme {
  id: string
  name: string
  colors: BaseThemeColors
  /** Phase-2 book-content CSS (section documents); absent/'' = no CSS */
  contentCss?: string
  /** Phase-2 reader-chrome CSS; absent/'' = no CSS */
  uiCss?: string
  /** Phase-3 ordered text-highlight rules; absent = no rules */
  highlightRules?: HighlightRuleDef[]
  /** Phase-4 wallpaper (配色与背景 block); stable asset id, bytes stay local */
  wallpaperAssetId?: string
  wallpaperFileName?: string
  wallpaperOpacity?: number
  wallpaperBlur?: number
  /** Phase-4 CSS-referenced asset manifest (follows the CSS blocks) */
  assets?: ThemeAssetRef[]
}

/** One CSS-referenced theme image: stable id + display name (original file name). */
export interface ThemeAssetRef {
  id: string
  name: string
}

export type ReadingThemeMode = 'system' | 'light' | 'dark'
export type SystemTheme = 'light' | 'dark'
/** Which of the two day/night slots the reader currently resolves against. */
export type ReadingThemeSlot = 'light' | 'dark'

export function isReadingThemeMode(value: unknown): value is ReadingThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

/**
 * The slot the reader is using right now. A manual day/night lock owns the
 * answer; only `system` delegates to the device, which is what keeps a lock
 * from being undone by the OS flipping its appearance.
 */
export function readingThemeSlot(mode: ReadingThemeMode, systemTheme: SystemTheme): ReadingThemeSlot {
  return mode === 'dark' || (mode === 'system' && systemTheme === 'dark') ? 'dark' : 'light'
}

export function resolveEffectiveReadingThemeId(
  mode: ReadingThemeMode,
  systemTheme: SystemTheme,
  lightReadingThemeId: string,
  darkReadingThemeId = 'night',
): string {
  return mode === 'dark' || (mode === 'system' && systemTheme === 'dark')
    ? darkReadingThemeId
    : lightReadingThemeId
}

// A theme is a base {bg, fg, primary} triple; every other UI color is derived.
// An explicit dual pair takes over the reading surfaces directly (the paper
// becomes the paginated/scrolled page canvas too); chrome colors keep
// deriving from bg.
export function deriveReadingTheme(base: BaseThemeColors): ReadingTheme {
  if (isDualColorPair(base)) {
    return {
      bg: base.bg,
      pageBg: base.pageBg!,
      text: base.fg,
      uiText: mix(base.fg, base.bg, 0.45),
      accent: mix(base.fg, base.bg, 0.75),
      primary: base.primary,
      scrolled: { page: base.pageBg!, outside: base.outsideBg! },
    }
  }
  return {
    bg: base.bg,
    pageBg: isDark(base.bg) ? darken(base.bg, 4) : darken(base.bg, 3),
    text: base.fg,
    uiText: mix(base.fg, base.bg, 0.45),
    accent: mix(base.fg, base.bg, 0.75),
    primary: base.primary,
  }
}

// The editor emits hex values; synced/hand-written data with anything else in
// the dual pair is treated as absent so an invalid value can never half-apply.
export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)
}

export function generateSmartPalette(pageBg: string): { fg: string; outsideBg: string; primary: string } {
  if (!isHexColor(pageBg)) return { fg: '#1c1917', outsideBg: '#ECECEC', primary: '#57534e' }
  const dark = isDark(pageBg)
  const hsl = hexToHsl(pageBg)

  if (dark) {
    const fg = mix('#E4E4E7', pageBg, 0.1)
    const outsideBg = darken(pageBg, 35)
    let primary: string
    if (hsl.s > 0.15) {
      primary = hslToHex((hsl.h + 30) % 360, Math.min(0.7, hsl.s * 1.5 + 0.2), 0.65)
    } else {
      primary = '#9CA3AF'
    }
    return { fg, outsideBg, primary }
  } else {
    const fg = mix('#18181B', pageBg, 0.15)
    const outsideBg = darken(pageBg, 4.5)
    let primary: string
    if (hsl.s > 0.08) {
      if (hsl.h >= 20 && hsl.h < 65) {
        primary = '#8A7A5F'
      } else if (hsl.h >= 65 && hsl.h < 170) {
        primary = '#4A7A5F'
      } else {
        primary = hslToHex(hsl.h, Math.min(0.6, hsl.s + 0.2), 0.42)
      }
    } else {
      primary = '#57534E'
    }
    return { fg, outsideBg, primary }
  }
}

function isDualColorPair(colors: BaseThemeColors): boolean {
  return isHexColor(colors.pageBg) && isHexColor(colors.outsideBg)
}

export const PRESET_READING_THEMES: CustomReadingTheme[] = [
  { id: 'paper', name: '白纸', colors: { bg: '#F4F4F4', fg: '#1c1917', primary: '#57534e' } },
  { id: 'cream', name: '米黄', colors: { bg: '#F4ECE4', fg: '#2c2622', primary: '#8a7a5f' } },
  { id: 'sepia', name: '护眼', colors: { bg: '#DFECE4', fg: '#3c342f', primary: '#5f7d5f' } },
  { id: 'night', name: '夜间', colors: { bg: '#111111', fg: '#d6d6d6', primary: '#8a8a8a' } },
]

export function findReadingTheme(id: string, customThemes: CustomReadingTheme[] = []): CustomReadingTheme | null {
  return customThemes.find((t) => t.id === id)
    ?? PRESET_READING_THEMES.find((t) => t.id === id)
    ?? null
}

// Tone classes pin the app `dark:` variant axis to the reading theme's
// brightness: reader chrome surfaces add the class so `dark:` styles inside
// follow the reading surface instead of the system preference (see the
// `dark` custom variant in index.css).
export type ReadingTone = 'bd-tone-light' | 'bd-tone-dark'

export function resolveReadingTheme(id: string, customThemes: CustomReadingTheme[] = []): ReadingTheme {
  return deriveReadingTheme(findReadingTheme(id, customThemes)?.colors ?? PRESET_READING_THEMES[0]!.colors)
}

/**
 * Effective theme for the reader and its chrome: a session override (仅本书
 * selection or the editor's trial draft) shadows the resolved global chain.
 * The override resolves against presets + custom themes so a saved id keeps
 * following later edits of that theme.
 */
export function resolveEffectiveReadingTheme(
  override: CustomReadingTheme | null,
  themeId: string,
  customThemes: CustomReadingTheme[] = [],
): ReadingTheme {
  if (override) return deriveReadingTheme(override.colors)
  return resolveReadingTheme(themeId, customThemes)
}

export interface EffectiveThemeCss {
  contentCss: string
  uiCss: string
  /** Asset manifest of the theme the CSS came from (phase 4); [] when off/none */
  assets: ThemeAssetRef[]
}

/** The CSS blocks (and their asset manifest) of one theme. */
export function themeCssOf(theme: CustomReadingTheme | null | undefined): EffectiveThemeCss {
  return { contentCss: theme?.contentCss ?? '', uiCss: theme?.uiCss ?? '', assets: theme?.assets ?? [] }
}

/**
 * Effective custom CSS for the open book (phase 2). The editor's trial draft
 * provides colors and CSS together; otherwise the book follows the effective
 * theme chain's CSS.
 */
export function resolveEffectiveThemeCss(
  trial: CustomReadingTheme | null,
  effectiveTheme: CustomReadingTheme | null,
): EffectiveThemeCss {
  return themeCssOf(trial ?? effectiveTheme)
}

// Parse the synced custom-themes JSON; undefined when absent or malformed so
// an unrelated sync doesn't clobber the local list. Same validation leniency
// as the store's localStorage seed. Dual colors validate independently: a
// bad value is dropped rather than rejecting the whole theme. CSS blocks run
// the same validators as save/preview; an invalid block drops to ''.
export function customThemesFromSync(raw: unknown): CustomReadingTheme[] | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return undefined
    return parsed.filter(
      (t): t is CustomReadingTheme =>
        !!t && typeof t.id === 'string' && typeof t.name === 'string'
        && typeof t.colors?.bg === 'string' && typeof t.colors?.fg === 'string' && typeof t.colors?.primary === 'string',
    ).map((t) => {
      const highlightRules = sanitizeHighlightRulesField(t.highlightRules)
      const assets = sanitizeThemeAssetRefs(t.assets)
      const wallpaperAssetId = sanitizeThemeAssetId(t.wallpaperAssetId)
      const { wallpaperAssetId: _rawWallpaper, assets: _rawAssets, ...rest } = t
      return {
        ...rest,
        colors: sanitizeDualColors(t.colors),
        contentCss: sanitizeThemeCssField(t.contentCss, 'content'),
        uiCss: sanitizeThemeCssField(t.uiCss, 'ui'),
        ...(wallpaperAssetId ? { wallpaperAssetId } : {}),
        ...(assets.length ? { assets } : {}),
        ...(highlightRules.length ? { highlightRules } : {}),
      }
    })
  } catch {
    return undefined
  }
}

// Phase-4 asset references: same leniency as every other block — an invalid
// id or manifest entry is dropped and the rest of the theme survives. Bytes
// live per-device; a dropped/missing id only means the image does not render.
const THEME_ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/

export function sanitizeThemeAssetId(value: unknown): string | undefined {
  return typeof value === 'string' && THEME_ASSET_ID_PATTERN.test(value) ? value : undefined
}

export function sanitizeThemeAssetRefs(raw: unknown): ThemeAssetRef[] {
  if (!Array.isArray(raw)) return []
  const refs: ThemeAssetRef[] = []
  const seen = new Set<string>()
  for (const item of raw.slice(0, 8)) {
    if (!item || typeof item !== 'object') continue
    const ref = item as Record<string, unknown>
    const id = sanitizeThemeAssetId(ref.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    refs.push({ id, name: typeof ref.name === 'string' && ref.name.trim() ? ref.name.trim().slice(0, 120) : id })
  }
  return refs
}

function sanitizeDualColors(colors: BaseThemeColors): BaseThemeColors {
  if (isHexColor(colors.pageBg) && isHexColor(colors.outsideBg)) return colors
  const { pageBg: _page, outsideBg: _outside, ...base } = colors
  return base
}

export { sanitizeDualColors }

// Phase-3 highlight rules: same leniency as the CSS blocks — an invalid rule
// is dropped (or trimmed) and the rest of the theme survives. Per-rule caps
// (pattern length, group count) mirror the matching engine; the rule count is
// unlimited, matching the runtime.
function sanitizeRuleStyle(raw: unknown): HighlightRuleStyle | null {
  if (!raw || typeof raw !== 'object') return null
  const style = raw as Record<string, unknown>
  const cleaned: HighlightRuleStyle = {}
  if (isHexColor(style.textColor)) cleaned.textColor = style.textColor
  if (isHexColor(style.backgroundColor)) cleaned.backgroundColor = style.backgroundColor
  if (style.underline === true || style.underline === false) cleaned.underline = style.underline
  const line = sanitizeRuleLine(style.line)
  if (line) cleaned.line = line
  return cleaned.textColor !== undefined || cleaned.backgroundColor !== undefined
    || cleaned.underline !== undefined || cleaned.line !== undefined
    ? cleaned
    : null
}

function sanitizeRuleLine(raw: unknown): HighlightRuleLine | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const line = raw as Record<string, unknown>
  const style = line.style
  if (style !== 'solid' && style !== 'wavy' && style !== 'dashed') return undefined
  return { style, ...(isHexColor(line.color) ? { color: line.color } : {}) }
}

function sanitizeRuleGroups(raw: unknown): HighlightRuleGroup[] | null {
  if (!Array.isArray(raw)) return null
  const groups: HighlightRuleGroup[] = []
  for (const item of raw.slice(0, HIGHLIGHT_LIMITS.maxGroups)) {
    if (!item || typeof item !== 'object') continue
    const group = item as Record<string, unknown>
    const index = typeof group.index === 'number' && Number.isInteger(group.index) && group.index >= 1 && group.index <= HIGHLIGHT_LIMITS.maxGroups ? group.index : 0
    const style = sanitizeRuleStyle(group.style)
    if (!index || !style) continue
    groups.push({ index, style })
  }
  return groups.length ? groups : null
}

export function sanitizeHighlightRulesField(raw: unknown): HighlightRuleDef[] {
  if (!Array.isArray(raw)) return []
  const rules: HighlightRuleDef[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rule = item as Record<string, unknown>
    const id = typeof rule.id === 'string' && rule.id ? rule.id.slice(0, 100) : ''
    const pattern = typeof rule.pattern === 'string' ? rule.pattern.slice(0, HIGHLIGHT_LIMITS.maxPatternLength) : ''
    if (!id || !pattern) continue
    const style = sanitizeRuleStyle(rule.style)
    const groups = sanitizeRuleGroups(rule.groups)
    const sampleText = typeof rule.sampleText === 'string'
      ? rule.sampleText.replace(/\r\n?/g, '\n').slice(0, HIGHLIGHT_LIMITS.maxSampleLength)
      : ''
    rules.push({
      id,
      name: typeof rule.name === 'string' && rule.name.trim() ? rule.name.trim().slice(0, 50) : id,
      pattern,
      isRegex: rule.isRegex === true,
      enabled: rule.enabled !== false,
      ...(sampleText ? { sampleText } : {}),
      ...(style ? { style } : {}),
      ...(groups ? { groups } : {}),
    })
  }
  return rules
}

/**
 * Effective highlight rules for the open book (phase 3). The editor's trial
 * draft provides the full rule set; otherwise the book follows the effective
 * theme chain's rules.
 */
export function resolveEffectiveHighlightRules(
  trial: CustomReadingTheme | null,
  effectiveTheme: CustomReadingTheme | null,
): HighlightRuleDef[] {
  if (trial) return sanitizeHighlightRulesField(trial.highlightRules)
  return sanitizeHighlightRulesField(effectiveTheme?.highlightRules)
}

