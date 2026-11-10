import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Blob as NativeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { IDBFactory } from 'fake-indexeddb'

import type { BookDetailRes } from '@bookdock/shared'

import { apiGet, apiPut } from '@/api/client'
import Reader from '@/features/reader/Reader'
import { LocalReaderContext } from '@/features/reading-data/reader-source-context'
import { localLibraryRepository } from '@/features/local-library/repository'
import { openLocalReaderSession } from '@/features/local-library/reader-session'
import { useAuthStore } from '@/stores/auth.store'
import { useSettingsSyncStore } from '@/stores/settings-sync.store'
import { useToastStore } from '@/stores/toast.store'

const { mockState, navigate, timerCalls, timerPing } = vi.hoisted(() => ({
  mockState: { instances: [] as Array<{ url: string; mountCount: number; destroyed: boolean; position: { cfi: string; fraction: number }; emit: (type: string, value?: unknown) => void }> },
  navigate: vi.fn(),
  timerCalls: [] as unknown[][],
  timerPing: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'reader-book' }),
  useNavigate: () => navigate,
  Link: () => null,
}))
vi.mock('@/api/client', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/client')>(), apiGet: vi.fn(), apiPut: vi.fn() }))
vi.mock('@/features/reader/hooks/useReadingTimer', () => ({ useReadingTimer: (...args: unknown[]) => { timerCalls.push(args); return { flush: vi.fn(), ping: timerPing } } }))
vi.mock('@/features/reader/components/ReaderSidebar', () => ({ ReaderSidebar: () => null }))
vi.mock('@/features/reader/components/ReaderHeader', () => ({ ReaderHeader: () => null }))
vi.mock('@/features/reader/renderers/FoliateReader', () => ({
  setActiveReplacements: vi.fn(),
  setAutoMarkSelectionMode: vi.fn(),
  FoliateReader: class {
    url: string
    mountCount = 0
    destroyed = false
    position = { cfi: 'cfi-original-position', fraction: 0.42 }
    listeners = new Map<string, Set<(value?: any) => void>>()
    constructor(url: string) {
      this.url = url
      mockState.instances.push(this as any)
    }
    on(type: string, listener: (value?: any) => void) {
      const listeners = this.listeners.get(type) ?? new Set()
      listeners.add(listener)
      this.listeners.set(type, listeners)
      return () => listeners.delete(listener)
    }
    emit(type: string, value?: unknown) { this.listeners.get(type)?.forEach(listener => listener(value)) }
    mount(_host: HTMLElement, _cfi: string, _fraction: number | undefined, ready: () => unknown) {
      this.mountCount += 1
      ready()
      if (this.url.includes('revisionId=rev-2')) return Promise.reject(new Error('candidate renderer failed'))
      queueMicrotask(() => this.emit('rendered'))
      return Promise.resolve()
    }
    getCurrentPosition() { return this.position }
    destroy() { this.destroyed = true; this.listeners.clear() }
    display() { return Promise.resolve() }
    applyTextReplacements() { return Promise.resolve() }
    clearMediaOverlayHighlight() {}
    getMediaOverlayCues() { return Promise.resolve([]) }
    setAutoReadingActive() {}
    clearTtsHighlight() {}
    applyReadingMode() {} applyPageColumns() {} applyColumnGap() {} applyPageAnimation() {}
    applyShowHeader() {} applyShowFooter() {} applyReadingTheme() {} applyFont() {}
    applyParagraphStyle() {} applyPageWidth() {} applyChineseConversion() {}
    applyContinuousScroll() {} applyClickSettings() {} applyMarginals() {}
    setChapterWordCounts() {}
  },
}))

const book: BookDetailRes = {
  id: 'reader-book', title: 'Reader book', author: '', authors: [], format: 'txt', coverKey: null,
  size: 100, readStatus: 'reading', progress: 0, createdAt: 1, updatedAt: 1, shelfId: null,
  hidden: false, effectiveHidden: false, hiddenReason: null, collected: true,
  filePath: 'fixture.txt', meta: {}, readerSettings: { viewSettings: null, boundPresetId: null },
  revisionId: 'rev-1',
}
let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  mockState.instances = []
  timerCalls.length = 0
  useToastStore.getState().clearToasts()
  localStorage.clear()
  useAuthStore.getState().clearAuth()
  useAuthStore.getState().setAuth({ id: 'reader', username: 'Reader', role: 'member' })
  useSettingsSyncStore.setState({ userId: 'reader', ready: true, failed: false })
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  vi.mocked(apiGet).mockImplementation(async (path) => {
    if (path.startsWith('/books/reader-book/chapters')) return { data: [] } as never
    if (path.startsWith('/books/reader-book')) return { data: book } as never
    if (path.startsWith('/progress/')) return { data: null } as never
    if (path.startsWith('/replacements')) return { data: [] } as never
    return { data: [] } as never
  })
  vi.mocked(apiPut).mockResolvedValue({ data: null })
})

