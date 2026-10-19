import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookDetailRes } from '@bookdock/shared'

import { apiGet, apiPut } from '@/api/client'
import Reader from '@/features/reader/Reader'
import { useReaderRenderer } from '@/features/reader/hooks/useReaderRenderer'
import { useAuthStore } from '@/stores/auth.store'
import { useSettingsSyncStore } from '@/stores/settings-sync.store'

const { navigate, rendererRef } = vi.hoisted(() => ({ navigate: vi.fn(), rendererRef: { current: null } }))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'reader-book' }),
  useNavigate: () => navigate,
  Link: () => null,
}))
vi.mock('@/api/client', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/client')>(), apiGet: vi.fn(), apiPut: vi.fn() }))
vi.mock('@/features/reader/hooks/useReaderRenderer', () => ({ useReaderRenderer: vi.fn(() => ({ containerRef: rendererRef, renderer: null, fontStack: '', fontCss: '' })) }))
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

    await act(async () => { lastRendererOptions().onRendered?.() })
    expect(screen.queryByTestId('reader-loading-surface')).not.toBeInTheDocument()

    // Content replacements and Chinese conversion tear the view down and
    // build it again: the empty reading area must be covered meanwhile.
    await act(async () => { lastRendererOptions().onViewRebuilding?.(true) })
    expect(screen.getByTestId('reader-loading-surface')).toBeInTheDocument()

    await act(async () => { lastRendererOptions().onViewRebuilding?.(false) })
    expect(screen.queryByTestId('reader-loading-surface')).not.toBeInTheDocument()
  })
})


