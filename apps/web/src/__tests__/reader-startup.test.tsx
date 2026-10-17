import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useReaderRenderer } from '@/features/reader/hooks/useReaderRenderer'
import { waitForReaderFonts } from '@/features/reader/lib/reader-font-ready'
import { openZipFromWholeFile } from '@/features/reader/renderers/FoliateReader'
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
  it('waits for visible glyphs even while unrelated chapter fonts remain pending', async () => {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise(() => {}), load: vi.fn().mockResolvedValue([]) } })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    expect(await waitForReaderFonts(document, new AbortController().signal)).toBe(true)
    Reflect.deleteProperty(document, 'fonts')
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
