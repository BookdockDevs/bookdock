import { waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { serializeVisibleBody } from './epub-document-adapter'
import { prepareEditorResources, resolveEditorResource } from './epub-editor-resources'

// @ts-expect-error vendored JavaScript module has no declarations
import { Loader as FoliateLoader } from '../../../../public/foliate-js/epub.js'

const lifecycle = vi.hoisted(() => ({ sessionDestroyed: vi.fn(), loaderDestroyed: vi.fn(), loaded: vi.fn(), text: vi.fn(), blob: vi.fn() }))
vi.mock('@/features/reader/lib/reader-content-client', () => ({
  ReaderContentSession: class {
    loadText(path: string) { return lifecycle.text(path) }
    loadBlob(path: string) { return lifecycle.blob(path) }
    destroy() { lifecycle.sessionDestroyed() }
  },
}))

describe('EPUB editor resource references', () => {
  it('resolves parent paths, encoded names and fragments within the archive', () => {
    expect(resolveEditorResource('../images/a%20b.svg#part', 'OEBPS/text/chapter.xhtml')).toEqual({ path: 'OEBPS/images/a b.svg', fragment: '#part' })
    expect(resolveEditorResource('../images/bg.png', 'OEBPS/styles/book.css')).toEqual({ path: 'OEBPS/images/bg.png', fragment: '' })
  })

  it('rejects external, local and ambiguous references', () => {
    for (const value of ['https://example.org/a.png', '//example.org/a.png', 'file:///a.png', 'data:image/png,aaa', 'blob:https://example.org/id', 'a%2fb.png', '#local']) {
      expect(resolveEditorResource(value, 'OEBPS/text/chapter.xhtml')).toBeNull()
    }
  })

  it('loads only archive resources, keeps the original body, and releases the session on disposal', async () => {
    class Loader {
      loadHref: (value: string, base: string) => Promise<string | null> = async () => null
      async loadItem(item: { href: string }) { lifecycle.loaded(item.href); return `blob:${item.href}` }
      async replaceCSS(css: string, base: string) {
        const path = css.match(/url\(([^)]+)\)/)?.[1]
        return path ? css.replace(path, await this.loadHref(path, base) ?? '') : css
      }
      destroy() { lifecycle.loaderDestroyed() }
    }
    const markup = '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../styles/book.css"/><style>p{background:url(../images/bg.png)}</style></head><body><p>Text<img src="../images/a.png"/><img src="https://example.org/external.png"/></p></body></html>'
    const frame = new DOMParser().parseFromString('<html><head></head><body><p>Text<img src="../images/a.png"><img src="https://example.org/external.png"></p></body></html>', 'text/html')
    const source = {
      manifest: { entries: [
        { path: 'OEBPS/styles/book.css', mediaType: 'text/css', size: 20 },
        { path: 'OEBPS/images/bg.png', mediaType: 'image/png', size: 20 },
        { path: 'OEBPS/images/a.png', mediaType: 'image/png', size: 20 },
      ] }, accountScope: 'test', epoch: 0, contentUrl: '/api/v1/books/test/file?revisionId=rev',
    } as never
    const dispose = prepareEditorResources(frame, markup, 'OEBPS/text/ch.xhtml', source, async () => ({ Loader }))
    await waitFor(() => expect(frame.querySelector('img')?.getAttribute('src')).toBe('blob:OEBPS/images/a.png'))
    expect(frame.head.querySelector('link[rel="stylesheet"]')?.getAttribute('href')).toBe('blob:OEBPS/styles/book.css')
    expect(frame.head.textContent).toContain('blob:OEBPS/images/bg.png')
    expect(lifecycle.loaded).not.toHaveBeenCalledWith(expect.stringContaining('example.org'))
    expect(frame.querySelector('img[src^="https:"]')?.hasAttribute('data-bookdock-missing')).toBe(true)
    frame.querySelector('p')!.firstChild!.textContent = 'Edited'
    const saved = serializeVisibleBody(markup, frame.body)
    expect(saved).toContain('../images/a.png')
    expect(saved).not.toContain('blob:')
    expect(saved).not.toContain('data-bookdock-missing')
    dispose()
    await waitFor(() => expect(lifecycle.loaderDestroyed).toHaveBeenCalled())
    expect(lifecycle.sessionDestroyed).toHaveBeenCalled()
    expect(frame.querySelector('img')?.getAttribute('src')).toBe('../images/a.png')
    expect(frame.querySelector('img[src^="https:"]')?.hasAttribute('data-bookdock-missing')).toBe(false)
    expect(frame.head.querySelector('link[rel="stylesheet"]')).toBeNull()
  })

  it('uses the reader loader for CSS dependencies and releases every created URL', async () => {
    if (!URL.createObjectURL) Object.defineProperty(URL, 'createObjectURL', { value: () => '', configurable: true, writable: true })
    if (!URL.revokeObjectURL) Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true, writable: true })
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:resource-${create.mock.calls.length}`)
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    lifecycle.text.mockImplementation(async (path: string) => path.endsWith('.css') ? 'p { background: url(../images/bg.png) }' : null)
    lifecycle.blob.mockImplementation(async () => new Blob(['image'], { type: 'image/png' }))
    const markup = '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../styles/book.css"/></head><body><p><img src="../images/a.png"/></p></body></html>'
    const frame = new DOMParser().parseFromString('<html><head></head><body><p><img src="../images/a.png"></p></body></html>', 'text/html')
    const source = { manifest: { entries: [
      { path: 'OEBPS/styles/book.css', mediaType: 'text/css', size: 30 },
      { path: 'OEBPS/images/bg.png', mediaType: 'image/png', size: 10 },
      { path: 'OEBPS/images/a.png', mediaType: 'image/png', size: 10 },
    ] }, accountScope: 'test', epoch: 0, contentUrl: '/file' } as never
    const dispose = prepareEditorResources(frame, markup, 'OEBPS/text/ch.xhtml', source, async () => ({ Loader: FoliateLoader }))
    await waitFor(() => expect(frame.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/))
    expect(lifecycle.text).toHaveBeenCalledWith('OEBPS/styles/book.css')
    expect(lifecycle.blob).toHaveBeenCalledWith('OEBPS/images/bg.png')
    expect(lifecycle.blob).toHaveBeenCalledWith('OEBPS/images/a.png')
    const created = create.mock.results.map((result) => result.value)
    dispose()
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(created.length))
    expect(revoke.mock.calls.map(([url]) => url).sort()).toEqual(created.sort())
    create.mockRestore()
    revoke.mockRestore()
  })

  it('shows root-element background resources without saving or retaining temporary URLs', async () => {
    class Loader {
      loadHref: (value: string, base: string) => Promise<string | null> = async () => null
      async loadItem(item: { href: string }) { return `blob:${item.href}` }
      async replaceCSS(css: string, base: string) {
        const path = css.match(/url\(([^)]+)\)/)?.[1]
        return path ? css.replace(path, await this.loadHref(path, base) ?? '') : css
      }
      destroy() {}
    }
    const markup = '<html xmlns="http://www.w3.org/1999/xhtml" style="background-image:url(../images/cover.png)"><head></head><body><p>Cover</p></body></html>'
    const frame = new DOMParser().parseFromString('<html><head></head><body><p>Cover</p></body></html>', 'text/html')
    const source = { manifest: { entries: [{ path: 'OEBPS/images/cover.png', mediaType: 'image/png', size: 10 }] }, accountScope: 'test', epoch: 0, contentUrl: '/file' } as never
    const dispose = prepareEditorResources(frame, markup, 'OEBPS/text/cover.xhtml', source, async () => ({ Loader }))
    await waitFor(() => expect(frame.documentElement.getAttribute('style')).toContain('blob:OEBPS/images/cover.png'))
    frame.querySelector('p')!.textContent = 'Edited'
    const saved = serializeVisibleBody(markup, frame.body)
    expect(saved).toContain('background-image:url(../images/cover.png)')
    expect(saved).not.toContain('blob:')
    dispose()
    expect(frame.documentElement.hasAttribute('style')).toBe(false)
  })

  it('loads a legacy body background through the archive and removes the temporary attribute', async () => {
    class Loader {
      loadHref: (value: string, base: string) => Promise<string | null> = async () => null
      async loadItem(item: { href: string }) { return `blob:${item.href}` }
      async replaceCSS(css: string) { return css }
      destroy() {}
    }
    const markup = '<html xmlns="http://www.w3.org/1999/xhtml"><body background="../images/cover.png"><p>Cover</p></body></html>'
    const frame = new DOMParser().parseFromString('<html><body><p>Cover</p></body></html>', 'text/html')
    const source = { manifest: { entries: [{ path: 'OEBPS/images/cover.png', mediaType: 'image/png', size: 10 }] }, accountScope: 'test', epoch: 0, contentUrl: '/file' } as never
    const dispose = prepareEditorResources(frame, markup, 'OEBPS/text/cover.xhtml', source, async () => ({ Loader }))
    await waitFor(() => expect(frame.body.getAttribute('background')).toBe('blob:OEBPS/images/cover.png'))
    frame.querySelector('p')!.textContent = 'Edited'
    const saved = serializeVisibleBody(markup, frame.body)
    expect(saved).toContain('background="../images/cover.png"')
    expect(saved).not.toContain('blob:')
    dispose()
    expect(frame.body.hasAttribute('background')).toBe(false)
  })

  it('loads SVG cover images using namespaced xlink href and preserves the original reference', async () => {
    class Loader {
      loadHref: (value: string, base: string) => Promise<string | null> = async () => null
      async loadItem(item: { href: string }) { return `blob:${item.href}` }
      async replaceCSS(css: string) { return css }
      destroy() {}
    }
    const markup = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:xlink="http://www.w3.org/1999/xlink"><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900"><image width="600" height="900" xlink:href="../images/cover.jpg"/></svg><p>Caption</p></body></html>'
    const frame = new DOMParser().parseFromString(markup, 'text/html')
    const image = frame.querySelector('svg image')!
    expect(image.getAttributeNode('xlink:href')?.namespaceURI).toBe('http://www.w3.org/1999/xlink')
    const source = { manifest: { entries: [{ path: 'OEBPS/images/cover.jpg', mediaType: 'image/jpeg', size: 10 }] }, accountScope: 'test', epoch: 0, contentUrl: '/file' } as never
    const dispose = prepareEditorResources(frame, markup, 'OEBPS/text/cover.xhtml', source, async () => ({ Loader }))
    await waitFor(() => expect(image.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('blob:OEBPS/images/cover.jpg'))
    expect(serializeVisibleBody(markup, frame.body)).toBe(markup)
    frame.querySelector('p')!.textContent = 'Edited'
    const saved = serializeVisibleBody(markup, frame.body)
    const savedDocument = new DOMParser().parseFromString(saved, 'application/xhtml+xml')
    expect(savedDocument.querySelector('image')?.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('../images/cover.jpg')
    expect(saved).not.toContain('blob:')
    dispose()
    expect(image.getAttributeNS('http://www.w3.org/1999/xlink', 'href')).toBe('../images/cover.jpg')
  })

  it('does not mutate a disposed frame when a resource finishes late', async () => {
    let finish: ((value: string) => void) | undefined
    const destroyed = vi.fn()
    class Loader {
      loadHref: (value: string, base: string) => Promise<string | null> = async () => null
      loadItem() { return new Promise<string>((resolve) => { finish = resolve }) }
      async replaceCSS(css: string) { return css }
      destroy() { destroyed() }
    }
    const markup = '<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="a.png"/></body></html>'
    const frame = new DOMParser().parseFromString(markup, 'text/html')
    const source = { manifest: { entries: [{ path: 'a.png', mediaType: 'image/png', size: 1 }] }, accountScope: 'test', epoch: 0, contentUrl: '/file' } as never
    const dispose = prepareEditorResources(frame, markup, 'chapter.xhtml', source, async () => ({ Loader }))
    await waitFor(() => expect(finish).toBeDefined())
    dispose()
    finish!('blob:late')
    await waitFor(() => expect(destroyed).toHaveBeenCalled())
    expect(frame.querySelector('img')?.getAttribute('src')).toBe('a.png')
  })
})
