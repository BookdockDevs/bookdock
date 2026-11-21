import { describe, expect, it } from 'vitest'

import type { ReaderBookThemeSettings } from '@bookdock/shared'

import { applyHighlightLayers, resolveAppearance, themeApplication, themeMatchesState, toggleAppearanceHighlight, trialAppearanceAfterTheme, type GlobalAppearanceState } from '@/features/reading-theme/appearance'
import { INITIAL_THEME_LIBRARY, materializeTheme, type ReadingThemeLibrary } from '@/features/reading-theme/theme-library'

const library: ReadingThemeLibrary = {
  ...INITIAL_THEME_LIBRARY,
  css: [
    ...INITIAL_THEME_LIBRARY.css,
    { id: 'css-1', name: 'CSS', contentCss: 'p {}', uiCss: '', assets: [] },
    { id: 'css-2', name: 'Other', contentCss: 'h1 {}', uiCss: '', assets: [] },
  ],
  highlights: [
    { id: 'rule-1', name: 'R1', pattern: 'a', isRegex: false, enabled: true },
    { id: 'rule-2', name: 'R2', pattern: 'b', isRegex: false, enabled: true },
    { id: 'rule-3', name: 'R3', pattern: 'c', isRegex: false, enabled: true },
  ],
  themes: [
    ...INITIAL_THEME_LIBRARY.themes,
    // A palette theme with CSS and rules
    { id: 'saved', name: 'Saved', cards: { paletteId: 'cream', cssId: 'css-1', highlightIds: ['rule-1', 'rule-2'] } },
    // Palette-less highlight-only theme
    { id: 'rulesOnly', name: 'RulesOnly', cards: { cssId: null, highlightIds: ['rule-3'] } },
  ],
}

const globalBase: GlobalAppearanceState = {
  lightReadingThemeId: 'paper',
  darkReadingThemeId: 'night',
  lightPaletteId: null,
  darkPaletteId: null,
  cssMode: 'follow',
  cssId: null,
  highlightAdds: [],
  highlightRemoves: [],
}

function resolveFor(global: Partial<GlobalAppearanceState>, book?: ReaderBookThemeSettings, slot: 'light' | 'dark' = 'light') {
  return resolveAppearance(library, { ...globalBase, ...global }, book, slot)
}

describe('resolveAppearance', () => {
  it('resolves the slot default theme with its own palette and no layers', () => {
    const resolved = resolveFor({})
    expect(resolved.candidateThemeId).toBe('paper')
    expect(resolved.selectedThemeId).toBe('paper')
    expect(resolved.effectivePaletteId).toBe('paper')
    expect(resolved.cssId).toBeNull()
    expect(resolved.highlightIds).toEqual([])
  })

  it('a book slot selection overrides the chain and keeps the palette when the theme has none', () => {
    const resolved = resolveFor({}, { selections: { light: { themeId: 'rulesOnly', paletteId: 'sepia' } } })
    expect(resolved.candidateThemeId).toBe('rulesOnly')
    // The highlight-only theme pins no palette; the explicit one applies
    expect(resolved.effectivePaletteId).toBe('sepia')
    expect(resolved.selectedThemeId).toBe('rulesOnly')
    expect(resolved.highlightIds).toEqual(['rule-3'])
  })

  it('a theme without CSS keeps an extra CSS card and stays selected', () => {
    const resolved = resolveFor({}, { selections: { light: { themeId: 'rulesOnly', paletteId: null } }, css: { mode: 'card', cssId: 'css-1' } })
    expect(resolved.cssId).toBe('css-1')
    expect(resolved.selectedThemeId).toBe('rulesOnly')
  })

  it('replacing a theme-defined CSS shows the theme as unselected', () => {
    const resolved = resolveFor({}, { selections: { light: { themeId: 'saved', paletteId: null } }, css: { mode: 'card', cssId: 'css-2' } })
    expect(resolved.cssId).toBe('css-2')
    expect(resolved.selectedThemeId).toBeNull()
    // Disabling it shows unselected too
    const off = resolveFor({}, { selections: { light: { themeId: 'saved', paletteId: null } }, css: { mode: 'off' } })
    expect(off.selectedThemeId).toBeNull()
  })

  it('switching the palette off a theme-pinned palette shows unselected', () => {
    const resolved = resolveFor({ lightPaletteId: 'night' })
    expect(resolved.candidateThemeId).toBe('paper')
    expect(resolved.effectivePaletteId).toBe('night')
    expect(resolved.selectedThemeId).toBeNull()
  })

  it('a theme-mode book selection applies the theme palette and css and keeps extra highlight adds', () => {
    const resolved = resolveFor(
      { highlightAdds: ['rule-3'] },
      { selections: { light: { themeId: 'saved', paletteId: null } } },
    )
    expect(resolved.effectivePaletteId).toBe('cream')
    expect(resolved.cssId).toBe('css-1')
    expect(resolved.highlightIds).toEqual(['rule-1', 'rule-2', 'rule-3'])
    expect(resolved.selectedThemeId).toBe('saved')
  })

  it('highlight layers remove, re-enable and order rules with book wins', () => {
    expect(applyHighlightLayers(['rule-1', 'rule-2'], [], ['rule-3'])).toEqual(['rule-1', 'rule-2', 'rule-3'])
    // A global removal hides a theme rule for a book that never touched it
    expect(applyHighlightLayers(['rule-1', 'rule-2'], ['rule-1'], [], { adds: [], removes: [] })).toEqual(['rule-2'])
    // A book add resurrects a globally removed rule, keeping its base position
    // (theme rule order must stay intact for the selected-state match)
    expect(applyHighlightLayers(['rule-1', 'rule-2'], ['rule-1'], [], { adds: ['rule-1'], removes: [] })).toEqual(['rule-1', 'rule-2'])
    // A book removal stays after the inheritance source changes
    expect(applyHighlightLayers(['rule-1', 'rule-2'], [], ['rule-3'], { adds: [], removes: ['rule-3'] })).toEqual(['rule-1', 'rule-2'])
    // Dedupe keeps the first occurrence
    expect(applyHighlightLayers(['rule-1'], [], ['rule-1', 'rule-2'])).toEqual(['rule-1', 'rule-2'])
  })

  it('resolves a book theme independently from a preset switch (global layers keep flowing in)', () => {
    const book: ReaderBookThemeSettings = { selections: { light: { themeId: 'saved', paletteId: null } } }
    const before = resolveFor({}, book)
    expect(before.highlightIds).toEqual(['rule-1', 'rule-2'])
    // A later global add flows into the book unless the book removed it
    const after = resolveFor({ highlightAdds: ['rule-3'] }, { ...book, highlights: { adds: [], removes: ['rule-3'] } })
    expect(after.highlightIds).toEqual(['rule-1', 'rule-2'])
  })
})

