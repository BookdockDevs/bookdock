import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FontListItem } from '@bookdock/shared'

import {
  BUILTIN_FONTS,
  buildFontOptions,
  ensureDeviceFontFace,
  builtinImportCss,
  canRenderCjk,
  ensureBuiltinFontLoaded,
  ensureUploadedFontLoaded,
  fontCssFor,
  isBuiltinFontLoaded,
  isCjkFontName,
  releaseDeviceFontFace,
  resolveCjkFont,
  resolveDualFont,
  resolveFont,
  stackFirstFamily,
  uploadedFaceCss,
  uploadedFontAlias,
  useFontLoaderStore,
} from '../features/reader/fonts'
import { IDBFactory } from 'fake-indexeddb'
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer'
import { webcrypto } from 'node:crypto'

import { FONT_OPTIONS, READER_GLYPH_FALLBACK } from '../features/reader/types'
import { DeviceFontStore } from '../features/device-fonts/db'
import { useDeviceFontStore } from '../features/device-fonts/store'
import { acquireDeviceFontUrl, peekDeviceFontUrl, releaseDeviceFontUrl, useDeviceFontUrlStore } from '../features/device-fonts/urls'
import { useUiStore } from '../stores/ui.store'

import i18n from '../i18n/i18n'

const uploadedFont: FontListItem = {
  id: 'abc123',
  family: 'My Handwriting',
  fileName: 'my-handwriting.woff2',
  format: 'woff2',
  size: 2048,
  scope: 'user',
  mine: true,
  createdAt: 0,
}

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  localStorage.clear()
  useFontLoaderStore.setState({ loadedIds: [], loadingIds: [], latinIds: [] })
})

describe('resolveFont', () => {
  it('resolves system stacks by id', () => {
    const resolved = resolveFont('kaiti', [])
    expect(resolved.stack).toBe(FONT_OPTIONS.find((f) => f.id === 'kaiti')!.value)
    expect(resolved.stack).toContain(READER_GLYPH_FALLBACK)
    expect(resolved.builtin).toBeUndefined()
    expect(resolved.uploaded).toBeUndefined()
  })

  it('resolves builtin CDN fonts', () => {
    const resolved = resolveFont('lxgw-wenkai', [])
    expect(resolved.name).toBe('霞鹜文楷')
    expect(resolved.stack).toBe(BUILTIN_FONTS[0].family)
    expect(resolved.stack).toContain(READER_GLYPH_FALLBACK)
    expect(resolved.builtin?.cssUrl).toContain('/fonts/builtin/lxgw-wenkai/1.7.0/css')
  })

  it('resolves uploaded fonts to the aliased family', () => {
    const resolved = resolveFont('abc123', [uploadedFont])
    expect(resolved.name).toBe('My Handwriting')
    expect(resolved.stack).toBe(`"bd-font-abc123", ${READER_GLYPH_FALLBACK}, serif`)
    expect(resolved.stack).toContain(READER_GLYPH_FALLBACK)
    expect(resolved.uploaded).toBe(uploadedFont)
  })

  it('falls back to the first system stack for unknown ids', () => {
    expect(resolveFont('does-not-exist', []).stack).toBe(FONT_OPTIONS[0].value)
    expect(resolveFont('does-not-exist', []).name).toBe(FONT_OPTIONS[0].name)
  })

  it('prefers system stacks over builtin ids and uploaded rows', () => {
    const resolved = resolveFont('serif', [{ ...uploadedFont, id: 'serif' }])
    expect(resolved.uploaded).toBeUndefined()
    expect(resolved.stack).toBe(FONT_OPTIONS.find((f) => f.id === 'serif')!.value)
  })

  it('falls back when the selected font is disabled', () => {
    const resolved = resolveFont('kaiti', [], {
      kaiti: { enabled: false },
      'sans-serif': { displayName: '正文' },
    })
    expect(resolved.name).toBe('正文')
    expect(resolved.stack).toBe(FONT_OPTIONS.find((f) => f.id === 'sans-serif')!.value)
  })
})

