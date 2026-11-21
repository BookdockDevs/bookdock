// Named reading-setting profiles are full-snapshot config sets layered above
// the flat global store fields. The store keeps the resolved config's values in
// its flat fields; this module owns the persistent multi-config state:
// `{ global, presets[] }`, serialized as one JSON string (`readingConfig`) in
// localStorage and the server sync payload.
//
// Activation is deliberately NOT part of the synced blob (intents sync,
// outcomes stay local): the device-local active preset lives in the ui.store
// (`bd-reading-active-preset`), per-book bindings in `book.readerSettings.boundPresetId`.
// Resolution chain: bound preset > device active > global.

// The global snapshot adds theme defaults to the settings that reading
// presets can capture: fonts, layout, reader chrome and reading behavior.
const READING_THEME_KEYS = ['readingThemeMode', 'readingThemeId', 'lightReadingThemeId', 'darkReadingThemeId'] as const
// Appearance layers are global-only too: presets never capture them, so
// switching presets keeps the current appearance (theme/palette/CSS/highlights).
const READING_APPEARANCE_KEYS = ['lightPaletteId', 'darkPaletteId', 'appearanceCssMode', 'appearanceCssId', 'highlightAdds', 'highlightRemoves'] as const

export const READING_PROFILE_DEFAULTS = {
  cleanReading: false,
  readingThemeMode: 'system',
  readingThemeId: 'night',
  lightReadingThemeId: 'paper',
  darkReadingThemeId: 'night',
  lightPaletteId: null,
  darkPaletteId: null,
  appearanceCssMode: 'follow',
  appearanceCssId: null,
  highlightAdds: [],
  highlightRemoves: [],
  fontFamily: 'sans-serif',
  cjkFontFamily: 'sans-serif',
  fontSize: 22,
  fontWeight: 500,
  lineHeight: 1.9,
  paragraphSpacing: 1.2,
  chapterTitleAlign: 'center',
  chapterTitleSize: 1.5,
  chapterTitleTopSpacing: 4,
  chapterTitleBottomSpacing: 6,
  letterSpacing: 0,
  indent: 2,
  textAlignJustify: true,
  overrideBookFont: false,
  overrideBookLayout: false,
  pageWidth: 900,
  horizontalPadding: 64,
  verticalPadding: 0,
  pageColumns: 2,
  columnGap: 0,
  scrollPageWidth: 900,
  scrollHorizontalPadding: 64,
  scrollVerticalPadding: 0,
  pagePageWidth: 1250,
  pageHorizontalPadding: 0,
  pageVerticalPadding: 56,
  pagePageColumns: 2,
  columnGapPage: 0,
  readingMode: 'scroll',
  continuousScroll: 'snap',
  pageAnimation: true,
  chineseConversion: 'off',
  showHeader: false,
  showFooter: true,
  showFriendIdeas: true,
  headerLeft: 'bookTitle',
  headerCenter: 'none',
  headerRight: 'none',
  footerLeft: 'none',
  footerCenter: 'none',
  footerRight: 'chapterWordCount',
  marginalFontSize: 0,
  clickAreaMode: 'standard',
  autoMarkSelection: false,
} as const satisfies Record<ReadingProfileKey, unknown>

export const READING_PROFILE_KEYS = [
  'cleanReading',
  ...READING_THEME_KEYS,
  ...READING_APPEARANCE_KEYS,
  'fontFamily',
  'cjkFontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'paragraphSpacing',
  'chapterTitleAlign',
  'chapterTitleSize',
  'chapterTitleTopSpacing',
  'chapterTitleBottomSpacing',
  'letterSpacing',
  'indent',
  'textAlignJustify',
  'overrideBookFont',
  'overrideBookLayout',
  'pageWidth',
  'horizontalPadding',
  'verticalPadding',
  'pageColumns',
  'columnGap',
  'scrollPageWidth',
  'scrollHorizontalPadding',
  'scrollVerticalPadding',
  'pagePageWidth',
  'pageHorizontalPadding',
  'pageVerticalPadding',
  'pagePageColumns',
  'columnGapPage',
  'readingMode',
  'continuousScroll',
  'pageAnimation',
  'chineseConversion',
  'showHeader',
  'showFooter',
  'showFriendIdeas',
  'headerLeft',
  'headerCenter',
  'headerRight',
  'footerLeft',
  'footerCenter',
  'footerRight',
  'marginalFontSize',
  'clickAreaMode',
  'autoMarkSelection',
] as const

export type ReadingProfileKey = (typeof READING_PROFILE_KEYS)[number]

export type ReadingSnapshot = Record<ReadingProfileKey, unknown>

/** Keys the global snapshot owns exclusively; presets never capture them. */
const READING_GLOBAL_ONLY_KEYS: ReadonlySet<string> = new Set([...READING_THEME_KEYS, ...READING_APPEARANCE_KEYS])

type ReadingPresetKey = Exclude<ReadingProfileKey, (typeof READING_THEME_KEYS)[number] | (typeof READING_APPEARANCE_KEYS)[number]>
type ReadingPresetSnapshot = Record<ReadingPresetKey, unknown>

function isReadingPresetKey(key: ReadingProfileKey): key is ReadingPresetKey {
  return !READING_GLOBAL_ONLY_KEYS.has(key)
}

const READING_PRESET_KEYS = READING_PROFILE_KEYS.filter(isReadingPresetKey)

export function pickReadingPresetSnapshot(snapshot: ReadingPresetSnapshot): ReadingPresetSnapshot {
  return Object.fromEntries(READING_PRESET_KEYS.map((key) => [key, snapshot[key]])) as ReadingPresetSnapshot
}

