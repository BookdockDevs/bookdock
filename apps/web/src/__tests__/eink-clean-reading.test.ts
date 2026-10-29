import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ loaders: [] as any[], books: [] as any[], close: vi.fn(), destroy: vi.fn(), styles: vi.fn((_css: string) => {}), init: vi.fn(async (_options: unknown) => {}), next: vi.fn(async () => {}), prev: vi.fn(async () => {}) }))
vi.mock('../../public/foliate-js/view.js', () => {
  if (!customElements.get('foliate-view')) customElements.define('foliate-view', class extends HTMLElement {
    renderer = Object.assign(document.createElement('div'), { setStyles: state.styles })
    constructor() { super(); this.renderer.attachShadow({ mode: 'open' }) }
    next() { return state.next() }
    prev() { return state.prev() }
    async open() {}
    async init(options: unknown) { await state.init(options) }
    resolveNavigation() { return { index: 0 } }
    getProgressOf() { return { tocItem: { label: 'Chapter 1' } } }
    close() { state.close() }
  })
  return {}
})
vi.mock('../../public/foliate-js/epub.js', () => ({ EPUB: class {
  toc = []
  sections = [{ id: 'chapter.xhtml', load: vi.fn(async () => 'blob:chapter'), unload: vi.fn() }]
  rendition = {}
  transformTarget = new EventTarget()
  constructor(loader: unknown) { state.loaders.push(loader); state.books.push(this) }
  async init() { return this }
  destroy() { state.destroy() }
} }))

