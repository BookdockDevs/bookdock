import { create } from 'zustand'

import type { FontListItem, FontPreferences } from '@bookdock/shared'

import { BASE_URL } from '@/api/client'
import i18n from '@/i18n/i18n'

import { FONT_OPTIONS, READER_GLYPH_FALLBACK } from './types'

export interface BuiltinFont {
  id: string
  name: string
  /** CSS family name as declared by the CDN stylesheet */
  family: string
  cssUrl: string
  license: { name: string; url: string }
  /** Latin-first entries pair with a CJK companion instead of covering CJK */
  latin?: boolean
}

export const BUILTIN_FONTS: BuiltinFont[] = [
  {
    id: 'lxgw-wenkai',
    name: '霞鹜文楷',
    family: `"LXGW WenKai", ${READER_GLYPH_FALLBACK}, serif`,
    cssUrl: 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css',
    license: { name: 'OFL-1.1', url: 'https://github.com/lxgw/LxgwWenKai/blob/main/LICENSE' },
  },
  {
    id: 'noto-serif-sc',
    name: '思源宋体',
    // Variable package: fontsource's static index.css ships weight 400 only,
    // so the reader's fontWeight would synthesize faux bold
    family: `"Noto Serif SC Variable", ${READER_GLYPH_FALLBACK}, serif`,
    cssUrl: 'https://cdn.jsdelivr.net/npm/@fontsource-variable/noto-serif-sc@5.3.0/index.css',
    license: { name: 'OFL-1.1', url: 'https://fonts.google.com/noto/specimen/Noto+Serif+SC/license' },
  },
  {
    id: 'noto-sans-sc',
    name: '思源黑体',
    family: `"Noto Sans SC Variable", ${READER_GLYPH_FALLBACK}, sans-serif`,
    cssUrl: 'https://cdn.jsdelivr.net/npm/@fontsource-variable/noto-sans-sc@5.3.0/index.css',
    license: { name: 'OFL-1.1', url: 'https://fonts.google.com/noto/specimen/Noto+Sans+SC/license' },
  },
  {
    id: 'literata',
    name: 'Literata',
    latin: true,
    family: `"Literata Variable", ${READER_GLYPH_FALLBACK}, serif`,
    cssUrl: 'https://cdn.jsdelivr.net/npm/@fontsource-variable/literata@5.3.0/index.css',
    license: { name: 'OFL-1.1', url: 'https://fonts.google.com/specimen/Literata/license' },
  },
]

export interface ResolvedFont {
  name: string
  /** Ready-to-use CSS font-family stack */
  stack: string
  latin: boolean
  builtin?: BuiltinFont
  uploaded?: FontListItem
}

/** Uploaded fonts get an alias family name so they can never be confused with
 *  a same-named system font */
export function uploadedFontAlias(id: string): string {
  return `bd-font-${id}`
}

export function resolveFont(
  id: string,
  uploaded: FontListItem[] = [],
  preferences: FontPreferences = {},
  fontOrder: string[] = [],
): ResolvedFont {
  const options = buildFontOptions(uploaded, useFontLoaderStore.getState(), preferences, fontOrder)
  const candidates = options.filter((option) => option.id === id)
  const selected = candidates.find((option) => option.source === 'system')
    ?? candidates.find((option) => option.source === 'builtin')
    ?? candidates[0]
  const option = selected?.enabled
    ? selected
    : options.find((item) => item.source === 'system' && item.enabled)
      ?? options.find((item) => item.enabled)
      ?? options[0]
  return {
    name: option.name,
    stack: option.stack,
    latin: option.latin,
    builtin: option.builtin,
    uploaded: option.uploaded,
  }
}

/** First family of a stack: the authoritative face, the rest is fallback */
export function stackFirstFamily(stack: string): string {
  return stack.split(',')[0].trim()
}

export interface DualFont {
  /** Primary display name (the CJK companion is fallback, not the title) */
  name: string
  /** Ready-to-use CSS font-family stack: primary face + CJK companion chain */
  stack: string
  /** Combined @font-face/@import snippet for every non-system face used */
  css: string
  primary: ResolvedFont
  companion: ResolvedFont
}

/** CJK companion resolution: only non-Latin enabled entries qualify, so a
 *  Latin primary never falls back to another Latin face for CJK glyphs */
