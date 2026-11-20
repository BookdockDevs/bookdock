import { readingThemeCardsSchema, type HighlightRuleDef, type HighlightRuleGroup, type HighlightRuleStyle, type ReaderBookSettings, type ReadingThemeCards, type ReadingThemeSelection, type ReadingThemeSelectionState } from '@bookdock/shared'

import { localRecordId } from '@/features/local-library/id'
import type { ReadingThemeSlot } from '@/lib/reading-theme'

import { customThemesFromSync, isHexColor, PRESET_READING_THEMES, sanitizeDualColors, sanitizeHighlightRulesField, sanitizeThemeAssetId, sanitizeThemeAssetRefs, themeCssOf, type BaseThemeColors, type CustomReadingTheme, type EffectiveThemeCss, type ThemeAssetRef } from '@/lib/reading-theme'
import { sanitizeThemeCssField, collectCssAssetRefs } from '@/lib/theme-css-guard'

export interface ThemePalette {
  id: string
  name: string
  colors: BaseThemeColors
  wallpaperAssetId?: string
  wallpaperFileName?: string
  wallpaperOpacity?: number
  wallpaperBlur?: number
}

export interface ThemeCssCard extends EffectiveThemeCss {
  id: string
  name: string
}

export interface SavedReadingTheme {
  id: string
  name: string
  cards: ReadingThemeCards
}

export type ThemeHighlightCard = HighlightRuleDef & { legacyId?: string }

export const BUILTIN_THEME_COMBINATIONS: SavedReadingTheme[] = PRESET_READING_THEMES.map(({ id, name }) => ({
  id, name, cards: { paletteId: id, cssId: null, highlightIds: [] },
}))

export interface ReadingThemeLibrary {
  palettes: ThemePalette[]
  css: ThemeCssCard[]
  highlights: ThemeHighlightCard[]
  themes: SavedReadingTheme[]
}

export const INITIAL_THEME_LIBRARY: ReadingThemeLibrary = {
  palettes: PRESET_READING_THEMES, css: [], highlights: [], themes: BUILTIN_THEME_COMBINATIONS,
}

export function findThemeCombination(library: ReadingThemeLibrary, id: string | undefined): SavedReadingTheme | undefined {
  return library.themes.find((theme) => theme.id === id)
}

export function resolveDefaultThemeChoice(library: ReadingThemeLibrary, id: unknown, initialId: string): string | undefined {
  return (typeof id === 'string' ? findThemeCombination(library, id)?.id : undefined)
    ?? findThemeCombination(library, initialId)?.id ?? library.themes[0]?.id
}

export function savePortableTheme(library: ReadingThemeLibrary, theme: CustomReadingTheme): ReadingThemeLibrary {
  const { id, name, colors, wallpaperAssetId, wallpaperFileName, wallpaperOpacity, wallpaperBlur } = theme
  const css = themeCssOf(theme)
  const cssId = css.contentCss || css.uiCss || css.assets.length ? id : null
  const highlights = (theme.highlightRules ?? []).map((rule, index) => ({ ...rule, legacyId: rule.id, id: `${id.slice(0, 93)}:${index}` }))
  return {
    palettes: upsertThemeCard(library.palettes, { id, name, colors, wallpaperAssetId, wallpaperFileName, wallpaperOpacity, wallpaperBlur }),
    css: cssId ? upsertThemeCard(library.css, { ...css, id: cssId, name }) : library.css,
    highlights: highlights.reduce(upsertThemeCard, library.highlights),
    themes: upsertThemeCard(library.themes, { id, name, cards: { paletteId: id, cssId, highlightIds: highlights.filter((rule) => rule.enabled).map((rule) => rule.id) } }),
  }
}

export function upsertThemeCard<T extends { id: string }>(items: T[], item: T): T[] {
  if (items.some(({ id }) => id === item.id)) return items.map((previous) => previous.id === item.id ? item : previous)
  return [...items, item]
}

