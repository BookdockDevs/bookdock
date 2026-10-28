import { expect, it, vi } from 'vitest'

vi.mock('../../public/foliate-js/view.js', () => ({}))
vi.mock('../../public/foliate-js/epub.js', () => ({ EPUB: class {} }))

it('repaginates around the first visible book when the shelf grows', async () => {
  history.replaceState(null, '', '/eink')
  document.body.innerHTML = '<div id="app"></div>'
  let availableHeight = 475
  let pausePageTwo = false
  let releasePageTwo: (() => void) | undefined
  const widths = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('grid') ? 432 : 0
  })
  const rectangles = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { top: this.classList.contains('shelf-footer') ? 125 + availableHeight : 125 } as DOMRect
  })
  const books = Array.from({ length: 50 }, (_, index) => ({ id: `book-${index}`, title: `Book ${index}`, format: 'txt' }))
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input)
    if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ data: { id: 'user-1', guest: false } }))
    if (url.endsWith('/libraries')) return new Response(JSON.stringify({ data: [] }))
    if (url.includes('/books?')) {
      const params = new URL(url, 'http://localhost').searchParams
      const page = Number(params.get('page'))
      const size = Number(params.get('pageSize'))
      if (pausePageTwo && page === 2 && size === 8) await new Promise<void>(resolve => { releasePageTwo = resolve })
      return new Response(JSON.stringify({ data: books.slice((page - 1) * size, page * size), total: books.length }))
    }
    throw new Error(`Unexpected request: ${url}`)
  }))
  try {
    await import('../eink/index')
    await vi.waitFor(() => expect(document.querySelectorAll('.book')).toHaveLength(8))
    expect(document.querySelector<HTMLElement>('.grid')?.style.height).toBe('475px')
    expect(document.querySelector('.grid')?.classList.contains('grid-balanced')).toBe(true)
    const next = () => document.querySelectorAll<HTMLButtonElement>('.shelf-footer button')[1]!.click()
    next()
    await vi.waitFor(() => expect(document.querySelector('.book-title')?.textContent).toBe('Book 8'))
    next()
    await vi.waitFor(() => expect(document.querySelector('.book-title')?.textContent).toBe('Book 16'))
    pausePageTwo = true
    document.querySelectorAll<HTMLButtonElement>('.shelf-footer button')[0]!.click()
    await vi.waitFor(() => expect(releasePageTwo).toBeDefined())
    availableHeight = 700
    window.dispatchEvent(new Event('resize'))
    releasePageTwo!()
    await vi.waitFor(() => expect(document.querySelectorAll('.book')).toHaveLength(12))
    expect(document.querySelector('.shelf-footer span')?.textContent).toMatch(/1/)
    expect([...document.querySelectorAll('.book-title')].map(node => node.textContent)).toContain('Book 8')
    next()
    await vi.waitFor(() => expect(document.querySelector('.book-title')?.textContent).toBe('Book 12'))
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('page=2&pageSize=12'))).toBe(true)
    next()
    await vi.waitFor(() => expect(document.querySelector('.book-title')?.textContent).toBe('Book 24'))
    next()
    await vi.waitFor(() => expect(document.querySelector('.book-title')?.textContent).toBe('Book 36'))
    next()
    await vi.waitFor(() => expect(document.querySelector('.book-title')?.textContent).toBe('Book 48'))
    availableHeight = 1200
    window.dispatchEvent(new Event('resize'))
    await vi.waitFor(() => expect(document.querySelector('.book-title')?.textContent).toBe('Book 40'))
    expect(document.querySelectorAll('.book')).toHaveLength(10)
    expect(document.querySelectorAll<HTMLButtonElement>('.shelf-footer button')[1]!.disabled).toBe(true)
  } finally {
    widths.mockRestore()
    rectangles.mockRestore()
    vi.unstubAllGlobals()
    history.replaceState(null, '', '/')
    document.body.innerHTML = ''
  }
})
