import { mix, darken, isDark } from './color'

export interface BaseThemeColors {
  bg: string
  fg: string
  primary: string
}

export interface ReadingTheme {
  bg: string
  pageBg: string
  text: string
  uiText: string
  accent: string
  primary: string
}

export interface CustomReadingTheme {
  id: string
  name: string
  colors: BaseThemeColors
}

// A theme is a base {bg, fg, primary} triple; every other UI color is derived.
export function deriveReadingTheme(base: BaseThemeColors): ReadingTheme {
  return {
    bg: base.bg,
    pageBg: isDark(base.bg) ? darken(base.bg, 4) : darken(base.bg, 3),
    text: base.fg,
    uiText: mix(base.fg, base.bg, 0.45),
    accent: mix(base.fg, base.bg, 0.75),
    primary: base.primary,
  }
}

export const PRESET_READING_THEMES: CustomReadingTheme[] = [
  { id: 'paper', name: '白纸', colors: { bg: '#F4F4F4', fg: '#1c1917', primary: '#57534e' } },
  { id: 'cream', name: '米黄', colors: { bg: '#F4ECE4', fg: '#2c2622', primary: '#8a7a5f' } },
  { id: 'sepia', name: '护眼', colors: { bg: '#DFECE4', fg: '#3c342f', primary: '#5f7d5f' } },
  { id: 'night', name: '夜间', colors: { bg: '#111111', fg: '#d6d6d6', primary: '#8a8a8a' } },
]

const PRESET_IDS = new Set(PRESET_READING_THEMES.map((t) => t.id))

export function isPresetThemeId(id: string): boolean {
  return PRESET_IDS.has(id)
}

export function resolveReadingTheme(id: string, customThemes: CustomReadingTheme[] = []): ReadingTheme {
  const preset = PRESET_READING_THEMES.find((t) => t.id === id)
  if (preset) return deriveReadingTheme(preset.colors)
  const custom = customThemes.find((t) => t.id === id)
  if (custom) return deriveReadingTheme(custom.colors)
  return deriveReadingTheme(PRESET_READING_THEMES[0].colors)
}