describe('resolveDualFont', () => {
  it('keeps a CJK primary untouched when it already is the companion', () => {
    const dual = resolveDualFont('serif', 'serif', [])
    expect(dual.stack).toBe(FONT_OPTIONS.find((f) => f.id === 'serif')!.value)
    expect(dual.css).toBe('')
    expect(dual.name).toBe('宋体')
  })

  it('keeps a CJK primary stack intact even when companion is different', () => {
    const dual = resolveDualFont('serif', 'sans-serif', [])
    expect(dual.stack).toBe(FONT_OPTIONS.find((f) => f.id === 'serif')!.value)
    expect(dual.stack).toContain('"SimSun"')
    expect(dual.css).toBe('')
    expect(dual.name).toBe('宋体')
  })

  it('leads with the latin face and follows with the CJK companion chain', () => {
    const dual = resolveDualFont('literata', 'lxgw-wenkai', [])
    expect(dual.stack.startsWith('"Literata Variable", ')).toBe(true)
    expect(dual.stack).toContain('"LXGW WenKai"')
    expect(dual.css).toContain('/fonts/builtin/literata/5.3.0/css')
    expect(dual.css).toContain('/fonts/builtin/lxgw-wenkai/1.7.0/css')
  })

  it('combines css only for the non-system faces in use', () => {
    const dual = resolveDualFont('serif-en', 'serif', [])
    expect(dual.stack.startsWith('"Georgia", ')).toBe(true)
    expect(dual.css).toBe('')
  })

  it('never resolves the companion to a latin entry', () => {
    const companion = resolveCjkFont('serif-en', [])
    expect(companion.stack).not.toContain('Georgia')
    expect(stackFirstFamily('ui-monospace, "SF Mono", serif')).toBe('ui-monospace')
  })
})

describe('uploaded CJK detection', () => {
  it('classifies family names by readest CJK signals', () => {
    expect(isCjkFontName('Noto Serif SC')).toBe(true)
    expect(isCjkFontName('Source Han Serif SC')).toBe(true)
    expect(isCjkFontName('霞鹜文楷')).toBe(true)
    expect(isCjkFontName('LXGW WenKai')).toBe(true)
    expect(isCjkFontName('Literata')).toBe(false)
    expect(isCjkFontName('Georgia')).toBe(false)
    expect(isCjkFontName('STIX Two Text')).toBe(false)
    expect(isCjkFontName('')).toBe(false)
  })

  it('marks store-flagged uploads as latin and keeps them out of the CJK companion', () => {
    useFontLoaderStore.setState({ loadedIds: [], loadingIds: [], latinIds: ['abc123'] })
    const options = buildFontOptions([uploadedFont])
    expect(options.find((o) => o.id === 'abc123')?.latin).toBe(true)
    expect(resolveCjkFont('abc123', [uploadedFont]).stack).not.toContain('bd-font-abc123')
  })

  it('pre-marks by name and corrects after the face loads', async () => {
    const load = vi.fn().mockResolvedValue([])
    const check = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'fonts', { value: { load, check }, configurable: true, writable: true })
    try {
      // English-looking name pre-marks latin, then check() proves CJK and clears it
      await ensureUploadedFontLoaded({ ...uploadedFont, id: 'pre-mark', family: 'My English Font' })
      expect(load).toHaveBeenCalled()
      expect(useFontLoaderStore.getState().latinIds).not.toContain('pre-mark')
      // CJK name never pre-marks
      await ensureUploadedFontLoaded({ ...uploadedFont, id: 'cjk-face', family: '思源测试体' })
      expect(useFontLoaderStore.getState().latinIds).not.toContain('cjk-face')
      // a failing check marks latin afterwards
      check.mockReturnValue(false)
      expect(canRenderCjk('whatever')).toBe(false)
      await ensureUploadedFontLoaded({ ...uploadedFont, id: 'latin-face', family: 'My English Font 2' })
      expect(useFontLoaderStore.getState().latinIds).toContain('latin-face')
    } finally {
      Reflect.deleteProperty(document, 'fonts')
    }
  })
})

describe('uploadedFaceCss', () => {
  it('builds an absolute-URL @font-face rule with the aliased family', () => {
    const css = uploadedFaceCss(uploadedFont)
    expect(css).toContain(`font-family: "${uploadedFontAlias('abc123')}"`)
    expect(css).toContain(`${window.location.origin}/api/v1/fonts/abc123/file`)
    expect(css).toContain('format("woff2")')
    expect(css).toContain('font-display: swap')
  })

  it('maps ttf/otf to their css format names', () => {
    expect(uploadedFaceCss({ ...uploadedFont, format: 'ttf' })).toContain('format("truetype")')
    expect(uploadedFaceCss({ ...uploadedFont, format: 'otf' })).toContain('format("opentype")')
  })
})

