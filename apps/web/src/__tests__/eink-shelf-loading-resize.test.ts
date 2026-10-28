import { expect, it, vi } from 'vitest'

vi.mock('../../public/foliate-js/view.js', () => ({}))
vi.mock('../../public/foliate-js/epub.js', () => ({ EPUB: class {} }))

it('rechecks page size after the library name request finishes', async () => {
  history.replaceState(null, '', '/eink')
  document.body.innerHTML = '<div id="app"></div>'
  let availableHeight = 475
  let releaseLibraries!: () => void
  const librariesReady = new Promise<void>(resolve => { releaseLibraries = resolve })
  const widths = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('grid') ? 432 : 0
  })
  const rectangles = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { top: this.classList.contains('shelf-footer') ? 125 + availableHeight : 125 } as DOMRect
  })
  const books = Array.from({ length: 30 }, (_, index) => ({ id: `book-${index}`, title: `Book ${index}`, format: 'txt' }))
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input)
    if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ data: { id: 'user-1', guest: false } }))
    if (url.endsWith('/libraries')) {
      await librariesReady
      return new Response(JSON.stringify({ data: [] }))
    }
    if (url.includes('/books?')) {
      const size = Number(new URL(url, 'http://localhost').searchParams.get('pageSize'))
      return new Response(JSON.stringify({ data: books.slice(0, size), total: books.length }))
    }
    throw new Error(`Unexpected request: ${url}`)
  }))
  try {
    await import('../eink/index')
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('pageSize=8'))).toBe(true))
    availableHeight = 700
    window.dispatchEvent(new Event('resize'))
    releaseLibraries()
    await vi.waitFor(() => expect(document.querySelectorAll('.book')).toHaveLength(12))
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('pageSize=12'))).toBe(true)
  } finally {
    releaseLibraries()
    widths.mockRestore()
    rectangles.mockRestore()
    vi.unstubAllGlobals()
    history.replaceState(null, '', '/')
    document.body.innerHTML = ''
  }
})
