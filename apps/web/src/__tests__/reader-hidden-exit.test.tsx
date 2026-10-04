import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookDetailRes } from '@bookdock/shared'

import { apiGet, apiPut } from '@/api/client'
import Reader from '@/features/reader/Reader'
import { useReaderRenderer } from '@/features/reader/hooks/useReaderRenderer'
import { toggleRevealHidden } from '@/lib/reveal-hidden'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

const { navigate, rendererRef, timerFlush } = vi.hoisted(() => ({ navigate: vi.fn(), rendererRef: { current: null }, timerFlush: vi.fn() }))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'hidden-book' }),
  useNavigate: () => navigate,
  Link: () => null,
}))
vi.mock('@/api/client', async (importOriginal) => ({ ...await importOriginal<typeof import('@/api/client')>(), apiGet: vi.fn(), apiPut: vi.fn() }))
vi.mock('@/features/reader/hooks/useReaderRenderer', () => ({ useReaderRenderer: vi.fn(() => ({ containerRef: rendererRef, renderer: null, fontStack: '', fontCss: '' })) }))
vi.mock('@/features/reader/hooks/useReadingTimer', () => ({ useReadingTimer: () => ({ flush: timerFlush, ping: vi.fn() }) }))
vi.mock('@/features/reader/components/ReaderSidebar', () => ({ ReaderSidebar: () => null }))
vi.mock('@/features/reader/components/ReaderHeader', () => ({ ReaderHeader: () => null }))

const book: BookDetailRes = {
  id: 'hidden-book', title: 'Hidden book', author: '', authors: [], format: 'txt', coverKey: null,
  size: 100, readStatus: 'reading', progress: 0, createdAt: 1, updatedAt: 1, shelfId: null,
  hidden: true, effectiveHidden: true, hiddenReason: 'direct', collected: true,
  filePath: 'fixture.txt', meta: {}, readerSettings: { viewSettings: null, boundPresetId: null },
}
let client: QueryClient
let currentBook: BookDetailRes

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAuthStore.getState().clearAuth()
  useAuthStore.getState().setAuth({ id: 'reader', username: 'Reader', role: 'member' })
  useUiStore.getState().setRevealHidden(true)
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  currentBook = { ...book }
  vi.mocked(apiGet).mockImplementation(async (path) => {
    if (path.startsWith('/books/hidden-book/chapters')) return { data: [] } as never
    if (path.startsWith('/books/hidden-book')) return { data: currentBook } as never
    if (path.startsWith('/progress/')) return { data: null } as never
    return { data: [] } as never
  })
  vi.mocked(apiPut).mockResolvedValue({ data: null })
})

afterEach(() => {
  client.clear()
  useAuthStore.getState().clearAuth()
})

async function mountAndRelocate() {
  const view = render(<QueryClientProvider client={client}><Reader /></QueryClientProvider>)
  await waitFor(() => expect(client.getQueryData(['book', 'hidden-book'])).toEqual({ data: currentBook }))
  await act(async () => {
    const options = vi.mocked(useReaderRenderer).mock.calls.at(-1)![0]
    options.onRendered?.()
    options.onRelocated?.({ cfi: 'txt:50', percent: 50, fraction: 0.5, chapterIndex: 0, chapter: 'Chapter' })
  })
  return view
}

describe('hidden private reader exit', () => {
  it.each(['direct', 'category', 'tag'] as const)('saves progress before leaving a reader hidden by %s', async (reason) => {
    currentBook = { ...book, hidden: reason === 'direct', hiddenReason: reason }
    await mountAndRelocate()
    let finish!: (value: { data: null }) => void
    vi.mocked(apiPut).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }) as never)
    let closing!: Promise<void>
    await act(async () => { closing = toggleRevealHidden() })
    await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/progress/hidden-book?showHidden=1', expect.objectContaining({ cfi: 'txt:50', percent: 50 })))
    expect(navigate).not.toHaveBeenCalled()
    expect(useUiStore.getState().revealHidden).toBe(true)
    await act(async () => { finish({ data: null }); await closing })
    expect(navigate).toHaveBeenCalledWith({ to: '/' })
    expect(timerFlush).toHaveBeenCalled()
    expect(useUiStore.getState().revealHidden).toBe(false)
  })

  it('keeps buffered progress after a failed close and saves it on retry', async () => {
    await mountAndRelocate()
    vi.mocked(apiPut).mockRejectedValueOnce(new Error('offline'))
    await act(async () => { await expect(toggleRevealHidden()).rejects.toThrow('offline') })
    expect(navigate).not.toHaveBeenCalled()
    expect(useUiStore.getState().revealHidden).toBe(true)
    await act(async () => { await toggleRevealHidden() })
    expect(apiPut).toHaveBeenCalledTimes(2)
    expect(navigate).toHaveBeenCalledWith({ to: '/' })
    expect(useUiStore.getState().revealHidden).toBe(false)
  })

  it('keeps shared-library hidden reads governed by shared permissions', async () => {
    currentBook = { ...book, collected: false }
    await mountAndRelocate()
    await act(async () => { await toggleRevealHidden() })
    expect(navigate).not.toHaveBeenCalled()
    expect(apiPut).not.toHaveBeenCalled()
    expect(useUiStore.getState().revealHidden).toBe(false)
  })

  it('does not navigate or restore cached progress after the account expires during saving', async () => {
    await mountAndRelocate()
    let finish!: (value: { data: null }) => void
    vi.mocked(apiPut).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }) as never)
    let closing!: Promise<void>
    await act(async () => { closing = toggleRevealHidden() })
    await waitFor(() => expect(apiPut).toHaveBeenCalled())
    await act(async () => { useAuthStore.getState().clearAuth(); client.clear() })
    await act(async () => { finish({ data: null }); await closing })
    expect(navigate).not.toHaveBeenCalled()
    expect(useUiStore.getState().revealHidden).toBe(false)
    expect(localStorage.getItem('bd-reveal-hidden:reader')).toBe('true')
    expect(client.getQueryData(['progress', 'hidden-book', 'user'])).toBeUndefined()
  })
})
