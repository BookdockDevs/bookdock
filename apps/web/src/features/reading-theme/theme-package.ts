import JSZip from 'jszip'

import { highlightRuleSchema } from '@bookdock/shared'

import { fetchThemeAssetFromServer, uploadThemeAssetToServer } from '@/api/hooks/useReadingThemes'
import { isHexColor, sanitizeHighlightRulesField, sanitizeThemeAssetId, sanitizeThemeAssetRefs, type ThemeAssetRef } from '@/lib/reading-theme'
import { collectCssAssetRefs, remapCssAssetRefs, validateContentCss, validateUiCss } from '@/lib/theme-css-guard'
import { timestampSuffix } from '@/lib/download'

import { THEME_ASSET_LIMITS, ThemeAssetStore, ThemeAssetError, prepareThemeAsset, type PreparedThemeAsset, type ThemeAssetMime } from './assets'
import { highlightRuleIssue } from './draft'
import {
  portableCssOf,
  portablePaletteOf,
  portableRuleOf,
  portableThemeOf,
  type PortableCssCard,
  type PortableHighlightRule,
  type PortablePalette,
  type PortableTheme,
  type PortableThemeBundle,
  type ReadingThemeLibrary,
  type SavedReadingTheme,
  type ThemeCssCard,
  type ThemeHighlightCard,
  type ThemePalette,
} from './theme-library'

export const THEME_PACKAGE_FORMAT = 'bookdock-theme-package'
export const THEME_PACKAGE_VERSION = 1

// Only actual risks are capped: a package is read into memory whole, and a
// hostile archive can claim more decompressed data than it carries. How many
// themes or cards someone packs is their own business — the manifest byte
// budget already bounds the count a package can describe.
const MAX_PACKAGE_BYTES = 256 * 1024 * 1024
const MAX_PACKAGE_DECOMPRESSED_BYTES = 512 * 1024 * 1024
const MAX_PACKAGE_ENTRIES = 4096
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024

const MIME_EXTENSIONS: Record<ThemeAssetMime, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

interface PackagedAsset {
  id: string
  file: string
  mime: ThemeAssetMime
  size: number
  width: number
  height: number
}

interface ThemePackageManifest {
  format: string
  version: number
  /** Themes embed their palette/CSS/highlight content, so no local id is referenced */
  themes: unknown[]
  palettes?: unknown[]
  css?: unknown[]
  highlights?: unknown[]
  assets?: PackagedAsset[]
}

/** What the settings page hands to the exporter: whole themes plus loose cards. */
export interface ThemePackageSelection {
  themes: SavedReadingTheme[]
  palettes: ThemePalette[]
  css: ThemeCssCard[]
  highlights: ThemeHighlightCard[]
}

export type ThemePackageErrorCategory =
  | 'invalid-zip'
  | 'manifest'
  | 'version'
  | 'entry-path'
  | 'too-many-entries'
  | 'too-large'
  | 'asset-missing'
  | 'asset-invalid'
  | 'unresolved-reference'
  | 'storage'

export class ThemePackageError extends Error {
  constructor(public readonly category: ThemePackageErrorCategory, message: string) {
    super(message)
  }
}

function collectBundleAssetIds(bundle: PortableThemeBundle): string[] {
  const ids = new Set<string>()
  const palettes = [...bundle.themes.flatMap((theme) => theme.palette ? [theme.palette] : []), ...bundle.palettes]
  for (const palette of palettes) if (palette.wallpaperAssetId) ids.add(palette.wallpaperAssetId)
  const css = [...bundle.themes.flatMap((theme) => theme.css ? [theme.css] : []), ...bundle.css]
  for (const card of css) for (const asset of card.assets ?? []) ids.add(asset.id)
  return [...ids]
}

/**
 * Build one ZIP holding every selected item. The package is always a single
 * file: themes embed their palette/CSS/highlight content, loose cards travel
 * beside them, and each referenced image is packed once.
 *
 * Refuses (returns the missing ids) instead of producing a silently incomplete
 * package when any referenced asset has no stored bytes on this device.
 */
