import { create } from 'zustand'

import { BUILTIN_FONTS as SHARED_BUILTIN_FONTS } from '@bookdock/shared'
import type { BuiltinFont as SharedBuiltinFont, FontListItem, FontPreferences } from '@bookdock/shared'

import { BASE_URL } from '@/api/client'
import type { DeviceFontMeta } from '@/features/device-fonts/db'
import { acquireDeviceFontUrl, releaseDeviceFontUrl } from '@/features/device-fonts/urls'
import { deviceFontCatalogSnapshot } from '@/features/device-fonts/store'
import i18n from '@/i18n/i18n'

import { FONT_OPTIONS, READER_GLYPH_FALLBACK } from './types'

export interface BuiltinFont extends SharedBuiltinFont {
  /** CSS family stack: the upstream face + CJK glyph fallback + generic */
  family: string
  /** Absolute URL of the server-proxied stylesheet (the foliate iframe is a
   *  blob document, so relative URLs would not resolve back to this origin) */
  cssUrl: string
}

/** The server proxies the pinned upstream stylesheet; the versioned address
 *  changes content only when the registry pins a new package version. */
export function builtinFontCssUrl(font: Pick<SharedBuiltinFont, 'id' | 'version'>): string {
  return `${window.location.origin}${BASE_URL}/fonts/builtin/${font.id}/${font.version}/css`
}

export const BUILTIN_FONTS: BuiltinFont[] = SHARED_BUILTIN_FONTS.map((font) => ({
  ...font,
  family: `"${font.familyName}", ${READER_GLYPH_FALLBACK}, ${font.generic}`,
  cssUrl: builtinFontCssUrl(font),
}))

export interface ResolvedFont {
  name: string
  /** Ready-to-use CSS font-family stack */
  stack: string
  latin: boolean
  builtin?: BuiltinFont
  uploaded?: FontListItem
  device?: DeviceFontMeta
}

/** Device-local catalog passed explicitly so callers can memoize on it.
 *  `order` is the device-local display order of ALL font ids (system, builtin,
 *  uploaded and device alike — the unified-shelf rule); it never leaves the
 *  device. Empty falls back to the synced `fontOrder`. */
export interface DeviceFontCatalog {
  fonts: DeviceFontMeta[]
  preferences: FontPreferences
  order: string[]
}

/** Uploaded and device fonts get an alias family name so they can never be
 *  confused with a same-named system font. Device ids carry a `device-`
 *  prefix of different length than server nanoid ids, so the alias strings
 *  cannot collide across sources. */
export function uploadedFontAlias(id: string): string {
  return `bd-font-${id}`
}