export function resolveCjkFont(
  id: string,
  uploaded: FontListItem[] = [],
  preferences: FontPreferences = {},
  fontOrder: string[] = [],
): ResolvedFont {
  const options = buildFontOptions(uploaded, useFontLoaderStore.getState(), preferences, fontOrder)
  const cjk = options.filter((option) => !option.latin)
  const selected = cjk.find((option) => option.id === id && option.enabled)
    ?? cjk.find((option) => option.enabled)
    ?? options.find((option) => option.enabled)
    ?? options[0]
  return {
    name: selected.name,
    stack: selected.stack,
    latin: selected.latin,
    builtin: selected.builtin,
    uploaded: selected.uploaded,
  }
}

/** Primary + CJK companion composition. A CJK primary keeps its own stack
 *  untouched; when the primary face is Latin-first, it leads and the
 *  companion chain covers CJK glyphs */
export function resolveDualFont(
  primaryId: string,
  cjkId: string,
  uploaded: FontListItem[] = [],
  preferences: FontPreferences = {},
  fontOrder: string[] = [],
): DualFont {
  const primary = resolveFont(primaryId, uploaded, preferences, fontOrder)
  const companion = resolveCjkFont(cjkId, uploaded, preferences, fontOrder)
  if (!primary.latin || primary.stack === companion.stack) {
    return { name: primary.name, stack: primary.stack, css: fontCssFor(primary), primary, companion }
  }
  return {
    name: primary.name,
    stack: `${stackFirstFamily(primary.stack)}, ${companion.stack}`,
    css: [fontCssFor(primary), fontCssFor(companion)].filter(Boolean).join('\n'),
    primary,
    companion,
  }
}

const FONT_FORMAT_MAP: Record<FontListItem['format'], string> = {
  ttf: 'truetype',
  otf: 'opentype',
  woff: 'woff',
  woff2: 'woff2',
}

export function uploadedFontFileUrl(font: FontListItem): string {
  // Absolute URL: the foliate iframe is a blob document, so relative URLs
  // would not resolve back to this origin
  return `${window.location.origin}${BASE_URL}/fonts/${font.id}/file`
}

export function uploadedFaceCss(font: FontListItem): string {
  return `@font-face {
  font-family: "${uploadedFontAlias(font.id)}";
  src: url("${uploadedFontFileUrl(font)}") format("${FONT_FORMAT_MAP[font.format]}");
  font-display: swap;
}`
}

export function builtinImportCss(cssUrl: string): string {
  return `@import url("${cssUrl}");`
}

/** CSS snippet prepended to the iframe stylesheet for the resolved font;
 *  '' for system stacks which need no loading */
export function fontCssFor(resolved: ResolvedFont): string {
  if (resolved.builtin) return builtinImportCss(resolved.builtin.cssUrl)
  if (resolved.uploaded) return uploadedFaceCss(resolved.uploaded)
  return ''
}

const BUILTIN_LOADED_KEY = 'bd-builtin-fonts-loaded-v2'
const BUILTIN_SAMPLE_TEXT = '汉'

function readLoadedIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BUILTIN_LOADED_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

interface FontLoaderState {
  /** Builtin ids whose font faces completed a browser font load. Persisted so
   *  the pickers can reuse the result between sessions; the versioned key
   *  avoids treating the old stylesheet-only marker as a real font download. */
  loadedIds: string[]
  /** Builtin ids with an in-flight stylesheet */
  loadingIds: string[]
  /** Uploaded font ids proven to lack CJK glyphs (session-only: re-tested on
   *  every load via document.fonts.check, so no persistence to go stale) */
  latinIds: string[]
}

export const useFontLoaderStore = create<FontLoaderState>(() => ({
  loadedIds: readLoadedIds(),
  loadingIds: [],
  latinIds: [],
}))

export function isBuiltinFontLoaded(id: string): boolean {
  return useFontLoaderStore.getState().loadedIds.includes(id)
}

const injectedBuiltinIds = new Set<string>()

/** Idempotently inject the CDN stylesheet into the main document (settings
 *  panel / share card previews live outside the reader iframe). The persisted
 *  marker is written only after the browser font-loading API confirms that the
 *  font face itself is available; a stylesheet load alone is not enough. */