export async function buildThemeLibraryPackage(
  selection: ThemePackageSelection,
  library: ReadingThemeLibrary,
  store: ThemeAssetStore,
  scope: string,
): Promise<{ blob: Blob | null; missing: string[] }> {
  const bundle: PortableThemeBundle = {
    themes: selection.themes.map((theme) => portableThemeOf(library, theme)),
    palettes: selection.palettes.map(portablePaletteOf),
    css: selection.css.map(portableCssOf),
    highlights: selection.highlights.map(portableRuleOf),
  }
  const referencedIds = collectBundleAssetIds(bundle)
  const assets: PackagedAsset[] = []
  const files = new Map<string, Uint8Array>()
  const missing: string[] = []
  const metadata = referencedIds.length ? await store.list(scope) : []
  for (const id of referencedIds) {
    let meta = metadata.find((candidate) => candidate.id === id)
    let blob = meta ? await store.getBlob(scope, id) : null
    if ((!meta || !blob) && scope !== 'device') {
      const remoteBlob = await fetchThemeAssetFromServer(id).catch(() => null)
      if (remoteBlob) {
        const prepared = await prepareThemeAsset(scope, remoteBlob).catch(() => null)
        if (prepared) {
          meta = { ...prepared.asset, id }
          blob = prepared.blob
        }
      }
    }
    if (!meta || !blob) {
      missing.push(id)
      continue
    }
    const extension = MIME_EXTENSIONS[meta.mime] ?? 'png'
    const path = `assets/${id}.${extension}`
    assets.push({ id, file: path, mime: meta.mime, size: meta.size, width: meta.width, height: meta.height })
    files.set(path, new Uint8Array(await blob.arrayBuffer()))
  }
  if (missing.length) return { blob: null, missing }
  const manifest: ThemePackageManifest = {
    format: THEME_PACKAGE_FORMAT,
    version: THEME_PACKAGE_VERSION,
    themes: bundle.themes,
    ...(bundle.palettes.length ? { palettes: bundle.palettes } : {}),
    ...(bundle.css.length ? { css: bundle.css } : {}),
    ...(bundle.highlights.length ? { highlights: bundle.highlights } : {}),
    assets,
  }
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  for (const [path, blob] of files) zip.file(path, blob)
  const generated = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  if (generated.size > MAX_PACKAGE_BYTES) throw new ThemePackageError('too-large', 'Package exceeds the size limit')
  return { blob: generated, missing: [] }
}

export function themeLibraryPackageFileName(selection: ThemePackageSelection): string {
  const single = selection.themes.length === 1 && !selection.palettes.length && !selection.css.length && !selection.highlights.length
  if (single) return `${safeFileStem(selection.themes[0]!.name, 'theme')}-bookdock-theme-${timestampSuffix()}.zip`
  return `bookdock-theme-library-${timestampSuffix()}.zip`
}

