import type { z } from 'zod'

import type { readerBookSettingsPatchSchema } from './schema'
import type { ViewSettings } from './domain'
import type { ReaderBookSettings, ReaderBookSlotTheme, ReaderBookThemeSettings } from './contract'

export type {
  ReaderBookDisplaySettings,
  ReaderBookFontSettings,
  ReaderBookLayoutSettings,
  ReaderBookSlotTheme,
  ReaderBookThemeSettings,
} from './contract'

export type ReaderBookSettingsPatch = z.infer<typeof readerBookSettingsPatchSchema>
export type ReaderBookGroupsPatch = Pick<ReaderBookSettingsPatch, 'font' | 'layout' | 'display' | 'theme'>

export function mergeReaderBookGroups(current: ReaderBookSettings, patch: ReaderBookGroupsPatch): ReaderBookSettings {
  const next = { ...current }
  for (const key of ['font', 'layout', 'display'] as const) {
    const group = patch[key]
    if (group === null) delete next[key]
    else if (group !== undefined) next[key] = { ...current[key], ...group }
  }
  if (patch.theme === null) delete next.theme
  else if (patch.theme !== undefined) {
    const { selections, css, highlights } = patch.theme
    const theme = { ...current.theme }
    if (selections !== undefined) theme.selections = { ...theme.selections, ...selections }
    if (css === null) {
      delete theme.css
      if (theme.selections) {
        theme.selections = { ...theme.selections }
        for (const slot of ['light', 'dark'] as const) {
          const value = theme.selections[slot]
          if (value?.legacyCards?.cssId !== undefined) {
            theme.selections[slot] = { ...value, legacyCards: { highlightIds: value.legacyCards.highlightIds } }
          }
        }
      }
    }
    else if (css !== undefined) theme.css = css
    if (highlights === null) delete theme.highlights
    else if (highlights !== undefined) theme.highlights = highlights
    next.theme = theme
  }
  return next
}

/**
 * Apply a settings patch (groups, preset binding and legacy fields) to stored
 * settings. Legacy patch fields fold into the groups with their old semantics
 * so the two shapes never coexist: `readingThemeId`/`themeSelection` updates
 * and clears stay effective even after the row already carries `theme`.
 */
export function applyReaderBookSettingsPatch(current: ReaderBookSettings, patch: ReaderBookSettingsPatch): ReaderBookSettings {
  const next = mergeReaderBookGroups(current, patch)

  if (patch.boundPresetId === null) delete next.boundPresetId
  else if (patch.boundPresetId !== undefined) next.boundPresetId = patch.boundPresetId

  if (patch.viewSettings === null) {
    // A legacy diff clear removes the groups it used to feed.
    for (const key of ['font', 'layout', 'display'] as const) delete next[key]
  } else if (patch.viewSettings !== undefined) {
    const legacy = migrateLegacyReaderBookSettings({ viewSettings: patch.viewSettings })
    for (const key of ['font', 'layout', 'display'] as const) {
      if (legacy[key]) next[key] = { ...(next[key] ?? {}), ...legacy[key] }
    }
  }

  let legacyThemeFolded = false
  if (patch.themeSelection !== undefined) {
    next.theme = applyLegacyThemeSelectionPatch(next.theme, patch.themeSelection)
    legacyThemeFolded = true
  }
  if (patch.readingThemeId !== undefined) {
    next.theme = applyLegacyThemeSelectionPatch(next.theme, patch.readingThemeId === null
      ? null
      : { mode: 'theme', themeId: patch.readingThemeId })
    legacyThemeFolded = true
  }
  // Only the legacy fold may leave the group empty (its slots were the whole
  // payload); an explicit `theme: {}` means "enabled, no explicit values".
  if (legacyThemeFolded && next.theme && Object.keys(next.theme).length === 0) delete next.theme
  return next
}

/** One legacy appearance patch against the stored theme group: a selection
 *  replaces both slots, null clears the slots while css/highlights survive. */
function applyLegacyThemeSelectionPatch(
  theme: ReaderBookThemeSettings | undefined,
  selection: ReaderBookSettings['themeSelection'],
): ReaderBookThemeSettings | undefined {
  if (selection === null) {
    if (!theme) return undefined
    const { selections: _cleared, ...rest } = theme
    return Object.keys(rest).length ? rest : undefined
  }
  const migrated = migrateLegacyReaderBookSettings({ themeSelection: selection })
  if (!migrated.theme?.selections) return theme
  return { ...theme, selections: migrated.theme.selections }
}

/** Fold legacy fields into independent groups without flattening either tone's custom cards. */
export function migrateLegacyReaderBookSettings(value: ReaderBookSettings): ReaderBookSettings {
  const next: ReaderBookSettings = { ...value }
  const font = { ...value.font }
  const layout = { ...value.layout }
  const display = { ...value.display }

  const legacyView: ViewSettings | undefined = value.viewSettings ?? undefined
  if (legacyView) {
    // Fields already present in a group win, so a partially migrated value is
    // never regressed by its own legacy copy.
    if (legacyView.fontSize !== undefined && font.fontSize === undefined) font.fontSize = legacyView.fontSize
    const layoutKeys = [
      'lineHeight', 'pageWidth', 'horizontalPadding', 'verticalPadding',
      'scrollPageWidth', 'scrollHorizontalPadding', 'scrollVerticalPadding',
      'pagePageWidth', 'pageHorizontalPadding', 'pageVerticalPadding',
    ] as const
    for (const key of layoutKeys) {
      const v = legacyView[key]
      if (v !== undefined && layout[key] === undefined) layout[key] = v
    }
    if (legacyView.cleanReading !== undefined && display.cleanReading === undefined) display.cleanReading = legacyView.cleanReading
    if (legacyView.pageColumns !== undefined && display.pageColumns === undefined) display.pageColumns = legacyView.pageColumns
    if (legacyView.columnGap !== undefined && display.columnGap === undefined) display.columnGap = legacyView.columnGap
  }

  const theme: ReaderBookThemeSettings = { ...value.theme }
  const legacySlots = value.themeSelection ?? (value.readingThemeId
    ? { mode: 'theme' as const, themeId: value.readingThemeId }
    : null)
  if (legacySlots && !theme.selections) {
    const light = legacySlots.mode === 'slots' ? legacySlots.light : legacySlots
    const dark = legacySlots.mode === 'slots' ? legacySlots.dark : legacySlots
    theme.selections = {
      ...(light ? { light: legacySlotTheme(light) } : {}),
      ...(dark ? { dark: legacySlotTheme(dark) } : {}),
    }
  }

  const hasFont = Object.keys(font).length > 0
  const hasLayout = Object.keys(layout).length > 0
  const hasDisplay = Object.keys(display).length > 0
  const hasTheme = Object.keys(theme).length > 0
  if (hasFont) next.font = font
  if (hasLayout) next.layout = layout
  if (hasDisplay) next.display = display
  if (hasTheme) next.theme = theme
  delete next.viewSettings
  delete next.themeSelection
  delete next.readingThemeId
  return next
}

function legacySlotTheme(
  selection: Exclude<NonNullable<ReaderBookSettings['themeSelection']>, { mode: 'slots' }>,
): ReaderBookSlotTheme {
  if (selection.mode === 'theme') return { themeId: selection.themeId, paletteId: null }
  const { paletteId, cssId, highlightIds } = selection.cards
  return {
    themeId: selection.themeId ?? null,
    paletteId,
    legacyCards: { cssId, highlightIds },
  }
}
