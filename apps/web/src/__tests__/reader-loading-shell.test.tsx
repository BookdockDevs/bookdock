import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet } from '@/api/client'
import Reader from '@/features/reader/Reader'
import { useReaderState } from '@/features/reader/state/reader-state'
import { useAuthStore } from '@/stores/auth.store'
import { useSettingsSyncStore } from '@/stores/settings-sync.store'
import { useUiStore } from '@/stores/ui.store'

const sidebarPropsSpy = vi.hoisted(() => vi.fn())
const headerPropsSpy = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'book-b' }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: ReactNode; to?: string }) => <a href={to ?? '/'}>{children}</a>,
}))

vi.mock('@/api/client', () => ({
  ApiError: class extends Error {},
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
vi.mock('@/features/reader/hooks/useBookChapters', () => ({ useBookChapters: () => ({ data: undefined, isLoading: true }) }))
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
    expect(screen.queryByTestId('reader-sidebar')).toBeNull()
  })
})
