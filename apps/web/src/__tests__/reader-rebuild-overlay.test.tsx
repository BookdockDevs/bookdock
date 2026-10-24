import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookDetailRes } from '@bookdock/shared'

import { apiGet, apiPut } from '@/api/client'
import Reader from '@/features/reader/Reader'
import { useReaderRenderer } from '@/features/reader/hooks/useReaderRenderer'
import { useAuthStore } from '@/stores/auth.store'
import { useSettingsSyncStore } from '@/stores/settings-sync.store'
import { idbChapterTextStore } from '@/features/reader/lib/idb-chapter-store'
import { useReaderState } from '@/features/reader/state/reader-state'

const { navigate, rendererRef, readerRenderer } = vi.hoisted(() => ({ navigate: vi.fn(), rendererRef: { current: null }, readerRenderer: { current: null } }))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'reader-book' }),
  useNavigate: () => navigate,
  Link: () => null,
}))
vi.mock('@/api/client', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/client')>(), apiGet: vi.fn(), apiPut: vi.fn() }))
vi.mock('@/features/reader/hooks/useReaderRenderer', () => ({ useReaderRenderer: vi.fn(() => ({ containerRef: rendererRef, renderer: readerRenderer.current, fontStack: '', fontCss: '' })) }))
vi.mock('@/features/reader/hooks/useReadingTimer', () => ({ useReadingTimer: () => ({ flush: vi.fn(), ping: vi.fn() }) }))
vi.mock('@/features/reader/components/ReaderSidebar', () => ({ ReaderSidebar: () => null }))
vi.mock('@/features/reader/components/ReaderHeader', () => ({ ReaderHeader: () => null }))

const book: BookDetailRes = {
  id: 'reader-book', title: 'Reader book', author: '', authors: [], format: 'txt', coverKey: null,
  size: 100, readStatus: 'reading', progress: 0, createdAt: 1, updatedAt: 1, shelfId: null,
  hidden: false, effectiveHidden: false, hiddenReason: null, collected: true,
  filePath: 'fixture.txt', meta: {}, readerSettings: { viewSettings: null, boundPresetId: null },
}
let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  rendererRef.current = null
  readerRenderer.current = null
  localStorage.clear()
  useAuthStore.getState().clearAuth()
  useAuthStore.getState().setAuth({ id: 'reader', username: 'Reader', role: 'member' })
  useSettingsSyncStore.setState({ userId: null, ready: false, failed: false })
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  vi.mocked(apiGet).mockImplementation(async (path) => {
    if (path.startsWith('/books/reader-book/chapters')) return { data: [] } as never
    if (path.startsWith('/books/reader-book')) return { data: book } as never
    if (path.startsWith('/progress/')) return { data: null } as never
    return { data: [] } as never
  })
  vi.mocked(apiPut).mockResolvedValue({ data: null })
})

afterEach(() => {
  client.clear()
  useAuthStore.getState().clearAuth()
})

function lastRendererOptions() {
  return vi.mocked(useReaderRenderer).mock.calls.at(-1)![0]
}

