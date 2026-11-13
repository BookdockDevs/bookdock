import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'

import { BUILTIN_FONTS } from '@bookdock/shared'

import { errorHandler } from '../../middleware/error'
import { resetFontCacheForTest } from './font-cache'
import { resetBuiltinFontInflightForTest, resolveRelativePath, rewriteBuiltinCss } from './builtin-fonts.service'
import builtinFontsRoutes from './builtin-fonts.routes'

const state = vi.hoisted(() => ({ directory: '' }))
vi.mock('../../config', () => ({ config: { get dataDir() { return state.directory }, fontCacheMaxMb: 1 } }))

const FONT = BUILTIN_FONTS.find((font) => font.id === 'noto-serif-sc')!
const ORIGIN = 'http://test'

interface UpstreamMock {
  status: number
  body: Buffer
  url?: string
}

function createApp() {
  const app = new Hono()
  app.onError(errorHandler)
  app.route('/api/v1/fonts/builtin', builtinFontsRoutes)
  return app
}

describe('builtin font path resolution', () => {
  it('resolves package-relative references against the containing stylesheet', () => {
    expect(resolveRelativePath('index.css', './files/a.woff2')).toBe('files/a.woff2')
    expect(resolveRelativePath('css/sub/a.css', '../files/b.woff2')).toBe('css/files/b.woff2')
    expect(resolveRelativePath('style.css', './lxgwwenkai-regular.css')).toBe('lxgwwenkai-regular.css')
  })

  it('rejects references the proxy must not follow', () => {
    expect(resolveRelativePath('index.css', 'https://evil.example/a.css')).toBeNull()
    expect(resolveRelativePath('index.css', 'data:font/woff2;base64,AAAA')).toBeNull()
    expect(resolveRelativePath('index.css', '/root-absolute.css')).toBeNull()
    expect(resolveRelativePath('index.css', '../../escape.css')).toBeNull()
    expect(resolveRelativePath('index.css', 'has space.woff2')).toBeNull()
  })
})

describe('builtin font css rewrite', () => {
  it('rewrites relative urls and imports to root-relative proxy addresses', () => {
    const css = [
      '@import url(\'./lxgwwenkai-regular.css\');',
      '@font-face { src: url(./files/a.woff2) format("woff2"); }',
      `@font-face { src: url("${ORIGIN}/keep/absolute.woff2"); }`,
    ].join('\n')
    const rewritten = rewriteBuiltinCss(css, FONT.id, FONT.version, FONT.upstreamCssPath)
    const base = `/api/v1/fonts/builtin/${FONT.id}/${FONT.version}/res`
    expect(rewritten).toContain(`@import url("${base}/lxgwwenkai-regular.css");`)
    expect(rewritten).toContain(`src: url("${base}/files/a.woff2")`)
    expect(rewritten).toContain(`url("${ORIGIN}/keep/absolute.woff2")`)
  })
})

