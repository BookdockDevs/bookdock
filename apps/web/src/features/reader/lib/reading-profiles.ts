// Named reading-setting profiles (grill 定案 2026-08-12): a full-snapshot
// config set layered above the flat global store fields. The store keeps the
// active config's values in its flat fields; this module owns the persistent
// multi-config state: `{ global, presets[], active }`, serialized as one JSON
// string (`readingConfig`) in localStorage + the server sync payload.

// Exactly the settings reachable in the reader's settings menu — fonts,
// typography, layout (incl. per-mode backing), reading mode, chrome, margins,
// behavior and theme references. Resource collections (custom themes, fonts)
// are referenced by id, never snapshotted.
export const READING_PROFILE_KEYS = [
  'readingThemeId',
  'lightReadingThemeId',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'paragraphSpacing',
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
  /** null = global config is active */
  active: string | null
}

const CONFIG_STORAGE_KEY = 'bd-reading-config'

export function createPresetId(): string {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function emptyConfig(snapshot: ReadingSnapshot): ReadingConfig {
  return { global: snapshot, presets: [], active: null }
}

export function parseReadingConfig(raw: string | null | undefined): ReadingConfig | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ReadingConfig>
    if (!parsed || typeof parsed !== 'object') return null
    const presets = Array.isArray(parsed.presets)
      ? parsed.presets.filter((p) => p && typeof p.id === 'string' && typeof p.name === 'string' && p.snapshot && typeof p.snapshot === 'object')
      : []
    const global = parsed.global && typeof parsed.global === 'object' ? parsed.global : null
    const active = typeof parsed.active === 'string' ? parsed.active : null
    if (!global) return null
    return { global: global as ReadingSnapshot, presets, active }
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

/** Values the active config resolves to (preset snapshot or the global one). */
export function activeSnapshot(config: ReadingConfig): ReadingSnapshot {
  if (config.active) {
    const preset = config.presets.find((p) => p.id === config.active)
    if (preset) return preset.snapshot
  }
  return config.global
}

/** Fold a profile-key change into the active target (preset or global). */
export function foldReadingChange(config: ReadingConfig, key: ReadingProfileKey, value: unknown): ReadingConfig {
  const target = config.active
    ? config.presets.find((p) => p.id === config.active)
    : undefined
  if (target) {
    return {
      ...config,
      presets: config.presets.map((p) => (p.id === target.id ? { ...p, snapshot: { ...p.snapshot, [key]: value } } : p)),
    }
  }
  return { ...config, global: { ...config.global, [key]: value } }
}

export function createReadingPreset(config: ReadingConfig, name: string, snapshot: ReadingSnapshot): ReadingConfig {
  const preset: ReadingPreset = { id: createPresetId(), name, snapshot }
  return { global: config.global, presets: [...config.presets, preset], active: preset.id }
}

export function renameReadingPreset(config: ReadingConfig, id: string, name: string): ReadingConfig {
  return {
    ...config,
    presets: config.presets.map((p) => (p.id === id ? { ...p, name } : p)),
  }
}

/** Deleting the active preset falls back to the global config. */
export function deleteReadingPreset(config: ReadingConfig, id: string): ReadingConfig {
  return {
    ...config,
    presets: config.presets.filter((p) => p.id !== id),
    active: config.active === id ? null : config.active,
  }
}

export function nextPresetName(config: ReadingConfig, base: string): string {
  let n = 1
  const names = new Set(config.presets.map((p) => p.name))
  while (names.has(`${base} ${n}`)) n += 1
  return `${base} ${n}`
}

export { CONFIG_STORAGE_KEY }