export function readThemeLibrary(raw: unknown): ReadingThemeLibrary | undefined {
  if (typeof raw !== 'string') return undefined
  try {
    const value = JSON.parse(raw)
    if (Array.isArray(value)) return (customThemesFromSync(raw) ?? []).reduce(savePortableTheme, INITIAL_THEME_LIBRARY)
    if ((value?.version !== 2 && value?.version !== 3) || !['palettes', 'css', 'highlights', 'themes'].every((key) => Array.isArray(value[key]))) return undefined
    const named = (item: unknown): item is { id: string; name: string } => {
      if (!item || typeof item !== 'object') return false
      const { id, name } = item as Record<string, unknown>
      return typeof id === 'string' && !!id && id.length <= 100 && typeof name === 'string' && !!name.trim()
    }
    const palettes: ThemePalette[] = (value.palettes as ThemePalette[]).flatMap((item) => {
      if (!named(item) || !item.colors || ![item.colors.bg, item.colors.fg, item.colors.primary].every(isHexColor)) return []
      return [{
        id: item.id,
        name: item.name,
        colors: sanitizeDualColors(item.colors),
        wallpaperAssetId: sanitizeThemeAssetId(item.wallpaperAssetId),
        wallpaperFileName: typeof item.wallpaperFileName === 'string' && item.wallpaperFileName.trim() ? item.wallpaperFileName.trim().slice(0, 100) : undefined,
        wallpaperOpacity: typeof item.wallpaperOpacity === 'number' && Number.isFinite(item.wallpaperOpacity)
          ? Math.max(0.1, Math.min(1, item.wallpaperOpacity))
          : undefined,
        wallpaperBlur: typeof item.wallpaperBlur === 'number' && Number.isFinite(item.wallpaperBlur)
          ? Math.max(0, Math.min(20, item.wallpaperBlur))
          : undefined,
      }]
    })
    const css: ThemeCssCard[] = (value.css as ThemeCssCard[]).filter(named).map((item) => ({
      id: item.id, name: item.name,
      contentCss: sanitizeThemeCssField(item.contentCss, 'content') ?? '',
      uiCss: sanitizeThemeCssField(item.uiCss, 'ui') ?? '',
      assets: sanitizeThemeAssetRefs(item.assets),
    }))
    const highlights: ThemeHighlightCard[] = (value.highlights as ThemeHighlightCard[]).flatMap((item) =>
      sanitizeHighlightRulesField([item]).map((rule) => ({
        ...rule, ...(typeof item.legacyId === 'string' ? { legacyId: item.legacyId } : {}),
      })))
    const themes: SavedReadingTheme[] = (value.themes as SavedReadingTheme[]).flatMap((item) => {
      if (!named(item)) return []
      const parsed = readingThemeCardsSchema.safeParse(item.cards)
      return parsed.success ? [{ id: item.id, name: item.name, cards: parsed.data }] : []
    })
    if (value.version === 2) return {
      palettes: palettes.reduce(upsertThemeCard, INITIAL_THEME_LIBRARY.palettes),
      css, highlights, themes: themes.reduce(upsertThemeCard, INITIAL_THEME_LIBRARY.themes),
    }
    return { palettes, css, highlights, themes }
  } catch {
    return undefined
  }
}

export function serializeThemeLibrary(library: ReadingThemeLibrary): string {
  return JSON.stringify({ version: 3, ...library })
}

const themeMaterializeCache = new WeakMap<ReadingThemeLibrary, Map<string, CustomReadingTheme>>()

export function materializeTheme(library: ReadingThemeLibrary, theme: SavedReadingTheme): CustomReadingTheme {
  let libCache = themeMaterializeCache.get(library)
  if (!libCache) {
    libCache = new Map()
    themeMaterializeCache.set(library, libCache)
  }
  const key = theme.id === 'book-appearance'
    ? `book-appearance:${theme.cards.paletteId}:${theme.cards.cssId ?? ''}:${theme.cards.highlightIds.join(',')}`
    : theme.id
  const cached = libCache.get(key)
  if (cached) return cached

  const palette = library.palettes.find((item) => item.id === theme.cards.paletteId)
    ?? library.palettes[0] ?? PRESET_READING_THEMES.find((item) => item.id === theme.cards.paletteId) ?? PRESET_READING_THEMES[0]!
  const css = library.css.find((item) => item.id === theme.cards.cssId)
  const highlights = [...new Set(theme.cards.highlightIds)].flatMap((id) => {
    const rule = library.highlights.find((item) => item.id === id)
    if (!rule) return []
    const { legacyId: _legacyId, ...definition } = rule
    return [{ ...definition, id: _legacyId ?? id, enabled: true }]
  })
  const result: CustomReadingTheme = {
    id: theme.id, name: theme.name, colors: palette.colors,
    ...(palette.wallpaperAssetId ? {
      wallpaperAssetId: palette.wallpaperAssetId,
      wallpaperFileName: palette.wallpaperFileName,
      wallpaperOpacity: palette.wallpaperOpacity,
      wallpaperBlur: palette.wallpaperBlur,
    } : {}),
    ...(css ? { contentCss: css.contentCss, uiCss: css.uiCss, assets: css.assets } : {}),
    ...(highlights.length ? { highlightRules: highlights } : {}),
  }
  libCache.set(key, result)
  return result
}