export interface ReadingPreset {
  id: string
  name: string
  snapshot: ReadingPresetSnapshot
}

export interface ReadingConfig {
  global: ReadingSnapshot
  presets: ReadingPreset[]
}

const CONFIG_STORAGE_KEY = 'bd-reading-config'

export function createPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function emptyConfig(snapshot: ReadingSnapshot): ReadingConfig {
  return { global: snapshot, presets: [] }
}

/**
 * Fill every profile key a stored snapshot is missing, so a config written
 * before a key existed resolves it to the built-in default instead of
 * `undefined` (which used to blank that setting outright).
 *
 * `pageWidth` / `horizontalPadding` / `verticalPadding` are mirrors of whichever
 * mode is active rather than independent values, so their fallback reads the
 * matching mode-specific backing key out of the same snapshot — a scroll-mode
 * config missing `pageWidth` recovers the reader's scroll width, not a
 * page-mode zero.
 */
export function resolveProfileSnapshot(defaults: ReadingSnapshot, snapshot: Partial<ReadingSnapshot>): ReadingSnapshot {
  const resolved = { ...defaults } as ReadingSnapshot
  const src = snapshot as Record<string, unknown>
  for (const key of READING_PROFILE_KEYS) {
    if (src[key] !== undefined) resolved[key] = src[key]
  }
  const mode = (src.readingMode === 'page' ? 'page' : 'scroll') as 'scroll' | 'page'
  const mirrorFallbacks: Array<[ReadingProfileKey, ReadingProfileKey]> = [
    ['pageWidth', mode === 'page' ? 'pagePageWidth' : 'scrollPageWidth'],
    ['horizontalPadding', mode === 'page' ? 'pageHorizontalPadding' : 'scrollHorizontalPadding'],
    ['verticalPadding', mode === 'page' ? 'pageVerticalPadding' : 'scrollVerticalPadding'],
  ]
  for (const [mirror, backing] of mirrorFallbacks) {
    if (src[mirror] === undefined && src[backing] !== undefined) {
      ;(resolved as Record<string, unknown>)[mirror] = src[backing]
    }
  }
  return resolved
}

export function parseReadingConfig(raw: string | null | undefined): ReadingConfig | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ReadingConfig>
    if (!parsed || typeof parsed !== 'object') return null
    const presets = Array.isArray(parsed.presets)
      ? parsed.presets.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.snapshot && typeof p.snapshot === 'object')
        .map((p) => ({ ...p, snapshot: pickReadingPresetSnapshot(resolveProfileSnapshot(READING_PROFILE_DEFAULTS, p.snapshot)) }))
      : []
    const global = parsed.global && typeof parsed.global === 'object' ? parsed.global : null
    if (!global) return null
    return { global: resolveProfileSnapshot(READING_PROFILE_DEFAULTS, global), presets }
  } catch {
    return null
  }
}

export function serializeReadingConfig(config: ReadingConfig): string {
  return JSON.stringify(config)
}

/** Current flat values of the profile keys, read from the store state. */
export function pickReadingSnapshot(state: object): ReadingSnapshot {
  const snapshot = {} as ReadingSnapshot
  const src = state as Record<string, unknown>
  for (const key of READING_PROFILE_KEYS) {
    ;(snapshot as Record<string, unknown>)[key] = src[key]
  }
  return snapshot
}

/** Values the given preset resolves to, falling back to the global config. */
export function resolveSnapshot(config: ReadingConfig, presetId: string | null): ReadingSnapshot {
  if (presetId) {
    const preset = config.presets.find((p) => p.id === presetId)
    if (preset) return { ...config.global, ...pickReadingPresetSnapshot(preset.snapshot) }
  }
  return config.global
}

/** Fold a profile-key change into the target (preset or global). A dangling
 * target id folds into global, mirroring the resolution fallback. */
export function foldReadingChange(config: ReadingConfig, key: ReadingProfileKey, value: unknown, targetId: string | null): ReadingConfig {
  const target = targetId && isReadingPresetKey(key)
    ? config.presets.find((p) => p.id === targetId)
    : undefined
  if (target) {
    return {
      ...config,
      presets: config.presets.map((p) => (p.id === target.id ? { ...p, snapshot: { ...p.snapshot, [key]: value } } : p)),
    }
  }
  return { ...config, global: { ...config.global, [key]: value } }
}

/** Creation does not activate: the (device-local) active pointer lives
 * outside the blob, so the caller gets the new preset back to point at it. */
export function createReadingPreset(config: ReadingConfig, name: string, snapshot: ReadingSnapshot): { config: ReadingConfig; preset: ReadingPreset } {
  const preset: ReadingPreset = { id: createPresetId(), name, snapshot: pickReadingPresetSnapshot(snapshot) }
  return { config: { global: config.global, presets: [...config.presets, preset] }, preset }
}

export function renameReadingPreset(config: ReadingConfig, id: string, name: string): ReadingConfig {
  return {
    ...config,
    presets: config.presets.map((p) => (p.id === id ? { ...p, name } : p)),
  }
}

/** Deleting never touches activation state: dangling device-local active and
 * per-book bindings fall back at resolution instead of being cleaned up here
 * (a cross-book meta scan on every delete is not worth it). */
export function deleteReadingPreset(config: ReadingConfig, id: string): ReadingConfig {
  return {
    ...config,
    presets: config.presets.filter((p) => p.id !== id),
  }
}

export function nextPresetName(config: ReadingConfig | null, base: string): string {
  let n = 1
  const names = new Set(config?.presets.map((p) => p.name))
  while (names.has(`${base} ${n}`)) n += 1
  return `${base} ${n}`
}

export { CONFIG_STORAGE_KEY }