describe('reader loading surface', () => {
  it('waits for the replacement rules before opening the book', async () => {
    // A rule set that arrives after the first paint forces a full rebuild of
    // the view (close + open + re-locate), so the reader must wait for it.
    useSettingsSyncStore.setState({ userId: 'reader', ready: true, failed: false })
    let resolveReplacements!: (value: unknown) => void
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path.startsWith('/replacements')) {
        return new Promise((resolve) => { resolveReplacements = resolve }) as never
      }
      if (path.startsWith('/books/reader-book/chapters')) return { data: [] } as never
      if (path.startsWith('/books/reader-book')) return { data: book } as never
      if (path.startsWith('/progress/')) return { data: null } as never
      return { data: [] } as never
    })

    render(<QueryClientProvider client={client}><Reader /></QueryClientProvider>)
    await waitFor(() => expect(client.getQueryData(['book', 'reader-book'])).toEqual({ data: book }))

    expect(lastRendererOptions().ready).toBe(false)

    await act(async () => { resolveReplacements({ data: [] }) })
    await waitFor(() => expect(lastRendererOptions().ready).toBe(true))
  })

  it('covers the reading area again while the view is rebuilt', async () => {
    render(<QueryClientProvider client={client}><Reader /></QueryClientProvider>)
    await waitFor(() => expect(client.getQueryData(['book', 'reader-book'])).toEqual({ data: book }))

    await act(async () => { lastRendererOptions().onRendered?.(lastRendererOptions().url) })
    expect(screen.queryByTestId('reader-loading-surface')).not.toBeInTheDocument()

    // Content replacements and Chinese conversion tear the view down and
    // build it again: the empty reading area must be covered meanwhile.
    await act(async () => { lastRendererOptions().onViewRebuilding?.(true) })
    expect(screen.getByTestId('reader-loading-surface')).toBeInTheDocument()

    await act(async () => { lastRendererOptions().onViewRebuilding?.(false) })
    expect(screen.queryByTestId('reader-loading-surface')).not.toBeInTheDocument()
  })

  it('refreshes on the next navigation, lets the latest rapid jump win, and quarantines old progress', async () => {
    const revisionBook = { ...book, revisionId: 'rev-1' }
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path.startsWith('/books/reader-book/chapters')) return { data: [] } as never
      if (path.startsWith('/books/reader-book')) return { data: revisionBook } as never
      if (path.startsWith('/progress/')) return { data: null } as never
      return { data: [] } as never
    })
    useSettingsSyncStore.setState({ userId: 'reader', ready: true, failed: false })
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const latest = {
      formatVersion: 1,
      bookId: 'reader-book',
      revisionId: 'rev-2',
      contentHash: 'source-hash',
      size: 100,
      entryCount: 1,
      entries: [
        { path: 'OPS/ch1.xhtml', size: 20, compressedSize: 10, compression: 'deflate', mediaType: 'application/xhtml+xml' },
        { path: 'OPS/ch2.xhtml', size: 20, compressedSize: 10, compression: 'deflate', mediaType: 'application/xhtml+xml' },
      ],
      spine: [
        { path: 'OPS/ch1.xhtml', mediaType: 'application/xhtml+xml', linear: true },
        { path: 'OPS/ch2.xhtml', mediaType: 'application/xhtml+xml', linear: true },
      ],
      startupFiles: [], opfPath: 'OPS/content.opf', navPath: null, ncxPath: null, generated: false,
    }
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      if (url.includes('/reader/manifest')) return new Response(JSON.stringify({ data: latest }), { status: 200 })
      return new Response('<html><body><p>new revision</p></body></html>', { status: 200, headers: { 'Content-Type': 'application/xhtml+xml' } })
    }))

    render(<QueryClientProvider client={client}><Reader /></QueryClientProvider>)
    await waitFor(() => expect(lastRendererOptions().url).toContain('revisionId=rev-1'))
    await act(async () => { lastRendererOptions().onRendered?.(lastRendererOptions().url) })
    await act(async () => {
      client.setQueryData(['book', 'reader-book'], { data: { ...revisionBook, revisionId: 'rev-2' } })
    })
    expect(lastRendererOptions().url).toContain('revisionId=rev-1')
    await act(async () => {
      lastRendererOptions().onRevisionChanged?.({ revisionId: 'rev-1' })
      lastRendererOptions().onRelocated?.({
        cfi: 'epubcfi(/6/2!/4/2)', revisionId: 'rev-1', percent: 10, fraction: 0.1,
      })
    })
    await new Promise((resolve) => setTimeout(resolve, 620))
    expect(apiPut.mock.calls.some(([path]) => String(path).includes('/progress/'))).toBe(false)

    await act(async () => {
      expect(lastRendererOptions().onRevisionNavigation).toBeTypeOf('function')
      lastRendererOptions().onRevisionNavigation?.({
        target: 'chapter:0', sectionHref: 'OPS/ch1.xhtml', chapterNavigation: true,
        previousRevisionId: 'rev-1', previousContentHash: 'source-hash',
      })
      lastRendererOptions().onRevisionNavigation?.({
        target: 'OPS/ch2.xhtml', sectionHref: 'OPS/ch2.xhtml', chapterNavigation: true,
        previousRevisionId: 'rev-1', previousContentHash: 'source-hash',
      })
    })
    await waitFor(() => expect(requests.length).toBeGreaterThan(0))
    await waitFor(() => expect(lastRendererOptions().url).toContain('revisionId=rev-2'))
    expect(requests.some((url) => url.includes('/reader/manifest') && url.includes('revisionId=rev-1'))).toBe(false)
    const latestUrl = lastRendererOptions().url
    expect(lastRendererOptions().onReady?.()).toBe('OPS/ch2.xhtml')
    await act(async () => { lastRendererOptions().onRendered?.(latestUrl) })
    await act(async () => {
      lastRendererOptions().onRelocated?.({
        cfi: 'epubcfi(/6/4!/4/2)', revisionId: 'rev-2', percent: 20, fraction: 0.2,
      })
    })
    await waitFor(() => expect(apiPut.mock.calls.some(([path, body]) =>
      String(path).includes('/progress/') && (body as { cfi?: string }).cfi === 'epubcfi(/6/4!/4/2)',
    )).toBe(true))
    expect(lastRendererOptions().url).toBe(latestUrl)
  })

  it('keeps the displayed revision when the prepared replacement renderer fails', async () => {
    const revisionBook = { ...book, revisionId: 'rev-1' }
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path.startsWith('/books/reader-book/chapters')) return { data: [] } as never
      if (path.startsWith('/books/reader-book')) return { data: revisionBook } as never
      if (path.startsWith('/progress/')) return { data: null } as never
      return { data: [] } as never
    })
    useSettingsSyncStore.setState({ userId: 'reader', ready: true, failed: false })
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const latest = {
      formatVersion: 1, bookId: 'reader-book', revisionId: 'rev-2', contentHash: 'source-hash',
      size: 100, entryCount: 1,
      entries: [{ path: 'OPS/ch1.xhtml', size: 20, compressedSize: 10, compression: 'deflate', mediaType: 'application/xhtml+xml' }],
      spine: [{ path: 'OPS/ch1.xhtml', mediaType: 'application/xhtml+xml', linear: true }],
      startupFiles: [], opfPath: 'OPS/content.opf', navPath: null, ncxPath: null, generated: false,
    }
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).includes('/reader/manifest')
      ? new Response(JSON.stringify({ data: latest }), { status: 200 })
      : new Response('<html><body><p>new revision</p></body></html>', { status: 200, headers: { 'Content-Type': 'application/xhtml+xml' } })))

    render(<QueryClientProvider client={client}><Reader /></QueryClientProvider>)
    await waitFor(() => expect(lastRendererOptions().url).toContain('revisionId=rev-1'))
    await act(async () => { lastRendererOptions().onRendered?.(lastRendererOptions().url) })
    await act(async () => { lastRendererOptions().onRevisionChanged?.({ revisionId: 'rev-1' }) })
    await act(async () => {
      lastRendererOptions().onRevisionNavigation?.({
        target: 'OPS/ch1.xhtml', sectionHref: 'OPS/ch1.xhtml', chapterNavigation: true,
        previousRevisionId: 'rev-1', previousContentHash: 'source-hash',
      })
    })
    await waitFor(() => expect(lastRendererOptions().url).toContain('revisionId=rev-2'))
    expect(screen.queryByTestId('reader-loading-surface')).not.toBeInTheDocument()
    await act(async () => { lastRendererOptions().onError?.(new Error('renderer initialization failed')) })
    await waitFor(() => expect(lastRendererOptions().url).toContain('revisionId=rev-1'))
    await act(async () => { lastRendererOptions().onRendered?.(lastRendererOptions().url) })
    expect(lastRendererOptions().url).toContain('revisionId=rev-1')
    expect(apiPut.mock.calls.some(([path]) => String(path).includes('/progress/'))).toBe(false)
  })

  it('loads a generated TXT chapter selected from the refreshed TOC under that revision', async () => {
    const revisionBook = { ...book, revisionId: 'rev-1' }
    vi.mocked(apiGet).mockImplementation(async (path) => {
      if (path.startsWith('/books/reader-book/chapters')) return { data: [] } as never
      if (path.startsWith('/books/reader-book')) return { data: revisionBook } as never
      if (path.startsWith('/progress/')) return { data: null } as never
      return { data: [] } as never
    })
    useSettingsSyncStore.setState({ userId: 'reader', ready: true, failed: false })
    vi.spyOn(idbChapterTextStore, 'get').mockResolvedValue(undefined)
    const latest = {
      formatVersion: 1, bookId: 'reader-book', revisionId: 'rev-2', contentHash: 'latest-hash',
      size: 100, entryCount: 2,
      entries: [
        { path: 'nav.xhtml', size: 80, compressedSize: 40, compression: 'deflate', mediaType: 'application/xhtml+xml' },
        { path: 'chapter-0002.xhtml', size: 20, compressedSize: 10, compression: 'deflate', mediaType: 'application/xhtml+xml' },
        { path: 'chapter-0003.xhtml', size: 20, compressedSize: 10, compression: 'deflate', mediaType: 'application/xhtml+xml' },
      ],
      spine: [
        { path: 'chapter-0002.xhtml', mediaType: 'application/xhtml+xml', linear: true },
        { path: 'chapter-0003.xhtml', mediaType: 'application/xhtml+xml', linear: true },
      ],
      startupFiles: [{ path: 'nav.xhtml', text: '<nav epub:type="toc"><ol><li><a href="chapter-0002.xhtml">Latest chapter</a></li></ol></nav>' }],
      opfPath: 'content.opf', navPath: 'nav.xhtml', ncxPath: null, generated: true,
    }
    const requests: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      return url.includes('/reader/manifest')
        ? new Response(JSON.stringify({ data: latest }), { status: 200 })
        : new Response(`<html><body>explicit latest chapter ${url}</body></html>`, { status: 200, headers: { 'Content-Type': 'application/xhtml+xml' } })
    }))
    readerRenderer.current = new Proxy({
      isFixedLayout: false,
      on: () => () => {},
      display: vi.fn(async () => {}),
      getMediaOverlayCues: vi.fn(async () => []),
    }, { get: (target, key) => Reflect.get(target, key) ?? vi.fn() })

    render(<QueryClientProvider client={client}><Reader /></QueryClientProvider>)
    await waitFor(() => expect(lastRendererOptions().url).toContain('revisionId=rev-1'))
    await act(async () => { lastRendererOptions().onRendered?.(lastRendererOptions().url) })
    await act(async () => {
      lastRendererOptions().onRevisionChanged?.({ revisionId: 'rev-1' })
      lastRendererOptions().onRevisionNavigation?.({
        target: 'chapter-0002.xhtml', sectionHref: 'chapter-0002.xhtml', chapterNavigation: true,
        previousRevisionId: 'rev-1', previousContentHash: 'old-hash',
      })
    })
    await waitFor(() => expect(requests.filter((url) => url.includes('/reader/manifest'))).toHaveLength(1))
    expect(lastRendererOptions().url).toContain('revisionId=rev-1')

    const mountGeneration = lastRendererOptions().mountGeneration
    await act(async () => { useReaderState.getState().setPendingTocHref('chapter-0002.xhtml') })
    await waitFor(() => expect(requests.filter((url) => url.includes('/reader/manifest'))).toHaveLength(2))
    await waitFor(() => expect(lastRendererOptions().url).toContain('revisionId=rev-2'))
    expect(lastRendererOptions().mountGeneration).toBeGreaterThan(mountGeneration ?? 0)
    expect(lastRendererOptions().onReady?.()).toBe('chapter-0002.xhtml')
    expect(requests.some((url) => url.includes('revisionId=rev-2') && url.includes('chapter-0002.xhtml'))).toBe(true)

    const firstCandidateGeneration = lastRendererOptions().mountGeneration
    await act(async () => { useReaderState.getState().setPendingTocHref('chapter-0003.xhtml') })
    await waitFor(() => expect(requests.filter((url) => url.includes('/reader/manifest'))).toHaveLength(3))
    expect(lastRendererOptions().mountGeneration).toBeGreaterThan(firstCandidateGeneration ?? 0)
    expect(lastRendererOptions().onReady?.()).toBe('chapter-0003.xhtml')
  })
})