export function effectiveThemeCards(
  library: ReadingThemeLibrary,
  fallbackId: string,
  preferences?: ReaderBookSettings | null,
): { themeId?: string; cards: ReadingThemeCards } {
  // Callers resolve the tone first (Reader keeps one selection per slot, so the
  // value reaching here is single); a slotted value cannot be interpreted
  // without knowing the slot and falls through to the chain instead of guessing.
  const rawSelection = preferences?.themeSelection
  const selection = rawSelection && rawSelection.mode !== 'slots' ? rawSelection : null
  const source = selection?.themeId ?? preferences?.readingThemeId ?? fallbackId
  const theme = findThemeCombination(library, source)
  const base = theme ?? findThemeCombination(library, fallbackId)
  const fallbackPalette = PRESET_READING_THEMES.find((item) => item.id === source)?.id ?? (fallbackId === 'night' ? 'night' : 'paper')
  const baseCards = base?.cards ?? { paletteId: fallbackPalette, cssId: null, highlightIds: [] }
  if (selection?.mode === 'custom') return { themeId: theme?.id, cards: normalizeThemeCards(library, selection.cards, baseCards.paletteId) }
  return { themeId: base?.id, cards: normalizeThemeCards(library, baseCards) }
}

export function normalizeThemeCards(library: ReadingThemeLibrary, cards: ReadingThemeCards, fallback = 'paper'): ReadingThemeCards {
  const palettes = library.palettes
  return {
    paletteId: palettes.some(({ id }) => id === cards.paletteId) ? cards.paletteId
      : palettes.some(({ id }) => id === fallback) ? fallback
      : palettes[0]?.id ?? (fallback === 'night' ? 'night' : 'paper'),
    cssId: library.css.some(({ id }) => id === cards.cssId) ? cards.cssId : null,
    highlightIds: [...new Set(cards.highlightIds)].filter((id) => library.highlights.some((rule) => rule.id === id)),
  }
}

/**
 * Drop one card and re-point every theme that referenced it, in one step —
 * deleting a palette silently moves its themes onto the fallback palette, so
 * the caller needs both the rewritten library (for the undo snapshot) and the
 * number of themes it touched (for the toast).
 */
export function removeThemeCard(
  library: ReadingThemeLibrary,
  kind: 'palette' | 'css' | 'highlight',
  id: string,
): { library: ReadingThemeLibrary; affected: number } {
  const changed: ReadingThemeLibrary = {
    ...library,
    palettes: kind === 'palette' ? library.palettes.filter((item) => item.id !== id) : library.palettes,
    css: kind === 'css' ? library.css.filter((item) => item.id !== id) : library.css,
    highlights: kind === 'highlight' ? library.highlights.filter((item) => item.id !== id) : library.highlights,
  }
  const affected = library.themes.filter((theme) => kind === 'palette'
    ? theme.cards.paletteId === id
    : kind === 'css'
      ? theme.cards.cssId === id
      : theme.cards.highlightIds.includes(id)).length
  return {
    library: { ...changed, themes: changed.themes.map((theme) => ({ ...theme, cards: normalizeThemeCards(changed, theme.cards) })) },
    affected,
  }
}

export function sameThemeCards(left: ReadingThemeCards, right: ReadingThemeCards): boolean {
  return left.paletteId === right.paletteId && left.cssId === right.cssId &&
    left.highlightIds.length === right.highlightIds.length && left.highlightIds.every((id) => right.highlightIds.includes(id))
}

