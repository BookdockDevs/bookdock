// Named reading-setting profiles are full-snapshot config sets layered above
// the flat global store fields. The store keeps the resolved config's values in
// its flat fields; this module owns the persistent multi-config state:
// `{ global, presets[] }`, serialized as one JSON string (`readingConfig`) in
// localStorage and the server sync payload.
//
// Activation is deliberately NOT part of the synced blob (intents sync,
// outcomes stay local): the device-local active preset lives in the ui.store
// (`bd-reading-active-preset`), per-book bindings in `book.meta.boundPresetId`.
// Resolution chain: bound preset > device active > global.

// Exactly the settings reachable in the reader's settings menu — fonts,
// typography, layout (incl. per-mode backing), reading mode, chrome, margins,
// behavior and theme references. Resource collections (custom themes, fonts)
// are referenced by id, never snapshotted.
export const CHAPTER_TITLE_DEFAULTS = {
  chapterTitleAlign: 'center' as const,
  chapterTitleSize: 1.5,
  chapterTitleTopSpacing: 1.5,
  chapterTitleBottomSpacing: 2.25,
}

export const READING_PROFILE_KEYS = [
  'readingThemeMode',
  'readingThemeId',
  'lightReadingThemeId',
  'fontFamily',
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

export interface ReadingPreset {
  id: string
  name: string
  snapshot: ReadingSnapshot
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

export function parseReadingConfig(raw: string | null | undefined): ReadingConfig | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ReadingConfig>
    if (!parsed || typeof parsed !== 'object') return null
    const presets = Array.isArray(parsed.presets)
      ? parsed.presets.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.snapshot && typeof p.snapshot === 'object')
        .map((p) => ({ ...p, snapshot: { ...CHAPTER_TITLE_DEFAULTS, ...p.snapshot } }))
      : []
    const global = parsed.global && typeof parsed.global === 'object' ? parsed.global : null
    if (!global) return null
    return { global: { ...CHAPTER_TITLE_DEFAULTS, ...global } as ReadingSnapshot, presets }
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
    if (preset) return preset.snapshot
  }
  return config.global
}

/** Fold a profile-key change into the target (preset or global). A dangling
 * target id folds into global, mirroring the resolution fallback. */
export function foldReadingChange(config: ReadingConfig, key: ReadingProfileKey, value: unknown, targetId: string | null): ReadingConfig {
  const target = targetId
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
  const preset: ReadingPreset = { id: createPresetId(), name, snapshot }
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

export function nextPresetName(config: ReadingConfig, base: string): string {
  let n = 1
  const names = new Set(config.presets.map((p) => p.name))
  while (names.has(`${base} ${n}`)) n += 1
  return `${base} ${n}`
}

export { CONFIG_STORAGE_KEY }
