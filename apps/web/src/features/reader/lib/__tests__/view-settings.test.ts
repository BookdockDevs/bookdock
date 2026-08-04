import { describe, expect, it } from 'vitest'

import { mergeViewSettings, viewSettingsDiffForKey, hasViewSettings } from '../view-settings'
import type { GlobalViewSettings } from '../view-settings'

const baseGlobal: GlobalViewSettings = {
  fontSize: 18,
  lineHeight: 1.8,
  pageWidth: 800,
  horizontalPadding: 0,
  verticalPadding: 0,
  pageColumns: 2,
  columnGap: 5,
  scrollPageWidth: 800,
  scrollHorizontalPadding: 0,
  scrollVerticalPadding: 0,
  pagePageWidth: 0,
  pageHorizontalPadding: 40,
  pageVerticalPadding: 0,
  readingMode: 'scroll',
}

describe('mergeViewSettings', () => {
  it('returns global values when there is no per-book diff', () => {
    expect(mergeViewSettings(baseGlobal, undefined)).toEqual({
      fontSize: 18,
      lineHeight: 1.8,
      pageWidth: 800,
      horizontalPadding: 0,
      verticalPadding: 0,
      pageColumns: 2,
      columnGap: 5,
    })
  })

  it('overrides single-backing keys from the diff', () => {
    const merged = mergeViewSettings(baseGlobal, { fontSize: 24, lineHeight: 2.0, pageColumns: 1, columnGap: 8 })
    expect(merged.fontSize).toBe(24)
    expect(merged.lineHeight).toBe(2.0)
    expect(merged.pageColumns).toBe(1)
    expect(merged.columnGap).toBe(8)
    // untouched keys stay global
    expect(merged.pageWidth).toBe(800)
  })

  it('merges dual-backing keys per mode, not by the diff flat value', () => {
    // Diff was saved in scroll mode: scroll backing present, page backing absent.
    const merged = mergeViewSettings({ ...baseGlobal, readingMode: 'page' }, {
      pageWidth: 500,
      scrollPageWidth: 500,
    })
    // In page mode the diff's flat/scroll value must NOT leak through —
    // the page backing falls back to global.
    expect(merged.pageWidth).toBe(0)
  })

  it('derives the flat value from the current mode backing when both exist', () => {
    const merged = mergeViewSettings({ ...baseGlobal, readingMode: 'page' }, {
      pageWidth: 1200,
      pagePageWidth: 1200,
      pageHorizontalPadding: 80,
      horizontalPadding: 80,
    })
    expect(merged.pageWidth).toBe(1200)
    expect(merged.horizontalPadding).toBe(80)
  })

  it('falls back per backing independently', () => {
    const merged = mergeViewSettings(baseGlobal, { pageWidth: 1200, pagePageWidth: 1200 })
    // scroll mode: page backing irrelevant, scroll backing falls back to global
    expect(merged.pageWidth).toBe(800)
    // but switching the mode reports the diff value
    const page = mergeViewSettings({ ...baseGlobal, readingMode: 'page' }, { pageWidth: 1200, pagePageWidth: 1200 })
    expect(page.pageWidth).toBe(1200)
  })
})

describe('viewSettingsDiffForKey', () => {
  it('carries flat + backing for dual-backing keys in scroll mode', () => {
    expect(viewSettingsDiffForKey('pageWidth', 900, 'scroll')).toEqual({ pageWidth: 900, scrollPageWidth: 900 })
    expect(viewSettingsDiffForKey('horizontalPadding', 8, 'scroll')).toEqual({ horizontalPadding: 8, scrollHorizontalPadding: 8 })
    expect(viewSettingsDiffForKey('verticalPadding', 16, 'scroll')).toEqual({ verticalPadding: 16, scrollVerticalPadding: 16 })
  })

  it('carries flat + backing for dual-backing keys in page mode', () => {
    expect(viewSettingsDiffForKey('pageWidth', 1200, 'page')).toEqual({ pageWidth: 1200, pagePageWidth: 1200 })
    expect(viewSettingsDiffForKey('horizontalPadding', 40, 'page')).toEqual({ horizontalPadding: 40, pageHorizontalPadding: 40 })
    expect(viewSettingsDiffForKey('verticalPadding', 12, 'page')).toEqual({ verticalPadding: 12, pageVerticalPadding: 12 })
  })

  it('keeps single-backing keys as-is', () => {
    expect(viewSettingsDiffForKey('fontSize', 22, 'scroll')).toEqual({ fontSize: 22 })
    expect(viewSettingsDiffForKey('lineHeight', 2.2, 'page')).toEqual({ lineHeight: 2.2 })
    expect(viewSettingsDiffForKey('pageColumns', 1, 'page')).toEqual({ pageColumns: 1 })
    expect(viewSettingsDiffForKey('columnGap', 10, 'page')).toEqual({ columnGap: 10 })
  })
})

describe('hasViewSettings', () => {
  it('is false for undefined and empty objects', () => {
    expect(hasViewSettings(undefined)).toBe(false)
    expect(hasViewSettings({})).toBe(false)
  })

  it('is true when any key is present', () => {
    expect(hasViewSettings({ fontSize: 20 })).toBe(true)
    expect(hasViewSettings({ scrollPageWidth: 900 })).toBe(true)
  })
})