export function matchThemeCards(library: ReadingThemeLibrary, cards: ReadingThemeCards, preferredId?: string): SavedReadingTheme | undefined {
  const matches = (theme: SavedReadingTheme) => sameThemeCards(cards, normalizeThemeCards(library, theme.cards))
  const preferred = findThemeCombination(library, preferredId)
  return preferred && matches(preferred) ? preferred : library.themes.find(matches)
}

function restoreDeletedEntries<T extends { id: string }>(before: T[], after: T[], current: T[]): T[] {
  const surviving = new Set(after.map(({ id }) => id))
  const present = new Set(current.map(({ id }) => id))
  const oldOrder = new Map(before.map(({ id }, index) => [id, index]))
  const restored = [...current]
  for (const [index, item] of before.entries()) {
    if (surviving.has(item.id) || present.has(item.id)) continue
    const nextIndex = restored.findIndex(({ id }) => (oldOrder.get(id) ?? -1) > index)
    const previousIndex = restored.findLastIndex(({ id }) => oldOrder.has(id))
    restored.splice(nextIndex === -1 ? previousIndex + 1 : nextIndex, 0, item)
  }
  return restored
}

export function undoThemeLibraryDeletion(
  before: ReadingThemeLibrary,
  after: ReadingThemeLibrary,
  current: ReadingThemeLibrary,
): ReadingThemeLibrary {
  const library = {
    palettes: restoreDeletedEntries(before.palettes, after.palettes, current.palettes),
    css: restoreDeletedEntries(before.css, after.css, current.css),
    highlights: restoreDeletedEntries(before.highlights, after.highlights, current.highlights),
    themes: restoreDeletedEntries(before.themes, after.themes, current.themes),
  }
  const previousThemes = new Map(before.themes.map((theme) => [theme.id, theme.cards]))
  const deletedState = new Map(after.themes.map((theme) => [theme.id, theme.cards]))
  const orderedIds = (ids: string[]) => JSON.stringify(ids)
  library.themes = library.themes.map((theme) => {
    const previous = previousThemes.get(theme.id)
    const deleted = deletedState.get(theme.id)
    if (!previous) return theme
    if (!deleted) return current.themes.includes(theme) ? theme : { ...theme, cards: normalizeThemeCards(library, theme.cards) }
    const cards = { ...theme.cards }
    // Only revert a field the deletion changed and no later edit touched.
    if (cards.paletteId === deleted.paletteId) cards.paletteId = previous.paletteId
    if (cards.cssId === deleted.cssId) cards.cssId = previous.cssId
    if (orderedIds(cards.highlightIds) === orderedIds(deleted.highlightIds)) cards.highlightIds = previous.highlightIds
    if (cards.paletteId === theme.cards.paletteId && cards.cssId === theme.cards.cssId &&
      orderedIds(cards.highlightIds) === orderedIds(theme.cards.highlightIds)) return theme
    return { ...theme, cards: normalizeThemeCards(library, cards) }
  })
  return library
}

export function selectionForCards(library: ReadingThemeLibrary, cards: ReadingThemeCards, themeId?: string): ReadingThemeSelection {
  const match = matchThemeCards(library, cards, themeId)
  if (match) return { mode: 'theme', themeId: match.id }
  return { mode: 'custom', themeId: findThemeCombination(library, themeId)?.id, cards }
}

/** Which stored selection applies to the light or dark slot right now. */
export function themeSelectionForSlot(
  value: ReadingThemeSelectionState | null | undefined,
  slot: ReadingThemeSlot,
): ReadingThemeSelection | null {
  if (!value) return null
  // A legacy single selection predates the pair and always applied to both
  // tones, so it keeps doing that until the next write splits it.
  if (value.mode !== 'slots') return value
  return value[slot] ?? null
}

/**
 * Fold one tone's pick into the stored appearance. Picking is scoped to the
 * current slot, including when it returns to following its default.
 */
