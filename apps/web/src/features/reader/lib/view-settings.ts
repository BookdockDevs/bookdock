import type { MarginalField, ReaderBookDisplaySettings, ReaderBookFontSettings, ReaderBookLayoutSettings, ReaderBookThemeSettings } from '@bookdock/shared'

import type { ContinuousScroll, ChineseConversion, IdeaDisplayMode, ReadingMode } from '../types'

// Per-book settings are four independent groups; a group present in
// book.readerSettings means it is enabled for this book and its fields are the
// book's explicit values. Later increments extend the key lists; the merge
// machinery is key-agnostic.

export type BookSettingsGroup = 'font' | 'layout' | 'display'

export type FontSettingKey = keyof ReaderBookFontSettings
export type LayoutSettingKey = keyof ReaderBookLayoutSettings
export type DisplaySettingKey = keyof ReaderBookDisplaySettings

// Flat effective values after merging the global chain with the per-book
// groups. Everything the reader consumes for fonts/layout/display rides here.
export interface EffectiveReadingSettings {
  fontFamily: string
  cjkFontFamily: string
  fontSize: number
  fontWeight: number
  overrideBookFont: boolean

  lineHeight: number
  paragraphSpacing: number
  letterSpacing: number
  indent: number
  textAlignJustify: boolean
  chapterTitleAlign: 'start' | 'center' | 'end'
  chapterTitleSize: number
  chapterTitleTopSpacing: number
  chapterTitleBottomSpacing: number
  pageWidth: number
  horizontalPadding: number
  verticalPadding: number
  overrideBookLayout: boolean

  readingMode: ReadingMode
  pageColumns: number
  columnGap: number
  continuousScroll: ContinuousScroll
  pageAnimation: boolean
  chineseConversion: ChineseConversion
  cleanReading: boolean
  showHeader: boolean
  headerLeft: MarginalField
  headerCenter: MarginalField
  headerRight: MarginalField
  showFooter: boolean
  footerLeft: MarginalField
  footerCenter: MarginalField
  footerRight: MarginalField
  marginalFontSize: number
  showFriendIdeas: boolean
  ideaDisplayMode: IdeaDisplayMode
}

/** The global chain's values, including every mode-specific backing. */
export type GlobalReadingSettings = Omit<EffectiveReadingSettings, 'pageWidth' | 'horizontalPadding' | 'verticalPadding'> & {
  scrollPageWidth: number
  scrollHorizontalPadding: number
  scrollVerticalPadding: number
  pagePageWidth: number
  pageHorizontalPadding: number
  pageVerticalPadding: number
}

export interface BookSettingGroups {
  font?: ReaderBookFontSettings
  layout?: ReaderBookLayoutSettings
  display?: ReaderBookDisplaySettings
  theme?: ReaderBookThemeSettings
}

