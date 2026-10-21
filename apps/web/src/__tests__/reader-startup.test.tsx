import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useReaderRenderer } from '@/features/reader/hooks/useReaderRenderer'
import { waitForReaderFonts } from '@/features/reader/lib/reader-font-ready'
import { FoliateReader, openZipFromWholeFile } from '@/features/reader/renderers/FoliateReader'
import { useUiStore } from '@/stores/ui.store'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('whole EPUB download', () => {
  it('keeps its timeout active until the response body finishes', async () => {
    vi.useFakeTimers()
    let aborted = false
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => ({
      ok: true,
      headers: new Headers(),
      blob: () => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
        aborted = true
        reject(new Error('body timeout'))
      })),
    })))
    const download = openZipFromWholeFile('/book', {})
    const assertion = expect(download).rejects.toThrow('body timeout')
    await vi.advanceTimersByTimeAsync(60000)
    await assertion
    expect(aborted).toBe(true)
  })

  it('rejects an incomplete body before trying to parse its ZIP', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('short', { headers: { 'Content-Length': '10' } })))
    await expect(openZipFromWholeFile('/book', {})).rejects.toThrow('Incomplete EPUB response')
  })
})

describe('chapter font readiness', () => {
  it.each(['loading', 'loaded', 'error'])('tracks font import completion through load events: %s', async (state) => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: vi.fn().mockResolvedValue([]) } })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    const style = document.createElement('style')
    style.textContent = '@import url("https://example.com/fonts.css");'
    style.dataset.bdReaderFonts = ''
    style.dataset.loadState = state
    document.head.appendChild(style)
    try {
      // An empty CSSOM, or an inaccessible/nested import, must not count as completion.
      Object.defineProperty(style, 'sheet', { value: { cssRules: [] } })
      const done = vi.fn()
      const wait = waitForReaderFonts(document, new AbortController().signal).then(done)
      if (state === 'loading') {
        await act(async () => { await Promise.resolve() })
        expect(done).not.toHaveBeenCalled()
        expect(document.fonts.load).not.toHaveBeenCalled()
        style.dispatchEvent(new Event('load'))
      }
      await wait
      expect(done).toHaveBeenCalledWith(state !== 'error')
    } finally {
      style.remove()
      Reflect.deleteProperty(document, 'fonts')
    }
  })

  it('falls back when an import times out without waiting for a late load event', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: vi.fn().mockResolvedValue([]) } })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    const style = document.createElement('style')
    style.textContent = '@import url("https://example.com/fonts.css");'
    style.dataset.bdReaderFonts = ''
    style.dataset.loadState = 'loading'
    document.head.appendChild(style)
    try {
      const wait = waitForReaderFonts(document, new AbortController().signal)
      await vi.advanceTimersByTimeAsync(8000)
      expect(await wait).toBe(false)
      style.dispatchEvent(new Event('load'))
      await Promise.resolve()
      expect(document.fonts.load).not.toHaveBeenCalled()
    } finally {
      style.remove()
      Reflect.deleteProperty(document, 'fonts')
    }
  })

  it('waits for visible glyphs even while unrelated chapter fonts remain pending', async () => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise(() => {}), load: vi.fn().mockResolvedValue([]) } })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    expect(await waitForReaderFonts(document, new AbortController().signal)).toBe(true)
    Reflect.deleteProperty(document, 'fonts')
  })

  it('does not wait again for imports belonging to the book stylesheet', async () => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: vi.fn().mockResolvedValue([]) } })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    const style = document.createElement('style')
    style.textContent = '@import url("https://example.com/book.css");'
    document.head.appendChild(style)
    try {
      expect(await waitForReaderFonts(document, new AbortController().signal)).toBe(true)
    } finally {
      style.remove()
      Reflect.deleteProperty(document, 'fonts')
    }
  })

  it('bounds an unavailable font instead of keeping the reader hidden forever', async () => {
    vi.useFakeTimers()
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: vi.fn(() => new Promise(() => {})) } })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    const wait = waitForReaderFonts(document, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(8000)
    expect(await wait).toBe(false)
    Reflect.deleteProperty(document, 'fonts')
  })

  it('waits for the selected glyphs rather than only stylesheet readiness', async () => {
    let resolveFont!: () => void
    const load = vi.fn(() => new Promise<void>((resolve) => { resolveFont = resolve }))
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve(), load } })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    const done = vi.fn()
    const wait = waitForReaderFonts(document, new AbortController().signal).then(done)
    await waitFor(() => expect(load).toHaveBeenCalled())
    expect(done).not.toHaveBeenCalled()
    resolveFont()
    await wait
    expect(done).toHaveBeenCalledWith(true)
    Reflect.deleteProperty(document, 'fonts')
  })

  it('releases a destroyed reader even if its fonts never finish', async () => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise(() => {}), load: vi.fn() } })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    const controller = new AbortController()
    const wait = waitForReaderFonts(document, controller.signal)
    controller.abort()
    expect(await wait).toBe(false)
    Reflect.deleteProperty(document, 'fonts')
  })
})