export function writeThemeSelectionForSlot(
  current: ReadingThemeSelectionState | null | undefined,
  slot: ReadingThemeSlot,
  next: ReadingThemeSelection | null,
): ReadingThemeSelectionState | null {
  const carried = current?.mode === 'slots'
    ? { light: current.light ?? null, dark: current.dark ?? null }
    : current
      ? { light: current, dark: current }
      : { light: null, dark: null }
  const slots = { ...carried, [slot]: next }
  return slots.light || slots.dark ? { ...slots, mode: 'slots' } : null
}

/* ------------------------------------------------------------------ *
 * Portable bundles — the shape a theme package carries, and how an
 * imported bundle folds back into the local library.
 * ------------------------------------------------------------------ */

const MAX_LIBRARY_NAME = 100
const MAX_RULE_NAME = 50

/** One palette as a package carries it: no id, no scope. */
export interface PortablePalette {
  name: string
  colors: BaseThemeColors
  wallpaperAssetId?: string
  wallpaperFileName?: string
  wallpaperOpacity?: number
  wallpaperBlur?: number
}

/** One CSS card as a package carries it. */
export interface PortableCssCard {
  name: string
  contentCss?: string
  uiCss?: string
  assets?: ThemeAssetRef[]
}

/** One highlight rule as a package carries it: definition only, never ids or samples. */
export interface PortableHighlightRule {
  name: string
  pattern: string
  isRegex: boolean
  enabled: boolean
  style?: HighlightRuleStyle
  groups?: HighlightRuleGroup[]
}

/** A saved theme with its cards inline, so a package never depends on local ids. */
export interface PortableTheme {
  name: string
  palette: PortablePalette
  css?: PortableCssCard
  highlights?: PortableHighlightRule[]
}

/**
 * Everything one package can carry. `themes` embed their own cards; the three
 * card lists hold the standalone cards the exporter also selected.
 */
export interface PortableThemeBundle {
  themes: PortableTheme[]
  palettes: PortablePalette[]
  css: PortableCssCard[]
  highlights: PortableHighlightRule[]
}

export interface ThemeBundleCounts {
  themes: number
  palettes: number
  css: number
  highlights: number
}

export const EMPTY_THEME_BUNDLE_COUNTS: ThemeBundleCounts = { themes: 0, palettes: 0, css: 0, highlights: 0 }

/**
 * `名称_1`, `名称_2`… — the copy and import answer to a taken name. Unlike a
 * localized "副本" suffix this survives a max-length cut without a stray middle
 * separator, and repeated imports keep counting up instead of piling suffixes.
 */
