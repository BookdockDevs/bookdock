import { beforeEach, describe, expect, it } from 'vitest'

import {
  INITIAL_THEME_LIBRARY,
  removeThemeCard,
  serializeThemeLibrary,
  type ReadingThemeLibrary,
} from '@/features/reading-theme/theme-library'
import { getThemeLibrarySnapshot, useUiStore } from '@/stores/ui.store'

function fixture(): ReadingThemeLibrary {
  return {
    palettes: [
      ...INITIAL_THEME_LIBRARY.palettes,
      { id: 'warm', name: '暖木', colors: { bg: '#F4ECE4', fg: '#2c2622', primary: '#A86911' } },
    ],
    css: [{ id: 'css-a', name: '暗纹', contentCss: '', uiCss: '', assets: [] }],
    highlights: [{ id: 'hl-a', name: '对白', pattern: '「[^」]*」', isRegex: true, enabled: true, style: { textColor: '#A86911' } }],
    themes: [
      ...INITIAL_THEME_LIBRARY.themes,
      { id: 'mine', name: '我的主题', cards: { paletteId: 'warm', cssId: 'css-a', highlightIds: ['hl-a'] } },
    ],
  }
}

beforeEach(() => {
  const library = fixture()
  useUiStore.setState({
    themeLibrary: library,
    customThemes: [],
    readingConfig: null,
    readingThemeMode: 'light',
    readingThemeId: 'mine',
    lightReadingThemeId: 'mine',
    darkReadingThemeId: 'night',
  })
})

describe('removeThemeCard', () => {
  it('re-points every theme that referenced the deleted palette', () => {
    const { library, affected } = removeThemeCard(fixture(), 'palette', 'warm')
    expect(affected).toBe(1)
    expect(library.palettes.some(({ id }) => id === 'warm')).toBe(false)
    // normalizeThemeCards falls back to 白纸, which is what the toast reports.
    expect(library.themes.find(({ id }) => id === 'mine')?.cards.paletteId).toBe('paper')
  })

  it('counts only the themes that referenced the card', () => {
    const { affected } = removeThemeCard(fixture(), 'css', 'css-a')
    expect(affected).toBe(1)
    expect(removeThemeCard(fixture(), 'highlight', 'hl-a').affected).toBe(1)
  })
})

describe('theme deletion undo', () => {
  it('restores the deleted theme and its previous default', () => {
    const before = getThemeLibrarySnapshot()
    useUiStore.getState().deleteCustomTheme('mine')
    const after = getThemeLibrarySnapshot()
    expect(after.library.themes.some(({ id }) => id === 'mine')).toBe(false)
    expect(after.lightReadingThemeId).toBe('paper')
    useUiStore.getState().undoThemeDeletion(before, after)
    expect(serializeThemeLibrary(useUiStore.getState().themeLibrary)).toBe(serializeThemeLibrary(before.library))
    expect(useUiStore.getState()).toMatchObject({ readingThemeId: 'mine', lightReadingThemeId: 'mine' })
  })

  it('restores the deleted card and its usage while retaining newer library edits', () => {
    const before = getThemeLibrarySnapshot()
    useUiStore.getState().setThemeLibrary(removeThemeCard(before.library, 'palette', 'warm').library)
    const after = getThemeLibrarySnapshot()
    expect(after.library.themes.find(({ id }) => id === 'mine')?.cards.paletteId).toBe('paper')
    const latest = {
      ...after.library,
      palettes: [...after.library.palettes, { ...after.library.palettes[0]!, id: 'new', name: 'New palette' }],
      themes: after.library.themes.map((theme) => theme.id === 'mine'
        ? { ...theme, name: 'Edited theme', cards: { ...theme.cards, cssId: null } }
        : theme),
    }
    useUiStore.getState().setThemeLibrary(latest)
    useUiStore.getState().undoThemeDeletion(before, after)
    const restored = useUiStore.getState().themeLibrary
    expect(restored.palettes.map(({ id }) => id)).toEqual([...before.library.palettes.map(({ id }) => id), 'new'])
    expect(restored.themes.find(({ id }) => id === 'mine')).toMatchObject({ name: 'Edited theme', cards: { paletteId: 'warm', cssId: null } })
  })

  it('keeps newer defaults when restoring a deleted theme', () => {
    const before = getThemeLibrarySnapshot()
    useUiStore.getState().deleteCustomTheme('mine')
    const after = getThemeLibrarySnapshot()
    useUiStore.getState().setGlobalDefaultTheme('light', 'cream')
    useUiStore.getState().setGlobalDefaultTheme('dark', 'sepia')
    useUiStore.getState().undoThemeDeletion(before, after)
    expect(useUiStore.getState()).toMatchObject({ readingThemeId: 'cream', lightReadingThemeId: 'cream', darkReadingThemeId: 'sepia' })
    expect(useUiStore.getState().themeLibrary.themes.some(({ id }) => id === 'mine')).toBe(true)
  })
})
