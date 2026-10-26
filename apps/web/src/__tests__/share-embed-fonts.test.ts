import { afterEach, describe, expect, it, vi } from 'vitest'

import { embedCardFonts } from '../features/reader/components/share/embed-fonts'
import { resolveFont } from '../features/reader/fonts'

afterEach(() => vi.unstubAllGlobals())

describe('share font embedding', () => {
  it('embeds selected CDN faces with absolute font URLs and only used Unicode subsets', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('.css')) return new Response(`
        @font-face { font-family: "LXGW WenKai"; src: url("./latin.woff2"); unicode-range: U+0-FF; }
        @font-face { font-family: "LXGW WenKai"; src: url("./han.woff2"); unicode-range: U+4E00-9FFF; }
        @font-face { font-family: "LXGW WenKai"; font-weight: 700; src: url("./han.woff2"); unicode-range: U+4E00-9FFF; }
      `)
      return { ok: true, blob: async () => new Blob(['font data'], { type: 'font/woff2' }) }
    })
    vi.stubGlobal('fetch', fetcher)
    const font = resolveFont('lxgw-wenkai')
    const css = await embedCardFonts([font, font], '汉')
    expect(css).toContain('data:font/woff2;base64,')
    expect(css).toContain('font-weight: 700')
    expect(css).not.toContain('U+0-FF')
    expect(css).not.toContain('./han.woff2')
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      font.builtin!.cssUrl,
      new URL('./han.woff2', font.builtin!.cssUrl).href,
    ])
  })

  it('follows WenKai-style CSS imports and resolves font URLs relative to each child stylesheet', async () => {
    const font = resolveFont('lxgw-wenkai')
    const fetcher = vi.fn(async (url: string) => {
      if (url === font.builtin!.cssUrl) return new Response("@import url('./nested/regular.css'); @import './mono.css';")
      if (url.endsWith('/regular.css')) return new Response('@font-face { font-family: "LXGW WenKai"; src: url(../files/regular.woff2); unicode-range: U+4E??; }')
      if (url.endsWith('/mono.css')) return new Response('@font-face { font-family: "LXGW WenKai Mono"; src: url(./mono.woff2); }')
      return { ok: true, blob: async () => new Blob(['font'], { type: 'font/woff2' }) }
    })
    vi.stubGlobal('fetch', fetcher)
    const css = await embedCardFonts([font], '书')
    expect(css).toContain('data:font/woff2;base64,')
    expect(css).not.toContain('LXGW WenKai Mono')
    expect(fetcher.mock.calls.map(([url]) => url)).toContain(new URL('./files/regular.woff2', font.builtin!.cssUrl).href)
    expect(fetcher.mock.calls.some(([url]) => url.endsWith('/mono.woff2'))).toBe(false)
  })

  it('rejects missing font bytes instead of producing a fallback-font image', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('.css')
      ? new Response('@font-face { font-family: "LXGW WenKai"; src: url(./font.woff2); }')
      : new Response('', { status: 404 })))
    await expect(embedCardFonts([resolveFont('lxgw-wenkai')], '字')).rejects.toThrow('card font file unavailable')
  })

  it('does not scan or fetch webfonts for system-font cards', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect(await embedCardFonts([resolveFont('heiti')], '字')).toBe('')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
