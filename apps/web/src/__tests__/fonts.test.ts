import { beforeEach, describe, expect, it } from 'vitest'

import type { FontListItem } from '@bookdock/shared'

import {
  BUILTIN_FONTS,
  buildFontOptions,
  builtinImportCss,
  ensureBuiltinFontLoaded,
  fontCssFor,
  isBuiltinFontLoaded,
  resolveFont,
  uploadedFaceCss,
  uploadedFontAlias,
  useFontLoaderStore,
} from '../features/reader/fonts'
import { FONT_OPTIONS } from '../features/reader/types'

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

beforeEach(() => {
  localStorage.clear()
  useFontLoaderStore.setState({ loadedIds: [], loadingIds: [] })
})

describe('resolveFont', () => {
  it('resolves system stacks by id', () => {
    const resolved = resolveFont('kaiti', [])
    expect(resolved.stack).toBe(FONT_OPTIONS.find((f) => f.id === 'kaiti')!.value)
    expect(resolved.builtin).toBeUndefined()
    expect(resolved.uploaded).toBeUndefined()
  })

  it('resolves builtin CDN fonts', () => {
    const resolved = resolveFont('lxgw-wenkai', [])
    expect(resolved.name).toBe('霞鹜文楷')
    expect(resolved.stack).toBe(BUILTIN_FONTS[0].family)
    expect(resolved.builtin?.cssUrl).toContain('lxgw-wenkai-webfont')
  })

  it('resolves uploaded fonts to the aliased family', () => {
    const resolved = resolveFont('abc123', [uploadedFont])
    expect(resolved.name).toBe('My Handwriting')
    expect(resolved.stack).toBe('"bd-font-abc123", serif')
    expect(resolved.uploaded).toBe(uploadedFont)
  })

  it('falls back to the first system stack for unknown ids', () => {
    expect(resolveFont('does-not-exist', []).stack).toBe(FONT_OPTIONS[0].value)
    expect(resolveFont('does-not-exist', []).name).toBe(FONT_OPTIONS[0].name)
  })

  it('prefers system stacks over builtin ids and uploaded rows', () => {
    const resolved = resolveFont('serif', [{ ...uploadedFont, id: 'serif' }])
    expect(resolved.uploaded).toBeUndefined()
    expect(resolved.stack).toBe(FONT_OPTIONS[0].value)
  })

  it('falls back when the selected font is disabled', () => {
    const resolved = resolveFont('kaiti', [], {
      kaiti: { enabled: false },
      serif: { displayName: '正文' },
    })
    expect(resolved.name).toBe('正文')
    expect(resolved.stack).toBe(FONT_OPTIONS[0].value)
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
    expect(css).toMatch(/^@import url\("https:\/\/cdn\.jsdelivr\.net\//)
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
})

describe('buildFontOptions', () => {
  it('orders system → builtin → uploaded by default', () => {
    const options = buildFontOptions([uploadedFont])
    expect(options.map((o) => o.id)).toEqual([
      'serif',
      'sans-serif',
      'kaiti',
      'fangsong',
      'lxgw-wenkai',
      'noto-serif-sc',
      'noto-sans-sc',
      'abc123',
    ])
    expect(options.at(-1)).toMatchObject({
      source: 'uploaded',
      status: 'ready',
      name: 'My Handwriting',
      stack: '"bd-font-abc123", serif',
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
    ])
  })

  it('derives the builtin status tri-state from the loader store', () => {
    expect(buildFontOptions().find((o) => o.id === 'lxgw-wenkai')?.status).toBe('idle')

    useFontLoaderStore.setState({ loadedIds: [], loadingIds: ['lxgw-wenkai'] })
    expect(buildFontOptions().find((o) => o.id === 'lxgw-wenkai')?.status).toBe('loading')

    useFontLoaderStore.setState({ loadedIds: ['lxgw-wenkai'], loadingIds: [] })
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

  it('uses the variable fontsource packages for the noto fonts', () => {
    const serif = BUILTIN_FONTS.find((f) => f.id === 'noto-serif-sc')!
    expect(serif.cssUrl).toContain('@fontsource-variable/noto-serif-sc')
    expect(serif.family).toContain('Noto Serif SC Variable')
    const sans = BUILTIN_FONTS.find((f) => f.id === 'noto-sans-sc')!
    expect(sans.cssUrl).toContain('@fontsource-variable/noto-sans-sc')
    expect(sans.family).toContain('Noto Sans SC Variable')
  })
})
