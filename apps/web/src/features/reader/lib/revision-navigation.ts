import type { ReaderManifest } from '@bookdock/shared'

import { fetchLatestReaderManifest, ReaderContentError, ReaderContentSession } from './reader-content-client'

export interface ReaderRevisionNavigationIntent {
  target?: string
  sectionHref?: string
  chapterNavigation: boolean
  explicitRevisionId?: string
}

export interface ReaderRevisionIdentity {
  bookId: string
  revisionId: string
  contentHash: string | null
  generated?: boolean
}

function pathFromHref(href: string): string {
  const path = href.split(/[?#]/, 1)[0] ?? ''
  try { return decodeURIComponent(path).replace(/^\/+/, '') } catch { return path.replace(/^\/+/, '') }
}

export function resolveRevisionNavigationTarget(
  previous: ReaderRevisionIdentity,
  latest: ReaderManifest,
  intent: ReaderRevisionNavigationIntent,
): string | null {
  if (previous.bookId !== latest.bookId || previous.revisionId === latest.revisionId) return null
  const target = intent.target
  if (previous.contentHash && previous.contentHash === latest.contentHash && target) return target
  if (!intent.chapterNavigation) return null
  // Generated TXT EPUBs use ordinal filenames, so an exact href can point to
  // a different chapter after insertion or deletion. The manifest currently
  // carries no durable chapter correspondence for those generated books.
  if (previous.generated || latest.generated) return null
  const href = target && !/^(?:epubcfi\(|search-hit:|chapter:)/.test(target)
    ? target
    : intent.sectionHref
  if (!href) return null
  const path = pathFromHref(href)
  if (!path || !latest.spine.some((item) => item.path === path)) return null
  const fragment = target && href === target ? target.match(/#[^?]*$/)?.[0] : undefined
  return `${path}${fragment ?? ''}`
}

export function extractReaderManifestToc(manifest: ReaderManifest): { label: string; href: string; level?: number }[] {
  const files = new Map(manifest.startupFiles.map((file) => [file.path, file.text]))
  const navText = manifest.navPath ? files.get(manifest.navPath) : undefined
  if (navText) {
    const doc = new DOMParser().parseFromString(navText, 'text/html')
    const navs = [...doc.querySelectorAll('nav')]
    const nav = navs.find((item) => /(?:^|\s)toc(?:\s|$)/i.test(item.getAttribute('epub:type') ?? '')) ?? navs[0]
    if (nav) {
      return [...nav.querySelectorAll('a[href]')].flatMap((anchor) => {
        const label = anchor.textContent?.trim()
        const href = anchor.getAttribute('href')
        if (!label || !href) return []
        const resolved = new URL(href, `https://reader.invalid/${manifest.navPath}`).pathname
        let path = resolved.replace(/^\//, '')
        try { path = decodeURIComponent(path) } catch { /* preserve the encoded path */ }
        const fragment = new URL(href, `https://reader.invalid/${manifest.navPath}`).hash
        const level = Math.max(0, anchor.closest('ol')?.parentElement?.closest('ol') ? 1 : 0)
        return [{ label, href: `${path}${fragment}`, ...(level ? { level } : {}) }]
      })
    }
  }
  const ncxText = manifest.ncxPath ? files.get(manifest.ncxPath) : undefined
  if (!ncxText) return []
  const doc = new DOMParser().parseFromString(ncxText, 'application/xml')
  return [...doc.querySelectorAll('navPoint')].flatMap((point) => {
    const label = point.querySelector(':scope > navLabel > text')?.textContent?.trim()
    const src = point.querySelector(':scope > content')?.getAttribute('src')
    if (!label || !src) return []
    const url = new URL(src, `https://reader.invalid/${manifest.ncxPath}`)
    let path = url.pathname.replace(/^\//, '')
    try { path = decodeURIComponent(path) } catch { /* preserve the encoded path */ }
    const level = point.parentElement?.localName.toLowerCase() === 'navpoint' ? 1 : 0
    return [{ label, href: `${path}${url.hash}`, ...(level ? { level } : {}) }]
  })
}

export function buildRevisionContentUrl(contentUrl: string, revisionId: string): string {
  const [path, query = ''] = contentUrl.split('?', 2)
  const params = new URLSearchParams(query)
  params.set('revisionId', revisionId)
  return `${path}?${params.toString()}`
}

export function revisionTargetEntryPath(target: string, sectionHref?: string): string | null {
  const href = /^(?:epubcfi\(|search-hit:|chapter:|\d+(?:\.\d+)?$)/.test(target) ? sectionHref : target
  if (!href) return null
  const path = pathFromHref(href)
  return path || null
}

export function revisionTargetHasHrefFragment(target: string): boolean {
  return !/^(?:epubcfi\(|search-hit:|chapter:|\d+(?:\.\d+)?$)/.test(target) && /#[^?]*$/.test(target)
}

export async function prepareRevisionNavigation(
  contentUrl: string,
  previous: ReaderRevisionIdentity,
  intent: ReaderRevisionNavigationIntent,
  signal: AbortSignal,
): Promise<{
  latest: Awaited<ReturnType<typeof fetchLatestReaderManifest>>
  target: string | null
  targetPath: string | null
  targetText: string | null
  toc: { label: string; href: string; level?: number }[]
}> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const latest = await fetchLatestReaderManifest(contentUrl, signal)
    if (latest.manifest.bookId !== previous.bookId || latest.manifest.revisionId === previous.revisionId) {
      throw new ReaderContentError('READER_REVISION_CHANGED', 'The current reader revision could not be refreshed')
    }
    const explicitSelection = intent.explicitRevisionId !== undefined
    const target = explicitSelection
      ? latest.manifest.revisionId === intent.explicitRevisionId
        ? resolveExplicitRevisionSelection(latest.manifest, intent)
        : null
      : resolveRevisionNavigationTarget(previous, latest.manifest, intent)
    const toc = target ? [] : extractReaderManifestToc(latest.manifest)
    if (!target) return { latest, target, targetPath: null, targetText: null, toc }

    const path = revisionTargetEntryPath(target, intent.sectionHref)
    if (!path) return { latest, target: null, targetPath: null, targetText: null, toc: extractReaderManifestToc(latest.manifest) }
    const latestUrl = buildRevisionContentUrl(contentUrl, latest.manifest.revisionId)
    const session = new ReaderContentSession(latest.manifest, latest.accountScope, latest.epoch, latestUrl)
    try {
      const text = await session.loadText(path, 'foreground', signal)
      if (!text || (revisionTargetHasHrefFragment(target) && !hasTargetFragment(text, target))) {
        return { latest, target: null, targetPath: null, targetText: null, toc: extractReaderManifestToc(latest.manifest) }
      }
      return { latest, target, targetPath: path, targetText: text, toc }
    } catch (error) {
      if (signal.aborted || !(error instanceof ReaderContentError) || error.code !== 'READER_REVISION_CHANGED' || attempt === 2) throw error
    } finally {
      session.destroy()
    }
  }
  throw new ReaderContentError('READER_REVISION_CHANGED', 'Reader content changed repeatedly while preparing navigation')
}

function resolveExplicitRevisionSelection(
  latest: ReaderManifest,
  intent: ReaderRevisionNavigationIntent,
): string | null {
  const href = intent.target ?? intent.sectionHref
  if (!href) return null
  const path = pathFromHref(href)
  if (!path || !latest.spine.some((item) => item.path === path)) return null
  return `${path}${href.match(/#[^?]*$/)?.[0] ?? ''}`
}

export function hasTargetFragment(text: string, target: string): boolean {
  const fragment = target.match(/#([^?]*)$/)?.[1]
  if (!fragment) return true
  let id = fragment
  try { id = decodeURIComponent(id) } catch { /* keep the source fragment */ }
  const doc = new DOMParser().parseFromString(text, 'text/html')
  return Boolean(doc.getElementById(id) ?? doc.querySelector(`[name="${CSS.escape(id)}"]`))
}
