import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, apiGet } from '@/api/client'
import Reader from '@/features/reader/Reader'
import { useReaderState } from '@/features/reader/state/reader-state'
import { useAuthStore } from '@/stores/auth.store'
import { useSettingsSyncStore } from '@/stores/settings-sync.store'
import { useToastStore } from '@/stores/toast.store'
import { useUiStore } from '@/stores/ui.store'

const sidebarPropsSpy = vi.hoisted(() => vi.fn())
const headerPropsSpy = vi.hoisted(() => vi.fn())
const chapterQuery = vi.hoisted(() => vi.fn(() => ({ data: undefined, isLoading: true, isError: false, error: null as Error | null })))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'book-b' }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: ReactNode; to?: string }) => <a href={to ?? '/'}>{children}</a>,
}))

vi.mock('@/api/client', () => ({
  ApiError: class extends Error {
    constructor(public code: string, message: string) { super(message) }
  },
  BASE_URL: '/api/v1',
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
  apiPut: vi.fn(),
}))

vi.mock('@/api/hooks/reading-records', () => ({
  usePrefetchBookReadingStats: () => vi.fn(),
  useReadingRound: () => ({ mutate: vi.fn(), isPending: false }),
}))

vi.mock('@/api/hooks/useReplacements', () => ({
  useBookReplacements: () => ({ data: { data: [] }, isPending: false }),
}))

vi.mock('@/api/hooks/useAi', () => ({ useAiConfig: () => ({ data: undefined }) }))
vi.mock('@/api/hooks/useDictionaries', () => ({ useDictionaries: () => ({ data: undefined }) }))
vi.mock('@/api/hooks/useTranslationConfig', () => ({ useTranslationConfig: () => ({ data: undefined }) }))
vi.mock('@/features/reader/hooks/useAnnotations', () => ({
  useAnnotations: () => ({ data: { data: [] } }),
  useCreateAnnotation: () => ({ mutate: vi.fn() }),
  useDeleteAnnotation: () => ({ mutate: vi.fn() }),
}))
vi.mock('@/features/reader/hooks/useIdeas', () => ({ useReaderIdeas: () => ({ data: { data: [] }, isError: false }) }))
vi.mock('@/features/reader/hooks/useBookChapters', () => ({ useBookChapters: chapterQuery }))
vi.mock('@/features/reader/hooks/useReadingTimer', () => ({
  useReadingTimer: () => ({
    flush: vi.fn(),
    trackProgressActivity: vi.fn(),
    reportManualSegment: vi.fn(),
    retryPending: vi.fn(),
    pauseForInactivity: vi.fn(),
    isPausedForInactivity: false,
  }),
}))
vi.mock('@/features/reader/hooks/useManualTimerSource', () => {
  const timerState = {
    storageError: null,
    retry: vi.fn().mockResolvedValue(undefined),
    restore: vi.fn().mockResolvedValue(undefined),
  }
  const store = Object.assign(
    (selector: (state: typeof timerState) => unknown) => selector(timerState),
    { getState: () => timerState },
  )
  return { useManualTimerSource: () => store }
})
vi.mock('@/features/reader/hooks/useIsTouch', () => ({ useIsTouch: () => false }))
vi.mock('@/features/reader/hooks/useReaderRenderer', () => ({
  useReaderRenderer: () => ({ containerRef: vi.fn(), rendererRef: { current: null }, bookReady: false }),
}))
vi.mock('@/features/reader/components/ReaderSidebar', () => ({
  ReaderSidebar: (props: Record<string, unknown>) => {
    sidebarPropsSpy(props)
    const open = useReaderState((s) => s.sidebarOpen)
    const activeTab = useReaderState((s) => s.activeNavTab)
    return <aside data-testid="reader-sidebar" data-open={String(open)} data-tab={activeTab} />
  },
}))
vi.mock('@/features/reader/components/ReaderHeader', () => ({
  ReaderHeader: (props: Record<string, unknown>) => {
    headerPropsSpy(props)
    return <header data-testid="reader-header" data-title={String(props.title ?? '')} />
  },
}))
vi.mock('@/features/reader/components/ProgressStrip', () => ({ ProgressStrip: () => null }))
vi.mock('@/features/reader/components/ReaderFooterControls', () => ({ default: () => null }))
vi.mock('@/features/reader/components/ContentUpdateNotice', () => ({ default: () => null }))
vi.mock('@/features/reader/components/SelectionToolbar', () => ({ SelectionToolbar: () => null }))
vi.mock('@/features/reader/components/ShareCardDialog', () => ({ default: () => null }))
vi.mock('@/features/reader/components/AutoReadingProgressBar', () => ({ default: () => null }))
vi.mock('@/features/reader/components/Ribbon', () => ({ Ribbon: () => null }))

