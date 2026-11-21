import { describe, expect, it } from 'vitest'

import { applyReaderBookSettingsPatch, mergeReaderBookGroups, migrateLegacyReaderBookSettings } from './reader-book-settings'
import type { ReaderBookSettings } from './contract'
import { readerBookSettingsPatchSchema } from './schema'

describe('migrateLegacyReaderBookSettings', () => {
  it('folds the legacy 13-key viewSettings diff into the three visible groups', () => {
    const legacy: ReaderBookSettings = {
      viewSettings: {
        fontSize: 20,
        lineHeight: 2,
        cleanReading: true,
        pageColumns: 3,
        columnGap: 8,
        pageWidth: 900,
        pagePageWidth: 1200,
        scrollPageWidth: 900,
        horizontalPadding: 40,
        scrollHorizontalPadding: 40,
        pageHorizontalPadding: 0,
      },
    }
    expect(migrateLegacyReaderBookSettings(legacy)).toEqual({
      font: { fontSize: 20 },
      layout: {
        lineHeight: 2,
        pageWidth: 900,
        pagePageWidth: 1200,
        scrollPageWidth: 900,
        horizontalPadding: 40,
        scrollHorizontalPadding: 40,
        pageHorizontalPadding: 0,
      },
      display: { cleanReading: true, pageColumns: 3, columnGap: 8 },
    })
  })

  it('keeps existing group fields over legacy ones (idempotent migration)', () => {
    const value: ReaderBookSettings = {
      font: { fontSize: 30 },
      viewSettings: { fontSize: 20 },
      readingThemeId: 'cream',
    }
    const migrated = migrateLegacyReaderBookSettings(value)
    expect(migrated.font).toEqual({ fontSize: 30 })
    expect(migrated.theme?.selections).toEqual({
      light: { themeId: 'cream', paletteId: null },
      dark: { themeId: 'cream', paletteId: null },
    })
    expect(migrated.viewSettings).toBeUndefined()
    expect(migrated.readingThemeId).toBeUndefined()
    expect(migrateLegacyReaderBookSettings(migrated)).toEqual(migrated)
  })

  it('preserves a legacy custom combination in both tones', () => {
    const cards = { paletteId: 'paper', cssId: null, highlightIds: ['rule-2', 'rule-1'] }
    const migrated = migrateLegacyReaderBookSettings({ themeSelection: { mode: 'custom', themeId: 'saved', cards } })
    const slot = { themeId: 'saved', paletteId: 'paper', legacyCards: { cssId: null, highlightIds: ['rule-2', 'rule-1'] } }
    expect(migrated.theme).toEqual({ selections: { light: slot, dark: slot } })
  })

  it('keeps a legacy theme-mode selection as an inherit-everything slot state', () => {
    const legacy: ReaderBookSettings = { readingThemeId: 'saved' }
    expect(migrateLegacyReaderBookSettings(legacy).theme).toEqual({
      selections: { light: { themeId: 'saved', paletteId: null }, dark: { themeId: 'saved', paletteId: null } },
    })
  })

  it('keeps distinct legacy day and night custom combinations', () => {
    const migrated = migrateLegacyReaderBookSettings({
      themeSelection: {
        mode: 'slots',
        light: { mode: 'custom', cards: { paletteId: 'paper', cssId: 'day-css', highlightIds: ['rule-2', 'rule-1'] } },
        dark: { mode: 'custom', cards: { paletteId: 'night', cssId: null, highlightIds: ['rule-3'] } },
      },
    })
    expect(migrated.theme?.selections).toEqual({
      light: { themeId: null, paletteId: 'paper', legacyCards: { cssId: 'day-css', highlightIds: ['rule-2', 'rule-1'] } },
      dark: { themeId: null, paletteId: 'night', legacyCards: { cssId: null, highlightIds: ['rule-3'] } },
    })
  })

  it('accepts clearing each group and reopening it empty', () => {
    const initial = { font: { fontSize: 24 }, layout: { lineHeight: 2 }, display: { pageColumns: 2 }, theme: { css: { mode: 'off' as const } }, boundPresetId: 'preset' }
    const reset = readerBookSettingsPatchSchema.parse({ font: null, layout: null, display: null, theme: null })
    expect(mergeReaderBookGroups(initial, reset)).toEqual({ boundPresetId: 'preset' })
    const enable = readerBookSettingsPatchSchema.parse({ font: {}, layout: {}, display: {}, theme: {} })
    expect(mergeReaderBookGroups(mergeReaderBookGroups(initial, reset), enable)).toEqual({ ...enable, boundPresetId: 'preset' })
  })

  it('persists more than 64 explicit highlight removals across tones', () => {
    const patch = { theme: { highlights: { adds: [], removes: Array.from({ length: 65 }, (_, i) => `rule-${i}`) } } }
    expect(readerBookSettingsPatchSchema.parse(patch)).toEqual(patch)
  })

  it('leaves the theme group absent for a book whose only legacy value was a preset binding', () => {
    const value: ReaderBookSettings = { boundPresetId: 'preset-a' }
    expect(migrateLegacyReaderBookSettings(value)).toEqual({ boundPresetId: 'preset-a' })
  })
})

describe('applyReaderBookSettingsPatch', () => {
  it('keeps legacy readingThemeId updates and clears effective after migration', () => {
    const current: ReaderBookSettings = {
      theme: { selections: { light: { themeId: 'cream', paletteId: null }, dark: { themeId: 'cream', paletteId: null } } },
    }
    const updated = applyReaderBookSettingsPatch(current, readerBookSettingsPatchSchema.parse({ readingThemeId: 'sepia' }))
    expect(updated.theme?.selections).toEqual({
      light: { themeId: 'sepia', paletteId: null },
      dark: { themeId: 'sepia', paletteId: null },
    })
    const cleared = applyReaderBookSettingsPatch(updated, readerBookSettingsPatchSchema.parse({ readingThemeId: null }))
    expect(cleared).toEqual({})
  })

  it('clears only the legacy slots on themeSelection null and keeps css and highlights', () => {
    const current: ReaderBookSettings = {
      theme: {
        selections: { light: { themeId: 'cream', paletteId: null } },
        css: { mode: 'off' },
        highlights: { adds: ['rule-1'], removes: [] },
      },
    }
    const next = applyReaderBookSettingsPatch(current, readerBookSettingsPatchSchema.parse({ themeSelection: null }))
    expect(next.theme).toEqual({ css: { mode: 'off' }, highlights: { adds: ['rule-1'], removes: [] } })
  })

  it('folds a legacy viewSettings patch field-by-field into existing groups', () => {
    const current: ReaderBookSettings = { font: { fontWeight: 500 } }
    const next = applyReaderBookSettingsPatch(current, readerBookSettingsPatchSchema.parse({ viewSettings: { fontSize: 20, lineHeight: 2 } }))
    expect(next).toEqual({ font: { fontWeight: 500, fontSize: 20 }, layout: { lineHeight: 2 } })
    const cleared = applyReaderBookSettingsPatch(next, readerBookSettingsPatchSchema.parse({ viewSettings: null }))
    expect(cleared).toEqual({})
  })
})