function safeFileStem(name: string, fallback: string): string {
  return name.trim().replace(/[\\/:*?"<>|]+/g, '') || fallback
}

/**
 * Validate one package and prepare its cards for merging. Assets are stored under
 * fresh scope-local ids (deduped by content hash — the package's ids are never
 * trusted), and the bundle's references are rewritten.
 *
 * Throws `ThemePackageError` before any write on validation failure.
 */
export async function importThemePackage(
  file: File,
  store: ThemeAssetStore,
  scope: string,
): Promise<PortableThemeBundle> {
  if (file.size > MAX_PACKAGE_BYTES) throw new ThemePackageError('too-large', 'Package exceeds the size limit')
  let zip: JSZip
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const names = inspectDirectory(bytes)
    zip = await JSZip.loadAsync(bytes)
    const entries = Object.values(zip.files)
    if (entries.length !== names.size || entries.some((entry) => !names.has(entry.unsafeOriginalName ?? entry.name))) {
      throw new ThemePackageError('entry-path', 'ZIP entry names do not match the directory')
    }
  } catch (error) {
    if (error instanceof ThemePackageError) throw error
    throw new ThemePackageError('invalid-zip', 'Not a readable ZIP package')
  }
  const entries = Object.values(zip.files)
  const realEntries = entries.filter((entry) => !entry.dir && !entry.name.endsWith('/') && !entry.name.startsWith('__MACOSX/') && entry.name.split('/').pop() !== '.DS_Store')
  if (realEntries.length > MAX_PACKAGE_ENTRIES) throw new ThemePackageError('too-many-entries', 'Package has too many files')
  for (const entry of realEntries) assertEntryPath(entry.unsafeOriginalName ?? entry.name)
  const manifestEntry = realEntries.find((entry) => entry.name === 'manifest.json')
    ?? (realEntries.every((entry) => entry.name.includes('/')) ? realEntries.find((entry) => entry.name.endsWith('/manifest.json') && entry.name.indexOf('/') === entry.name.lastIndexOf('/')) : undefined)
  if (!manifestEntry) throw new ThemePackageError('manifest', 'Package has no manifest.json')
  const rootPrefix = manifestEntry.name === 'manifest.json' ? '' : manifestEntry.name.slice(0, manifestEntry.name.indexOf('/') + 1)
  const manifest = await readManifest(manifestEntry)
  const assetEntries = readAssetEntries(manifest, realEntries, zip, rootPrefix)
  const bundle = bundleFromManifest(manifest)
  for (const id of collectBundleAssetIds(bundle)) {
    if (!assetEntries.has(id)) throw new ThemePackageError('unresolved-reference', `Theme references unpackaged asset: ${id}`)
  }

  const images: Array<{ key: string; image: PreparedThemeAsset }> = []
  let room = MAX_PACKAGE_DECOMPRESSED_BYTES
  for (const [id, { path, meta }] of assetEntries) {
    const bytes = await readEntry(zip.file(rootPrefix + path)!, Math.min(THEME_ASSET_LIMITS.maxBytes, room))
    room -= bytes.length
    try {
      const image = await prepareThemeAsset(scope, new Blob([bytes], { type: meta.mime }), path.split('/').pop())
      if (image.asset.mime !== meta.mime || image.asset.size !== meta.size ||
          image.asset.width !== meta.width || image.asset.height !== meta.height) {
        throw new ThemePackageError('asset-invalid', `Image metadata does not match its bytes: ${path}`)
      }
      images.push({ key: id, image })
    } catch {
      throw new ThemePackageError('asset-invalid', `Asset is not a supported image: ${path}`)
    }
  }

  let stored: Map<string, PreparedThemeAsset['asset']>
  try {
    stored = await store.storePrepared(scope, images)
  } catch (error) {
    throw new ThemePackageError('storage', error instanceof ThemeAssetError ? error.message : 'Image storage failed')
  }
  if (scope !== 'device') {
    try {
      await Promise.all(images.map(({ key, image }) => {
        const saved = stored.get(key)
        if (!saved) return Promise.resolve()
        return uploadThemeAssetToServer({
          assetId: saved.id,
          blob: image.blob,
          fileName: saved.fileName,
          width: saved.width,
          height: saved.height,
        })
      }))
    } catch (error) {
      throw new ThemePackageError('storage', error instanceof Error ? error.message : 'Image upload failed')
    }
  }
  const idMap = new Map([...stored].map(([id, asset]) => [id, asset.id]))
  return remapBundleAssetIds(bundle, idMap)
}

function readAssetEntries(
  manifest: ThemePackageManifest,
  realEntries: JSZip.JSZipObject[],
  zip: JSZip,
  rootPrefix: string,
): Map<string, { path: string; meta: PackagedAsset }> {
  const assetEntries = new Map<string, { path: string; meta: PackagedAsset }>()
  if (manifest.assets !== undefined) {
    if (!Array.isArray(manifest.assets)) throw new ThemePackageError('manifest', 'Manifest assets must be a list')
    for (const raw of manifest.assets) {
      const asset = sanitizePackagedAsset(raw)
      if (!asset) throw new ThemePackageError('manifest', 'Invalid asset entry')
      if (assetEntries.has(asset.id)) throw new ThemePackageError('manifest', 'Duplicate asset entry')
      assetEntries.set(asset.id, { path: asset.file, meta: asset })
    }
  }
  // Every declared asset must exist as a package file, and every package file
  // must be declared — the format is explicit about its contents.
  for (const { path } of assetEntries.values()) {
    if (!zip.file(rootPrefix + path)) throw new ThemePackageError('asset-missing', `Packaged file missing: ${path}`)
  }
  for (const entry of realEntries) {
    if (entry.name === `${rootPrefix}manifest.json`) continue
    const relative = entry.name.slice(rootPrefix.length)
    if (!entry.name.startsWith(rootPrefix) || ![...assetEntries.values()].some(({ path }) => path === relative)) {
      throw new ThemePackageError('entry-path', `Unexpected package entry: ${relative}`)
    }
  }
  return assetEntries
}

function remapBundleAssetIds(bundle: PortableThemeBundle, idMap: Map<string, string>): PortableThemeBundle {
  const remapId = (id: string): string => idMap.get(id) ?? id
  const remapAssets = (refs: ThemeAssetRef[] | undefined): ThemeAssetRef[] | undefined => refs && [...new Map(refs.map((ref) => [remapId(ref.id), { id: remapId(ref.id), name: ref.name }])).values()]
  const remapPalette = (palette: PortablePalette): PortablePalette => palette.wallpaperAssetId
    ? { ...palette, wallpaperAssetId: remapId(palette.wallpaperAssetId) }
    : palette
  const remapCss = (card: PortableCssCard): PortableCssCard => ({
    ...card,
    ...(card.contentCss ? { contentCss: remapCssAssetRefs(card.contentCss, idMap) } : {}),
    ...(card.uiCss ? { uiCss: remapCssAssetRefs(card.uiCss, idMap) } : {}),
    ...(card.assets ? { assets: remapAssets(card.assets) } : {}),
  })
  const remapTheme = (theme: PortableTheme): PortableTheme => ({
    ...theme,
    ...(theme.palette ? { palette: remapPalette(theme.palette) } : {}),
    ...(theme.css ? { css: remapCss(theme.css) } : {}),
  })
  return {
    themes: bundle.themes.map(remapTheme),
    palettes: bundle.palettes.map(remapPalette),
    css: bundle.css.map(remapCss),
    highlights: bundle.highlights,
  }
}

function assertEntryPath(name: string): void {
  if (name.includes(':') || name.includes('\\') || [...name].some((char) => char.charCodeAt(0) < 32) || name.replace(/\/$/, '').split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new ThemePackageError('entry-path', `Unsafe package entry: ${name}`)
  }
}

// JSZip normalizes entry paths and overwrites duplicate names during load.
// Inspect the small, single-disk archive directory before it does either.
function inspectDirectory(bytes: Uint8Array<ArrayBuffer>): Set<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break
  }
  if (end < Math.max(0, bytes.length - 65557)) throw new ThemePackageError('invalid-zip', 'ZIP directory missing')
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  if (view.getUint32(end + 4, true) !== 0 || view.getUint16(end + 8, true) !== count || offset + view.getUint32(end + 12, true) !== end) {
    throw new ThemePackageError('invalid-zip', 'Invalid ZIP directory')
  }
  if (count > MAX_PACKAGE_ENTRIES) throw new ThemePackageError('too-many-entries', 'Package has too many entries')
  const names = new Set<string>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) {
      throw new ThemePackageError('invalid-zip', 'Invalid ZIP entry')
    }
    const nameLength = view.getUint16(offset + 28, true)
    const nameEnd = offset + 46 + nameLength
    const next = nameEnd + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
    if (!nameLength || next > end) throw new ThemePackageError('invalid-zip', 'Invalid ZIP entry length')
    const name = decoder.decode(bytes.subarray(offset + 46, nameEnd))
    assertEntryPath(name)
    if (names.has(name)) throw new ThemePackageError('entry-path', `Duplicate package entry: ${name}`)
    names.add(name)
    offset = next
  }
  if (offset !== end) throw new ThemePackageError('invalid-zip', 'Invalid ZIP directory length')
  return names
}

