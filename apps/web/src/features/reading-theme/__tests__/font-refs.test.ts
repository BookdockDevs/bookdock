import { describe, expect, it } from 'vitest'

import type { FontOption } from '@/features/reader/fonts'

import { resolveThemeFontRefs, themeFontReference, themeFontSources } from '../font-refs'

function option(overrides: Partial<FontOption> & { id: string; source: FontOption['source'] }): FontOption {
  return {
    name: overrides.id,
    stack: '',
    status: 'ready',
    enabled: true,
    latin: false,
    ...overrides,
  }
}

const GLYPH = '"Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Segoe UI Symbol", "Noto Sans Symbols 2", "Noto Sans Symbols", "Arial Unicode MS"'

const systemOption = option({
  id: 'serif',
  source: 'system',
  name: '宋体',
  stack: `"Songti SC", "SimSun", ${GLYPH}, serif`,
})

const uploadedOption = option({
  id: 'FONT1',
  source: 'uploaded',
  name: '本机上传',
  stack: `"bd-font-FONT1", ${GLYPH}, serif`,
  uploaded: {
    id: 'FONT1', family: 'Uploaded', format: 'woff2', size: 1, scope: 'user',
    createdAt: 0, updatedAt: 0, mine: true,
  } as unknown as FontOption['uploaded'],
})

const builtinOption = option({
  id: 'lxgw-wenkai',
  source: 'builtin',
  name: '霞鹜文楷',
  stack: `"LXGW WenKai", ${GLYPH}, serif`,
  builtin: {
    id: 'lxgw-wenkai', name: '霞鹜文楷', familyName: 'LXGW WenKai', generic: 'serif',
    version: '1.0.0', family: `"LXGW WenKai", ${GLYPH}, serif`, cssUrl: 'https://cdn.example/lxgw.css',
  } as unknown as FontOption['builtin'],
})

const deviceOption = option({
  id: 'device-abc',
  source: 'device',
  name: '本机导入',
  stack: `"bd-font-device-abc", ${GLYPH}, serif`,
  device: { id: 'device-abc', family: 'Imported', format: 'ttf', size: 1, localNames: null, createdAt: 0 } as unknown as FontOption['device'],
})

const catalog = [systemOption, uploadedOption, builtinOption, deviceOption]

describe('themeFontReference', () => {
  it('copies the plain family stack for a system face', () => {
    expect(themeFontReference(systemOption)).toBe('font-family: "Songti SC", "SimSun", serif;')
  })

  it('copies a stable id-based reference plus fallback for managed faces', () => {
    expect(themeFontReference(uploadedOption)).toBe('font-family: "bd-font:FONT1", serif;')
    expect(themeFontReference(builtinOption)).toBe('font-family: "bd-font:lxgw-wenkai", serif;')
    // a renamed display name never enters the copied declaration
    expect(themeFontReference({ ...uploadedOption, name: '改过的名字' })).toBe('font-family: "bd-font:FONT1", serif;')
  })
})

describe('themeFontSources', () => {
  it('resolves each referenced id to its family and face rules', () => {
    const sources = themeFontSources(['serif', 'FONT1', 'lxgw-wenkai', 'device-abc'], catalog, { 'device-abc': 'blob:http://localhost/font' })
    expect(sources.stacks.get('serif')).toBe('"Songti SC"')
    expect(sources.stacks.get('FONT1')).toBe('"bd-font-FONT1"')
    expect(sources.faces.get('serif')).toBeUndefined()
    expect(sources.faces.get('FONT1')).toContain('@font-face')
    expect(sources.faces.get('FONT1')).toContain('/fonts/FONT1/file')
    expect(sources.faces.get('lxgw-wenkai')).toBe('@import url("https://cdn.example/lxgw.css");')
    expect(sources.faces.get('device-abc')).toContain('blob:http://localhost/font')
  })

  it('leaves a device face without a pooled URL unresolved', () => {
    const sources = themeFontSources(['device-abc'], catalog, {})
    expect(sources.stacks.has('device-abc')).toBe(false)
    expect(sources.faces.has('device-abc')).toBe(false)
  })

  it('drops ids the catalog no longer has', () => {
    const sources = themeFontSources(['gone', 'FONT1'], catalog)
    expect([...sources.stacks.keys()]).toEqual(['FONT1'])
  })
})

describe('resolveThemeFontRefs', () => {
  it('preserves fallback order and puts online imports first even if they are referenced last', () => {
    const sources = themeFontSources(['lxgw-wenkai', 'FONT1'], catalog)
    const resolved = resolveThemeFontRefs('[data-bd-chapter-title] { font-family: "bd-font:FONT1", "bd-font:lxgw-wenkai", sans-serif }', sources)
    expect(resolved.css).toContain('font-family: "bd-font-FONT1", "LXGW WenKai", sans-serif;')
    expect(resolved.css).not.toContain('bd-font:lxgw-wenkai')
    expect(resolved.faces.indexOf('@import')).toBeLessThan(resolved.faces.indexOf('@font-face'))
  })

  it('leaves disabled references on the authored fallback', () => {
    const css = 'p { font-family: "bd-font:lxgw-wenkai", sans-serif }'
    const sources = themeFontSources(['lxgw-wenkai'], [{ ...builtinOption, enabled: false }])
    expect(resolveThemeFontRefs(css, sources)).toEqual({ css, faces: '' })
  })

  it('is a no-op without referenced tokens or without sources', () => {
    const css = 'p { color: red }'
    expect(resolveThemeFontRefs(css, undefined)).toEqual({ css, faces: '' })
    expect(resolveThemeFontRefs(css, themeFontSources([], catalog))).toEqual({ css, faces: '' })
  })
})
