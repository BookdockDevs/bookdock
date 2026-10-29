import { expect, it, vi } from 'vitest'

const goTo = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../public/foliate-js/view.js', () => ({}))
vi.mock('../../public/foliate-js/epub.js', () => ({ EPUB: class {
  async init() { return { toc: [], sections: [{ id: 'chapter' }], rendition: {} } }
} }))

it('restores a book from its address and follows navigation between book and shelf', async () => {
  localStorage.setItem('i18nextLng', 'zh-CN')
  history.replaceState(null, '', '/eink#/book/book-1')
  document.body.innerHTML = '<div id="app"></div>'
  if (!customElements.get('foliate-view')) {
    customElements.define('foliate-view', class extends HTMLElement {
      renderer = Object.assign(document.createElement('div'), { setStyles: () => {}, goTo })
      async open() {}
      async init() {}
    })
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string, _options?: RequestInit) => {
    if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ data: { id: 'user-1', guest: false } }))
    if (url.includes('/reader/manifest')) return new Response(JSON.stringify({ data: { revisionId: 'rev', entries: [], startupFiles: [] } }))
    if (url.includes('/progress/')) return new Response(JSON.stringify({ data: { cfi: 'chapter:0:0.5', fraction: 0.5 } }))
    if (url.endsWith('/books/book-1')) return new Response(JSON.stringify({ data: { title: 'Book title' } }))
    if (url.includes('/books?')) return new Response(JSON.stringify({ data: [{ id: 'book-1', title: 'Book' }], total: 1 }))
    if (url.endsWith('/libraries')) return new Response(JSON.stringify({ data: [] }))
    throw new Error(`Unexpected request: ${url}`)
  }))
  try {
    await import('../eink/index')
    await vi.waitFor(() => expect(document.querySelector('.controls')).not.toBeNull())
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.loading-overlay')?.style.display).toBe('none'))
    await vi.waitFor(() => expect(document.title).toBe('Book title'))
    expect(goTo).toHaveBeenCalledWith({ index: 0, anchor: 0.5 })
    expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false)
    document.querySelector<HTMLButtonElement>('.controls button')!.click()
    await vi.waitFor(() => expect(document.querySelector('.book')).not.toBeNull())
    expect(document.title).toBe('书坞')
    expect(location.hash).toBe('')
    const pushState = vi.spyOn(history, 'pushState').mockImplementation(() => { throw new Error('History API unavailable') })
    document.querySelector<HTMLButtonElement>('.book')!.click()
    await vi.waitFor(() => expect(location.hash).toBe('#/book/book-1'))
    await vi.waitFor(() => expect(document.querySelector('.controls')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('.controls button')!.click()
    await vi.waitFor(() => expect(document.querySelector('.book')).not.toBeNull())
    expect(location.hash).toBe('')
    expect(pushState).not.toHaveBeenCalled()
    pushState.mockRestore()
    history.replaceState(null, '', '/eink')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await vi.waitFor(() => expect(document.querySelector('.book')).not.toBeNull())
    history.replaceState(null, '', '/eink#/invalid')
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await vi.waitFor(() => expect(document.querySelector('.loading-actions button')).not.toBeNull())
    expect(document.title).toBe('书坞')
    document.querySelector<HTMLButtonElement>('.loading-actions button')!.click()
    await vi.waitFor(() => expect(location.hash).toBe(''))
  } finally {
    vi.unstubAllGlobals()
    localStorage.removeItem('i18nextLng')
    history.replaceState(null, '', '/')
    document.body.innerHTML = ''
  }
})