function readEntry(entry: JSZip.JSZipObject, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  // The JSZip file stream is public but missing from its TypeScript definitions.
  const stream = (entry as JSZip.JSZipObject & {
    internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>
  }).internalStream('uint8array')
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let size = 0
    stream.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        stream.pause()
        reject(new ThemePackageError('too-large', `Entry exceeds decompression budget: ${entry.name}`))
        return
      }
      chunks.push(chunk)
    }).on('error', () => {
      reject(new ThemePackageError('invalid-zip', `Cannot decompress entry: ${entry.name}`))
    }).on('end', () => {
      if (size > limit) return
      const result = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
      }
      resolve(result)
    }).resume()
  })
}

async function readManifest(entry: JSZip.JSZipObject): Promise<ThemePackageManifest> {
  const bytes = await readEntry(entry, MAX_MANIFEST_BYTES)
  let manifest: Record<string, unknown>
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object')
    manifest = value as Record<string, unknown>
  } catch {
    throw new ThemePackageError('manifest', 'Manifest is not valid JSON')
  }
  if (manifest.format !== THEME_PACKAGE_FORMAT) throw new ThemePackageError('version', 'Not a Bookdock theme package')
  if (manifest.version !== THEME_PACKAGE_VERSION) throw new ThemePackageError('version', 'Unsupported theme package version')
  return manifest as unknown as ThemePackageManifest
}

