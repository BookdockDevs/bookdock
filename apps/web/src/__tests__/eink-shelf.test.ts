import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../public/foliate-js/view.js', () => ({}))
vi.mock('../../public/foliate-js/epub.js', () => ({ EPUB: class {} }))

async function openShelf(libraries: Response, books: unknown[] = []) {
  document.body.innerHTML = '<div id="app"></div>'
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ data: { id: 'user-1', guest: false } }))
    if (url.includes('/books?')) return new Response(JSON.stringify({ data: books, total: books.length }))
    if (url.endsWith('/libraries')) return libraries
    if (url.endsWith('/auth/logout')) return new Response('{}')
    throw new Error(`Unexpected request: ${url}`)
  }))
  vi.resetModules()
  await import('../eink/index')
  await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.loading-overlay')?.style.display).toBe('none'))
  return document.querySelector('.shelf-header h1')?.textContent
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('Kindle library heading', () => {
  it('shows the private library name rather than a shared library name', async () => {
    const libraries = new Response(JSON.stringify({ data: [
      { type: 'shared', name: 'Shared' }, { type: 'private', name: 'My custom library' },
    ] }))
    expect(await openShelf(libraries)).toBe('My custom library')
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('pageSize=8&sortBy=lastReadAt&sortOrder=desc'))).toBe(true)
    const signOut = document.querySelector('.shelf-title-group .logout-btn')
    expect(signOut?.getAttribute('aria-label')).toBeTruthy()
    expect(signOut?.querySelector('svg')).not.toBeNull()
    expect(signOut?.textContent).toBe('')
    expect(document.querySelector('.shelf-header-actions .logout-btn')).toBeNull()
  })

  it('changes page capacity when the viewport no longer fits two rows', async () => {
    let footerTop = 600
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(432)
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: this.classList.contains('shelf-footer') ? footerTop : 125 } as DOMRect
    })
    try {
      await openShelf(new Response(JSON.stringify({ data: [] })))
      const grid = document.querySelector<HTMLElement>('.grid')!
      expect(grid.style.gridTemplateColumns).toBe('repeat(4, 96px)')
      footerTop = 430
      window.dispatchEvent(new Event('resize'))
      await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('pageSize=4&sortBy=lastReadAt'))).toBe(true))
      await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.loading-overlay')?.style.display).toBe('none'))
      expect(document.querySelector<HTMLElement>('.grid')!.style.gridTemplateColumns).toBe('repeat(4, 96px)')
    } finally { width.mockRestore(); rect.mockRestore() }
  })

  it('shows coverless EPUBs and keeps their fallback until the image loads', async () => {
    await openShelf(new Response(JSON.stringify({ data: [] })), [
      { id: 'epub-1', title: 'Example.epub', format: 'epub', coverKey: null },
      { id: 'txt-1', title: 'Story.txt', format: 'txt', coverKey: null },
    ])
    const covers = document.querySelectorAll<HTMLElement>('.cover')
    expect(document.querySelector('.grid')?.classList.contains('grid-balanced')).toBe(false)
    expect(covers[0]!.querySelector('.cover-fallback-title')?.textContent).toBe('Example')
    const image = covers[0]!.querySelector<HTMLImageElement>('img')!
    expect(image.getAttribute('src')).toContain('/books/epub-1/cover?')
    expect(covers[0]!.querySelector<HTMLElement>('.cover-fallback')!.hidden).toBe(false)
    image.dispatchEvent(new Event('load'))
    expect(covers[0]!.querySelector<HTMLElement>('.cover-fallback')!.hidden).toBe(true)
    image.dispatchEvent(new Event('error'))
    expect(covers[0]!.querySelector<HTMLElement>('.cover-fallback')!.hidden).toBe(false)
    expect(covers[1]!.querySelector('.cover-fallback-title')?.textContent).toBe('Story')
    expect(covers[1]!.querySelector('img')).toBeNull()
  })

  it('shows only the language button in shelf header actions', async () => {
    localStorage.setItem('i18nextLng', 'zh-CN')
    try {
      await openShelf(new Response(JSON.stringify({ data: [] })))
      const actions = document.querySelectorAll<HTMLButtonElement>('.shelf-header-actions button')
      expect(actions).toHaveLength(1)
      expect(actions[0]!.getAttribute('aria-label')).toContain('语言')
    } finally {
      localStorage.removeItem('i18nextLng')
    }
  })

  it('requires confirmation before signing out', async () => {
    await openShelf(new Response(JSON.stringify({ data: [{ type: 'private', name: 'Library' }] })))
    const signOut = document.querySelector<HTMLButtonElement>('.logout-btn')!
    signOut.click()
    let dialog = document.querySelector<HTMLElement>('[role=dialog]')!
    expect(dialog).not.toBeNull()
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/auth/logout'))).toBe(false)
    dialog.querySelectorAll('button')[0]!.click()
    expect(document.querySelector('[role=dialog]')).toBeNull()
    expect(document.querySelector('.shelf')).not.toBeNull()
    signOut.click()
    dialog = document.querySelector<HTMLElement>('[role=dialog]')!
    dialog.querySelectorAll('button')[1]!.click()
    await vi.waitFor(() => expect(document.querySelector('.login')).not.toBeNull())
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/auth/logout'))).toHaveLength(1)
  })

  it('uses the ordinary reader default when no private library name is returned', async () => {
    localStorage.setItem('i18nextLng', 'zh-CN')
    try { expect(await openShelf(new Response(JSON.stringify({ data: [] })))).toBe('个人书库') }
    finally { localStorage.removeItem('i18nextLng') }
  })

  it('does not prevent the shelf from opening if library names fail to load', async () => {
    expect(await openShelf(new Response('', { status: 500 }))).toBe('—')
  })
})
