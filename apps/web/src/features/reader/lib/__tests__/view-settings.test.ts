import { describe, expect, it } from 'vitest'

import { hasBookGroups, mergeBookSettings, settingPatchForKey } from '../view-settings'
import type { BookSettingGroups, GlobalReadingSettings } from '../view-settings'

const baseGlobal: GlobalReadingSettings = {
  fontFamily: 'sans-serif',
  cjkFontFamily: 'sans-serif',
  fontSize: 18,
  fontWeight: 400,
  overrideBookFont: false,
  lineHeight: 1.8,
  paragraphSpacing: 0.5,
  letterSpacing: 0,
  indent: 2,
  textAlignJustify: false,
  chapterTitleAlign: 'center',
  chapterTitleSize: 1.5,
  chapterTitleTopSpacing: 1.5,
  chapterTitleBottomSpacing: 2.25,
  pageWidth: 800,
  horizontalPadding: 0,
  verticalPadding: 0,
  overrideBookLayout: false,
  readingMode: 'scroll',
  pageColumns: 2,
  columnGap: 5,
  continuousScroll: 'off',
  pageAnimation: true,
  chineseConversion: 'off',
  cleanReading: false,
  showHeader: true,
  headerLeft: 'bookTitle',
  headerCenter: 'none',
  headerRight: 'none',
  showFooter: true,
  footerLeft: 'chapter',
  footerCenter: 'none',
  footerRight: 'bookProgress',
  marginalFontSize: 0,
  showFriendIdeas: true,
  ideaDisplayMode: 'sidebar',
  scrollPageWidth: 800,
  scrollHorizontalPadding: 0,
  scrollVerticalPadding: 0,
  pagePageWidth: 0,
  pageHorizontalPadding: 40,
  pageVerticalPadding: 0,
}

describe('mergeBookSettings', () => {
  it('returns global values when there is no per-book group', () => {
    // The effective shape carries the flat values only — the mode backings
    // stay global-side inputs.
    const { scrollPageWidth: _sw, scrollHorizontalPadding: _shp, scrollVerticalPadding: _svp,
      pagePageWidth: _pw, pageHorizontalPadding: _php, pageVerticalPadding: _pvp, ...globalFlat } = baseGlobal
    expect(mergeBookSettings(baseGlobal, undefined)).toEqual(globalFlat)
  })

  it('overrides single-backing keys from the groups', () => {
    const merged = mergeBookSettings(baseGlobal, {
      font: { fontSize: 24 },
      layout: { lineHeight: 2.0 },
      display: { pageColumns: 1, columnGap: 8 },
    })
    expect(merged.fontSize).toBe(24)
    expect(merged.lineHeight).toBe(2.0)
    expect(merged.pageColumns).toBe(1)
    expect(merged.columnGap).toBe(8)
    // untouched keys stay global
    expect(merged.pageWidth).toBe(800)
  })

  it('lets an explicit false override a true global value', () => {
    expect(mergeBookSettings({ ...baseGlobal, cleanReading: true }, { display: { cleanReading: false } }).cleanReading).toBe(false)
    expect(mergeBookSettings({ ...baseGlobal, cleanReading: false }, { display: { cleanReading: true } }).cleanReading).toBe(true)
  })

  it('merges dual-backing keys per mode, not by the group flat value', () => {
    // Group was saved in scroll mode: scroll backing present, page backing absent.
    const merged = mergeBookSettings({ ...baseGlobal, readingMode: 'page' }, {
      layout: { pageWidth: 500, scrollPageWidth: 500 },
    })
    // In page mode the group's flat/scroll value must NOT leak through —
    // the page backing falls back to global.
    expect(merged.pageWidth).toBe(0)
  })

  it('derives the flat value from the current mode backing when both exist', () => {
    const merged = mergeBookSettings({ ...baseGlobal, readingMode: 'page' }, {
      layout: { pageWidth: 1200, pagePageWidth: 1200, pageHorizontalPadding: 80, horizontalPadding: 80 },
    })
    expect(merged.pageWidth).toBe(1200)
    expect(merged.horizontalPadding).toBe(80)
  })

  it('falls back per backing independently', () => {
    const merged = mergeBookSettings(baseGlobal, { layout: { pageWidth: 1200, pagePageWidth: 1200 } })
    // scroll mode: page backing irrelevant, scroll backing falls back to global
    expect(merged.pageWidth).toBe(800)
    // but switching the mode reports the group value
    const page = mergeBookSettings({ ...baseGlobal, readingMode: 'page' }, { layout: { pageWidth: 1200, pagePageWidth: 1200 } })
    expect(page.pageWidth).toBe(1200)
  })

  it('takes the reading mode from the display group over the global one', () => {
    const merged = mergeBookSettings(baseGlobal, { display: { readingMode: 'page' } })
    expect(merged.readingMode).toBe('page')
    // and the page geometry then resolves from the page backings
    expect(merged.pageWidth).toBe(0)
    expect(merged.horizontalPadding).toBe(40)
  })
})

