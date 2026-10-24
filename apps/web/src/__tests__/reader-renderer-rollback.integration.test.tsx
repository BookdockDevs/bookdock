import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookDetailRes } from '@bookdock/shared'

import { apiGet, apiPut } from '@/api/client'
import Reader from '@/features/reader/Reader'
import { useAuthStore } from '@/stores/auth.store'
import { useSettingsSyncStore } from '@/stores/settings-sync.store'

const { mockState, navigate } = vi.hoisted(() => ({
  mockState: { instances: [] as Array<{ url: string; mountCount: number; destroyed: boolean; position: { cfi: string; fraction: number }; emit: (type: string, value?: unknown) => void }> },
  navigate: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'reader-book' }),
  useNavigate: () => navigate,
  Link: () => null,
}))
vi.mock('@/api/client', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/client')>(), apiGet: vi.fn(), apiPut: vi.fn() }))
vi.mock('@/features/reader/hooks/useReadingTimer', () => ({ useReadingTimer: () => ({ flush: vi.fn(), ping: vi.fn() }) }))
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

afterEach(() => {
  client.clear()
  useAuthStore.getState().clearAuth()
})

describe('Reader staged-renderer rollback with the real renderer hook', () => {
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
