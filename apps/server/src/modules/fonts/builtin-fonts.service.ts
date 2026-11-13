import path from 'node:path'

import { findBuiltinFont } from '@bookdock/shared'
import type { BuiltinFont } from '@bookdock/shared'

import { AppError } from '../../middleware/error'
import { readFontCache, writeFontCache } from './font-cache'

/** Builtin fonts are pinned open-source packages on a public CDN. This proxy
 *  fetches their bytes once per instance, caches them locally, and rewrites
 *  the stylesheets so reader iframes never talk to the CDN directly. Upstream
 *  access is locked to registry entries: only pinned id+version combinations,
 *  fixed extensions, flat package-relative paths, bounded size and timeouts. */

const UPSTREAM_CDN_BASE = 'https://cdn.jsdelivr.net/npm'
const UPSTREAM_TIMEOUT_MS = 30_000
const UPSTREAM_MAX_BYTES = 20 * 1024 * 1024

const RESOURCE_EXTENSIONS = new Set(['.css', '.woff2', '.woff', '.ttf', '.otf'])
const SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/

const RESOURCE_CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

// Both the CSS (rewritten per request from pinned upstream bytes) and the font
// binaries are content-stable under a versioned address, so long-lived caching
// is correct for every response this module produces.
const FONT_CACHE_CONTROL = 'public, max-age=31536000, immutable'

export interface BuiltinFontResource {
  data: Buffer
  contentType: string
  cacheControl: string
}

const inflight = new Map<string, Promise<Buffer>>()

// The endpoints allow anonymous access and a cold cache makes every distinct
// shard a separate miss; without an instance-wide cap, one cold reader could
// hold unbounded concurrent upstream connections and response buffers (the
// disk LRU only bounds what has already been written).
const MAX_UPSTREAM_CONCURRENCY = 4
let activeUpstreamFetches = 0
const upstreamWaiters: (() => void)[] = []

async function withUpstreamSlot<T>(run: () => Promise<T>): Promise<T> {
  if (activeUpstreamFetches >= MAX_UPSTREAM_CONCURRENCY) {
    await new Promise<void>((resolve) => upstreamWaiters.push(resolve))
  }
  activeUpstreamFetches++
  try {
    return await run()
  } finally {
    activeUpstreamFetches--
    upstreamWaiters.shift()?.()
  }
}

/** Resolve a package-relative url() reference against the stylesheet that
 *  contains it. Returns null for references the proxy must not touch. */
export function resolveRelativePath(fromPath: string, reference: string): string | null {
  const clean = reference.split('?')[0]?.split('#')[0] ?? ''
  if (!clean || clean.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return null
  const dir = path.posix.dirname(fromPath)
  const resolved = path.posix.normalize(dir === '.' ? clean : `${dir}/${clean}`)
  if (resolved.startsWith('..')) return null
  if (!resolved.split('/').every((segment) => SEGMENT_PATTERN.test(segment))) return null
  return resolved
}

/** Rewrite every relative url() (including @import url(...)) to a root-relative
 *  proxy address. Root-relative is deliberate: CSS resolves it against the
 *  stylesheet's own URL (a site-origin URL), so it follows whatever scheme the
 *  page uses — an absolute origin taken from the backend request would read as
 *  http:// behind a TLS-terminating reverse proxy and get blocked as mixed
 *  content. The frontend keeps the entry @import absolute. */
export function rewriteBuiltinCss(css: string, fontId: string, version: string, cssPath: string): string {
  const base = `/api/v1/fonts/builtin/${fontId}/${version}/res`
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _quote: string, reference: string) => {
    if (/^(?:https?:)?\/\//i.test(reference) || reference.startsWith('data:')) return match
    const resolved = resolveRelativePath(cssPath, reference)
    if (!resolved) return match
    return `url("${base}/${resolved}")`
  })
}