describe('settingPatchForKey', () => {
  it('keeps the boolean field typed and independent from numeric settings', () => {
    expect(settingPatchForKey('cleanReading', true, 'scroll')).toEqual({ group: 'display', patch: { cleanReading: true } })
    expect(settingPatchForKey('cleanReading', false, 'page')).toEqual({ group: 'display', patch: { cleanReading: false } })
  })
  it('carries flat + backing for dual-backing keys in scroll mode', () => {
    expect(settingPatchForKey('pageWidth', 900, 'scroll')).toEqual({ group: 'layout', patch: { pageWidth: 900, scrollPageWidth: 900 } })
    expect(settingPatchForKey('horizontalPadding', 8, 'scroll')).toEqual({ group: 'layout', patch: { horizontalPadding: 8, scrollHorizontalPadding: 8 } })
    expect(settingPatchForKey('verticalPadding', 16, 'scroll')).toEqual({ group: 'layout', patch: { verticalPadding: 16, scrollVerticalPadding: 16 } })
  })

  it('carries flat + backing for dual-backing keys in page mode', () => {
    expect(settingPatchForKey('pageWidth', 1200, 'page')).toEqual({ group: 'layout', patch: { pageWidth: 1200, pagePageWidth: 1200 } })
    expect(settingPatchForKey('horizontalPadding', 40, 'page')).toEqual({ group: 'layout', patch: { horizontalPadding: 40, pageHorizontalPadding: 40 } })
    expect(settingPatchForKey('verticalPadding', 12, 'page')).toEqual({ group: 'layout', patch: { verticalPadding: 12, pageVerticalPadding: 12 } })
  })

  it('keeps single-backing keys as-is and routes each group', () => {
    expect(settingPatchForKey('fontSize', 22, 'scroll')).toEqual({ group: 'font', patch: { fontSize: 22 } })
    expect(settingPatchForKey('fontFamily', 'serif', 'page')).toEqual({ group: 'font', patch: { fontFamily: 'serif' } })
    expect(settingPatchForKey('lineHeight', 2.2, 'page')).toEqual({ group: 'layout', patch: { lineHeight: 2.2 } })
    expect(settingPatchForKey('pageColumns', 1, 'page')).toEqual({ group: 'display', patch: { pageColumns: 1 } })
    expect(settingPatchForKey('columnGap', 10, 'page')).toEqual({ group: 'display', patch: { columnGap: 10 } })
    expect(settingPatchForKey('readingMode', 'page', 'scroll')).toEqual({ group: 'display', patch: { readingMode: 'page' } })
  })
})

describe('hasBookGroups', () => {
  it('is false for undefined and empty objects', () => {
    expect(hasBookGroups(undefined)).toBe(false)
    expect(hasBookGroups({})).toBe(false)
  })

  it('is true when any group is present', () => {
    const groups: BookSettingGroups = { font: { fontSize: 20 } }
    expect(hasBookGroups(groups)).toBe(true)
    expect(hasBookGroups({ layout: { scrollPageWidth: 900 } })).toBe(true)
  })
})