describe('reader mount preparation', () => {
  it('keeps the current chapter when toggling clean reading after leaving the saved position', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['fonts'], { data: [] })
    const baseline = useUiStore.getState()
    useUiStore.setState({ cleanReading: false })
    const positions = new WeakMap<FoliateReader, { cfi: string | null; fraction: number | null }>()
    const instances: FoliateReader[] = []
    const mount = vi.spyOn(FoliateReader.prototype, 'mount').mockImplementation(async function (this: FoliateReader, _container, target, fraction, onReady) {
      instances.push(this)
      positions.set(this, { cfi: target ?? null, fraction: fraction ?? null })
      onReady?.()
    })
    const display = vi.spyOn(FoliateReader.prototype, 'display').mockImplementation(async function (this: FoliateReader, target) {
      positions.set(this, { cfi: target ?? null, fraction: null })
      return true
    })
    const position = vi.spyOn(FoliateReader.prototype, 'getCurrentPosition').mockImplementation(function (this: FoliateReader) {
      return positions.get(this) ?? { cfi: null, fraction: null }
    })
    const destroy = vi.spyOn(FoliateReader.prototype, 'destroy').mockImplementation(() => {})
    function Harness({ bookId = 'book-a' }: { bookId?: string }) {
      const { containerRef } = useReaderRenderer({
        url: `/books/${bookId}/file`, bookId, format: 'epub', initialCfi: 'chapter:251:0.4', initialFraction: 0.5,
      })
      return <div ref={containerRef} />
    }
    const view = render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>)
    try {
      await waitFor(() => expect(mount).toHaveBeenCalledOnce())
      const currentPosition = { cfi: 'chapter:252:0.2', fraction: 0.51 }
      positions.set(instances[0], currentPosition)

      act(() => { useUiStore.setState({ cleanReading: true }) })
      await waitFor(() => expect(mount).toHaveBeenCalledTimes(2))
      expect(mount.mock.calls[1].slice(1, 3)).toEqual([currentPosition.cfi, currentPosition.fraction])
      expect(positions.get(instances[1])).toEqual(currentPosition)
      expect(display).not.toHaveBeenCalled()

      act(() => { useUiStore.setState({ cleanReading: false }) })
      await waitFor(() => expect(mount).toHaveBeenCalledTimes(3))
      expect(positions.get(instances[2])).toEqual(currentPosition)
      expect(display).not.toHaveBeenCalled()

      view.rerender(<QueryClientProvider client={client}><Harness bookId="book-b" /></QueryClientProvider>)
      await waitFor(() => expect(mount).toHaveBeenCalledTimes(4))
      expect(mount.mock.calls[3].slice(1, 3)).toEqual(['chapter:251:0.4', 0.5])
    } finally {
      view.unmount()
      client.clear()
      mount.mockRestore(); display.mockRestore(); position.mockRestore(); destroy.mockRestore()
      useUiStore.setState(baseline)
    }
  })

  it('does not mount a chapter before account settings and the font catalog are ready', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const baseline = useUiStore.getState()
    useUiStore.setState({ fontSize: 29 })
    const { FoliateReader } = await import('@/features/reader/renderers/FoliateReader')
    const events: unknown[] = []
    const apply = vi.spyOn(FoliateReader.prototype, 'applyFont').mockImplementation((font) => { events.push(font.size) })
    const mount = vi.spyOn(FoliateReader.prototype, 'mount').mockImplementation(async () => { events.push('mount') })
    const destroy = vi.spyOn(FoliateReader.prototype, 'destroy').mockImplementation(() => {})
    function Harness({ url, ready }: { url: string; ready: boolean }) {
      const { containerRef } = useReaderRenderer({ url, ready, initialCfi: '' })
      return <div ref={containerRef} />
    }
    const view = render(<QueryClientProvider client={client}><Harness url="" ready={false} /></QueryClientProvider>)
    view.rerender(<QueryClientProvider client={client}><Harness url="/book" ready={false} /></QueryClientProvider>)
    expect(mount).not.toHaveBeenCalled()
    act(() => { client.setQueryData(['fonts'], { data: [] }) })
    expect(mount).not.toHaveBeenCalled()
    view.rerender(<QueryClientProvider client={client}><Harness url="/book" ready /></QueryClientProvider>)
    await waitFor(() => expect(mount).toHaveBeenCalledOnce())
    expect(events.indexOf(29)).toBeLessThan(events.indexOf('mount'))
    view.rerender(<QueryClientProvider client={client}><Harness url="/book" ready={false} /></QueryClientProvider>)
    expect(mount).toHaveBeenCalledOnce()
    view.unmount()
    client.clear()
    apply.mockRestore(); mount.mockRestore(); destroy.mockRestore()
    useUiStore.setState(baseline)
  })
})