it('toggles clean reading, restores the position and blocks book presentation resources', async () => {
  history.replaceState(null, '', '/eink')
  document.body.innerHTML = '<div id="app"></div>'
  localStorage.setItem('i18nextLng', 'en')
  localStorage.removeItem('bd-eink-clean-reading')
  localStorage.removeItem('bd-eink-settings-tab')
  localStorage.removeItem('bd-eink-turn-area')
  const markup = '<html xmlns="http://www.w3.org/1999/xhtml"><head><style>p { color:red }</style><link rel="stylesheet" href="book.css"/></head><body><p style="color:red">Text <img src="image.png"/></p></body></html>'
  const json = (data: unknown) => new Response(JSON.stringify({ data }))
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input)
    if (url.endsWith('/auth/me')) return json({ id: 'user-1', guest: false })
    if (url.endsWith('/libraries')) return json([])
    if (url.includes('/books?')) return new Response(JSON.stringify({ data: [{ id: 'book-1', title: 'Book', format: 'epub' }], total: 1 }))
    if (url.endsWith('/reader/manifest')) return json({ revisionId: 'rev', generated: false, entries: [
      { path: 'chapter.xhtml', mediaType: 'application/xhtml+xml' },
      { path: 'image.png', mediaType: 'image/png' },
      { path: 'book.css', mediaType: 'text/css' },
    ], startupFiles: [{ path: 'chapter.xhtml', text: markup }] })
    if (url.includes('/progress/')) return json(null)
    throw new Error(`Unexpected request: ${url}`)
  }))
  try {
    await import('../eink/index')
    await vi.waitFor(() => expect(document.querySelector('.book')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('.book')!.click()
    await vi.waitFor(() => expect(state.init).toHaveBeenCalled())
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.loading-overlay')?.style.display).toBe('none'))
    document.querySelector('foliate-view')!.dispatchEvent(new CustomEvent('relocate', { detail: { cfi: 'epubcfi(/6/2)' } }))
    const controls = [...document.querySelectorAll<HTMLButtonElement>('.controls button')]
    controls.find(button => button.textContent === 'Settings')!.click()
    ;[...document.querySelectorAll<HTMLButtonElement>('.settings-tab-btn')].find(button => button.textContent === 'Other')!.click()
    const cards = [...document.querySelectorAll<HTMLButtonElement>('.turn-area-card')]
    expect(cards.map(card => card.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false'])
    cards[1].click()
    expect(localStorage.getItem('bd-eink-turn-area')).toBe('single')
    expect(cards[1].getAttribute('aria-pressed')).toBe('true')
    cards[2].click()
    expect(localStorage.getItem('bd-eink-turn-area')).toBe('disabled')
    cards[0].click()
    expect(localStorage.getItem('bd-eink-turn-area')).toBe('standard')
    const reader = document.querySelector('foliate-view')!
    vi.spyOn(reader, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect)
    const testPanel = document.querySelector<HTMLElement>('.panel')!
    const clickReader = (x: number) => reader.dispatchEvent(new CustomEvent('click-view', { detail: { x } }))
    clickReader(10)
    expect(state.prev).not.toHaveBeenCalled()
    testPanel.hidden = true
    clickReader(10)
    await vi.waitFor(() => expect(state.prev).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.loading-overlay')?.style.display).toBe('none'))
    clickReader(60)
    await vi.waitFor(() => expect(state.next).toHaveBeenCalledTimes(1))
    testPanel.hidden = false
    cards[1].click()
    testPanel.hidden = true
    await vi.waitFor(() => { clickReader(10); expect(state.next).toHaveBeenCalledTimes(2) })
    testPanel.hidden = false
    cards[2].click()
    testPanel.hidden = true
    clickReader(10)
    clickReader(90)
    expect(state.next).toHaveBeenCalledTimes(2)
    expect(state.prev).toHaveBeenCalledTimes(1)
    testPanel.hidden = false
    cards[0].click()
    const toggle = document.querySelector<HTMLButtonElement>('[role=switch]')!
    const panel = document.querySelector<HTMLElement>('.panel')!
    const originalView = document.querySelector('foliate-view')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    toggle.click()
    expect(panel.hidden).toBe(false)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    await vi.waitFor(() => expect(state.loaders).toHaveLength(2))
    await vi.waitFor(() => expect(state.init).toHaveBeenLastCalledWith({ lastLocation: 'epubcfi(/6/2)' }))
    expect(state.close).toHaveBeenCalledTimes(1)
    expect(state.destroy).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('bd-eink-clean-reading')).toBe('true')
    expect(document.querySelector('.panel')).toBe(panel)
    expect(panel.hidden).toBe(false)
    expect(document.querySelector('[role=switch]')).toBe(toggle)
    expect(document.querySelector('foliate-view')).not.toBe(originalView)
    const text = await state.loaders[1].loadText('chapter.xhtml')
    const doc = new DOMParser().parseFromString(text, 'application/xhtml+xml')
    expect(doc.querySelector('p')?.textContent).toContain('Text')
    expect(doc.querySelector('p')?.hasAttribute('style')).toBe(false)
    expect(doc.querySelector('img')?.hasAttribute('data-bd-clean-hidden')).toBe(true)
    expect(doc.querySelector('link')?.hasAttribute('href')).toBe(false)
    expect(await state.loaders[1].loadBlob('image.png')).toBeNull()
    const detail = { type: 'text/css', href: 'book.css', allow: false, url: '' }
    state.books[1].transformTarget.dispatchEvent(new CustomEvent('load', { detail }))
    expect(detail.url).toBe('data:text/plain,')
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('image.png'))).toBe(false)
    const chapterDoc = new DOMParser().parseFromString('<html><body><p>Chapter 1</p><h2>Subheading</h2></body></html>', 'text/html')
    document.querySelector('foliate-view')!.dispatchEvent(new CustomEvent('load', { detail: { doc: chapterDoc, index: 0 } }))
    expect(chapterDoc.querySelector('p')?.hasAttribute('data-bd-chapter-title')).toBe(true)
    expect(chapterDoc.querySelector('h2')?.hasAttribute('data-bd-chapter-title')).toBe(false)
    expect(state.styles.mock.calls.some(([css]) => String(css).includes('[data-bd-chapter-title] { text-align: center'))).toBe(true)
    expect(state.styles.mock.calls.some(([css]) => String(css).includes('p { text-indent: 2em !important; }'))).toBe(true)
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.loading-overlay')?.style.display).toBe('none'))
    await vi.waitFor(() => expect(panel.hasAttribute('aria-busy')).toBe(false))
    document.querySelector('foliate-view')!.dispatchEvent(new CustomEvent('relocate', { detail: { cfi: 'epubcfi(/6/4)' } }))
    toggle.click()
    await vi.waitFor(() => expect(state.loaders).toHaveLength(3))
    await vi.waitFor(() => expect(state.init).toHaveBeenLastCalledWith({ lastLocation: 'epubcfi(/6/4)' }))
    expect(localStorage.getItem('bd-eink-clean-reading')).toBe('false')
    expect(await state.loaders[2].loadText('chapter.xhtml')).toContain('src="image.png"')
  } finally {
    vi.unstubAllGlobals()
    localStorage.removeItem('i18nextLng')
    localStorage.removeItem('bd-eink-clean-reading')
    localStorage.removeItem('bd-eink-settings-tab')
    localStorage.removeItem('bd-eink-turn-area')
    history.replaceState(null, '', '/')
    document.body.innerHTML = ''
  }
})