export function resolveFont(
  id: string,
  uploaded: FontListItem[] = [],
  preferences: FontPreferences = {},
  fontOrder: string[] = [],
  device: DeviceFontCatalog = deviceFontCatalogSnapshot(),
  builtinDownloadsAllowed = true,
): ResolvedFont {
  const options = buildFontOptions(uploaded, useFontLoaderStore.getState(), preferences, fontOrder, device, builtinDownloadsAllowed)
  const candidates = options.filter((option) => option.id === id)
  const selected = candidates.find((option) => option.source === 'system')
    ?? candidates.find((option) => option.source === 'builtin')
    ?? candidates.find((option) => option.source === 'device')
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
    device: option.device,
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
  device: DeviceFontCatalog = deviceFontCatalogSnapshot(),
  builtinDownloadsAllowed = true,
): ResolvedFont {
  const options = buildFontOptions(uploaded, useFontLoaderStore.getState(), preferences, fontOrder, device, builtinDownloadsAllowed)
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
    device: selected.device,
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
  device: DeviceFontCatalog = deviceFontCatalogSnapshot(),
  deviceUrls: Record<string, string> = {},
  builtinDownloadsAllowed = true,
): DualFont {
  const primary = resolveFont(primaryId, uploaded, preferences, fontOrder, device, builtinDownloadsAllowed)
  const companion = resolveCjkFont(cjkId, uploaded, preferences, fontOrder, device, builtinDownloadsAllowed)
  if (!primary.latin || primary.stack === companion.stack) {
    return { name: primary.name, stack: primary.stack, css: fontCssFor(primary, deviceUrls), primary, companion }
  }
  return {
    name: primary.name,
    stack: `${stackFirstFamily(primary.stack)}, ${companion.stack}`,
    css: [fontCssFor(primary, deviceUrls), fontCssFor(companion, deviceUrls)].filter(Boolean).join('\n'),
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

/** Device fonts resolve to a pooled blob URL by the caller; '' when the URL
 *  has not been acquired yet (the fallback stack stays readable meanwhile) */
export function deviceFaceCss(font: DeviceFontMeta, url: string): string {
  return `@font-face {
  font-family: "${uploadedFontAlias(font.id)}";
  src: url("${url}") format("${FONT_FORMAT_MAP[font.format]}");
  font-display: swap;
}`
}

export function builtinImportCss(cssUrl: string): string {
  return `@import url("${cssUrl}");`
}

/** CSS snippet prepended to the iframe stylesheet for the resolved font;
 *  '' for system stacks which need no loading, and for device fonts whose
 *  pooled blob URL is not (yet) held by the caller */
export function fontCssFor(resolved: ResolvedFont, deviceUrls: Record<string, string> = {}): string {
  if (resolved.builtin) return builtinImportCss(resolved.builtin.cssUrl)
  if (resolved.uploaded) return uploadedFaceCss(resolved.uploaded)
  if (resolved.device) {
    const url = deviceUrls[resolved.device.id]
    return url ? deviceFaceCss(resolved.device, url) : ''
  }
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

/** Covers the whole chain (stylesheet fetch + font-face confirmation): a
 *  stalled CSS request never fires onload, so waiting on link events alone
 *  would spin forever. */
const BUILTIN_FONT_TIMEOUT_MS = 10_000

/** Idempotently inject the proxied stylesheet into the main document (settings
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

  // A timed-out attempt removes the link, so late callbacks from it are
  // dropped via isConnected and cannot clobber a fresh retry's state.
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const markLoaded = () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    link.dataset.loaded = 'true'
    useFontLoaderStore.setState((s) => {
      const loadedIds = s.loadedIds.includes(id) ? s.loadedIds : [...s.loadedIds, id]
      try {
        localStorage.setItem(BUILTIN_LOADED_KEY, JSON.stringify(loadedIds))
      } catch { /* private-mode quota failures are non-fatal */ }
      return { loadedIds, loadingIds: s.loadingIds.filter((v) => v !== id) }
    })
  }
  const fail = () => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    // Unblock waitForCardFont listeners before the element goes away
    link.dispatchEvent(new Event('error'))
    link.dataset.failed = 'true'
    injectedBuiltinIds.delete(id)
    link.remove()
    useFontLoaderStore.setState((s) => ({ loadingIds: s.loadingIds.filter((v) => v !== id) }))
  }
  link.onload = () => {
    if (!link.isConnected) return
    if (typeof document.fonts?.load !== 'function') {
      markLoaded()
      return
    }

    const familyName = font.family.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
    void document.fonts.load(`400 16px "${familyName}"`, BUILTIN_SAMPLE_TEXT).then((faces) => {
      if (!link.isConnected) return
      if (faces.length === 0) throw new Error(`font face unavailable: ${id}`)
      markLoaded()
    }).catch(() => {
      if (!link.isConnected) return
      fail()
    })
  }
  link.onerror = () => {
    if (!link.isConnected) return
    fail()
  }
  timer = setTimeout(() => {
    if (!link.isConnected) return
    fail()
  }, BUILTIN_FONT_TIMEOUT_MS)
  document.head.appendChild(link)
}

/** Wait until the selected face is available before html-to-image snapshots
 *  the card. `document.fonts.ready` alone can resolve before a newly inserted
 *  stylesheet has declared its @font-face rules. A device face acquired here
 *  is released again — card previews hold their own reference for the dialog
 *  lifetime. */
export async function waitForCardFont(font: ResolvedFont, text: string, weights = [400, 500, 600, 700]): Promise<boolean> {
  const deviceHeld = font.device ? await ensureDeviceFontFace(font.device) : undefined
  try {
    if (font.device && !deviceHeld) throw new Error('card font file unavailable')
    if (font.builtin) {
      ensureBuiltinFontLoaded(font.builtin.id)
      const link = Array.from(document.head.querySelectorAll<HTMLLinkElement>('link[data-bd-font]'))
        .find((item) => item.dataset.bdFont === font.builtin?.id)
      if (link && link.dataset.loaded !== 'true') {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            link.removeEventListener('load', loaded)
            link.removeEventListener('error', failed)
          }
          const loaded = () => { cleanup(); resolve() }
          const failed = () => { cleanup(); reject(new Error('card font stylesheet unavailable')) }
          link.addEventListener('load', loaded, { once: true })
          link.addEventListener('error', failed, { once: true })
          if (link.dataset.loaded === 'true') loaded()
          else if (link.dataset.failed === 'true') failed()
        })
      }
    }
    if (font.uploaded) await ensureUploadedFontLoaded(font.uploaded)
    const family = font.stack.split(',')[0].trim()
    if (typeof document.fonts?.load !== 'function') return false
    const faces = await Promise.all(weights.map((weight) => document.fonts.load(`${weight} 16px ${family}`, text || '汉')))
    return faces.every((loaded) => loaded.length > 0)
  } finally {
    if (font.device) releaseDeviceFontFace(font.device.id)
  }
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
  useFontLoaderStore.setState((s) => {
    const has = s.latinIds.includes(id)
    // Unchanged classification keeps the same state reference: a new array on
    // every call would re-render subscribers into a load→classify→re-load loop
    if (latin === has) return s
    return { latinIds: latin ? [...s.latinIds, id] : s.latinIds.filter((v) => v !== id) }
  })
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

