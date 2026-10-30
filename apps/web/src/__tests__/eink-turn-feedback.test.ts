import { expect, it, vi } from 'vitest'

vi.mock('../../public/foliate-js/view.js', () => ({}))
vi.mock('../../public/foliate-js/epub.js', () => ({ EPUB: class {
  async init() { return { sections: [{ id: 'first' }], rendition: {} } }
} }))

it('shows feedback while turning and retains at most one subsequent turn', async () => {
  let finish!: () => void
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const next = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve })).mockResolvedValue(undefined)
  if (!customElements.get('foliate-view')) {
    customElements.define('foliate-view', class extends HTMLElement {
      renderer = Object.assign(document.createElement('div'), { setStyles: () => {} })
      constructor() { super(); this.renderer.attachShadow({ mode: 'open' }) }
      async open() {}
      async init() {}
      next = next
    })
  }
  document.body.innerHTML = '<div id="app"></div>'
  history.replaceState(null, '', '/eink#/book/book-1')
  localStorage.setItem('i18nextLng', 'en')
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.endsWith('/auth/me')) return new Response(JSON.stringify({ data: { id: 'user-1', guest: false } }))
    if (url.includes('/reader/manifest')) return new Response(JSON.stringify({ data: { revisionId: 'rev', entries: [], startupFiles: [] } }))
    if (url.includes('/progress/')) return new Response(JSON.stringify({ data: null }))
    throw new Error(`Unexpected request: ${url}`)
  }))
  try {
    vi.resetModules()
    await import('../eink/index')
    await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.loading-overlay')?.style.display).toBe('none'))
    const buttons = document.querySelectorAll<HTMLButtonElement>('.controls button')
    const button = buttons[buttons.length - 1]!
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    button.click()
    const status = document.querySelector<HTMLElement>('.turn-status')!
    expect(button).toHaveClass('pressed')
    expect(next).not.toHaveBeenCalled()
    frames.shift()!(0)
    expect(next).not.toHaveBeenCalled()
    frames.shift()!(0)
    await Promise.resolve()
    expect(next).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(500)
    expect(button).not.toHaveClass('pressed')
    vi.advanceTimersByTime(1499)
    expect(status.hidden).toBe(true)
    vi.advanceTimersByTime(1)
    expect(status.hidden).toBe(false)
    expect(status.textContent).toContain('next page')
    vi.useRealTimers()
    button.click()
    button.click()
    frames.shift()!(0)
    frames.shift()!(0)
    frames.shift()!(0)
    frames.shift()!(0)
    await Promise.resolve()
    finish()
    await vi.waitFor(() => expect(frames.length).toBe(1))
    expect(status.hidden).toBe(false)
    frames.shift()!(0)
    expect(status.hidden).toBe(false)
    frames.shift()!(0)
    await vi.waitFor(() => expect(next).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(status.hidden).toBe(true))
  } finally {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    localStorage.removeItem('i18nextLng')
    document.body.innerHTML = ''
  }
})
