import type { ReaderManifest } from '@bookdock/shared'

import { ReaderContentSession } from '@/features/reader/lib/reader-content-client'

import { clearEpubPresentation, setEpubPresentationAttribute, setEpubPresentationText } from './epub-document-adapter'

interface ReaderSource {
  manifest: ReaderManifest
  accountScope: string
  epoch: number
  contentUrl: string
}

interface ResourceItem { href: string; mediaType: string; size: number }
interface ResourceLoader {
  loadHref: (href: string, base: string, parents?: string[], parent?: unknown, signal?: AbortSignal) => Promise<string | null>
  loadItem: (item: ResourceItem, parents?: unknown[], signal?: AbortSignal) => Promise<string | null>
  replaceCSS: (css: string, base: string, parents?: string[], parent?: unknown, signal?: AbortSignal) => Promise<string>
  destroy: () => void
}

export function resolveEditorResource(href: string, base: string): { path: string; fragment: string } | null {
  const value = href.trim()
  if (!value || value.startsWith('#') || /^(?:[a-z][a-z\d+.-]*:|\/\/|\\)/i.test(value)) return null
  try {
    const url = new URL(value, `https://epub.invalid/${base}`)
    if (url.origin !== 'https://epub.invalid' || /%2f|%5c/i.test(url.pathname)) return null
    return { path: decodeURIComponent(url.pathname.slice(1)), fragment: url.hash }
  } catch {
    return null
  }
}

type LoaderModule = { Loader: new (options: unknown) => ResourceLoader }

async function loadReaderLoader(): Promise<LoaderModule> {
  const dynamicImport = new Function('url', 'return import(url)') as (url: string) => Promise<LoaderModule>
  return dynamicImport('/foliate-js/epub.js')
}