interface DeviceFaceEntry {
  style: HTMLStyleElement | null
  refs: number
  ready: Promise<string | null>
  /** Pooled URL once this entry's acquire completed; null while pending */
  url: string | null
  /** Whether this entry already gave its own pooled reference back */
  poolReleased: boolean
}

const injectedDeviceEntries = new Map<string, DeviceFaceEntry>()
const classifiedDeviceIds = new Set<string>()

function releaseEntryPool(entry: DeviceFaceEntry, id: string): void {
  if (entry.url && !entry.poolReleased) {
    entry.poolReleased = true
    releaseDeviceFontUrl(id)
  }
}

function dropEntry(id: string, entry: DeviceFaceEntry): void {
  // Identity check: a cancelled entry must never remove a newer entry that a
  // re-ensure registered under the same font id
  if (injectedDeviceEntries.get(id) === entry) injectedDeviceEntries.delete(id)
}

async function loadDeviceFace(font: DeviceFontMeta, entry: DeviceFaceEntry): Promise<string | null> {
  // Storage read failures resolve to null like a missing file: consumers fall
  // back and notify instead of surfacing an unhandled rejection
  const url = await acquireDeviceFontUrl(font.id).catch(() => null)
  entry.url = url
  if (!url) {
    dropEntry(font.id, entry)
    return null
  }
  // Released while the load was in flight: give this entry's pooled reference
  // back and leave nothing mounted, so a cancelled surface cannot leak the URL
  if (entry.refs <= 0) {
    releaseEntryPool(entry, font.id)
    dropEntry(font.id, entry)
    return null
  }
  const style = document.createElement('style')
  style.dataset.bdDeviceFont = font.id
  style.textContent = deviceFaceCss(font, url)
  document.head.appendChild(style)
  entry.style = style
  if (typeof document.fonts?.load === 'function') {
    try {
      const faces = await document.fonts.load(`16px "${uploadedFontAlias(font.id)}"`)
      if (faces.length && injectedDeviceEntries.get(font.id) === entry) {
        classifiedDeviceIds.add(font.id)
        setUploadedLatin(font.id, !canRenderCjk(uploadedFontAlias(font.id)))
      }
    } catch (err) {
      console.warn(`[fonts] failed to load device font ${font.id}:`, err)
    }
  }
  return url
}

/** Register a device font in the main document for preview surfaces (settings
 *  list, reader settings chips, share card). Unlike uploaded fonts the backing
 *  blob URL is pooled, so every caller holds one reference and must pair its
 *  ensure with a releaseDeviceFontFace — the lease is registered synchronously,
 *  so releasing before the async load finishes still cancels cleanly, and a
 *  release→re-ensure race creates an independent lease instead of corrupting
 *  the cancelled one. The promise resolves to null when the file no longer
 *  resolves from device storage (or the lease was cancelled). */
export function ensureDeviceFontFace(font: DeviceFontMeta): Promise<string | null> {
  const existing = injectedDeviceEntries.get(font.id)
  if (existing) {
    existing.refs += 1
    return existing.ready
  }
  if (!classifiedDeviceIds.has(font.id) && !isCjkFontName(font.family)) setUploadedLatin(font.id, true)
  const entry: DeviceFaceEntry = { style: null, refs: 1, ready: null!, url: null, poolReleased: false }
  entry.ready = loadDeviceFace(font, entry)
  injectedDeviceEntries.set(font.id, entry)
  return entry.ready
}

export function releaseDeviceFontFace(id: string): void {
  const entry = injectedDeviceEntries.get(id)
  if (!entry) return
  entry.refs -= 1
  if (entry.refs > 0) return
  injectedDeviceEntries.delete(id)
  entry.style?.remove()
  // The pool reference is only released when this entry actually holds one:
  // a release racing a pending acquire leaves the give-back to loadDeviceFace,
  // which knows whether the acquire completed and whose reference it is.
  releaseEntryPool(entry, id)
}