// Dual-backing keys are merged per mode (the group's flat value reflects the
// mode it was saved under, which may differ from the book's effective one) and
// the flat effective value is derived from the effective mode's backing.
export function mergeBookSettings(global: GlobalReadingSettings, groups: BookSettingGroups | undefined): EffectiveReadingSettings {
  const font = groups?.font ?? {}
  const layout = groups?.layout ?? {}
  const display = groups?.display ?? {}
  const mode = display.readingMode ?? global.readingMode
  const pageWidth = mode === 'page'
    ? layout.pagePageWidth ?? global.pagePageWidth
    : layout.scrollPageWidth ?? global.scrollPageWidth
  const horizontalPadding = mode === 'page'
    ? layout.pageHorizontalPadding ?? global.pageHorizontalPadding
    : layout.scrollHorizontalPadding ?? global.scrollHorizontalPadding
  const verticalPadding = mode === 'page'
    ? layout.pageVerticalPadding ?? global.pageVerticalPadding
    : layout.scrollVerticalPadding ?? global.scrollVerticalPadding
  return {
    fontFamily: font.fontFamily ?? global.fontFamily,
    cjkFontFamily: font.cjkFontFamily ?? global.cjkFontFamily,
    fontSize: font.fontSize ?? global.fontSize,
    fontWeight: font.fontWeight ?? global.fontWeight,
    overrideBookFont: font.overrideBookFont ?? global.overrideBookFont,

    lineHeight: layout.lineHeight ?? global.lineHeight,
    paragraphSpacing: layout.paragraphSpacing ?? global.paragraphSpacing,
    letterSpacing: layout.letterSpacing ?? global.letterSpacing,
    indent: layout.indent ?? global.indent,
    textAlignJustify: layout.textAlignJustify ?? global.textAlignJustify,
    chapterTitleAlign: layout.chapterTitleAlign ?? global.chapterTitleAlign,
    chapterTitleSize: layout.chapterTitleSize ?? global.chapterTitleSize,
    chapterTitleTopSpacing: layout.chapterTitleTopSpacing ?? global.chapterTitleTopSpacing,
    chapterTitleBottomSpacing: layout.chapterTitleBottomSpacing ?? global.chapterTitleBottomSpacing,
    pageWidth,
    horizontalPadding,
    verticalPadding,
    overrideBookLayout: layout.overrideBookLayout ?? global.overrideBookLayout,

    readingMode: mode,
    pageColumns: display.pageColumns ?? global.pageColumns,
    columnGap: display.columnGap ?? global.columnGap,
    continuousScroll: display.continuousScroll ?? global.continuousScroll,
    pageAnimation: display.pageAnimation ?? global.pageAnimation,
    chineseConversion: display.chineseConversion ?? global.chineseConversion,
    cleanReading: display.cleanReading ?? global.cleanReading,
    showHeader: display.showHeader ?? global.showHeader,
    headerLeft: display.headerLeft ?? global.headerLeft,
    headerCenter: display.headerCenter ?? global.headerCenter,
    headerRight: display.headerRight ?? global.headerRight,
    showFooter: display.showFooter ?? global.showFooter,
    footerLeft: display.footerLeft ?? global.footerLeft,
    footerCenter: display.footerCenter ?? global.footerCenter,
    footerRight: display.footerRight ?? global.footerRight,
    marginalFontSize: display.marginalFontSize ?? global.marginalFontSize,
    showFriendIdeas: display.showFriendIdeas ?? global.showFriendIdeas,
    ideaDisplayMode: display.ideaDisplayMode ?? global.ideaDisplayMode,
  }
}

/**
 * The group patch one setting change produces. Mirrors the global store
 * setters: dual-backing keys carry both the flat value and the backing for the
 * current mode; the flat value may reflect a different mode later, so
 * resolution always reads the backing.
 */
export function settingPatchForKey(
  key: string,
  value: number | boolean | string,
  readingMode: ReadingMode,
): { group: BookSettingsGroup; patch: Record<string, unknown> } {
  if (key === 'fontSize' || key === 'fontWeight' || key === 'overrideBookFont'
    || key === 'fontFamily' || key === 'cjkFontFamily') {
    return { group: 'font', patch: { [key]: value } }
  }
  if (key === 'pageWidth' || key === 'horizontalPadding' || key === 'verticalPadding') {
    const backing = readingMode === 'page' ? `page${key.charAt(0).toUpperCase()}${key.slice(1)}` : `scroll${key.charAt(0).toUpperCase()}${key.slice(1)}`
    return { group: 'layout', patch: { [key]: value, [backing]: value } }
  }
  if (key === 'readingMode' || key === 'pageColumns' || key === 'columnGap' || key === 'continuousScroll' || key === 'pageAnimation'
    || key === 'chineseConversion' || key === 'cleanReading' || key === 'showHeader' || key === 'headerLeft' || key === 'headerCenter'
    || key === 'headerRight' || key === 'showFooter' || key === 'footerLeft' || key === 'footerCenter' || key === 'footerRight'
    || key === 'marginalFontSize' || key === 'showFriendIdeas' || key === 'ideaDisplayMode') {
    return { group: 'display', patch: { [key]: value } }
  }
  return { group: 'layout', patch: { [key]: value } }
}

/** Explicit per-book group fields flattened for preset-creation overlays. */
export function flattenGroupFields(groups: BookSettingGroups | undefined): Record<string, unknown> {
  if (!groups) return {}
  return { ...groups.font, ...groups.layout, ...groups.display }
}

export function hasBookGroups(groups: BookSettingGroups | undefined): boolean {
  return !!groups && (groups.font != null || groups.layout != null || groups.display != null)
}