describe('themeMatchesState', () => {
  it('requires the theme rules to survive in order', () => {
    expect(themeMatchesState(library, 'saved', { paletteId: 'cream', cssId: 'css-1', highlightIds: ['rule-1', 'rule-2'] })).toBe(true)
    expect(themeMatchesState(library, 'saved', { paletteId: 'cream', cssId: 'css-1', highlightIds: ['rule-1'] })).toBe(false)
    expect(themeMatchesState(library, 'saved', { paletteId: 'cream', cssId: 'css-1', highlightIds: ['rule-2', 'rule-1'] })).toBe(false)
    // Extras after the theme rules do not break the match
    expect(themeMatchesState(library, 'saved', { paletteId: 'cream', cssId: 'css-1', highlightIds: ['rule-1', 'rule-2', 'rule-3'] })).toBe(true)
  })

  it('materializing the resolved appearance carries colors, css and rules', () => {
    const resolved = resolveFor({}, { selections: { light: { themeId: 'saved', paletteId: null } } })
    const theme = materializeTheme(library, { id: 'book-appearance', name: '', cards: { paletteId: resolved.effectivePaletteId, cssId: resolved.cssId, highlightIds: resolved.highlightIds } })
    expect(theme.colors.primary).toBe((library.palettes.find((p) => p.id === 'cream')!).colors.primary)
    expect(theme.contentCss).toBe('p {}')
    expect(theme.highlightRules?.map((rule) => rule.id)).toEqual(['rule-1', 'rule-2'])
  })
})

it('restores required rules when explicitly reapplying a theme', () => {
  const theme = library.themes.find(({ id }) => id === 'saved')!
  const current = resolveFor({ lightReadingThemeId: 'saved', highlightRemoves: ['rule-1', 'rule-3'] })
  const changes = themeApplication(theme, current, true, { adds: ['rule-3'], removes: ['rule-2'] }, ['rule-1', 'rule-3'])
  const book = { selections: { light: { themeId: 'saved', paletteId: null } }, ...changes }
  expect(resolveFor({ highlightRemoves: ['rule-1', 'rule-3'] }, book).highlightIds).toEqual(['rule-1', 'rule-2', 'rule-3'])
})

