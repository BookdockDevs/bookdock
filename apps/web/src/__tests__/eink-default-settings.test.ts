import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ init: vi.fn(async () => {}) }))
vi.mock('../../public/foliate-js/view.js', () => {
  if (!customElements.get('foliate-view')) customElements.define('foliate-view', class extends HTMLElement {
    renderer = Object.assign(document.createElement('div'), { setStyles: () => {} })
    constructor() { super(); this.renderer.attachShadow({ mode: 'open' }) }
    async open() {}
    async init() { await state.init() }
  })
  return {}
})
vi.mock('../../public/foliate-js/epub.js', () => ({ EPUB: class {
  async init() { return { toc: [], sections: [], rendition: {} } }
} }))

it('uses the requested defaults and preserves an explicitly saved zero', async () => {
  const keys = ['bd-eink-margin-step', 'bd-eink-line-height-step', 'bd-eink-settings-tab', 'i18nextLng']
  const original = keys.map(key => localStorage.getItem(key))
  const json = (data: unknown) => new Response(JSON.stringify({ data }))
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const url = String(input)
    if (url.endsWith('/auth/me')) return json({ id: 'user-1', guest: false })
    if (url.endsWith('/libraries')) return json([])
    if (url.includes('/books?')) return new Response(JSON.stringify({ data: [{ id: 'b1', title: 'Book', format: 'txt' }], total: 1 }))
    if (url.endsWith('/reader/manifest')) return json({ revisionId: 'rev', generated: true, entries: [], startupFiles: [] })
    if (url.includes('/progress/')) return json(null)
    throw new Error(`Unexpected request: ${url}`)
  }))
  try {
    for (const [saved, expectedMargin, expectedLine] of [[null, 1, '1'], ['0', 0, '0']] as const) {
      history.replaceState(null, '', '/eink')
      document.body.innerHTML = '<div id="app"></div>'
      localStorage.setItem('i18nextLng', 'en')
      localStorage.removeItem('bd-eink-settings-tab')
      for (const key of keys.slice(0, 2)) {
        if (saved === null) localStorage.removeItem(key)
        else localStorage.setItem(key, saved)
      }
      state.init.mockClear()
      vi.resetModules()
      await import('../eink/index')
      await vi.waitFor(() => expect(document.querySelector('.book')).not.toBeNull())
      document.querySelector<HTMLButtonElement>('.book')!.click()
      await vi.waitFor(() => expect(state.init).toHaveBeenCalled())
      await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.loading-overlay')?.style.display).toBe('none'))
      ;[...document.querySelectorAll<HTMLButtonElement>('.controls button')].find(button => button.textContent === 'Settings')!.click()
      await vi.waitFor(() => expect(document.querySelectorAll('.settings-tab-btn').length).toBeGreaterThan(0))
      ;[...document.querySelectorAll<HTMLButtonElement>('.settings-tab-btn')].find(button => button.textContent === 'Layout')!.click()
      const margins = document.querySelectorAll('.layout-opt-group:first-child .layout-card')
      expect([...margins].findIndex(card => card.classList.contains('active'))).toBe(expectedMargin)
      const lineRow = [...document.querySelectorAll('.stepper-row')].find(row => row.textContent?.includes('Line Spacing'))
      expect(lineRow?.querySelector('.stepper-thumb-val')?.textContent).toBe(expectedLine)
    }
  } finally {
    keys.forEach((key, index) => original[index] === null ? localStorage.removeItem(key) : localStorage.setItem(key, original[index]!))
    vi.unstubAllGlobals()
    history.replaceState(null, '', '/')
    document.body.innerHTML = ''
  }
})