export async function getBuiltinFontCss(fontId: string, version: string): Promise<BuiltinFontResource> {
  const font = findBuiltinFont(fontId, version)
  if (!font) throw new AppError('FONT_NOT_FOUND')
  const resource = await loadResource(font, font.upstreamCssPath.split('/'))
  return {
    ...resource,
    data: Buffer.from(rewriteBuiltinCss(resource.data.toString('utf8'), fontId, version, font.upstreamCssPath), 'utf8'),
  }
}

export async function getBuiltinFontResource(fontId: string, version: string, resourcePath: string): Promise<BuiltinFontResource> {
  const font = findBuiltinFont(fontId, version)
  if (!font) throw new AppError('FONT_NOT_FOUND')
  const segments = resourcePath.split('/')
  // Unknown or malformed paths answer 404 like missing ones — no probing leak
  if (segments.length === 0 || !segments.every((segment) => segment.length > 0 && SEGMENT_PATTERN.test(segment))) {
    throw new AppError('FONT_NOT_FOUND')
  }
  const ext = path.posix.extname(resourcePath).toLowerCase()
  if (!RESOURCE_EXTENSIONS.has(ext)) throw new AppError('FONT_NOT_FOUND')
  const resource = await loadResource(font, segments)
  if (ext === '.css') {
    return {
      ...resource,
      data: Buffer.from(rewriteBuiltinCss(resource.data.toString('utf8'), fontId, version, resourcePath), 'utf8'),
    }
  }
  return resource
}

async function loadResource(font: BuiltinFont, segments: string[]): Promise<BuiltinFontResource> {
  const ext = path.posix.extname(segments[segments.length - 1]!).toLowerCase()
  const cacheKey = `${font.id}/${font.version}/${segments.join('/')}`

  const cached = readFontCache(cacheKey)
  if (cached) {
    return { data: cached, contentType: RESOURCE_CONTENT_TYPES[ext]!, cacheControl: FONT_CACHE_CONTROL }
  }

  const data = await fetchUpstream(font, segments, cacheKey)
  return { data, contentType: RESOURCE_CONTENT_TYPES[ext]!, cacheControl: FONT_CACHE_CONTROL }
}

async function fetchUpstream(font: BuiltinFont, segments: string[], cacheKey: string): Promise<Buffer> {
  const existing = inflight.get(cacheKey)
  if (existing) return existing

  const upstreamUrl = `${UPSTREAM_CDN_BASE}/${font.upstreamPackage}@${font.version}/${segments.map(encodeURIComponent).join('/')}`
  const expectedPrefix = `${UPSTREAM_CDN_BASE}/${font.upstreamPackage}@${font.version}/`
  const task = withUpstreamSlot(async () => {
    let response: Response
    try {
      response = await fetch(upstreamUrl, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })
    } catch {
      throw new AppError('FONT_UPSTREAM_FAILED', `Upstream font CDN unreachable: ${upstreamUrl}`)
    }
    if (!response.ok) {
      throw new AppError('FONT_UPSTREAM_FAILED', `Upstream font CDN returned ${response.status} for ${upstreamUrl}`)
    }
    // A redirect that leaves the pinned package would turn this endpoint into
    // an arbitrary fetcher; jsDelivr serves pinned versions directly.
    if (!response.url.startsWith(expectedPrefix)) {
      throw new AppError('FONT_UPSTREAM_FAILED', `Upstream redirected outside the pinned package: ${response.url}`)
    }
    const declaredLength = Number(response.headers.get('content-length') ?? '')
    if (Number.isFinite(declaredLength) && declaredLength > UPSTREAM_MAX_BYTES) {
      throw new AppError('FONT_UPSTREAM_FAILED', `Upstream font too large: ${upstreamUrl}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > UPSTREAM_MAX_BYTES) {
      throw new AppError('FONT_UPSTREAM_FAILED', `Upstream font too large: ${upstreamUrl}`)
    }
    writeFontCache(cacheKey, buffer)
    return buffer
  })
  inflight.set(cacheKey, task)
  try {
    return await task
  } finally {
    if (inflight.get(cacheKey) === task) inflight.delete(cacheKey)
  }
}

/** Test helper: drop in-flight upstream fetches between tests. */
export function resetBuiltinFontInflightForTest(): void {
  inflight.clear()
}
