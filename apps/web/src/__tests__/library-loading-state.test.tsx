import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReadingRecordSummaryRes, SettingsRes } from '@bookdock/shared'

import * as apiClient from '@/api/client'
import { useReadingSummary } from '@/api/hooks/reading-records'
import { useLibraryPrefsState } from '@/features/library/hooks'
import LibraryHeader from '@/features/library/components/LibraryHeader'
import ReadingStatsCard from '@/features/library/components/ReadingStatsCard'
import { clearStoredSettings, writeStoredSettings } from '@/lib/settings-cache'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}))

vi.mock('@/api/client', () => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  BASE_URL: 'http://localhost:3000',
}))

vi.mock('@/api/hooks/reading-records', () => ({
  useReadingSummary: vi.fn(() => ({ data: undefined, isLoading: false })),
}))

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, unknown>) => {
    if (options && typeof options === 'object') {
      return `${key} ${JSON.stringify(options)}`
    }
    return key
  },
}))

vi.mock('@/features/library/components/LibrarySearchInput', () => ({
  default: () => <div data-testid="search-input" />,
}))

vi.mock('@/features/library/components/ViewMenu', () => ({
  default: () => <div data-testid="view-menu" />,
}))

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
      },
    },
  })
}

function wrapperWithClient(client: QueryClient) {
  return function TestWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('library settings readiness and loading state', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    useAuthStore.setState({ user: null })
  })

  afterEach(() => {
    localStorage.clear()
    clearStoredSettings()
    useAuthStore.setState({ user: null })
  })

  it('reports isReady: true with undefined prefs for guests without querying server', () => {
    const client = createTestQueryClient()
    const { result } = renderHook(() => useLibraryPrefsState(), {
      wrapper: wrapperWithClient(client),
    })

    expect(result.current.isReady).toBe(true)
    expect(result.current.prefs).toBeUndefined()
    expect(result.current.isLoading).toBe(false)
    expect(apiClient.apiGet).not.toHaveBeenCalled()
  })

  it('keeps isReady: false when signed in without cache while settings request is pending', async () => {
    useAuthStore.setState({ user: { id: 'user-alice', username: 'alice', role: 'member' } })
    let resolveSettings: (val: { data: SettingsRes }) => void = () => {}
    const settingsPromise = new Promise<{ data: SettingsRes }>((resolve) => {
      resolveSettings = resolve
    })
    vi.mocked(apiClient.apiGet).mockReturnValue(settingsPromise)

    const client = createTestQueryClient()
    const { result } = renderHook(() => useLibraryPrefsState(), {
      wrapper: wrapperWithClient(client),
    })

    // Initially loading without cache: not ready!
    expect(result.current.isReady).toBe(false)
    expect(result.current.prefs).toBeUndefined()
    expect(result.current.isLoading).toBe(true)

    // When settings respond:
    resolveSettings({
      data: {
        library: { readingStatsEnabled: false, view: 'list' },
      },
    })

    await waitFor(() => {
      expect(result.current.isReady).toBe(true)
      expect(result.current.prefs?.readingStatsEnabled).toBe(false)
      expect(result.current.prefs?.view).toBe('list')
    })
  })

  it('immediately returns isReady: true when matching cache exists for current user', () => {
    useAuthStore.setState({ user: { id: 'user-alice', username: 'alice', role: 'member' } })
    writeStoredSettings({ library: { readingStatsEnabled: false } }, 'user-alice')

    const client = createTestQueryClient()
    // Seed queryClient as done on app startup
    client.setQueryData(['settings'], {
      data: { library: { readingStatsEnabled: false } },
    })

    const { result } = renderHook(() => useLibraryPrefsState(), {
      wrapper: wrapperWithClient(client),
    })

    expect(result.current.isReady).toBe(true)
    expect(result.current.prefs?.readingStatsEnabled).toBe(false)
  })

  it('retains known layout and isReady: true if background refresh fails after cache hit', async () => {
    useAuthStore.setState({ user: { id: 'user-alice', username: 'alice', role: 'member' } })
    writeStoredSettings({ library: { readingStatsEnabled: true, view: 'grid' } }, 'user-alice')

    const client = createTestQueryClient()
    client.setQueryData(['settings'], {
      data: { library: { readingStatsEnabled: true, view: 'grid' } },
    })
    vi.mocked(apiClient.apiGet).mockRejectedValueOnce(new Error('Network error'))

    const { result } = renderHook(() => useLibraryPrefsState(), {
      wrapper: wrapperWithClient(client),
    })

    expect(result.current.isReady).toBe(true)
    expect(result.current.prefs?.readingStatsEnabled).toBe(true)

    // Trigger refetch that fails
    await result.current.refetch().catch(() => {})

    // Should retain known settings from cache
    expect(result.current.isReady).toBe(true)
    expect(result.current.prefs?.readingStatsEnabled).toBe(true)
  })

  it('distinguishes unknown total from true 0 in LibraryHeader', () => {
    // 1. Initial loading: count is unknown (undefined)
    const { rerender } = render(
      <LibraryHeader
        navSearch={vi.fn()}
        view="grid"
        query=""
        sortBy="createdAt"
        sortOrder="desc"
        format={null}
        readStatus={null}
        title="所有书籍"
        bookCount={undefined}
      />,
    )

    // When count is undefined, "library.bookCount" should NOT be rendered
    expect(screen.queryByText(/library\.bookCount/)).toBeNull()

    // 2. Query finished with 0 books: true zero
    rerender(
      <LibraryHeader
        navSearch={vi.fn()}
        view="grid"
        query=""
        sortBy="createdAt"
        sortOrder="desc"
        format={null}
        readStatus={null}
        title="所有书籍"
        bookCount={0}
      />,
    )

    // When count is 0, "library.bookCount" with count 0 should be displayed
    expect(screen.getByText(/library\.bookCount/)).toHaveTextContent('"count":0')
  })

  it('does not leak Alice cached settings to Bob upon switching accounts', () => {
    // Alice has cached settings
    writeStoredSettings({ library: { readingStatsEnabled: false, view: 'list' } }, 'user-alice')

    // Bob logs in
    useAuthStore.setState({ user: { id: 'user-bob', username: 'bob', role: 'member' } })
    const client = createTestQueryClient()

    const { result } = renderHook(() => useLibraryPrefsState(), {
      wrapper: wrapperWithClient(client),
    })

    // Bob has no cache: must NOT use Alice's cache!
    expect(result.current.isReady).toBe(false)
    expect(result.current.prefs).toBeUndefined()
  })

  it('adopts product default enabled for readingStats when server response omits the field', async () => {
    useAuthStore.setState({ user: { id: 'user-alice', username: 'alice', role: 'member' } })
    vi.mocked(apiClient.apiGet).mockResolvedValueOnce({
      data: {
        library: {}, // readingStatsEnabled omitted
      },
    })

    const client = createTestQueryClient()
    const { result } = renderHook(() => useLibraryPrefsState(), {
      wrapper: wrapperWithClient(client),
    })

    await waitFor(() => expect(result.current.isReady).toBe(true))

    // Product default: readingStatsEnabled !== false
    const readingStatsEnabled = result.current.isReady
      ? result.current.prefs?.readingStatsEnabled !== false
      : false
    expect(readingStatsEnabled).toBe(true)
  })

  it('keeps optional module disabled when settings request fails without cache', async () => {
    useAuthStore.setState({ user: { id: 'user-alice', username: 'alice', role: 'member' } })
    vi.mocked(apiClient.apiGet).mockRejectedValueOnce(new Error('500 Internal Error'))

    const client = createTestQueryClient()
    const { result } = renderHook(() => useLibraryPrefsState(), {
      wrapper: wrapperWithClient(client),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.isReady).toBe(false)
    const readingStatsEnabled = result.current.isReady
      ? result.current.prefs?.readingStatsEnabled !== false
      : false
    expect(readingStatsEnabled).toBe(false)
  })

  it('never mounts ReadingStatsCard when settings are closed on server, even if reading summary returned first', async () => {
    useAuthStore.setState({ user: { id: 'user-alice', username: 'alice', role: 'member' } })
    let resolveSettings: (val: { data: SettingsRes }) => void = () => {}
    const settingsPromise = new Promise<{ data: SettingsRes }>((resolve) => {
      resolveSettings = resolve
    })
    vi.mocked(apiClient.apiGet).mockReturnValue(settingsPromise)

    // Summary query is already ready and has data
    vi.mocked(useReadingSummary).mockReturnValue({
      data: {
        data: {
          todaySeconds: 1200,
          currentStreak: 5,
          totalSeconds: 36000,
        } as unknown as ReadingRecordSummaryRes,
      },
      isLoading: false,
    } as any)

    function TestLibrarySection() {
      const { prefs, isReady } = useLibraryPrefsState()
      const readingStatsEnabled = isReady ? (prefs?.readingStatsEnabled !== false) : false
      return (
        <div>
          {readingStatsEnabled && <ReadingStatsCard />}
          <div data-testid="library-content">Content</div>
        </div>
      )
    }

    const client = createTestQueryClient()
    render(
      <QueryClientProvider client={client}>
        <TestLibrarySection />
      </QueryClientProvider>,
    )

    // Stage 1: Settings is still pending; reading summary has data.
    // The card MUST NOT be mounted!
    expect(screen.queryByText(/stats\.today/)).toBeNull()
    expect(screen.getByTestId('library-content')).toBeInTheDocument()

    // Stage 2: Server returns readingStatsEnabled: false
    resolveSettings({
      data: {
        library: { readingStatsEnabled: false },
      },
    })

    await waitFor(() => {
      // Stage 3: Card still MUST NOT be mounted!
      expect(screen.queryByText(/stats\.today/)).toBeNull()
    })
  })
})