it('enables rules past the former 64 cap in every slot and keeps them across day/night switching', () => {
  const rules = Array.from({ length: 80 }, (_, i) => ({ ...library.highlights[0]!, id: `many-${i}` }))
  const busy = { id: 'busy', name: 'Busy', cards: { highlightIds: rules.map(({ id }) => id) } }
  const expanded = { ...library, themes: [...library.themes, busy], highlights: [...library.highlights, ...rules] }
  const global = { ...globalBase, darkReadingThemeId: busy.id, lightReadingThemeId: busy.id }

  // Every enabled rule survives resolution — no count-based drop
  const dark = resolveAppearance(expanded, global, undefined, 'dark')
  expect(dark.highlightIds).toHaveLength(80)
  const light = resolveAppearance(expanded, global, undefined, 'light')
  expect(light.highlightIds).toHaveLength(80)

  // Toggling one more rule appends instead of being refused
  const layers = toggleAppearanceHighlight(expanded, global, undefined, 'dark', 'rule-1')
  expect(layers).toEqual({ adds: ['rule-1'], removes: [] })
  const after = resolveAppearance(expanded, { ...global, highlightAdds: layers!.adds }, undefined, 'dark')
  expect(after.highlightIds).toHaveLength(81)
  expect(after.highlightIds[80]).toBe('rule-1')

  // Stored removals beyond any cap persist; disabling one of 81 rules works
  const removes = Array.from({ length: 70 }, (_, i) => `many-${i}`)
  const book = { highlights: { adds: ['rule-2'], removes } }
  const bookResolved = resolveAppearance(expanded, global, book, 'dark')
  expect(bookResolved.highlightIds).toHaveLength(11)
  expect(bookResolved.highlightIds).toEqual(['many-70', 'many-71', 'many-72', 'many-73', 'many-74', 'many-75', 'many-76', 'many-77', 'many-78', 'many-79', 'rule-2'])

  // Re-applying the whole theme (which bypasses per-rule toggles) keeps them all
  const theme = expanded.themes.find(({ id }) => id === busy.id)!
  const changes = themeApplication(theme, after, true, { adds: after.highlightIds, removes: [] })
  const reapplied = resolveAppearance(expanded, { ...global, highlightAdds: changes.highlights!.adds }, undefined, 'dark')
  expect(reapplied.highlightIds).toHaveLength(81)
})

describe('trialAppearanceAfterTheme', () => {
  it('a highlight-only theme trial keeps the current palette and CSS', () => {
    // Current state: a theme with its own palette + CSS is selected
    const global = { ...globalBase, lightReadingThemeId: 'saved', highlightAdds: ['rule-1'] }
    const draft = library.themes.find(({ id }) => id === 'rulesOnly')!
    const resolved = trialAppearanceAfterTheme(library, global, undefined, 'light', draft)
    // The theme's rules replace the previous theme's base rules; an extra
    // global add stays layered
    expect(resolved.highlightIds).toEqual(['rule-3', 'rule-1'])
    // The theme defines no palette: the current one (cream, from 'saved') applies
    expect(resolved.effectivePaletteId).toBe('cream')
    // The theme defines no CSS: following pins the current theme's CSS
    expect(resolved.cssId).toBe('css-1')
  })

  it('an unsaved draft resolves against a library extended with itself', () => {
    const draft = { id: 'draft-1', name: 'Draft', cards: { paletteId: 'night', cssId: null, highlightIds: ['rule-1'] } }
    const resolved = trialAppearanceAfterTheme(library, globalBase, undefined, 'light', draft)
    expect(resolved.effectivePaletteId).toBe('night')
    expect(resolved.highlightIds).toEqual(['rule-1'])
    expect(resolved.cssId).toBeNull()
  })

  it('a book-scope trial mirrors the apply inside the theme group', () => {
    const book: ReaderBookThemeSettings = { selections: { light: { themeId: 'cream', paletteId: null } }, highlights: { adds: [], removes: ['rule-3'] } }
    const draft = library.themes.find(({ id }) => id === 'saved')!
    const resolved = trialAppearanceAfterTheme(library, globalBase, book, 'light', draft)
    // The apply pins the theme palette, follows its CSS, and layers the book removes
    expect(resolved.effectivePaletteId).toBe('cream')
    expect(resolved.cssId).toBe('css-1')
    expect(resolved.highlightIds).toEqual(['rule-1', 'rule-2'])
    expect(resolved.selectedThemeId).toBe('saved')
  })

  it('editing an existing theme trials the modified draft instead of its saved definition', () => {
    const edited = { id: 'saved', name: 'Saved', cards: { paletteId: 'sepia', cssId: 'css-2', highlightIds: ['rule-3'] } }
    const resolved = trialAppearanceAfterTheme(library, globalBase, undefined, 'light', edited)
    expect(resolved.effectivePaletteId).toBe('sepia')
    expect(resolved.cssId).toBe('css-2')
    expect(resolved.highlightIds).toEqual(['rule-3'])
  })

  it('materializeTheme does not serve stale cached trial definitions on the same library', () => {
    const first = materializeTheme(library, { id: 'trial', name: '', cards: { paletteId: 'paper', cssId: 'css-1', highlightIds: ['rule-1'] } })
    const second = materializeTheme(library, { id: 'trial', name: '', cards: { paletteId: 'night', cssId: 'css-2', highlightIds: ['rule-2'] } })
    expect(first.colors.bg).not.toBe(second.colors.bg)
    expect(second.contentCss).toBe('h1 {}')
    expect(second.highlightRules?.map((rule) => rule.id)).toEqual(['rule-2'])
  })
})
