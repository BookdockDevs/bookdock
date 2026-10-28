import { expect, it, vi } from 'vitest'

const toc = Array.from({ length: 25 }, (_, index) => ({ href: index < 2 ? `chapter.xhtml#part-${index}` : `chapter-${index}`, label: `Chapter ${index + 1}` }))
vi.mock('../../public/foliate-js/view.js', () => ({}))
vi.mock('../../public/foliate-js/epub.js', () => ({ EPUB: class {
  async init() { return { toc, sections: [{ id: 'first.xhtml' }, { id: 'second.xhtml' }, { id: 'third.xhtml' }], rendition: {} } }
} }))

it('fills available space with complete rows and repaginates on resize', async () => {
  let height = 552
  let footerTakesSpace = false
  const clientHeight = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (!this.classList.contains('panel-body')) return 0
    const footer = this.parentElement?.querySelector<HTMLElement>('.panel-footer')
    return height - (footerTakesSpace && footer && !footer.hidden ? 53 : 0)
  })
  if (!customElements.get('foliate-view')) {
    customElements.define('foliate-view', class extends HTMLElement {
      renderer = Object.assign(document.createElement('div'), { setStyles: () => {} })
      constructor() { super(); this.renderer.attachShadow({ mode: 'open' }) }
      async open() {}
      async init() {}
    })
  }
  document.body.innerHTML = '<div id="app"></div>'
  localStorage.setItem('i18nextLng', 'en')
  document.documentElement.setAttribute('data-theme', 'dark')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ data: { id: 'user-1', guest: false } }))
    if (url.includes('/books?')) return new Response(JSON.stringify({ data: [{ id: 'book-1', title: 'Book', format: 'txt', coverKey: null }], total: 1 }))
    if (url.endsWith('/libraries')) return new Response(JSON.stringify({ data: [] }))
    if (url.includes('/reader/manifest')) return new Response(JSON.stringify({ data: { revisionId: 'rev', entries: [{ path: 'second.xhtml', mediaType: 'application/xhtml+xml' }], startupFiles: [] } }))
    if (url.includes('/reader/entry')) return new Response(JSON.stringify({ data: { text: '<html>Second</html>' } }))
    if (url.includes('/progress/')) return new Response(JSON.stringify({ data: null }))
    throw new Error(`Unexpected request: ${url}`)
  }))
  try {
    vi.resetModules()
    await import('../eink/index')
    await vi.waitFor(() => expect(document.querySelector('.book')).not.toBeNull())
    document.querySelector<HTMLButtonElement>('.book')!.click()
    await vi.waitFor(() => expect(document.querySelector('.controls')).not.toBeNull())
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.loading-overlay')?.style.display).toBe('none'))
    vi.useFakeTimers()
    try {
      document.querySelector('foliate-view')!.dispatchEvent(new CustomEvent('relocate', { detail: { section: { current: 0 } } }))
      await vi.advanceTimersByTimeAsync(800)
      const request = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/reader/entry'))
      expect(String(request?.[0])).toContain('path=second.xhtml')
    } finally { vi.useRealTimers() }
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.controls button')]
    const renderer = (document.querySelector('foliate-view') as HTMLElement & { renderer: HTMLElement }).renderer
    expect(renderer.getAttribute('background-color')).toBe('#000000')
    expect(renderer.style.backgroundColor).toBe('rgb(0, 0, 0)')
    buttons.find(button => button.textContent === 'Settings')!.click()
    const themeButtons = [...document.querySelectorAll<HTMLButtonElement>('.panel button')]
    themeButtons.find(button => button.getAttribute('aria-label') === 'Light' || button.textContent === 'Light')!.click()
    expect(renderer.getAttribute('background-color')).toBe('#ffffff')
    expect(renderer.style.backgroundColor).toBe('rgb(255, 255, 255)')
    themeButtons.find(button => button.getAttribute('aria-label') === 'Dark' || button.textContent === 'Dark')!.click()
    expect(renderer.getAttribute('background-color')).toBe('#000000')
    document.querySelector('foliate-view')!.dispatchEvent(new CustomEvent('relocate', { detail: { tocItem: { href: 'chapter.xhtml#part-1', label: 'Chapter 2' } } }))
    buttons.find(button => button.textContent === 'Table of Contents')!.click()
    expect(document.querySelector('.toc-row.current')?.textContent).toBe('Chapter 2')
    expect(document.querySelectorAll('.toc-row')).toHaveLength(11)
    expect(document.querySelector('.toc-list')?.classList.contains('toc-list-fill')).toBe(true)
    expect(document.querySelector('.toc-pager')?.textContent).toContain('1 / 3')
    document.querySelectorAll<HTMLButtonElement>('.toc-pager button')[1]!.click()
    expect(document.querySelector('.toc-row')?.textContent).toBe('Chapter 12')
    height = 480
    window.dispatchEvent(new Event('resize'))
    expect(document.querySelectorAll('.toc-row')).toHaveLength(10)
    expect(document.querySelector('.toc-row')?.textContent).toBe('Chapter 11')
    document.querySelectorAll<HTMLButtonElement>('.toc-pager button')[1]!.click()
    expect(document.querySelectorAll('.toc-row')).toHaveLength(5)
    expect(document.querySelector('.toc-list')?.classList.contains('toc-list-fill')).toBe(false)
    expect(document.querySelectorAll('.toc-row')[4]?.textContent).toBe('Chapter 25')
    expect(document.querySelector('.panel-header-subtitle')?.textContent).toBe('25 chapters')
    document.querySelector<HTMLElement>('.backdrop')!.click()
    document.querySelector('foliate-view')!.dispatchEvent(new CustomEvent('relocate', { detail: { tocItem: { href: 'chapter.xhtml#unknown', label: 'Unknown' } } }))
    buttons.find(button => button.textContent === 'Table of Contents')!.click()
    expect(document.querySelector('.toc-row.current')).toBeNull()
    document.querySelector<HTMLElement>('.backdrop')!.click()
    document.querySelector('foliate-view')!.dispatchEvent(new CustomEvent('relocate', { detail: { tocItem: { href: 'other', label: 'Chapter 2' } } }))
    buttons.find(button => button.textContent === 'Table of Contents')!.click()
    expect(document.querySelector('.toc-row.current')?.textContent).toBe('Chapter 2')
    document.querySelector<HTMLElement>('.backdrop')!.click()
    const rest = toc.splice(3)
    try {
      buttons.find(button => button.textContent === 'Table of Contents')!.click()
      expect(document.querySelectorAll('.toc-row')).toHaveLength(3)
      expect(document.querySelector('.toc-list')?.classList.contains('toc-list-fill')).toBe(false)
      expect(document.querySelector<HTMLElement>('.panel-footer')?.hidden).toBe(true)
    } finally { toc.push(...rest) }
    document.querySelector<HTMLElement>('.backdrop')!.click()
    height = 552
    footerTakesSpace = true
    const overflow = toc.splice(11)
    try {
      buttons.find(button => button.textContent === 'Table of Contents')!.click()
      expect(document.querySelectorAll('.toc-row')).toHaveLength(11)
      expect(document.querySelector<HTMLElement>('.panel-footer')?.hidden).toBe(true)
      document.querySelector<HTMLElement>('.backdrop')!.click()
      toc.push(overflow.shift()!)
      buttons.find(button => button.textContent === 'Table of Contents')!.click()
      expect(document.querySelectorAll('.toc-row')).toHaveLength(10)
      expect(document.querySelector<HTMLElement>('.panel-footer')?.hidden).toBe(false)
      expect(document.querySelector('.toc-list')?.classList.contains('toc-list-fill')).toBe(true)
    } finally { toc.push(...overflow) }
  } finally {
    clientHeight.mockRestore()
    vi.unstubAllGlobals()
    localStorage.removeItem('i18nextLng')
    localStorage.removeItem('bd-eink-theme')
    document.documentElement.removeAttribute('data-theme')
    document.body.innerHTML = ''
  }
})
