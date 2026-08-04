import type { ViewSettings } from '@bookdock/shared'
import type { ReadingMode } from '../types'

// First-batch settings that support per-book overrides (F1 layering). Later
// increments extend this list; the merge/diff machinery is key-agnostic.
export type PerBookSettingKey = 'fontSize' | 'lineHeight' | 'pageWidth' | 'horizontalPadding' | 'verticalPadding' | 'pageColumns' | 'columnGap'

export const PER_BOOK_SETTING_KEYS: readonly PerBookSettingKey[] = [
  'fontSize',
  'lineHeight',
  'pageWidth',
  'horizontalPadding',
  'verticalPadding',
  'pageColumns',
  'columnGap',
]

// Flat effective values after merging global (store) with per-book overrides.
export interface EffectiveViewSettings {
  fontSize: number
  lineHeight: number
  pageWidth: number
  horizontalPadding: number
  verticalPadding: number
  pageColumns: number
  columnGap: number
}

export interface GlobalViewSettings {
  fontSize: number
  lineHeight: number
  pageWidth: number
  horizontalPadding: number
  verticalPadding: number
  pageColumns: number
  columnGap: number
  scrollPageWidth: number
  scrollHorizontalPadding: number
  scrollVerticalPadding: number
  pagePageWidth: number
  pageHorizontalPadding: number
  pageVerticalPadding: number
  readingMode: ReadingMode
}

// Dual-backing keys are merged per mode (the diff's flat value reflects the
// mode it was saved under, which may differ from the current one) and the
// flat effective value is derived from the current mode's backing.
export function mergeViewSettings(global: GlobalViewSettings, perBook: ViewSettings | undefined): EffectiveViewSettings {
  if (!perBook) {
    return {
      fontSize: global.fontSize,
      lineHeight: global.lineHeight,
      pageWidth: global.pageWidth,
      horizontalPadding: global.horizontalPadding,
      verticalPadding: global.verticalPadding,
      pageColumns: global.pageColumns,
      columnGap: global.columnGap,
    }
  }
  const scrollPageWidth = perBook.scrollPageWidth ?? global.scrollPageWidth
  const scrollHorizontalPadding = perBook.scrollHorizontalPadding ?? global.scrollHorizontalPadding
  const scrollVerticalPadding = perBook.scrollVerticalPadding ?? global.scrollVerticalPadding
  const pagePageWidth = perBook.pagePageWidth ?? global.pagePageWidth
  const pageHorizontalPadding = perBook.pageHorizontalPadding ?? global.pageHorizontalPadding
  const pageVerticalPadding = perBook.pageVerticalPadding ?? global.pageVerticalPadding
  return {
    fontSize: perBook.fontSize ?? global.fontSize,
    lineHeight: perBook.lineHeight ?? global.lineHeight,
    pageWidth: global.readingMode === 'page' ? pagePageWidth : scrollPageWidth,
    horizontalPadding: global.readingMode === 'page' ? pageHorizontalPadding : scrollHorizontalPadding,
    verticalPadding: global.readingMode === 'page' ? pageVerticalPadding : scrollVerticalPadding,
    pageColumns: perBook.pageColumns ?? global.pageColumns,
    columnGap: perBook.columnGap ?? global.columnGap,
  }
}

// The diff patch to send for a single setting change. Mirrors the global
// store setters: dual-backing keys carry both the flat value and the backing
// for the current mode.
export function viewSettingsDiffForKey(key: PerBookSettingKey, value: number, readingMode: ReadingMode): ViewSettings {
  switch (key) {
    case 'fontSize':
      return { fontSize: value }
    case 'lineHeight':
      return { lineHeight: value }
    case 'pageWidth':
      return readingMode === 'page'
        ? { pageWidth: value, pagePageWidth: value }
        : { pageWidth: value, scrollPageWidth: value }
    case 'horizontalPadding':
      return readingMode === 'page'
        ? { horizontalPadding: value, pageHorizontalPadding: value }
        : { horizontalPadding: value, scrollHorizontalPadding: value }
    case 'verticalPadding':
      return readingMode === 'page'
        ? { verticalPadding: value, pageVerticalPadding: value }
        : { verticalPadding: value, scrollVerticalPadding: value }
    case 'pageColumns':
      return { pageColumns: value }
    case 'columnGap':
      return { columnGap: value }
  }
}

export function hasViewSettings(viewSettings: ViewSettings | undefined): boolean {
  return !!viewSettings && Object.keys(viewSettings).length > 0
}