afterEach(async () => {
  cleanup()
  client.clear()
  await localLibraryRepository.close()
  useAuthStore.getState().clearAuth()
  vi.unstubAllGlobals()
})

describe('Reader staged-renderer rollback with the real renderer hook', () => {
  it('dispatches actual local relocation activity to the source-owned automatic timer', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.stubGlobal('crypto', webcrypto)
    vi.stubGlobal('Blob', NativeBlob)
    useAuthStore.getState().clearAuth()
    const ref = { scope: { kind: 'local' as const, vaultId: 'reader-vault' }, bookId: 'reader-book' }
    const content = { book: ref, contentId: 'local-revision' }
    await localLibraryRepository.addBook({ ref, content, title: 'Local fixture', authors: [], format: 'epub', availability: 'available', size: 3, createdAt: 1, updatedAt: 1, version: 0 }, new Blob(['abc']))
    const session = await openLocalReaderSession(ref)
    session.getStructure = async () => ({ content, sections: [{ index: 0, href: 'chapter.xhtml', title: 'Chapter', byteLength: null, wordCount: null }], navigation: [] })
    render(<QueryClientProvider client={client}><LocalReaderContext.Provider value={session}><Reader /></LocalReaderContext.Provider></QueryClientProvider>)
    await waitFor(() => expect(mockState.instances).toHaveLength(1))
    await waitFor(() => expect(timerCalls.some(([id, destination]) => id === 'reader-book' && Boolean(destination))).toBe(true))
    await act(async () => { mockState.instances[0]!.emit('relocated', { cfi: 'epubcfi(/6/2)', contentCfi: 'epubcfi(/6/2)', chapterIndex: 0, fraction: 0.2, percent: 20, revisionId: 'local-revision' }) })
    expect(timerPing).toHaveBeenCalledWith(expect.objectContaining({ fraction: 0.2, revisionId: 'local-revision' }))
    timerPing.mockClear()
    await act(async () => { useAuthStore.getState().setAuth({ id: 'connected-service', username: 'Service', role: 'member' }) })
    // Signing in re-resolves the account-scoped font catalog, which currently
    // rebuilds the renderer (see the acknowledged-limitation case below). The
    // source contract must survive that rebuild: activity still reaches the
    // device timer and never turns into server reading records.
    await waitFor(() => expect(mockState.instances.length).toBeGreaterThan(0))
    const live = mockState.instances.at(-1)!
    await act(async () => { live.emit('relocated', { cfi: 'epubcfi(/6/4)', chapterIndex: 0, fraction: 0.3, percent: 30, revisionId: 'local-revision' }) })
    expect(timerPing).toHaveBeenCalledWith(expect.objectContaining({ fraction: 0.3, revisionId: 'local-revision' }))
    expect(vi.mocked(apiGet).mock.calls.some(([path]) => path.startsWith('/reading-records/'))).toBe(false)
  })

  // Regression: signing in used to reload the book in place. Both the font
  // catalog and the replacement rule set move from the device vault to the
  // account when a session appears, so their readiness dipped back to false for
  // a beat and the mount effect tore the engine down. The engine now stays
  // mounted while its own url, book and generation are unchanged, and the
  // pending data lands in the live engine instead.
  //
  // The wait below is deliberate: an earlier version only drained one microtask
  // and sampled somewhere inside that teardown window, so it flipped between
  // passing and failing on identical code.
  it('keeps the mounted renderer when only the account changes', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory())
    vi.stubGlobal('crypto', webcrypto)
    vi.stubGlobal('Blob', NativeBlob)
    useAuthStore.getState().clearAuth()
    const ref = { scope: { kind: 'local' as const, vaultId: 'reader-vault' }, bookId: 'reader-book' }
    const content = { book: ref, contentId: 'local-revision' }
    await localLibraryRepository.addBook({ ref, content, title: 'Local fixture', authors: [], format: 'epub', availability: 'available', size: 3, createdAt: 1, updatedAt: 1, version: 0 }, new Blob(['abc']))
    const session = await openLocalReaderSession(ref)
    session.getStructure = async () => ({ content, sections: [{ index: 0, href: 'chapter.xhtml', title: 'Chapter', byteLength: null, wordCount: null }], navigation: [] })
    render(<QueryClientProvider client={client}><LocalReaderContext.Provider value={session}><Reader /></LocalReaderContext.Provider></QueryClientProvider>)
    await waitFor(() => expect(mockState.instances).toHaveLength(1))
    const fontFetches = () => vi.mocked(apiGet).mock.calls.filter(([path]) => path === '/fonts').length
    const before = fontFetches()
    await act(async () => { useAuthStore.getState().setAuth({ id: 'connected-service', username: 'Service', role: 'member' }) })
    // The new key is only fetched once the account is visible, and the teardown
    // follows that fetch. Waiting for it makes the outcome deterministic.
    await waitFor(() => expect(fontFetches()).toBeGreaterThan(before))
    await act(async () => { await Promise.resolve() })
    expect(mockState.instances).toHaveLength(1)
  })
  it('continues mounting with device fonts when the connected font service fails', async () => {
    const original = vi.mocked(apiGet).getMockImplementation()!
    vi.mocked(apiGet).mockImplementation(async (path, ...args) => {
      if (path === '/fonts') throw new Error('Font service unavailable')
      return original(path, ...args)
    })
    render(<QueryClientProvider client={client}><Reader /></QueryClientProvider>)
    await waitFor(() => expect(mockState.instances).toHaveLength(1))
    await waitFor(() => expect(mockState.instances[0]?.mountCount).toBe(1))
    expect(useToastStore.getState().toasts.some((toast) => toast.dedupeKey === 'reader-font-service')).toBe(true)
  })

  it('reuses the parked renderer, position and source after the candidate mount fails', async () => {
    const requests: string[] = []
    const latestManifest = {
      formatVersion: 1, bookId: 'reader-book', revisionId: 'rev-2', contentHash: 'source-hash',
      size: 100, entryCount: 1,
      entries: [{ path: 'chapter-0002.xhtml', size: 20, compressedSize: 10, compression: 'deflate', mediaType: 'application/xhtml+xml' }],
      spine: [{ path: 'chapter-0002.xhtml', mediaType: 'application/xhtml+xml', linear: true }],
      startupFiles: [], opfPath: 'content.opf', navPath: null, ncxPath: null, generated: true,
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      if (url.includes('/reader/manifest')) return new Response(JSON.stringify({ data: latestManifest }), { status: 200 })
      if (url.includes('/reader/entry')) return new Response('<html><body><p>latest</p></body></html>', { status: 200, headers: { 'Content-Type': 'application/xhtml+xml' } })
      return new Response(JSON.stringify({ data: { text: '<html><body><p>latest</p></body></html>', resources: [] } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))

    render(<QueryClientProvider client={client}><Reader /></QueryClientProvider>)
    await waitFor(() => expect(mockState.instances).toHaveLength(1))
    const parked = mockState.instances[0]!
    await waitFor(() => expect(parked.mountCount).toBe(1))
    await act(async () => { parked.emit('revisionChanged', { revisionId: 'rev-1' }) })
    await act(async () => { parked.emit('revisionNavigation', {
      target: 'chapter-0002.xhtml', sectionHref: 'chapter-0002.xhtml', chapterNavigation: true,
      previousRevisionId: 'rev-1', previousContentHash: 'source-hash',
    }) })
    await waitFor(() => expect(mockState.instances).toHaveLength(2))
    await waitFor(() => expect(mockState.instances[1]?.destroyed).toBe(true))
    await waitFor(() => expect(mockState.instances).toHaveLength(2))

    expect(parked.destroyed).toBe(false)
    expect(parked.mountCount).toBe(1)
    expect(parked.getCurrentPosition()).toEqual({ cfi: 'cfi-original-position', fraction: 0.42 })
    expect(requests.some(url => url.includes('/reader/manifest') && url.includes('revisionId=rev-1'))).toBe(false)
    expect(requests.filter(url => url.includes('/reader/entry'))).toHaveLength(1)
  })
})