function sanitizePackagedAsset(raw: unknown): PackagedAsset | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  const id = sanitizeThemeAssetId(entry.id)
  const mime = entry.mime
  if (!id || typeof entry.file !== 'string' || typeof mime !== 'string') return null
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) return null
  const normalized = entry.file.replace(/\\/g, '/')
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) return null
  if (normalized !== `assets/${id}.${MIME_EXTENSIONS[mime as ThemeAssetMime]}`) return null
  return {
    id,
    file: normalized,
    mime: mime as ThemeAssetMime,
    size: typeof entry.size === 'number' ? entry.size : 0,
    width: typeof entry.width === 'number' ? entry.width : 0,
    height: typeof entry.height === 'number' ? entry.height : 0,
  }
}

function bundleFromManifest(manifest: ThemePackageManifest): PortableThemeBundle {
  return {
    themes: readList(manifest.themes).map(readPortableTheme),
    palettes: readList(manifest.palettes).map(readPortablePalette),
    css: readList(manifest.css).map(readPortableCss),
    highlights: readList(manifest.highlights).map(readPortableRule),
  }
}

function readList(value: unknown): unknown[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new ThemePackageError('manifest', 'Package list is malformed')
  return value
}

function readName(value: unknown, maxLength: number, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : fallback
}

function readColors(value: unknown): PortablePalette['colors'] {
  const { bg, fg, primary, pageBg, outsideBg } = (value ?? {}) as Record<string, unknown>
  if (!isHexColor(bg) || !isHexColor(fg) || !isHexColor(primary) ||
      ((pageBg !== undefined || outsideBg !== undefined) && (!isHexColor(pageBg) || !isHexColor(outsideBg)))) {
    throw new ThemePackageError('manifest', 'Theme colors are invalid')
  }
  return { bg, fg, primary, ...(isHexColor(pageBg) && isHexColor(outsideBg) ? { pageBg, outsideBg } : {}) }
}

function readOptionalUnit(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ThemePackageError('manifest', 'Theme wallpaper settings are invalid')
  }
  return value
}

