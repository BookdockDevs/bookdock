import { IDBFactory } from 'fake-indexeddb'
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/hooks/useReadingThemes', () => ({
  uploadThemeAssetToServer: vi.fn(async () => ({})),
  fetchThemeAssetFromServer: vi.fn(async () => null),
}))

import JSZip from 'jszip'

import type { CustomReadingTheme } from '@/lib/reading-theme'
import { collectCssAssetRefs } from '@/lib/theme-css-guard'

import { prepareThemeAsset, ThemeAssetStore } from './assets'
import {
  THEME_PACKAGE_FORMAT,
  THEME_PACKAGE_VERSION,
  buildThemeLibraryPackage,
  importThemePackage as prepareThemePackage,
  ThemePackageError,
  type ThemePackageSelection,
} from './theme-package'
import { mergeThemeBundle, type ReadingThemeLibrary, type ThemeCssCard, type ThemePalette } from './theme-library'

async function importThemePackage(file: File, store: ThemeAssetStore, scope: string, library: ReadingThemeLibrary) {
  return mergeThemeBundle(library, await prepareThemePackage(file, store, scope))
}

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x02,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a,
  0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d,
  0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
])

const EMPTY_LIBRARY: ReadingThemeLibrary = { palettes: [], css: [], highlights: [], themes: [] }

function blobOf(bytes: Uint8Array, type = 'image/png'): Blob {
  return new NativeBlob([bytes as unknown as NativeBlob], { type }) as unknown as Blob
}

async function saveImage(store: ThemeAssetStore, scope: string, blob: Blob, { name }: { name: string }) {
  const image = await prepareThemeAsset(scope, blob, name)
  const stored = await store.storePrepared(scope, [{ key: image.asset.id, image }])
  return { asset: stored.get(image.asset.id)! }
}

function packageFile(blob: Blob): File {
  return new NativeFile([blob as unknown as NativeBlob], 'theme.zip', { type: 'application/zip' }) as unknown as File
}

function libraryFromTheme(theme: CustomReadingTheme): ReadingThemeLibrary {
  const palette: ThemePalette = {
    id: 'source-palette',
    name: theme.name,
    colors: theme.colors,
    ...(theme.wallpaperAssetId ? { wallpaperAssetId: theme.wallpaperAssetId } : {}),
  }
  const css: ThemeCssCard = {
    id: 'source-css',
    name: theme.name,
    contentCss: theme.contentCss ?? '',
    uiCss: theme.uiCss ?? '',
    assets: theme.assets ?? [],
  }
  const highlights = (theme.highlightRules ?? []).map((rule) => ({ ...rule }))
  return {
    palettes: [palette],
    css: css.contentCss || css.uiCss || css.assets.length ? [css] : [],
    highlights,
    themes: [{
      id: 'source-theme',
      name: theme.name,
      cards: {
        paletteId: 'source-palette',
        cssId: css.contentCss || css.uiCss || css.assets.length ? 'source-css' : null,
        highlightIds: highlights.filter((rule) => rule.enabled).map((rule) => rule.id),
      },
    }],
  }
}

function themeWithAssets(overrides: Partial<CustomReadingTheme> = {}): CustomReadingTheme {
  return {
    id: 'custom-source',
    name: 'Ink Garden',
    colors: { bg: '#111111', fg: '#eeeeee', primary: '#888888', pageBg: '#1b1b1b', outsideBg: '#0a0a0a' },
    contentCss: '[data-bd-chapter-title] { color: #b45309 !important }',
    uiCss: '[data-bd-ui="outside"] { background-image: url("bd-asset:asset-fig") }',
    highlightRules: [{ id: 'rule-1', name: '对白', pattern: '「[^」]*」', isRegex: true, enabled: true, style: { backgroundColor: '#F5E3B8' } }],
    wallpaperAssetId: 'asset-wall',
    assets: [{ id: 'asset-fig', name: 'figure.png' }],
    ...overrides,
  } as CustomReadingTheme
}