describe('builtin font proxy routes', () => {
  let app: ReturnType<typeof createApp>
  let fetchMock: ReturnType<typeof vi.fn>

  function mockUpstream(responses: Record<string, UpstreamMock>) {
    fetchMock = vi.fn(async (url: string | URL) => {
      const key = String(url)
      const mock = responses[key]
      if (!mock) return { ok: false, status: 404, url: key, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }
      return {
        ok: mock.status === 200,
        status: mock.status,
        url: mock.url ?? key,
        headers: { get: () => String(mock.body.length) },
        arrayBuffer: async () => mock.body.buffer.slice(mock.body.byteOffset, mock.body.byteOffset + mock.body.byteLength),
      }
    })
    vi.stubGlobal('fetch', fetchMock)
  }

  beforeEach(() => {
    state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bd-font-cache-'))
    resetFontCacheForTest()
    resetBuiltinFontInflightForTest()
    app = createApp()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    fs.rmSync(state.directory, { recursive: true, force: true })
  })

  it('serves the entry css rewritten and caches it across requests', async () => {
    mockUpstream({
      [`https://cdn.jsdelivr.net/npm/${FONT.upstreamPackage}@${FONT.version}/index.css`]: {
        status: 200,
        body: Buffer.from('@font-face { src: url(./files/a.woff2); }'),
      },
    })

    const first = await app.request(`http://test/api/v1/fonts/builtin/${FONT.id}/${FONT.version}/css`)
    expect(first.status).toBe(200)
    expect(first.headers.get('Content-Type')).toBe('text/css; charset=utf-8')
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(await first.text()).toBe(`@font-face { src: url("/api/v1/fonts/builtin/${FONT.id}/${FONT.version}/res/files/a.woff2"); }`)

    const second = await app.request(`http://test/api/v1/fonts/builtin/${FONT.id}/${FONT.version}/css`)
    expect(second.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('serves font resources raw and caches them across requests', async () => {
    const bytes = Buffer.from('woff2-bytes')
    mockUpstream({
      [`https://cdn.jsdelivr.net/npm/${FONT.upstreamPackage}@${FONT.version}/files/a.woff2`]: {
        status: 200,
        body: bytes,
      },
    })

    const first = await app.request(`http://test/api/v1/fonts/builtin/${FONT.id}/${FONT.version}/res/files/a.woff2`)
    expect(first.status).toBe(200)
    expect(first.headers.get('Content-Type')).toBe('font/woff2')
    expect(Buffer.from(await first.arrayBuffer()).equals(bytes)).toBe(true)

    const second = await app.request(`http://test/api/v1/fonts/builtin/${FONT.id}/${FONT.version}/res/files/a.woff2`)
    expect(second.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rewrites sub-stylesheets relative to their own package path', async () => {
    mockUpstream({
      [`https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/lxgwwenkai-regular.css`]: {
        status: 200,
        body: Buffer.from('@font-face { src: url("./files/LXGWWenKai-Regular.woff2"); }'),
      },
    })
    const res = await app.request('http://test/api/v1/fonts/builtin/lxgw-wenkai/1.7.0/res/lxgwwenkai-regular.css')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('@font-face { src: url("/api/v1/fonts/builtin/lxgw-wenkai/1.7.0/res/files/LXGWWenKai-Regular.woff2"); }')
  })

  it('404s unknown ids, versions, extensions and traversal segments', async () => {
    mockUpstream({})
    const routes = [
      `/api/v1/fonts/builtin/unknown-font/${FONT.version}/css`,
      `/api/v1/fonts/builtin/${FONT.id}/9.9.9/css`,
      `/api/v1/fonts/builtin/${FONT.id}/${FONT.version}/res/files/evil.exe`,
      `/api/v1/fonts/builtin/${FONT.id}/${FONT.version}/res/../secret.css`,
      `/api/v1/fonts/builtin/${FONT.id}/${FONT.version}/res/files/sub%20dir/a.woff2`,
    ]
    for (const route of routes) {
      const res = await app.request(`http://test${route}`)
      expect(res.status).toBe(404)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers 502 when the upstream CDN fails', async () => {
    mockUpstream({
      [`https://cdn.jsdelivr.net/npm/${FONT.upstreamPackage}@${FONT.version}/index.css`]: {
        status: 503,
        body: Buffer.alloc(0),
      },
    })
    const res = await app.request(`http://test/api/v1/fonts/builtin/${FONT.id}/${FONT.version}/css`)
    expect(res.status).toBe(502)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('FONT_UPSTREAM_FAILED')
  })

  it('deduplicates concurrent misses into one upstream fetch', async () => {
    mockUpstream({
      [`https://cdn.jsdelivr.net/npm/${FONT.upstreamPackage}@${FONT.version}/files/a.woff2`]: {
        status: 200,
        body: Buffer.from('concurrent'),
      },
    })
    const [a, b] = await Promise.all([
      app.request(`http://test/api/v1/fonts/builtin/${FONT.id}/${FONT.version}/res/files/a.woff2`),
      app.request(`http://test/api/v1/fonts/builtin/${FONT.id}/${FONT.version}/res/files/a.woff2`),
    ])
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('caps distinct-resource upstream concurrency instance-wide', async () => {
    // Manually resolved upstream responses: track how many fetches are in
    // flight at once across six distinct cold-cache shards.
    let inFlight = 0
    let peak = 0
    const resolvers: (() => void)[] = []
    fetchMock = vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise<void>((resolve) => resolvers.push(resolve))
      inFlight--
      return {
        ok: true,
        status: 200,
        // Must stay inside the pinned package or the redirect guard rejects it
        url: `https://cdn.jsdelivr.net/npm/${FONT.upstreamPackage}@${FONT.version}/files/x.woff2`,
        headers: { get: () => '1' },
        arrayBuffer: async () => new ArrayBuffer(1),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    const requests = ['a', 'b', 'c', 'd', 'e', 'f'].map((name) =>
      app.request(`http://test/api/v1/fonts/builtin/${FONT.id}/${FONT.version}/res/files/${name}.woff2`),
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(4)

    resolvers[0]!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fetchMock).toHaveBeenCalledTimes(5)

    // Each release may start another queued fetch that parks a new resolver,
    // so drain until every request has flowed through the semaphore.
    while (resolvers.length > 0) {
      resolvers.shift()!()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const responses = await Promise.all(requests)
    expect(responses.every((res) => res.status === 200)).toBe(true)
    expect(peak).toBeLessThanOrEqual(4)
  })
})