export function uniqueName(base: string, taken: ReadonlySet<string>, maxLength = MAX_LIBRARY_NAME): string {
  const root = base.trim().slice(0, maxLength)
  if (!root) return root
  if (!taken.has(root)) return root
  for (let index = 1; index < 1000; index++) {
    const suffix = `_${index}`
    const candidate = `${root.slice(0, maxLength - suffix.length)}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  const suffix = `_${Date.now().toString(36)}`
  return `${root.slice(0, maxLength - suffix.length)}${suffix}`
}

/** The names already in use for one card kind, for `uniqueName`. */
export function themeLibraryNames(library: ReadingThemeLibrary, kind: 'palette' | 'css' | 'highlight' | 'theme'): Set<string> {
  const items = kind === 'palette' ? library.palettes : kind === 'css' ? library.css : kind === 'highlight' ? library.highlights : library.themes
  return new Set(items.map((item) => item.name))
}

export function portablePaletteOf(palette: {
  name: string
  colors: BaseThemeColors
  wallpaperAssetId?: string
  wallpaperFileName?: string
  wallpaperOpacity?: number
  wallpaperBlur?: number
}): PortablePalette {
  return {
    name: palette.name,
    colors: palette.colors,
    ...(palette.wallpaperAssetId ? { wallpaperAssetId: palette.wallpaperAssetId } : {}),
    ...(palette.wallpaperFileName ? { wallpaperFileName: palette.wallpaperFileName } : {}),
    ...(palette.wallpaperOpacity !== undefined ? { wallpaperOpacity: palette.wallpaperOpacity } : {}),
    ...(palette.wallpaperBlur !== undefined ? { wallpaperBlur: palette.wallpaperBlur } : {}),
  }
}

export function portableCssOf(card: { name: string } & EffectiveThemeCss): PortableCssCard {
  // The manifest must list every id the CSS mentions: a hand-edited card can
  // reference an image its `assets` list lost, and the importer rejects a CSS
  // block that references an image outside the package.
  const refs = new Map(card.assets.map((asset) => [asset.id, asset]))
  for (const id of [...collectCssAssetRefs(card.contentCss ?? ''), ...collectCssAssetRefs(card.uiCss ?? '')]) {
    if (!refs.has(id)) refs.set(id, { id, name: id })
  }
  return {
    name: card.name,
    ...(card.contentCss ? { contentCss: card.contentCss } : {}),
    ...(card.uiCss ? { uiCss: card.uiCss } : {}),
    ...(refs.size ? { assets: [...refs.values()] } : {}),
  }
}

/** Definition only: the editor sample and the local id stay on this device. */
export function portableRuleOf(rule: HighlightRuleDef): PortableHighlightRule {
  return {
    name: rule.name,
    pattern: rule.pattern,
    isRegex: rule.isRegex,
    enabled: rule.enabled,
    ...(rule.style ? { style: rule.style } : {}),
    ...(rule.groups?.length ? { groups: rule.groups } : {}),
  }
}

/** A saved theme with everything it references expanded, ready to package. */
export function portableThemeOf(library: ReadingThemeLibrary, theme: SavedReadingTheme): PortableTheme {
  const materialized = materializeTheme(library, theme)
  // Cards keep their own names: the theme's name is not the palette's name, and
  // packing it under the theme name would rename the palette on import.
  const paletteName = library.palettes.find((item) => item.id === theme.cards.paletteId)?.name ?? materialized.name
  const cssName = library.css.find((item) => item.id === theme.cards.cssId)?.name ?? materialized.name
  const css = portableCssOf({ ...themeCssOf(materialized), name: cssName })
  return {
    name: materialized.name,
    palette: portablePaletteOf({ ...materialized, name: paletteName }),
    ...(css.contentCss || css.uiCss || css.assets?.length ? { css } : {}),
    ...(materialized.highlightRules?.length ? { highlights: materialized.highlightRules.map(portableRuleOf) } : {}),
  }
}

function paletteKey(palette: Pick<PortablePalette, 'colors' | 'wallpaperAssetId' | 'wallpaperOpacity' | 'wallpaperBlur'>): string {
  const { bg, fg, primary, pageBg, outsideBg } = palette.colors
  return [bg, fg, primary, pageBg ?? '', outsideBg ?? '', palette.wallpaperAssetId ?? '', palette.wallpaperOpacity ?? '', palette.wallpaperBlur ?? ''].join('|')
}

function cssKey(card: Pick<PortableCssCard, 'contentCss' | 'uiCss' | 'assets'>): string {
  return [
    (card.contentCss ?? '').trim(),
    (card.uiCss ?? '').trim(),
    (card.assets ?? []).map((asset) => asset.id).sort().join(','),
  ].join('\u0000')
}

// Key order matters for equality, and sanitized objects keep their insertion
// order — but a key written by a future version should not read as "different"
// just because the generator reordered the fields.
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(',')}}`
}

function ruleKey(rule: PortableHighlightRule): string {
  // `enabled` is not identity: materializeTheme turns every rule a theme
  // includes on, so a disabled library card and the same rule inside a theme
  // are one rule, not two.
  return stableJson({ pattern: rule.pattern, isRegex: rule.isRegex, style: rule.style ?? null, groups: rule.groups ?? null })
}

function cardsKey(cards: ReadingThemeCards): string {
  return `${cards.paletteId}\u0000${cards.cssId ?? ''}\u0000${cards.highlightIds.join(',')}`
}

/**
 * Fold one package bundle into the library. Content that already exists is
 * reused instead of duplicated (a palette is the same palette when its colours
 * and wallpaper bytes match — asset ids are content-deduped before this runs),
 * and only a genuine name clash with different content gets `_1`.
 */
export function mergeThemeBundle(
  library: ReadingThemeLibrary,
  bundle: PortableThemeBundle,
): { library: ReadingThemeLibrary; added: ThemeBundleCounts; merged: ThemeBundleCounts } {
  const next: ReadingThemeLibrary = {
    palettes: [...library.palettes],
    css: [...library.css],
    highlights: [...library.highlights],
    themes: [...library.themes],
  }
  const added: ThemeBundleCounts = { ...EMPTY_THEME_BUNDLE_COUNTS }
  const names = {
    palettes: themeLibraryNames(library, 'palette'),
    css: themeLibraryNames(library, 'css'),
    highlights: themeLibraryNames(library, 'highlight'),
    themes: themeLibraryNames(library, 'theme'),
  }
  const paletteIndex = new Map(next.palettes.map((item) => [paletteKey(item), item.id]))
  const cssIndex = new Map(next.css.map((item) => [cssKey(item), item.id]))
  const ruleIndex = new Map(next.highlights.map((item) => [ruleKey(item), item.id]))
  const themeIndex = new Map(next.themes.map((item) => [cardsKey(normalizeThemeCards(next, item.cards)), item.id]))
  const known = {
    palettes: new Set(paletteIndex.keys()),
    css: new Set(cssIndex.keys()),
    highlights: new Set(ruleIndex.keys()),
    themes: new Set(themeIndex.keys()),
  }
  const reused = { palettes: new Set<string>(), css: new Set<string>(), highlights: new Set<string>(), themes: new Set<string>() }

  const resolvePalette = (source: PortablePalette): string => {
    const key = paletteKey(source)
    const existing = paletteIndex.get(key)
    if (existing) {
      if (known.palettes.has(key)) reused.palettes.add(key)
      return existing
    }
    const id = localRecordId()
    const name = uniqueName(source.name, names.palettes)
    names.palettes.add(name)
    next.palettes.push({
      id,
      name,
      colors: source.colors,
      ...(source.wallpaperAssetId ? { wallpaperAssetId: source.wallpaperAssetId } : {}),
      ...(source.wallpaperFileName ? { wallpaperFileName: source.wallpaperFileName } : {}),
      ...(source.wallpaperOpacity !== undefined ? { wallpaperOpacity: source.wallpaperOpacity } : {}),
      ...(source.wallpaperBlur !== undefined ? { wallpaperBlur: source.wallpaperBlur } : {}),
    })
    paletteIndex.set(key, id)
    added.palettes++
    return id
  }

  const resolveCss = (source: PortableCssCard): string => {
    const key = cssKey(source)
    const existing = cssIndex.get(key)
    if (existing) {
      if (known.css.has(key)) reused.css.add(key)
      return existing
    }
    const id = localRecordId()
    const name = uniqueName(source.name, names.css)
    names.css.add(name)
    next.css.push({ id, name, contentCss: source.contentCss ?? '', uiCss: source.uiCss ?? '', assets: source.assets ?? [] })
    cssIndex.set(key, id)
    added.css++
    return id
  }

  const resolveRule = (source: PortableHighlightRule): string => {
    const key = ruleKey(source)
    const existing = ruleIndex.get(key)
    if (existing) {
      if (known.highlights.has(key)) reused.highlights.add(key)
      return existing
    }
    const id = localRecordId()
    const name = uniqueName(source.name, names.highlights, MAX_RULE_NAME)
    names.highlights.add(name)
    next.highlights.push({ ...source, id, name })
    ruleIndex.set(key, id)
    added.highlights++
    return id
  }

  for (const source of bundle.themes) {
    const cards: ReadingThemeCards = {
      paletteId: resolvePalette(source.palette),
      cssId: source.css ? resolveCss(source.css) : null,
      highlightIds: (source.highlights ?? []).map(resolveRule),
    }
    const key = cardsKey(cards)
    const existing = themeIndex.get(key)
    if (existing) {
      if (known.themes.has(key)) reused.themes.add(key)
      continue
    }
    const id = localRecordId()
    const name = uniqueName(source.name, names.themes)
    names.themes.add(name)
    next.themes.push({ id, name, cards })
    themeIndex.set(key, id)
    added.themes++
  }
  for (const source of bundle.palettes) resolvePalette(source)
  for (const source of bundle.css) resolveCss(source)
  for (const source of bundle.highlights) resolveRule(source)

  const merged: ThemeBundleCounts = {
    themes: reused.themes.size,
    palettes: reused.palettes.size,
    css: reused.css.size,
    highlights: reused.highlights.size,
  }
  return { library: next, added, merged }
}