export function ensureBuiltinFontLoaded(id: string): void {
  const font = BUILTIN_FONTS.find((f) => f.id === id)
  if (!font) return
  if (injectedBuiltinIds.has(id)) {
    const linkExists = Array.from(document.head.querySelectorAll('link[data-bd-font]')).some((link) => link.getAttribute('data-bd-font') === id)
    if (linkExists) return
    injectedBuiltinIds.delete(id)
  }
  injectedBuiltinIds.add(id)
  if (!isBuiltinFontLoaded(id)) {
    useFontLoaderStore.setState((s) => ({ loadingIds: [...s.loadingIds, id] }))
  }
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = font.cssUrl
  link.dataset.bdFont = id
  link.onload = () => {
    if (typeof document.fonts?.load !== 'function') {
      useFontLoaderStore.setState((s) => {
        const loadedIds = s.loadedIds.includes(id) ? s.loadedIds : [...s.loadedIds, id]
        try {
          localStorage.setItem(BUILTIN_LOADED_KEY, JSON.stringify(loadedIds))
        } catch { /* private-mode quota failures are non-fatal */ }
        return { loadedIds, loadingIds: s.loadingIds.filter((v) => v !== id) }
      })
      return
    }

    const familyName = font.family.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
    void document.fonts.load(`400 16px "${familyName}"`, BUILTIN_SAMPLE_TEXT).then((faces) => {
      if (faces.length === 0) throw new Error(`font face unavailable: ${id}`)
      useFontLoaderStore.setState((s) => {
        const loadedIds = s.loadedIds.includes(id) ? s.loadedIds : [...s.loadedIds, id]
        try {
          localStorage.setItem(BUILTIN_LOADED_KEY, JSON.stringify(loadedIds))
        } catch { /* private-mode quota failures are non-fatal */ }
        return { loadedIds, loadingIds: s.loadingIds.filter((v) => v !== id) }
      })
    }).catch(() => {
      injectedBuiltinIds.delete(id)
      link.remove()
      useFontLoaderStore.setState((s) => ({ loadingIds: s.loadingIds.filter((v) => v !== id) }))
    })
  }
  link.onerror = () => {
    injectedBuiltinIds.delete(id)
    useFontLoaderStore.setState((s) => ({ loadingIds: s.loadingIds.filter((v) => v !== id) }))
  }
  document.head.appendChild(link)
}

export function ensureBuiltinFontsLoaded(): void {
  BUILTIN_FONTS.forEach((font) => ensureBuiltinFontLoaded(font.id))
}

const injectedUploadedIds = new Set<string>()

/** CJK name signals, ported from readest `CJK_FONTS_PATTENS` /
 *  `CJK_EXCLUDE_PATTENS` (services/constants.ts) + `isCJKStr` (utils/lang.ts):
 *  readest classifies custom fonts by family name, never by binary coverage.
 *  Kept verbatim including its known-loose ends (`Min` also matches Minion,
 *  `Yan` matches Yanone) — `canRenderCjk` corrects those after the face loads. */
const CJK_NAME_EXCLUDE_PATTERN = /AlBayan|STIX|Kailasa|ITCTT|Luminari|Myanmar/i
const CJK_NAME_PATTERN = /CJK|TC$|SC$|HK|JP|TW|Sim|Kai|Hei|Yan|Min|Khai|Yuan|Song|Ming|FZ|Huiwen|KingHwa|FangZheng|WenQuanYi|PingFang|Hiragino|Meiryo|Source\s?Han|Yu\s?Gothic|Yu\s?Mincho|Mincho|Nanum|Malgun|Gulim|Dotum|Batang|Gungsuh|OPPO sans|MiSans|Fallback/i
const CJK_CHAR_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

export function isCjkFontName(name: string): boolean {
  if (!name) return false
  if (CJK_NAME_EXCLUDE_PATTERN.test(name)) return false
  return CJK_NAME_PATTERN.test(name) || CJK_CHAR_PATTERN.test(name)
}

function setUploadedLatin(id: string, latin: boolean): void {
  useFontLoaderStore.setState((s) => ({
    latinIds: latin
      ? (s.latinIds.includes(id) ? s.latinIds : [...s.latinIds, id])
      : s.latinIds.filter((v) => v !== id),
  }))
}

/** Idempotently register an uploaded font in the main document via an inline
 *  @font-face rule (settings panel / share card previews live outside the
 *  reader iframe). Injected as CSS rather than the FontFace API on purpose:
 *  html-to-image only embeds fonts it finds in document.styleSheets, so a
 *  FontFace-registered family would bake fallback glyphs into exported card
 *  PNGs */
