import { afterEach, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ loader: null as null | { loadText: (name: string) => Promise<string>; loadBlob: (name: string, type?: string) => Promise<Blob | null> } }))
vi.mock('../../public/foliate-js/view.js', () => {
  if (!customElements.get('foliate-view')) customElements.define('foliate-view', class extends HTMLElement {
    renderer = Object.assign(document.createElement('div'), { setStyles: () => {} })
    constructor() { super(); this.renderer.attachShadow({ mode: 'open' }) }
    async open() {}
    async init() {}
  })
  return {}
})
vi.mock('../../public/foliate-js/epub.js', () => ({
  EPUB: class {
    sections = []
    constructor(loader: typeof captured.loader) { captured.loader = loader }
    async init() { return this }
  },
}))

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  captured.loader = null
})

it('filters startup and fetched chapters, blocks media fetches and keeps images available', async () => {
  document.body.innerHTML = '<div id="app"></div>'
  const markup = '<html xmlns="http://www.w3.org/1999/xhtml"><body><video src="movie.mp4">fallback</video><img src="picture.png"/></body></html>'
  const json = (data: unknown) => new Response(JSON.stringify({ data }))
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input)
    if (url.endsWith('/auth/me')) return json({ id: 'user-1', guest: false })
    if (url.endsWith('/libraries')) return json([])
    if (url.includes('/books?')) return new Response(JSON.stringify({ data: [{ id: 'b1', title: 'Book', format: 'epub' }], total: 1 }))
    if (url.endsWith('/reader/manifest')) return json({ revisionId: 'r1', entries: [
      { path: 'startup.xhtml', mediaType: 'application/xhtml+xml' },
      { path: 'chapter.xhtml', mediaType: 'application/xhtml+xml' },
      { path: 'movie.mp4', mediaType: 'video/mp4' },
      { path: 'picture.png', mediaType: 'image/png' },
    ], startupFiles: [{ path: 'startup.xhtml', text: markup }] })
    if (url.includes('/progress/')) return json(null)
    if (url.includes('path=chapter.xhtml')) return json({ text: markup })
    if (url.includes('path=picture.png')) return new Response('image')
    throw new Error(`Unexpected request: ${url}`)
  }))
  vi.resetModules()
  await import('../eink/index')
  await vi.waitFor(() => expect(document.querySelector('.book')).not.toBeNull())
  document.querySelector<HTMLButtonElement>('.book')!.click()
  await vi.waitFor(() => expect(captured.loader).not.toBeNull())
  const loader = captured.loader!
  for (const name of ['startup.xhtml', 'chapter.xhtml']) {
    const text = await loader.loadText(name)
    expect(text).not.toContain('<video')
    expect(text).toContain('fallback')
    expect(text).toContain('picture.png')
  }
  expect(await loader.loadBlob('movie.mp4')).toBeNull()
  expect((await loader.loadBlob('picture.png'))?.size).toBe(5)
  expect((await loader.loadBlob('picture.png'))?.size).toBe(5)
  const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url))
  expect(urls.some(url => url.includes('path=movie.mp4'))).toBe(false)
  expect(urls.some(url => url.includes('path=picture.png') && url.includes('imageVariant=eink'))).toBe(true)
  expect(urls.filter(url => url.includes('path=picture.png'))).toHaveLength(1)
})