describe('Reader loading shell', () => {
  let client: QueryClient
  const initialUi = useUiStore.getState()

  beforeEach(() => {
    sidebarPropsSpy.mockClear()
    headerPropsSpy.mockClear()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    useAuthStore.setState({ user: { id: 'reader', username: 'reader', role: 'user' } as never })
    useSettingsSyncStore.setState({ userId: 'reader', ready: true, failed: false })
    useUiStore.setState({
      toolbarLocked: true,
      sidebarRememberedOpen: true,
      navTabRemembered: 'toc',
    })
    useReaderState.setState({
      sidebarOpen: false,
      activeNavTab: 'toc',
    })
  })

  afterEach(() => {
    client.clear()
    useUiStore.setState(initialUi)
    vi.restoreAllMocks()
  })

  it('keeps ReaderSidebar mounted and open on first paint while bookQuery is still loading', async () => {
    vi.mocked(apiGet).mockImplementation(() => new Promise(() => {}))

    render(
      <QueryClientProvider client={client}>
        <Reader />
      </QueryClientProvider>,
    )

    const sidebar = screen.getByTestId('reader-sidebar')
    expect(sidebar).toBeInTheDocument()
    expect(sidebar).toHaveAttribute('data-open', 'true')
    expect(sidebar).toHaveAttribute('data-tab', 'toc')
    expect(screen.getByTestId('reader-loading-surface')).toBeInTheDocument()
  })

  it('keeps ReaderSidebar mounted and open on first paint when toolbar is unlocked (floating) and remembered open', async () => {
    vi.mocked(apiGet).mockImplementation(() => new Promise(() => {}))
    act(() => {
      useUiStore.setState({ toolbarLocked: false, sidebarRememberedOpen: true })
    })

    await act(async () => {
      render(
        <QueryClientProvider client={client}>
          <Reader />
        </QueryClientProvider>,
      )
    })

    const sidebar = screen.getByTestId('reader-sidebar')
    expect(sidebar).toBeInTheDocument()
    expect(sidebar).toHaveAttribute('data-open', 'true')
    expect(sidebar).toHaveAttribute('data-tab', 'toc')
  })

  it('persists sidebarRememberedOpen when toggling sidebarOpen even while toolbar is unlocked', async () => {
    vi.mocked(apiGet).mockImplementation(() => new Promise(() => {}))
    act(() => {
      useUiStore.setState({ toolbarLocked: false, sidebarRememberedOpen: true })
    })

    await act(async () => {
      render(
        <QueryClientProvider client={client}>
          <Reader />
        </QueryClientProvider>,
      )
    })

    expect(useUiStore.getState().sidebarRememberedOpen).toBe(true)

    act(() => {
      useReaderState.setState({ sidebarOpen: false })
    })
    expect(useUiStore.getState().sidebarRememberedOpen).toBe(false)

    act(() => {
      useReaderState.setState({ sidebarOpen: true })
    })
    expect(useUiStore.getState().sidebarRememberedOpen).toBe(true)
  })

  it('transitions to the not-found screen when bookQuery settles with empty data', async () => {
    let resolveBook!: (value: { data: null }) => void
    vi.mocked(apiGet).mockImplementation((path) => {
      if (path.startsWith('/books/book-b')) {
        return new Promise((resolve) => {
          resolveBook = resolve as never
        }) as never
      }
      return Promise.resolve({ data: null }) as never
    })

    render(
      <QueryClientProvider client={client}>
        <Reader />
      </QueryClientProvider>,
    )

    expect(screen.getByTestId('reader-sidebar')).toBeInTheDocument()
    await act(async () => {
      resolveBook({ data: null })
    })

    await waitFor(() => {
      expect(screen.getByText('Book not found')).toBeInTheDocument()
    })
    expect(document.title).toBe('Book not found')
    expect(screen.queryByTestId('reader-sidebar')).toBeNull()
  })

  it('shows only the page error when both book and chapter requests fail with 404', async () => {
    useToastStore.getState().clearToasts()
    const error = new ApiError('BOOK_NOT_FOUND', 'Missing book')
    chapterQuery.mockReturnValueOnce({ data: undefined, isLoading: false, isError: true, error })
    vi.mocked(apiGet).mockImplementation((path) => path.startsWith('/books/book-b')
      ? Promise.reject(error)
      : Promise.resolve({ data: null }) as never)
    render(<QueryClientProvider client={client}><Reader /></QueryClientProvider>)
    expect(await screen.findByText(/could not be found|errors.bookNotFound/)).toBeInTheDocument()
    expect(document.title).toBe('Book not found')
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('uses the app name while loading and an error title after a failed request', async () => {
    let failBook!: (error: Error) => void
    vi.mocked(apiGet).mockImplementation((path) => path.startsWith('/books/book-b')
      ? new Promise((_resolve, reject) => { failBook = reject })
      : Promise.resolve({ data: null }) as never)
    render(<QueryClientProvider client={client}><Reader /></QueryClientProvider>)
    expect(document.title).toBe('Bookdock')
    await act(async () => { failBook(new TypeError('Network unavailable')) })
    await waitFor(() => expect(document.title).toBe('Could not open book'))
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})
