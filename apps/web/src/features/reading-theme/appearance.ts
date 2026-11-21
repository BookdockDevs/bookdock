import type { ReaderBookGroupsPatch, ReaderBookThemeSettings } from '@bookdock/shared'
import { mergeReaderBookGroups } from '@bookdock/shared'

import type { BaseThemeColors, ReadingThemeSlot } from '@/lib/reading-theme'
import { PRESET_READING_THEMES } from '@/lib/reading-theme'

import { findThemeCombination, resolveDefaultThemeChoice, upsertThemeCard, type ReadingThemeLibrary, type SavedReadingTheme } from './theme-library'

/** Global appearance layers (readingConfig.global; independent of presets). */
export interface GlobalAppearanceState {
  lightReadingThemeId: string
  darkReadingThemeId: string
  lightPaletteId: string | null
  darkPaletteId: string | null
  cssMode: 'follow' | 'off' | 'card'
  cssId: string | null
  highlightAdds: string[]
  highlightRemoves: string[]
}

/** The appearance as it resolves for one slot, after every layer. */
export interface ResolvedAppearance {
  /** The theme the selection chain points at for this slot (the judged candidate). */
  candidateThemeId: string
  /** The theme shown as selected; null = 未选中 (the state left the candidate's spec). */
  selectedThemeId: string | null
  /** Explicit-or-theme palette; null = nothing pins a palette. */
  paletteId: string | null
  /** Concrete palette used for colors (falls back to the slot's built-in). */
  effectivePaletteId: string
  cssId: string | null
  highlightIds: string[]
}

export function slotFallbackPaletteId(slot: ReadingThemeSlot): string {
  return slot === 'dark' ? 'night' : 'paper'
}

/** Palette colors for an id, falling back to the slot's built-in palette. */
export function paletteColorsOf(library: ReadingThemeLibrary, paletteId: string | null, slot: ReadingThemeSlot): BaseThemeColors {
  const fallbackId = slotFallbackPaletteId(slot)
  const palette = (paletteId ? library.palettes.find((item) => item.id === paletteId) : undefined)
    ?? (paletteId ? PRESET_READING_THEMES.find((item) => item.id === paletteId) : undefined)
    ?? library.palettes.find((item) => item.id === fallbackId)
    ?? PRESET_READING_THEMES.find((item) => item.id === fallbackId)
    ?? PRESET_READING_THEMES[0]!
  return palette.colors
}

function themePaletteOf(theme: SavedReadingTheme | undefined): string | null {
  return theme?.cards.paletteId ?? null
}

/**
 * Layered highlight resolution: the candidate theme's rules, then the global
 * removes and adds, then the book's removes and adds. Dedupe keeps the first
 * occurrence. Every enabled rule enters the list — there is no count cap.
 */
export function applyHighlightLayers(
  base: string[],
  globalRemoves: string[],
  globalAdds: string[],
  book?: ReaderBookThemeSettings['highlights'],
): string[] {
  const globallyRemoved = new Set(globalRemoves)
  const bookRemoved = new Set(book?.removes ?? [])
  const bookAdded = new Set(book?.adds ?? [])
  const ids: string[] = []
  const seen = new Set<string>()
  const push = (id: string) => {
    // The book layer is the most specific one: its adds resurrect a globally
    // removed rule, and its removes hide anything the upper layers enable.
    if (seen.has(id) || bookRemoved.has(id)) return
    if (globallyRemoved.has(id) && !bookAdded.has(id)) return
    seen.add(id)
    ids.push(id)
  }
  for (const id of base) push(id)
  for (const id of globalAdds) push(id)
  for (const id of book?.adds ?? []) push(id)
  return ids
}

export function toggleAppearanceHighlight(
  library: ReadingThemeLibrary,
  global: GlobalAppearanceState,
  book: ReaderBookThemeSettings | undefined,
  slot: ReadingThemeSlot,
  id: string,
): NonNullable<ReaderBookThemeSettings['highlights']> | null {
  const current = resolveAppearance(library, global, book, slot)
  const adds = book ? book.highlights?.adds ?? [] : global.highlightAdds
  const removes = book ? book.highlights?.removes ?? [] : global.highlightRemoves
  if (current.highlightIds.includes(id)) {
    return { adds: adds.filter((rule) => rule !== id), removes: [...new Set([...removes, id])] }
  }
  return { adds: [...new Set([...adds, id])], removes: removes.filter((rule) => rule !== id) }
}

export function themeApplication(
  theme: SavedReadingTheme,
  current: ResolvedAppearance,
  followsThemeCss: boolean,
  ownHighlights: NonNullable<ReaderBookThemeSettings['highlights']>,
  inheritedRemovals: string[] = [],
): Pick<ReaderBookThemeSettings, 'css' | 'highlights'> {
  const required = new Set(theme.cards.highlightIds)
  const css = theme.cards.cssId
    ? { mode: 'follow' as const }
    : followsThemeCss && current.cssId ? { mode: 'card' as const, cssId: current.cssId } : undefined
  const retainedAdds = required.size ? inheritedRemovals.filter((id) => required.has(id)) : current.highlightIds
  return {
    css,
    highlights: {
      adds: [...new Set([...retainedAdds, ...ownHighlights.adds])],
      removes: ownHighlights.removes.filter((id) => !required.has(id)),
    },
  }
}