export async function ensureUploadedFontLoaded(font: FontListItem): Promise<void> {
  if (injectedUploadedIds.has(font.id)) return
  injectedUploadedIds.add(font.id)
  // Instant pre-classification by family name so the CJK row never flashes an
  // English-only upload; corrected below once the face itself can be tested
  if (!isCjkFontName(font.family)) setUploadedLatin(font.id, true)
  try {
    const style = document.createElement('style')
    style.dataset.bdUploadedFont = font.id
    style.textContent = uploadedFaceCss(font)
    document.head.appendChild(style)
    if (typeof document.fonts?.load === 'function') {
      await document.fonts.load(`16px "${uploadedFontAlias(font.id)}"`)
      setUploadedLatin(font.id, !canRenderCjk(uploadedFontAlias(font.id)))
    }
  } catch (err) {
    // drop the marker so a later attempt can retry
    injectedUploadedIds.delete(font.id)
    console.warn(`[fonts] failed to load uploaded font ${font.id}:`, err)
  }
}

/** Ground truth for CJK coverage, answered by the browser instead of a binary
 *  sfnt parse: the face is already loaded for preview, so this costs no extra
 *  bytes. Any doubt keeps the current CJK treatment — the fallback chain
 *  stays readable. */
export function canRenderCjk(familyAlias: string): boolean {
  try {
    if (typeof document.fonts?.check !== 'function') return true
    return document.fonts.check(`16px "${familyAlias}"`, BUILTIN_SAMPLE_TEXT)
  } catch {
    return true
  }
}

export type FontOptionSource = 'uploaded' | 'builtin' | 'system'
/** idle = builtin never fetched (download icon); loading = in flight
 *  (spinner); ready = nothing to show (uploaded/system are always ready) */
export type FontOptionStatus = 'idle' | 'loading' | 'ready'

export interface FontOption {
  id: string
  name: string
  stack: string
  source: FontOptionSource
  status: FontOptionStatus
  enabled: boolean
  /** Latin-first entries pair with a CJK companion instead of covering CJK */
  latin: boolean
  builtin?: BuiltinFont
  uploaded?: FontListItem
}

function fontPresentation(id: string, fallbackName: string, preferences: FontPreferences) {
  const preference = preferences[id]
  const i18nKey = `reader.fontNames.${id}`
  const localized = i18n.isInitialized && i18n.exists(i18nKey) ? i18n.t(i18nKey) : fallbackName
  return {
    name: preference?.displayName?.trim() || localized,
    enabled: preference?.enabled !== false,
  }
}

export const DEFAULT_FONT_ORDER: string[] = [
  'sans-serif',
  'serif',
  'noto-serif-sc',
  'noto-sans-sc',
  'lxgw-wenkai',
  'kaiti',
  'fangsong',
  'literata',
  'serif-en',
  'sans-en',
]

/** Single ordered list shared by the settings page and both font pickers.
 *  The loader snapshot is an explicit parameter so callers can memoize on it
 *  (default: current store state). */
export function buildFontOptions(
  uploaded: FontListItem[] = [],
  loader: Pick<FontLoaderState, 'loadedIds' | 'loadingIds'> & { latinIds?: string[] } = useFontLoaderStore.getState(),
  preferences: FontPreferences = {},
  fontOrder: string[] = [],
): FontOption[] {
  const { loadedIds, loadingIds } = loader
  const latinIds = loader.latinIds ?? []
  const options: FontOption[] = [
    ...FONT_OPTIONS.map((f) => ({
      id: f.id,
      ...fontPresentation(f.id, f.name, preferences),
      stack: f.value,
      source: 'system' as const,
      status: 'ready' as const,
      latin: f.latin ?? false,
    })),
    ...BUILTIN_FONTS.map((f) => ({
      id: f.id,
      ...fontPresentation(f.id, f.name, preferences),
      stack: f.family,
      source: 'builtin' as const,
      status: loadingIds.includes(f.id)
        ? ('loading' as const)
        : loadedIds.includes(f.id)
          ? ('ready' as const)
          : ('idle' as const),
      latin: f.latin ?? false,
      builtin: f,
    })),
    ...uploaded.map((f) => ({
      id: f.id,
      ...fontPresentation(f.id, f.family, preferences),
      stack: `"${uploadedFontAlias(f.id)}", ${READER_GLYPH_FALLBACK}, serif`,
      source: 'uploaded' as const,
      status: 'ready' as const,
      latin: latinIds.includes(f.id),
      uploaded: f,
    })),
  ]

  const activeOrder = fontOrder.length > 0 ? fontOrder : DEFAULT_FONT_ORDER
  const positions = new Map(activeOrder.map((id, index) => [id, index]))
  return [...options].sort((left, right) => {
    const leftPosition = positions.get(left.id)
    const rightPosition = positions.get(right.id)
    if (leftPosition === undefined && rightPosition === undefined) return 0
    if (leftPosition === undefined) return 1
    if (rightPosition === undefined) return -1
    return leftPosition - rightPosition
  })
}