async function buildExportedZip(library: ReadingThemeLibrary): Promise<Blob> {
  const selection: ThemePackageSelection = {
    themes: library.themes,
    palettes: library.palettes,
    css: library.css,
    highlights: library.highlights,
  }
  const { blob } = await buildThemeLibraryPackage(selection, library, new ThemeAssetStore(), 'u')
  return blob!
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('Blob', NativeBlob)
  vi.stubGlobal('File', NativeFile)
  vi.stubGlobal('createImageBitmap', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildThemeLibraryPackage', () => {
  it('packs every selected item into one archive, with each image once', async () => {
    const store = new ThemeAssetStore()
    const wall = (await saveImage(store, 'u', blobOf(new Uint8Array([...PNG_BYTES, 1])), { name: 'wall.png' })).asset
    const fig = (await saveImage(store, 'u', blobOf(new Uint8Array([...PNG_BYTES, 2])), { name: 'figure.png' })).asset
    const theme = themeWithAssets({
      wallpaperAssetId: wall.id,
      assets: [{ id: fig.id, name: 'figure.png' }],
      uiCss: `[data-bd-ui="outside"] { background-image: url("bd-asset:${fig.id}") }`,
    })
    theme.highlightRules![0]!.sampleText = 'private preview text'
    const library = libraryFromTheme(theme)
    const loose: ReadingThemeLibrary = {
      ...library,
      palettes: [...library.palettes, { id: 'standalone', name: 'Only palette', colors: { bg: '#222222', fg: '#dddddd', primary: '#999999' } }],
      css: [...library.css, { id: 'standalone-css', name: 'Only CSS', contentCss: '[data-bd-chapter-title] { color: red !important }', uiCss: '', assets: [] }],
    }
    const { blob, missing } = await buildThemeLibraryPackage(
      { themes: library.themes, palettes: loose.palettes, css: loose.css, highlights: library.highlights },
      loose,
      store,
      'u',
    )
    expect(missing).toEqual([])
    const zip = await JSZip.loadAsync(new Uint8Array(await blob!.arrayBuffer()))
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as Record<string, unknown>
    expect(manifest.format).toBe(THEME_PACKAGE_FORMAT)
    expect(manifest.version).toBe(THEME_PACKAGE_VERSION)
    const themes = manifest.themes as Array<Record<string, unknown>>
    expect(themes).toHaveLength(1)
    expect(themes[0]!.name).toBe('Ink Garden')
    expect(Object.keys(themes[0]!)).not.toContain('id')
    const palette = themes[0]!.palette as Record<string, unknown>
    expect(palette.wallpaperAssetId).toBe(wall.id)
    const highlights = themes[0]!.highlights as Array<Record<string, unknown>>
    expect(highlights).toHaveLength(1)
    expect(highlights[0]).not.toHaveProperty('sampleText')
    expect(highlights[0]).not.toHaveProperty('id')
    expect((manifest.palettes as unknown[])).toHaveLength(2)
    expect((manifest.css as unknown[])).toHaveLength(2)
    const assets = manifest.assets as Array<{ id: string; file: string }>
    expect(assets.map((entry) => entry.id).sort()).toEqual([fig.id, wall.id].sort())
    expect(zip.file(`assets/${wall.id}.png`)).not.toBeNull()
  })

  it('refuses with the missing ids instead of exporting a partial package', async () => {
    const library = libraryFromTheme(themeWithAssets())
    const { blob, missing } = await buildThemeLibraryPackage(
      { themes: library.themes, palettes: library.palettes, css: library.css, highlights: library.highlights },
      library,
      new ThemeAssetStore(),
      'u',
    )
    expect(blob).toBeNull()
    expect(missing.sort()).toEqual(['asset-fig', 'asset-wall'])
  })
})