/** Whether `candidate` is shown as selected for the resolved state. */
export function themeMatchesState(
  library: ReadingThemeLibrary,
  candidateThemeId: string,
  resolved: { paletteId: string | null; cssId: string | null; highlightIds: string[] },
): boolean {
  const theme = findThemeCombination(library, candidateThemeId)
  if (!theme) return false
  const { paletteId, cssId, highlightIds } = theme.cards
  if (paletteId != null && resolved.paletteId !== paletteId) return false
  if (cssId != null && resolved.cssId !== cssId) return false
  if (highlightIds.length > 0) {
    // The theme's rules must all still be enabled with their relative order
    // unchanged (an order-preserving subsequence of the effective list).
    let cursor = 0
    for (const id of highlightIds) {
      const found = resolved.highlightIds.indexOf(id, cursor)
      if (found === -1) return false
      cursor = found + 1
    }
  }
  return true
}

/**
 * The appearance that results from applying `theme` in the reader's editing
 * scope — the same writes `pickTheme` performs, re-resolved so a trial shows
 * exactly what applying would produce. A theme keeps the components it does
 * not define, and an unsaved editor draft resolves against a library extended
 * with the draft itself.
 */
export function trialAppearanceAfterTheme(
  library: ReadingThemeLibrary,
  global: GlobalAppearanceState,
  book: ReaderBookThemeSettings | undefined,
  slot: ReadingThemeSlot,
  theme: SavedReadingTheme,
): ResolvedAppearance {
  const trialLibrary = { ...library, themes: upsertThemeCard(library.themes, theme) }
  if (book) {
    const resolved = resolveAppearance(trialLibrary, global, book, slot)
    const cssMode = book.css?.mode ?? global.cssMode
    const followsThemeCss = cssMode === 'follow' || book.selections?.[slot]?.legacyCards?.cssId !== undefined
    const changes = themeApplication(theme, resolved, followsThemeCss, book.highlights ?? { adds: [], removes: [] }, global.highlightRemoves)
    const patch: ReaderBookGroupsPatch['theme'] = {
      selections: { [slot]: { themeId: theme.id, paletteId: theme.cards.paletteId ? null : resolved.effectivePaletteId } },
      ...changes,
    }
    const nextBook = mergeReaderBookGroups({ theme: book }, { theme: patch }).theme
    return resolveAppearance(trialLibrary, global, nextBook, slot)
  }
  const resolved = resolveAppearance(trialLibrary, global, undefined, slot)
  const changes = themeApplication(theme, resolved, global.cssMode === 'follow', { adds: global.highlightAdds, removes: global.highlightRemoves })
  const nextGlobal: GlobalAppearanceState = {
    ...global,
    ...(slot === 'dark'
      ? { darkReadingThemeId: theme.id, darkPaletteId: theme.cards.paletteId ? null : resolved.effectivePaletteId }
      : { lightReadingThemeId: theme.id, lightPaletteId: theme.cards.paletteId ? null : resolved.effectivePaletteId }),
    ...(changes.css ? { cssMode: changes.css.mode, cssId: changes.css.cssId ?? null } : {}),
    highlightAdds: changes.highlights?.adds ?? [],
    highlightRemoves: changes.highlights?.removes ?? [],
  }
  return resolveAppearance(trialLibrary, nextGlobal, undefined, slot)
}

export function resolveAppearance(
  library: ReadingThemeLibrary,
  global: GlobalAppearanceState,
  book: ReaderBookThemeSettings | undefined,
  slot: ReadingThemeSlot,
): ResolvedAppearance {
  const fallbackId = slotFallbackPaletteId(slot)
  const slotDefaultId = resolveDefaultThemeChoice(
    library,
    slot === 'dark' ? global.darkReadingThemeId : global.lightReadingThemeId,
    fallbackId,
  ) ?? fallbackId
  const bookSlot = book?.selections?.[slot]
  const bookTheme = findThemeCombination(library, bookSlot?.themeId ?? undefined)
  const candidateThemeId = bookTheme?.id ?? slotDefaultId
  const candidate = bookTheme ?? findThemeCombination(library, slotDefaultId)

  const globalPalette = slot === 'dark' ? global.darkPaletteId : global.lightPaletteId
  const paletteId = bookSlot?.paletteId ?? (bookTheme ? null : globalPalette) ?? themePaletteOf(candidate)

  const themeCssId = candidate?.cards.cssId ?? null
  const css = book?.css
  const cssChoice = css
    ? (css.mode === 'card' ? css.cssId ?? null : css.mode === 'follow' ? themeCssId : null)
    : bookSlot?.legacyCards?.cssId !== undefined ? bookSlot.legacyCards.cssId
      : (global.cssMode === 'card' ? global.cssId : global.cssMode === 'follow' ? themeCssId : null)

  const cssId = cssChoice && library.css.some((item) => item.id === cssChoice) ? cssChoice : null
  const base = bookSlot?.legacyCards?.highlightIds ?? candidate?.cards.highlightIds ?? []
  const rules = new Set(library.highlights.map((rule) => rule.id))
  const highlightIds = applyHighlightLayers(
    base.filter((id) => rules.has(id)),
    global.highlightRemoves,
    global.highlightAdds.filter((id) => rules.has(id)),
    book?.highlights && { ...book.highlights, adds: book.highlights.adds.filter((id) => rules.has(id)) },
  )

  const resolved: ResolvedAppearance = {
    candidateThemeId,
    selectedThemeId: themeMatchesState(library, candidateThemeId, { paletteId, cssId, highlightIds }) ? candidateThemeId : null,
    paletteId,
    effectivePaletteId: paletteId ?? slotFallbackPaletteId(slot),
    cssId,
    highlightIds,
  }
  return resolved
}