describe('fontCssFor', () => {
  it('returns @import for builtin fonts', () => {
    const css = fontCssFor(resolveFont('noto-serif-sc', []))
    expect(css).toBe(builtinImportCss(BUILTIN_FONTS.find((f) => f.id === 'noto-serif-sc')!.cssUrl))
    expect(css).toMatch(/^@import url\(".*\/api\/v1\/fonts\/builtin\/noto-serif-sc\//)
  })

  it('returns @font-face for uploaded fonts and empty for system stacks', () => {
    expect(fontCssFor(resolveFont('abc123', [uploadedFont]))).toContain('@font-face')
    expect(fontCssFor(resolveFont('serif', []))).toBe('')
  })
})

describe('ensureBuiltinFontLoaded', () => {
  it('injects the stylesheet link exactly once', () => {
    ensureBuiltinFontLoaded('noto-sans-sc')
    ensureBuiltinFontLoaded('noto-sans-sc')
    const links = document.head.querySelectorAll('link[data-bd-font="noto-sans-sc"]')
    expect(links).toHaveLength(1)
    expect((links[0] as HTMLLinkElement).href).toBe(BUILTIN_FONTS.find((f) => f.id === 'noto-sans-sc')!.cssUrl)
  })

  it('tracks loading, then persists the loaded marker after the font face loads', () => {
    ensureBuiltinFontLoaded('lxgw-wenkai')
    expect(useFontLoaderStore.getState().loadingIds).toContain('lxgw-wenkai')
    expect(isBuiltinFontLoaded('lxgw-wenkai')).toBe(false)

    const link = document.head.querySelector('link[data-bd-font="lxgw-wenkai"]') as HTMLLinkElement
    link.onload?.(new Event('load'))

    expect(useFontLoaderStore.getState().loadingIds).not.toContain('lxgw-wenkai')
    expect(isBuiltinFontLoaded('lxgw-wenkai')).toBe(true)
    expect(JSON.parse(localStorage.getItem('bd-builtin-fonts-loaded-v2')!)).toContain('lxgw-wenkai')
  })

  it('clears the loading state without persisting on stylesheet error', () => {
    ensureBuiltinFontLoaded('noto-serif-sc')
    const link = document.head.querySelector('link[data-bd-font="noto-serif-sc"]') as HTMLLinkElement
    link.onerror?.(new Event('error'))

    expect(useFontLoaderStore.getState().loadingIds).toEqual([])
    expect(localStorage.getItem('bd-builtin-fonts-loaded')).toBeNull()
  })

  it('times out when the stylesheet never loads and allows a retry', () => {
    // Earlier tests leave their (still-connected) links behind; drop them so
    // the idempotent-injection guard does not swallow this fresh attempt.
    document.head.querySelectorAll('link[data-bd-font]').forEach((link) => link.remove())
    vi.useFakeTimers()
    try {
      ensureBuiltinFontLoaded('lxgw-wenkai')
      expect(useFontLoaderStore.getState().loadingIds).toContain('lxgw-wenkai')

      vi.advanceTimersByTime(10_000)

      expect(document.head.querySelector('link[data-bd-font="lxgw-wenkai"]')).toBeNull()
      expect(useFontLoaderStore.getState().loadingIds).toEqual([])
      expect(isBuiltinFontLoaded('lxgw-wenkai')).toBe(false)

      ensureBuiltinFontLoaded('lxgw-wenkai')
      expect(document.head.querySelector('link[data-bd-font="lxgw-wenkai"]')).not.toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('times out when the font face never confirms after the css loads', async () => {
    const load = vi.fn(() => new Promise(() => { /* hangs forever */ }))
    Object.defineProperty(document, 'fonts', { value: { load }, configurable: true, writable: true })
    vi.useFakeTimers()
    try {
      ensureBuiltinFontLoaded('noto-serif-sc')
      const link = document.head.querySelector('link[data-bd-font="noto-serif-sc"]') as HTMLLinkElement
      link.onload?.(new Event('load'))
      expect(useFontLoaderStore.getState().loadingIds).toContain('noto-serif-sc')

      await vi.advanceTimersByTimeAsync(10_000)

      expect(useFontLoaderStore.getState().loadingIds).toEqual([])
      expect(document.head.querySelector('link[data-bd-font="noto-serif-sc"]')).toBeNull()
      expect(isBuiltinFontLoaded('noto-serif-sc')).toBe(false)
    } finally {
      vi.useRealTimers()
      Reflect.deleteProperty(document, 'fonts')
    }
  })

  it('ignores a late success after the attempt timed out', async () => {
    let resolveLoad: ((faces: object[]) => void) | undefined
    const load = vi.fn(() => new Promise<object[]>((resolve) => { resolveLoad = resolve }))
    Object.defineProperty(document, 'fonts', { value: { load }, configurable: true, writable: true })
    vi.useFakeTimers()
    try {
      ensureBuiltinFontLoaded('literata')
      const link = document.head.querySelector('link[data-bd-font="literata"]') as HTMLLinkElement
      link.onload?.(new Event('load'))

      await vi.advanceTimersByTimeAsync(10_000)
      expect(isBuiltinFontLoaded('literata')).toBe(false)

      resolveLoad?.([{}])
      await Promise.resolve()
      await Promise.resolve()
      expect(isBuiltinFontLoaded('literata')).toBe(false)
      expect(document.head.querySelector('link[data-bd-font="literata"]')).toBeNull()
    } finally {
      vi.useRealTimers()
      Reflect.deleteProperty(document, 'fonts')
    }
  })
})

describe('buildFontOptions', () => {
  it('orders system → builtin → uploaded by default', () => {
    const options = buildFontOptions([uploadedFont])
    expect(options.map((o) => o.id)).toEqual([
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
      'abc123',
    ])
    expect(options.at(-1)).toMatchObject({
      source: 'uploaded',
      status: 'ready',
      name: 'My Handwriting',
      stack: `"bd-font-abc123", ${READER_GLYPH_FALLBACK}, serif`,
    })
  })

  it('applies a saved order to all available font ids', () => {
    const options = buildFontOptions([uploadedFont], { loadedIds: [], loadingIds: [] }, {}, [
      'abc123',
      'noto-sans-sc',
      'serif',
      'lxgw-wenkai',
      'noto-serif-sc',
      'sans-serif',
      'kaiti',
      'fangsong',
      'serif-en',
      'sans-en',
      'literata',
    ])
    expect(options.map((option) => option.id)).toEqual([
      'abc123',
      'noto-sans-sc',
      'serif',
      'lxgw-wenkai',
      'noto-serif-sc',
      'sans-serif',
      'kaiti',
      'fangsong',
      'serif-en',
      'sans-en',
      'literata',
    ])
  })

  it('derives the builtin status tri-state from the loader store', () => {
    expect(buildFontOptions().find((o) => o.id === 'lxgw-wenkai')?.status).toBe('idle')

    useFontLoaderStore.setState({ loadedIds: [], loadingIds: ['lxgw-wenkai'], latinIds: [] })
    expect(buildFontOptions().find((o) => o.id === 'lxgw-wenkai')?.status).toBe('loading')

    useFontLoaderStore.setState({ loadedIds: ['lxgw-wenkai'], loadingIds: [], latinIds: [] })
    expect(buildFontOptions().find((o) => o.id === 'lxgw-wenkai')?.status).toBe('ready')
  })

  it('keeps uploaded and system options always ready', () => {
    const options = buildFontOptions([uploadedFont])
    expect(options.filter((o) => o.source !== 'builtin').every((o) => o.status === 'ready')).toBe(true)
  })

  it('applies per-user names and visibility overrides', () => {
    const options = buildFontOptions([uploadedFont], { loadedIds: [], loadingIds: [] }, {
      abc123: { enabled: false, displayName: '手写' },
      serif: { displayName: '正文宋体' },
    })
    expect(options.find((o) => o.id === 'abc123')).toMatchObject({ name: '手写', enabled: false })
    expect(options.find((o) => o.id === 'serif')).toMatchObject({ name: '正文宋体', enabled: true })
  })

  it('uses the versioned proxy addresses for the noto fonts', () => {
    const serif = BUILTIN_FONTS.find((f) => f.id === 'noto-serif-sc')!
    expect(serif.cssUrl).toContain('/fonts/builtin/noto-serif-sc/5.3.0/css')
    expect(serif.family).toContain('Noto Serif SC Variable')
    const sans = BUILTIN_FONTS.find((f) => f.id === 'noto-sans-sc')!
    expect(sans.cssUrl).toContain('/fonts/builtin/noto-sans-sc/5.3.0/css')
    expect(sans.family).toContain('Noto Sans SC Variable')
  })

  it('exposes the wenkai and an English serif proxy entry', () => {
    const wenkai = BUILTIN_FONTS.find((f) => f.id === 'lxgw-wenkai')!
    expect(wenkai.cssUrl).toContain('/fonts/builtin/lxgw-wenkai/1.7.0/css')
    expect(wenkai.family).toContain('LXGW WenKai')
    const literata = BUILTIN_FONTS.find((f) => f.id === 'literata')!
    expect(literata.cssUrl).toContain('/fonts/builtin/literata/5.3.0/css')
    expect(literata.family).toContain('Literata Variable')
  })

  it('keeps system songti/hei stacks on local fonts ahead of Noto', () => {
    const serif = FONT_OPTIONS.find((f) => f.id === 'serif')!
    expect(serif.name).toBe('宋体')
    expect(serif.value.indexOf('"Songti SC"')).toBeLessThan(serif.value.indexOf('"Noto Serif SC"'))
    const sans = FONT_OPTIONS.find((f) => f.id === 'sans-serif')!
    expect(sans.name).toBe('黑体')
    expect(sans.value.indexOf('"PingFang SC"')).toBeLessThan(sans.value.indexOf('"Noto Sans SC"'))
  })

  it('marks only the western entries as latin', () => {
    const options = buildFontOptions()
    expect(options.filter((o) => o.latin).map((o) => o.id).sort()).toEqual(
      ['literata', 'sans-en', 'serif-en'].sort(),
    )
    expect(options.find((o) => o.id === 'serif')?.latin).toBe(false)
    expect(options.find((o) => o.id === 'lxgw-wenkai')?.latin).toBe(false)
  })
})

let leaseCounter = 0

describe('device fonts', () => {
  const deviceFont = {
    id: 'device-testfont1',
    family: 'Device SimSun',
    fileName: 'device-simsun.ttf',
    format: 'ttf' as const,
    size: 4096,
    contentHash: 'hash',
    createdAt: 0,
  }
  const deviceCatalog = { fonts: [deviceFont], preferences: {}, order: [] }

  beforeEach(() => {
    useDeviceFontStore.setState({ status: 'ready', fonts: [deviceFont], preferences: {}, order: [], selection: { primary: null, cjk: null } })
    useFontLoaderStore.setState({ loadedIds: [], loadingIds: [], latinIds: [] })
  })

  it('lets the merged device order interleave device fonts anywhere', () => {
    const second = { ...deviceFont, id: 'device-testfont2', family: 'Device Kaiti', createdAt: 1 }
    // Unified local order: the device font sits between the system entries
    const options = buildFontOptions([], useFontLoaderStore.getState(), {}, [], {
      fonts: [second, deviceFont],
      preferences: {},
      order: ['sans-serif', deviceFont.id, 'serif', second.id],
    })
    const ids = options.map((option) => option.id)
    expect(ids.indexOf(deviceFont.id)).toBeGreaterThan(ids.indexOf('sans-serif'))
    expect(ids.indexOf(deviceFont.id)).toBeLessThan(ids.indexOf('serif'))
    expect(ids.indexOf(second.id)).toBeGreaterThan(ids.indexOf('serif'))
    expect(options.find((option) => option.id === deviceFont.id)?.source).toBe('device')
    expect(options.find((option) => option.id === deviceFont.id)?.stack).toBe(`"bd-font-${deviceFont.id}", ${READER_GLYPH_FALLBACK}, serif`)
  })

  it('trails device fonts after the synced catalog while the local order is empty', () => {
    const second = { ...deviceFont, id: 'device-testfont2', family: 'Device Kaiti', createdAt: 1 }
    const options = buildFontOptions([], useFontLoaderStore.getState(), {}, [], {
      fonts: [second, deviceFont],
      preferences: {},
      order: [],
    })
    const ids = options.map((option) => option.id)
    // Both trail the synced catalog, in catalog sequence
    expect(ids.indexOf(second.id)).toBeGreaterThan(ids.indexOf('sans-en'))
    expect(ids.indexOf(deviceFont.id)).toBeGreaterThan(ids.indexOf(second.id))
    expect(options.filter((option) => option.source === 'device')).toHaveLength(2)
  })

  it('applies device-local display names and enabled flags without touching server preferences', () => {
    const options = buildFontOptions([], useFontLoaderStore.getState(), { sansserifother: { displayName: 'server-side' } }, [], {
      fonts: [deviceFont],
      preferences: { [deviceFont.id]: { displayName: '手写体', enabled: false } },
      order: [],
    })
    const device = options.find((option) => option.id === deviceFont.id)!
    expect(device.name).toBe('手写体')
    expect(device.enabled).toBe(false)
    expect(options.find((option) => option.id === 'sans-serif')?.name).toBe('黑体')
  })

  it('separates device identity from same-named server ids', () => {
    const serverRow: FontListItem = { id: 'device-testfont1', family: 'Server Twin', fileName: 'twin.woff2', format: 'woff2', size: 1, scope: 'user', mine: true, createdAt: 0 }
    const resolved = resolveFont('device-testfont1', [serverRow], {}, [], deviceCatalog)
    // Same id from both sources resolves by explicit source, not bare id
    expect(resolved.device).toBe(deviceFont)
    expect(resolved.uploaded).toBeUndefined()
    expect(resolved.name).toBe(deviceFont.family)
    expect(resolved.stack).toBe(`"bd-font-${deviceFont.id}", ${READER_GLYPH_FALLBACK}, serif`)
  })

  it('falls back when the selected device font is disabled', () => {
    const resolved = resolveFont(deviceFont.id, [], {}, [], {
      fonts: [deviceFont],
      preferences: { [deviceFont.id]: { enabled: false } },
      order: [],
    })
    expect(resolved.device).toBeUndefined()
    expect(resolved.stack).toBe(FONT_OPTIONS[0].value)
  })

  it('builds the device face from the pooled URL and never from a server address', () => {
    const resolved = resolveFont(deviceFont.id, [], {}, [], deviceCatalog)
    expect(fontCssFor(resolved)).toBe('')
    const css = fontCssFor(resolved, { [deviceFont.id]: 'blob:https://example.test/uuid' })
    expect(css).toContain(`font-family: "${uploadedFontAlias(deviceFont.id)}"`)
    expect(css).toContain('src: url("blob:https://example.test/uuid")')
    expect(css).toContain('format("truetype")')
    expect(css).not.toContain('/api/v1/fonts/')
    expect(css).not.toContain(window.location.origin)
  })

  it('resolves a CJK device primary and a device CJK companion with their faces', () => {
    const dual = resolveDualFont(deviceFont.id, deviceFont.id, [], {}, [], deviceCatalog, {
      [deviceFont.id]: 'blob:https://example.test/uuid',
    })
    expect(dual.stack).toBe(`"bd-font-${deviceFont.id}", ${READER_GLYPH_FALLBACK}, serif`)
    expect(dual.css).toContain('blob:https://example.test/uuid')
  })

  it('merges a latin primary with a device CJK companion and inlines both faces', () => {
    const dual = resolveDualFont('serif-en', deviceFont.id, [], {}, [], deviceCatalog, {
      [deviceFont.id]: 'blob:https://example.test/companion',
    })
    expect(dual.stack.startsWith('"Georgia", ')).toBe(true)
    expect(dual.stack).toContain(`"bd-font-${deviceFont.id}"`)
    // serif-en is a system stack (no css of its own); the device companion
    // contributes its pooled face
    expect(dual.css).toContain('blob:https://example.test/companion')
    expect(dual.css).not.toContain('/api/v1/fonts/')
  })

  it('omits the device face from the css while its URL is not pooled yet', () => {
    const dual = resolveDualFont('serif-en', deviceFont.id, [], {}, [], deviceCatalog)
    expect(dual.css).toBe('')
  })

  describe('device face lease', () => {
    // One shared in-memory factory: the URL pool caches its connection, so
    // both tests must hit the same IndexedDB instance
    beforeAll(() => {
      vi.stubGlobal('indexedDB', new IDBFactory())
      vi.stubGlobal('crypto', webcrypto)
      vi.stubGlobal('Blob', NativeBlob)
      vi.stubGlobal('File', NativeFile)
      vi.stubGlobal('URL', class extends URL {
        static createObjectURL = vi.fn(() => `blob:mock-${++leaseCounter}`)
        static revokeObjectURL = vi.fn()
      })
    })

  it('cancels a face lease released before the async load resolves, without leaking the URL', async () => {
    let revoked: string | null = null
    vi.mocked(URL.revokeObjectURL).mockImplementation((url: string) => { revoked = url })
    const database = new DeviceFontStore('bookdock-device-fonts')
    const bytes = new Uint8Array(12)
    new DataView(bytes.buffer).setUint32(0, 0x00010000)
    const imported = await database.import(new NativeFile([bytes], 'lease.ttf') as unknown as File)
    const font = { ...deviceFont, id: imported.font.id }

    const pending = ensureDeviceFontFace(font)
    // Unmount races the async load: the synchronous release must cancel it
    releaseDeviceFontFace(font.id)
    expect(await pending).toBeNull()
    expect(useDeviceFontUrlStore.getState().urls).toEqual({})
    expect(revoked).toBe('blob:mock-1')
  })

  it('pairs ensure/release for a mounted preview surface and removes the style on release', async () => {
    const database = new DeviceFontStore('bookdock-device-fonts')
    const bytes = new Uint8Array(12)
    new DataView(bytes.buffer).setUint32(0, 0x00010000)
    const imported = await database.import(new NativeFile([bytes], 'mounted.ttf') as unknown as File)
    const font = { ...deviceFont, id: imported.font.id }
    const selector = `style[data-bd-device-font="${font.id}"]`

    const url = await ensureDeviceFontFace(font)
    expect(url).toBe('blob:mock-2')
    expect(document.head.querySelector(selector)).not.toBeNull()
    // A second consumer shares the lease; one release keeps it mounted
    await ensureDeviceFontFace(font)
    releaseDeviceFontFace(font.id)
    expect(document.head.querySelector(selector)).not.toBeNull()
    releaseDeviceFontFace(font.id)
    expect(document.head.querySelector(selector)).toBeNull()
    expect(useDeviceFontUrlStore.getState().urls).toEqual({})
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-2')
  })

  it('keeps a re-ensured lease independent of the cancelled one it replaced', async () => {
    const database = new DeviceFontStore('bookdock-device-fonts')
    const bytes = new Uint8Array(12)
    new DataView(bytes.buffer).setUint32(0, 0x00010000)
    const imported = await database.import(new NativeFile([bytes], 'reentry.ttf') as unknown as File)
    const font = { ...deviceFont, id: imported.font.id }
    const selector = `style[data-bd-device-font="${font.id}"]`

    const cancelled = ensureDeviceFontFace(font)
    releaseDeviceFontFace(font.id)
    const renewed = ensureDeviceFontFace(font)
    expect(await cancelled).toBeNull()
    const url = await renewed
    expect(url).toMatch(/^blob:mock-/)
    // The cancelled lease must not have removed or corrupted the new entry
    expect(document.head.querySelector(selector)).not.toBeNull()
    releaseDeviceFontFace(font.id)
    expect(document.head.querySelector(selector)).toBeNull()
    expect(useDeviceFontUrlStore.getState().urls).toEqual({})
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
  })

  it('does not revoke a URL the reader still holds when a preview lease is cancelled', async () => {
    const database = new DeviceFontStore('bookdock-device-fonts')
    const bytes = new Uint8Array(12)
    new DataView(bytes.buffer).setUint32(0, 0x00010000)
    const imported = await database.import(new NativeFile([bytes], 'readerhold.ttf') as unknown as File)
    const font = { ...deviceFont, id: imported.font.id }

    const readerUrl = await acquireDeviceFontUrl(font.id)
    const pending = ensureDeviceFontFace(font)
    releaseDeviceFontFace(font.id)
    expect(await pending).toBeNull()
    // The preview release must not have consumed the reader's pool reference
    expect(peekDeviceFontUrl(font.id)).toBe(readerUrl)
    releaseDeviceFontUrl(font.id)
    expect(peekDeviceFontUrl(font.id)).toBeNull()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(readerUrl)
  })
  })

  it('hides never-fetched builtins when builtin downloads are not allowed, keeping loaded ones', () => {
    const loaded = BUILTIN_FONTS[0]!
    // A stale in-flight entry (link events never fire in jsdom) must not
    // resurrect a never-confirmed builtin for gated viewers
    useFontLoaderStore.setState({ loadedIds: [loaded.id], loadingIds: ['lxgw-wenkai'], latinIds: [] })
    const gated = buildFontOptions([], useFontLoaderStore.getState(), {}, [], deviceCatalog, false)
    const builtinIds = gated.filter((option) => option.source === 'builtin').map((option) => option.id)
    expect(builtinIds).toEqual([loaded.id])
    // Unrestricted callers keep the full catalog
    expect(buildFontOptions([], useFontLoaderStore.getState(), {}, [], deviceCatalog, true)
      .filter((option) => option.source === 'builtin')).toHaveLength(BUILTIN_FONTS.length)
  })

  it('falls back instead of resolving a never-fetched builtin for gated viewers', () => {
    useFontLoaderStore.setState({ loadedIds: [], loadingIds: [], latinIds: [] })
    const gated = resolveFont('lxgw-wenkai', [], {}, [], deviceCatalog, false)
    expect(gated.builtin).toBeUndefined()
    expect(gated.stack).toBe(FONT_OPTIONS[0].value)
    // Unloaded builtin as CJK companion also falls back to an available face
    const dual = resolveDualFont('serif-en', 'lxgw-wenkai', [], {}, [], deviceCatalog, {}, false)
    expect(dual.companion.builtin).toBeUndefined()
    // Allowed viewers resolve it normally
    expect(resolveFont('lxgw-wenkai', [], {}, [], deviceCatalog, true).builtin).toBeDefined()
  })

  it('prefers the localized name for the UI language, then any other, then family', () => {
    const names = { '409': 'Source Han Sans', '804': '思源黑体' }
    const options = buildFontOptions([], useFontLoaderStore.getState(), {}, [], {
      fonts: [{ ...deviceFont, localNames: names }],
      preferences: {},
      order: [],
    })
    expect(options.find((option) => option.id === deviceFont.id)?.name).toBe('思源黑体')

    // No record for the UI language falls back to any other language's name
    const enOnly = buildFontOptions([], useFontLoaderStore.getState(), {}, [], {
      fonts: [{ ...deviceFont, localNames: { '409': 'Source Han Sans' } }],
      preferences: {},
      order: [],
    })
    expect(enOnly.find((option) => option.id === deviceFont.id)?.name).toBe('Source Han Sans')

    // Without localNames the cross-language family applies
    const noNames = buildFontOptions([], useFontLoaderStore.getState(), {}, [], {
      fonts: [deviceFont],
      preferences: {},
      order: [],
    })
    expect(noNames.find((option) => option.id === deviceFont.id)?.name).toBe(deviceFont.family)
  })

  it('applies localized names to uploaded server fonts too', () => {
    const uploaded: FontListItem = { ...uploadedFont, localNames: { '804': '我的手写体' } }
    const options = buildFontOptions([uploaded])
    expect(options.find((option) => option.id === 'abc123')?.name).toBe('我的手写体')
  })

  it('keeps device presentation in the device store, disjoint from the synced ui store', () => {
    const { setFontPreference, setFontOrder } = useUiStore.getState()
    setFontPreference('serif', { displayName: 'server-side name' })
    setFontOrder(['serif'])
    useDeviceFontStore.getState().setPreference(deviceFont.id, { displayName: 'device-side name' })
    useDeviceFontStore.getState().selectPrimary(deviceFont.id)

    // pickSettings reads only the ui store, so no device reference can enter
    // the account payload; the two stores never share preference keys
    const syncedPreferences = useUiStore.getState().fontPreferences
    expect(Object.keys(syncedPreferences)).toEqual(['serif'])
    expect(useUiStore.getState().fontOrder).toEqual(['serif'])
    expect(useDeviceFontStore.getState().preferences[deviceFont.id]).toEqual({ displayName: 'device-side name' })
    expect(useDeviceFontStore.getState().selection.primary).toBe(deviceFont.id)
  })
})