describe('importThemePackage', () => {
  async function exportedLibrary(): Promise<ReadingThemeLibrary> {
    const store = new ThemeAssetStore()
    const wall = (await saveImage(store, 'u', blobOf(new Uint8Array([...PNG_BYTES, 1])), { name: 'wall.png' })).asset
    const fig = (await saveImage(store, 'u', blobOf(new Uint8Array([...PNG_BYTES, 2])), { name: 'figure.png' })).asset
    return libraryFromTheme(themeWithAssets({
      wallpaperAssetId: wall.id,
      assets: [{ id: fig.id, name: 'figure.png' }],
      uiCss: `[data-bd-ui="outside"] { background-image: url("bd-asset:${fig.id}") }`,
    }))
  }

  it('round-trips a package into a library with fresh ids and stored bytes', async () => {
    const exported = await buildExportedZip(await exportedLibrary())
    const store = new ThemeAssetStore()
    const result = await importThemePackage(packageFile(exported), store, 'other', EMPTY_LIBRARY)
    expect(result.added).toEqual({ themes: 1, palettes: 1, css: 1, highlights: 1 })
    expect(result.merged).toEqual({ themes: 0, palettes: 0, css: 0, highlights: 0 })
    const [theme] = result.library.themes
    expect(theme!.id).not.toBe('source-theme')
    expect(theme!.name).toBe('Ink Garden')
    const palette = result.library.palettes[0]!
    expect(palette.colors).toEqual(themeWithAssets().colors)
    expect(result.library.css[0]!.contentCss).toContain('[data-bd-chapter-title]')
    expect(result.library.highlights).toHaveLength(1)
    // packaged ids are never trusted: fresh ids, rewritten everywhere
    const ids = new Set([palette.wallpaperAssetId, ...(result.library.css[0]!.assets).map((ref) => ref.id)])
    ids.delete(undefined)
    expect(ids.size).toBe(2)
    expect(collectCssAssetRefs(result.library.css[0]!.uiCss)).toEqual([result.library.css[0]!.assets[0]?.id])
    const serialized = JSON.stringify(result.library)
    for (const id of ids) {
      expect(serialized).toContain(id as string)
      expect(await store.getBlob('other', id as string)).not.toBeNull()
    }
    // the imported library is itself packageable
    const again = await buildThemeLibraryPackage(
      { themes: result.library.themes, palettes: [], css: [], highlights: [] },
      result.library,
      store,
      'other',
    )
    expect(again.missing).toEqual([])
  })

  it('reuses identical content instead of duplicating it', async () => {
    const exported = await buildExportedZip(await exportedLibrary())
    const store = new ThemeAssetStore()
    const first = await importThemePackage(packageFile(exported), store, 'other', EMPTY_LIBRARY)
    const second = await importThemePackage(packageFile(exported), store, 'other', first.library)
    expect(second.added).toEqual({ themes: 0, palettes: 0, css: 0, highlights: 0 })
    expect(second.merged).toEqual({ themes: 1, palettes: 1, css: 1, highlights: 1 })
    expect(second.library.themes).toHaveLength(1)
    expect(second.library.palettes).toHaveLength(1)
    expect((await store.list('other')).length).toBe(2)
  })

  it('matches an existing palette by content even under another name', async () => {
    const plain = libraryFromTheme(themeWithAssets({
      wallpaperAssetId: undefined,
      assets: undefined,
      uiCss: undefined,
      contentCss: undefined,
      highlightRules: undefined,
    }))
    const exported = await buildExportedZip(plain)
    const existing: ReadingThemeLibrary = {
      ...EMPTY_LIBRARY,
      palettes: [{ id: 'local-palette', name: '本地米黄', colors: themeWithAssets().colors }],
    }
    const result = await importThemePackage(packageFile(exported), new ThemeAssetStore(), 'other', existing)
    expect(result.library.palettes).toHaveLength(1)
    expect(result.library.palettes[0]!.name).toBe('本地米黄')
    expect(result.merged.palettes).toBe(1)
    expect(result.library.themes[0]!.cards.paletteId).toBe('local-palette')
  })

  it('suffixes a taken name instead of overwriting the local item', async () => {
    const exported = await buildExportedZip(await exportedLibrary())
    const local: ThemePalette = { id: 'local-palette', name: 'Ink Garden', colors: { bg: '#ffffff', fg: '#111111', primary: '#333333' } }
    const existing: ReadingThemeLibrary = {
      ...EMPTY_LIBRARY,
      palettes: [local],
      themes: [{ id: 'local-theme', name: 'Ink Garden', cards: { paletteId: local.id, cssId: null, highlightIds: [] } }],
    }
    const result = await importThemePackage(packageFile(exported), new ThemeAssetStore(), 'other', existing)
    expect(result.library.themes.map((theme) => theme.name)).toEqual(['Ink Garden', 'Ink Garden_1'])
    expect(result.library.palettes.map((palette) => palette.name)).toEqual(['Ink Garden', 'Ink Garden_1'])
    expect(result.library.themes[1]!.cards.paletteId).not.toBe('local-palette')
  })

  it('rejects wrong format or version, unsafe paths and unexpected entries', async () => {
    const exported = await buildExportedZip(await exportedLibrary())
    async function expectImportFailure(zip: JSZip, category: ThemePackageError['category']): Promise<void> {
      const blob = await zip.generateAsync({ type: 'blob' })
      await expect(importThemePackage(packageFile(blob), new ThemeAssetStore(), 'other', EMPTY_LIBRARY)).rejects.toMatchObject({ category })
    }
    const badFormat = await JSZip.loadAsync(new Uint8Array(await exported.arrayBuffer()))
    const badManifest = JSON.parse(await badFormat.file('manifest.json')!.async('string')) as Record<string, unknown>
    badFormat.file('manifest.json', JSON.stringify({ ...badManifest, format: 'other' }))
    await expectImportFailure(badFormat, 'version')
    const badVersion = await JSZip.loadAsync(new Uint8Array(await exported.arrayBuffer()))
    badVersion.file('manifest.json', JSON.stringify({ ...badManifest, version: 99 }))
    await expectImportFailure(badVersion, 'version')
    const traversal = await JSZip.loadAsync(new Uint8Array(await exported.arrayBuffer()))
    traversal.file('../escape.png', 'x')
    await expectImportFailure(traversal, 'entry-path')
    const unexpected = await JSZip.loadAsync(new Uint8Array(await exported.arrayBuffer()))
    unexpected.file('junk/readme.txt', 'hello')
    await expectImportFailure(unexpected, 'entry-path')
    const notAZip = new NativeBlob(['this is not a zip'])
    await expect(importThemePackage(packageFile(notAZip as unknown as Blob), new ThemeAssetStore(), 'other', EMPTY_LIBRARY)).rejects.toMatchObject({ category: 'invalid-zip' })
  })

  it('rejects a theme whose CSS references unpackaged assets', async () => {
    const exported = await buildExportedZip(await exportedLibrary())
    const zip = await JSZip.loadAsync(new Uint8Array(await exported.arrayBuffer()))
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as { themes: Array<{ css: { uiCss: string } }> }
    const css = manifest.themes[0]!.css
    css.uiCss = `${css.uiCss}\n[data-bd-ui="outside"] { border-image-source: url("bd-asset:asset-not-packaged") }`
    zip.file('manifest.json', JSON.stringify(manifest))
    const blob = await zip.generateAsync({ type: 'blob' })
    await expect(importThemePackage(packageFile(blob), new ThemeAssetStore(), 'other', EMPTY_LIBRARY)).rejects.toMatchObject({ category: 'unresolved-reference' })
  })

  it('rejects duplicate archive names before loading the manifest', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', 'null')
    zip.file('duplicate.txt', 'null')
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const oldName = new TextEncoder().encode('duplicate.txt')
    const newName = new TextEncoder().encode('manifest.json')
    for (let offset = 0; offset <= bytes.length - oldName.length; offset++) {
      if (oldName.every((byte, index) => bytes[offset + index] === byte)) bytes.set(newName, offset)
    }
    const blob = blobOf(bytes, 'application/zip')
    await expect(importThemePackage(packageFile(blob), new ThemeAssetStore(), 'other', EMPTY_LIBRARY)).rejects.toMatchObject({ category: 'entry-path' })
  })

  it('rejects malformed CSS and a malformed highlight rule without saving assets', async () => {
    const exported = await buildExportedZip(await exportedLibrary())
    const zip = await JSZip.loadAsync(new Uint8Array(await exported.arrayBuffer()))
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as { themes: Array<Record<string, unknown>> }
    const store = new ThemeAssetStore()
    for (const override of [{ css: { name: 'bad', uiCss: '[data-bd-ui="outside"] {' } }, { highlights: [{ name: 'bad', pattern: '[', isRegex: true, enabled: true }] }]) {
      zip.file('manifest.json', JSON.stringify({ ...manifest, themes: [{ ...manifest.themes[0]!, ...override }] }))
      const blob = await zip.generateAsync({ type: 'blob' })
      await expect(importThemePackage(packageFile(blob), store, 'other', EMPTY_LIBRARY)).rejects.toMatchObject({ category: 'manifest' })
      expect(await store.list('other')).toEqual([])
    }
  })

  it('rejects a non-object manifest and limits decompression before parsing', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', 'null')
    let blob = await zip.generateAsync({ type: 'blob' })
    await expect(importThemePackage(packageFile(blob), new ThemeAssetStore(), 'other', EMPTY_LIBRARY)).rejects.toMatchObject({ category: 'manifest' })
    zip.file('manifest.json', ' '.repeat(32 * 1024 * 1024 + 1)) // MAX_MANIFEST_BYTES
    blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
    await expect(importThemePackage(packageFile(blob), new ThemeAssetStore(), 'other', EMPTY_LIBRARY)).rejects.toMatchObject({ category: 'too-large' })
  })

  it('rejects packaged images that are not the declared type', async () => {
    const exported = await buildExportedZip(await exportedLibrary())
    const zip = await JSZip.loadAsync(new Uint8Array(await exported.arrayBuffer()))
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string')) as { assets: Array<{ id: string; file: string }> }
    const first = manifest.assets[0]!
    zip.file(`assets/${first.id}.png`, new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b]))
    const blob = await zip.generateAsync({ type: 'blob' })
    await expect(importThemePackage(packageFile(blob), new ThemeAssetStore(), 'other', EMPTY_LIBRARY)).rejects.toMatchObject({ category: 'asset-invalid' })
  })

  it('leaves existing assets untouched and rolls back added bytes on storage failure', async () => {
    const exported = await buildExportedZip(await exportedLibrary())
    const store = new ThemeAssetStore()
    const existing = (await saveImage(store, 'other', blobOf(new Uint8Array([...PNG_BYTES, 9])), { name: 'keep.png' })).asset
    const failing = new ThemeAssetStore()
    const putSpy = vi.spyOn(failing, 'storePrepared').mockRejectedValue(new Error('disk full'))
    await expect(importThemePackage(packageFile(exported), failing, 'other', EMPTY_LIBRARY)).rejects.toMatchObject({ category: 'storage' })
    expect(putSpy).toHaveBeenCalled()
    // nothing was written by the failing import
    expect((await store.list('other')).map((meta) => meta.id)).toEqual([existing.id])
  })
})