export function prepareEditorResources(document: Document, markup: string, href: string, source: ReaderSource, loadModule = loadReaderLoader, onMissing?: () => void): () => void {
  const controller = new AbortController()
  const session = new ReaderContentSession(source.manifest, source.accountScope, source.epoch, source.contentUrl, true)
  const entries = new Map(source.manifest.entries.map((entry) => [entry.path, { href: entry.path, mediaType: entry.mediaType, size: entry.size }]))
  let loader: ResourceLoader | null = null
  let disposed = false
  const insertedStyles: Element[] = []
  const task = (async () => {
    const module = await loadModule()
    if (disposed) return
    loader = new module.Loader({
      resources: { manifest: [...entries.values()] }, entries,
      loadText: (path: string, signal: AbortSignal) => session.loadText(path, 'foreground', signal),
      loadBlob: (path: string, type: string, signal: AbortSignal) => session.loadBlob(path, type, 'foreground', signal),
    })
    const activeLoader = loader
    let totalBytes = 0
    const counted = new Set<string>()
    const missing = () => { if (!disposed) onMissing?.() }
    activeLoader.loadHref = async (value, base, parents = [], parent, signal) => {
      if (value.startsWith('#')) return value
      const resolved = resolveEditorResource(value, base)
      const item = resolved && entries.get(resolved.path)
      if (!resolved || !item || !/^(?:image\/(?:png|jpeg|gif|webp|avif|svg\+xml)|text\/css|font\/|application\/(?:font|vnd\.ms-fontobject|x-font))/i.test(item.mediaType)) { missing(); return '' }
      if (!counted.has(item.href)) {
        if (counted.size >= 256 || item.size > 16 * 1024 * 1024 || totalBytes + item.size > 32 * 1024 * 1024) { missing(); return '' }
        counted.add(item.href)
        totalBytes += item.size
      }
      try {
        const url = await activeLoader.loadItem(item, [...parents, base, ...(parent === undefined ? [] : [parent])], signal)
        if (!url) missing()
        return url ? `${url}${resolved.fragment}` : ''
      } catch {
        missing()
        return ''
      }
    }
    const sourceDocument = new DOMParser().parseFromString(markup, 'application/xhtml+xml')
    if (sourceDocument.querySelector('parsererror')) return
    for (const name of ['class', 'id', 'lang', 'dir']) {
      const value = sourceDocument.documentElement.getAttribute(name)
      if (value !== null) document.documentElement.setAttribute(name, value)
      const bodyValue = sourceDocument.body?.getAttribute(name)
      if (bodyValue !== null && bodyValue !== undefined) document.body.setAttribute(name, bodyValue)
    }
    const insertStyle = (element: Element) => { if (!disposed) { document.head.append(element); insertedStyles.push(element) } }
    for (const element of Array.from(sourceDocument.head?.children ?? [])) {
      if (controller.signal.aborted) return
      if (element.localName === 'link' && element.getAttribute('rel')?.toLowerCase().split(/\s+/).includes('stylesheet')) {
        const value = element.getAttribute('href')
        const url = value && await activeLoader.loadHref(value, href, [], undefined, controller.signal)
        if (url && !disposed) {
          const link = document.createElement('link')
          link.rel = 'stylesheet'
          link.href = url
          const media = element.getAttribute('media')
          if (media) link.media = media
          insertStyle(link)
        }
      } else if (element.localName === 'style' && element.textContent) {
        const css = await activeLoader.replaceCSS(element.textContent, href, [], undefined, controller.signal)
        const style = document.createElement('style')
        style.textContent = css
        insertStyle(style)
      }
    }
    const sourceRootStyle = sourceDocument.documentElement.getAttribute('style')
    if (sourceRootStyle) {
      const style = await activeLoader.replaceCSS(sourceRootStyle, href, [], undefined, controller.signal)
      if (!disposed) setEpubPresentationAttribute(document.documentElement, 'style', style)
    }
    const sourceBodyStyle = sourceDocument.body?.getAttribute('style')
    if (sourceBodyStyle) {
      const style = await activeLoader.replaceCSS(sourceBodyStyle, href, [], undefined, controller.signal)
      if (!disposed) setEpubPresentationAttribute(document.body, 'style', style)
    }
    const bodyBackground = sourceDocument.body?.getAttribute('background')
    if (bodyBackground) {
      const url = await activeLoader.loadHref(bodyBackground, href, [], undefined, controller.signal)
      if (!disposed && url) setEpubPresentationAttribute(document.body, 'background', url)
    }
    for (const element of Array.from(document.body.querySelectorAll('style, [style], img[src], img[srcset], svg image'))) {
      if (controller.signal.aborted) return
      if (element.localName === 'style' && element.textContent) {
        const value = element.textContent
        const css = await activeLoader.replaceCSS(value, href, [], undefined, controller.signal)
        if (!disposed && element.textContent === value) setEpubPresentationText(element, css)
      }
      if (element.localName === 'img' && element.hasAttribute('srcset')) {
        setEpubPresentationAttribute(element, 'srcset', '')
        if (!element.hasAttribute('src')) {
          missing()
          setEpubPresentationAttribute(element, 'data-bookdock-missing', '')
          if (!element.hasAttribute('title')) setEpubPresentationAttribute(element, 'title', '图片无法加载')
        }
      }
      if (element.hasAttribute('style')) {
        const value = element.getAttribute('style')!
        const css = await activeLoader.replaceCSS(value, href, [], undefined, controller.signal)
        if (!disposed && element.getAttribute('style') === value) setEpubPresentationAttribute(element, 'style', css)
      }
      const name = element.localName === 'img' ? 'src' : element.localName === 'image' ? (element.hasAttribute('href') ? 'href' : 'xlink:href') : null
      if (name) {
        const value = element.getAttribute(name)
        const url = value && await activeLoader.loadHref(value, href, [], undefined, controller.signal)
        if (!disposed && element.getAttribute(name) === value) {
          if (url) setEpubPresentationAttribute(element, name, url)
          else if (element.localName === 'img') {
            setEpubPresentationAttribute(element, 'data-bookdock-missing', '')
            if (!element.hasAttribute('title')) setEpubPresentationAttribute(element, 'title', '图片无法加载')
          }
        }
      }
    }
  })().catch(() => { if (!disposed) onMissing?.() })
  return () => {
    disposed = true
    controller.abort()
    clearEpubPresentation(document.documentElement)
    for (const style of insertedStyles) style.remove()
    void task.finally(() => { loader?.destroy(); session.destroy() })
  }
}