function readPortablePalette(raw: unknown): PortablePalette {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ThemePackageError('manifest', 'Invalid palette entry')
  const entry = raw as Record<string, unknown>
  const wallpaperAssetId = sanitizeThemeAssetId(entry.wallpaperAssetId)
  if (entry.wallpaperAssetId !== undefined && !wallpaperAssetId) throw new ThemePackageError('manifest', 'Invalid wallpaper reference')
  const wallpaperOpacity = readOptionalUnit(entry.wallpaperOpacity, 0.1, 1)
  const wallpaperBlur = readOptionalUnit(entry.wallpaperBlur, 0, 20)
  return {
    name: readName(entry.name, 100, 'Palette'),
    colors: readColors(entry.colors),
    ...(wallpaperAssetId ? { wallpaperAssetId } : {}),
    ...(typeof entry.wallpaperFileName === 'string' && entry.wallpaperFileName.trim()
      ? { wallpaperFileName: entry.wallpaperFileName.trim().slice(0, 100) }
      : {}),
    ...(wallpaperOpacity !== undefined ? { wallpaperOpacity } : {}),
    ...(wallpaperBlur !== undefined ? { wallpaperBlur } : {}),
  }
}

function readPortableCss(raw: unknown): PortableCssCard {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ThemePackageError('manifest', 'Invalid CSS entry')
  const entry = raw as Record<string, unknown>
  const assets = sanitizeThemeAssetRefs(entry.assets)
  if (entry.assets !== undefined && (!Array.isArray(entry.assets) || assets.length !== entry.assets.length)) {
    throw new ThemePackageError('manifest', 'Theme image references are invalid')
  }
  if (assets.length > THEME_ASSET_LIMITS.maxPerTheme) throw new ThemePackageError('manifest', 'Theme image references are invalid')
  const declared = new Set(assets.map((asset) => asset.id))
  const readCss = (value: unknown, validate: typeof validateContentCss | typeof validateUiCss): string => {
    if (value === undefined) return ''
    if (typeof value !== 'string' || !validate(value).ok) throw new ThemePackageError('manifest', 'Theme CSS is invalid')
    if (collectCssAssetRefs(value).some((id) => !declared.has(id))) {
      throw new ThemePackageError('unresolved-reference', 'CSS references an image outside the theme manifest')
    }
    return value.trim()
  }
  const contentCss = readCss(entry.contentCss, validateContentCss)
  const uiCss = readCss(entry.uiCss, validateUiCss)
  return {
    name: readName(entry.name, 100, 'CSS'),
    ...(contentCss ? { contentCss } : {}),
    ...(uiCss ? { uiCss } : {}),
    ...(assets.length ? { assets } : {}),
  }
}

function readPortableRule(raw: unknown): PortableHighlightRule {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ThemePackageError('manifest', 'Invalid highlight rule')
  const entry = raw as Record<string, unknown>
  const candidate = {
    ...entry,
    id: typeof entry.id === 'string' && entry.id ? entry.id.slice(0, 100) : 'packaged-rule',
    name: readName(entry.name, 50, 'Highlight'),
  }
  const parsed = highlightRuleSchema.safeParse(candidate)
  const rule = parsed.success ? sanitizeHighlightRulesField([parsed.data])[0] : undefined
  if (!rule || highlightRuleIssue(rule)) throw new ThemePackageError('manifest', 'Theme highlight rules are invalid')
  return portableRuleOf(rule)
}

function readPortableTheme(raw: unknown): PortableTheme {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ThemePackageError('manifest', 'Invalid theme entry')
  const entry = raw as Record<string, unknown>
  const highlights = readList(entry.highlights).map(readPortableRule)
  const theme: PortableTheme = {
    name: readName(entry.name, 100, 'Theme'),
    ...(entry.palette !== undefined ? { palette: readPortablePalette(entry.palette) } : {}),
    ...(entry.css !== undefined ? { css: readPortableCss(entry.css) } : {}),
    ...(highlights.length ? { highlights } : {}),
  }
  if (!theme.palette && !theme.css && !theme.highlights) throw new ThemePackageError('manifest', 'Theme has no palette')
  return theme
}
