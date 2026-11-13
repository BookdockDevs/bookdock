import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookDetailRes } from '@bookdock/shared'

import { apiGet, apiPut } from '@/api/client'
import Reader from '@/features/reader/Reader'
import { useAuthStore } from '@/stores/auth.store'
import { useSettingsSyncStore } from '@/stores/settings-sync.store'

const { rendererRef } = vi.hoisted(() => ({ rendererRef: { current: null } }))
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'reader-book' }),
  useNavigate: () => vi.fn(),
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

/** The footer capsule row only slides up while the chrome is revealed. */
function footerRevealed() {
  const control = document.querySelector('[data-reader-corner-control]')
  expect(control).not.toBeNull()
  return control!.className.includes('-translate-y-12')
}

describe('reader chrome hot zone', () => {
  it('ignores moves over the selection bubble but still summons from the strip', async () => {
    render(<QueryClientProvider client={client}><Reader /></QueryClientProvider>)
    await waitFor(() => expect(client.getQueryData(['book', 'reader-book'])).toEqual({ data: book }))

    const canvas = document.querySelector('[data-reader-canvas]') as HTMLElement
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800, x: 0, y: 0, toJSON: () => ({}),
    }) as DOMRect

    // The selection bubble is clamped to the viewport edge, so it spans
    // [bottom-52, bottom-8] — 40px of it sit inside the 48px summon band.
    // Moves over it are parent-document moves, where the iframe selection is
    // invisible, so the band geometry must stay inert instead of revealing the
    // footer the same pointer position does not reveal over the iframe.
    const bubble = document.createElement('div')
    bubble.setAttribute('data-reader-selection-toolbar', '')
    document.body.appendChild(bubble)
    try {
      fireEvent.pointerMove(bubble, { clientX: 600, clientY: 770, buttons: 0 })
      expect(footerRevealed()).toBe(false)

      // Control: the very same point without the bubble under the pointer.
      fireEvent.pointerMove(document.body, { clientX: 600, clientY: 770, buttons: 0 })
      await waitFor(() => expect(footerRevealed()).toBe(true))
    } finally {
      bubble.remove()
    }
  })
})