export type FontOptionSource = 'uploaded' | 'builtin' | 'system' | 'device'
/** idle = builtin never fetched (download icon); loading = in flight
 *  (spinner); ready = nothing to show (uploaded/device/system are always ready) */
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
  device?: DeviceFontMeta
}

/** Display name for locally extracted localized names: prefer the record
 *  matching the current UI language, then any other language. The manual
 *  rename always wins upstream of this helper. */
const FONT_NAME_LANGUAGE_PREFERENCE: Record<string, number[]> = {
  'zh-CN': [0x804, 0x404, 0xc04, 0x1404, 0x411, 0x412],
  'zh-TW': [0x404, 0xc04, 0x1404, 0x804, 0x411, 0x412],
  'zh-HK': [0xc04, 0x1404, 0x404, 0x804, 0x411, 0x412],
  en: [0x409],
}

export function localizedFontName(localNames?: Record<string, string> | null): string | null {
  if (!localNames) return null
  const preferred = FONT_NAME_LANGUAGE_PREFERENCE[i18n.language] ?? []
  for (const langId of preferred) {
    const value = localNames[langId.toString(16)]
    if (value) return value
  }
  // No record for the UI language: any other language's name, then family
  for (const value of Object.values(localNames)) {
    if (value) return value
  }
  return null
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
 *  (default: current store state). Device fonts trail the synced list in
 *  their own device-local order — they never enter the synced fontOrder. */
/** When member resource uploads are disabled (and the viewer is not the
 *  owner), builtin fonts that were never downloaded stay invisible: showing
 *  them would let the viewer trigger an upstream fetch the instance policy
 *  forbids. Already-loaded entries remain usable. */
export function buildFontOptions(
  uploaded: FontListItem[] = [],
  loader: Pick<FontLoaderState, 'loadedIds' | 'loadingIds'> & { latinIds?: string[] } = useFontLoaderStore.getState(),
  preferences: FontPreferences = {},
  fontOrder: string[] = [],
  device: DeviceFontCatalog = deviceFontCatalogSnapshot(),
  builtinDownloadsAllowed = true,
): FontOption[] {
  const { loadedIds, loadingIds } = loader
  const latinIds = loader.latinIds ?? []
  const visibleBuiltins = builtinDownloadsAllowed ? BUILTIN_FONTS : BUILTIN_FONTS.filter((f) => loadedIds.includes(f.id))
  const deviceOptions = [...device.fonts].map((f) => ({
      id: f.id,
      ...fontPresentation(f.id, localizedFontName(f.localNames) ?? f.family, device.preferences),
      stack: `"${uploadedFontAlias(f.id)}", ${READER_GLYPH_FALLBACK}, serif`,
      source: 'device' as const,
      status: 'ready' as const,
      latin: latinIds.includes(f.id),
      device: f,
    }))
  const options: FontOption[] = [
    ...FONT_OPTIONS.map((f) => ({
      id: f.id,
      ...fontPresentation(f.id, f.name, preferences),
      stack: f.value,
      source: 'system' as const,
      status: 'ready' as const,
      latin: f.latin ?? false,
    })),
    ...visibleBuiltins.map((f) => ({
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
      ...fontPresentation(f.id, localizedFontName(f.localNames) ?? f.family, preferences),
      stack: `"${uploadedFontAlias(f.id)}", ${READER_GLYPH_FALLBACK}, serif`,
      source: 'uploaded' as const,
      status: 'ready' as const,
      latin: latinIds.includes(f.id),
      uploaded: f,
    })),
    ...deviceOptions,
  ]

  // One merged display order for every source: the device-local merged order
  // wins when present (a drag interleaves device fonts freely), otherwise the
  // synced fontOrder applies and device fonts trail. Ids missing from the
  // base order sort after it: device ones by catalog sequence, the rest by
  // the synced fontOrder.
  const base = device.order.length > 0
    ? device.order
    : (fontOrder.length > 0 ? fontOrder : DEFAULT_FONT_ORDER)
  const positions = new Map(base.map((id, index) => [id, index]))
  const tail = base.length
  // Ids the base order does not know (fresh imports, newly uploaded fonts)
  // trail it in natural catalog sequence: system, builtin, uploaded, device.
  const sourceRank = (option: FontOption): number =>
    option.source === 'system' ? 0 : option.source === 'builtin' ? 1 : option.source === 'uploaded' ? 2 : 3
  const sortKey = (option: FontOption): number => {
    const position = positions.get(option.id)
    if (position !== undefined) return position
    return tail + sourceRank(option) * 1000
  }
  return [...options].sort((left, right) => sortKey(left) - sortKey(right))
}
