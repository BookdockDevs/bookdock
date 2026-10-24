import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { cleanup, fireEvent, render as baseRender, screen, waitFor, within } from '@testing-library/react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LibrarySearch } from '@/routes/index'
import type { ArchiveSearch } from '@/routes/archive'
import Archive from '@/features/archive/Archive'
import { archiveEntryState } from '@/features/archive/archive-return'
import { localDateString } from '@/api/hooks/reading-records'
import { resolveArchiveScope } from '@/features/archive/archive-scope'
import { archiveScrollKey, saveArchiveScrollRecord } from '@/features/archive/archive-scroll'
import { useAuthStore } from '@/stores/auth.store'
import i18n from '@/i18n/i18n'

vi.mock('@/features/archive/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/archive/hooks')>()
  return {
    ...actual,
    useArchiveOverview: () => ({
      data: { data: { counts: { highlights: 1, bookmarks: 0, ideas: 0, reviews: 0, total: 1 }, totalBooks: 1 } },
      isLoading: false,
      isError: false,
    }),
    useArchiveBooksInfinite: () => ({
      data: { pages: [{ data: { entries: [], page: 1, hasMore: false } }] },
      isPending: false,
      isError: false,
      error: null,
      isFetching: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    }),
  }
})

vi.mock('@/api/hooks/reading-records', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/reading-records')>()
  return {
    ...actual,
    useReadingSummary: () => ({ data: undefined, isLoading: false, isError: false }),
  }
})

vi.mock('@/features/stats/components/StatsSettingsButton', () => ({ default: () => null }))

// The overview embeds the full stats suite; its data components are out of
// scope for the exit flow (the type cards above them stay real).
vi.mock('@/features/stats/components/BookTimeList', () => ({ default: () => null }))
vi.mock('@/features/stats/components/HourDistribution', () => ({ default: () => null }))
vi.mock('@/features/stats/components/PeriodBarChart', () => ({ default: () => null }))
vi.mock('@/features/stats/components/SummaryCards', () => ({ default: () => null, DeltaDisplay: () => null }))
vi.mock('@/features/stats/components/TagDistribution', () => ({ default: () => null }))
vi.mock('@/features/stats/components/YearHeatmap', () => ({ default: () => null }))

const ENTRY_SEARCH: LibrarySearch = { q: 'entry', page: 2 }
const ENTRY_SCROLL = 321
const SNAPSHOT_SEARCH: LibrarySearch = { page: 1 }
const SNAPSHOT_SCROLL = 720

function buildRouter(history: ReturnType<typeof createMemoryHistory>) {
  const root = createRootRoute()
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    validateSearch: (search: Record<string, unknown>) => search as LibrarySearch,
    component: () => null,
  })
  const profile = createRoute({
    getParentRoute: () => root,
    path: 'profile',
    component: () => null,
  })
  const archive = createRoute({
    getParentRoute: () => root,
    path: 'archive',
    validateSearch: (search: Record<string, unknown>) => search as ArchiveSearch,
    component: Archive,
  })
  return createRouter({ routeTree: root.addChildren([index, profile, archive]), history })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Archive top-bar exit (real component)', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    useAuthStore.setState({
      user: { id: 'u1', username: 'reader', role: 'member', avatarKey: null, createdAt: 1 },
    })
  })

  it('keeps the entry source across real in-archive moves and exits to it with the search session', async () => {
    const history = createMemoryHistory({ initialEntries: ['/'] })
    const router = buildRouter(history)
    await router.load()

    // Sidebar entry from search results, carrying the search session
    // snapshot (mirrors LibrarySidebar + searchSessionNavigation).
    await act(async () => {
      await router.navigate({
        to: '/archive',
        state: (previous) => ({
          ...previous,
          ...archiveEntryState(ENTRY_SEARCH, ENTRY_SCROLL, previous.archiveReturn),
          librarySearchReturn: { search: SNAPSHOT_SEARCH, scrollTop: SNAPSHOT_SCROLL, back: true },
        }),
      })
    })
    render(<RouterProvider router={router} />)
    expect(await screen.findByText('阅读档案')).toBeInTheDocument()

    // Real in-archive move 1: overview type card (SPA Link).
    fireEvent.click(screen.getByRole('button', { name: /划线/ }))
    await waitFor(() => expect(router.state.location.search).toMatchObject({ type: 'highlight' }))

    // Real in-archive move 2: sidebar search box (Archive.patch).
    fireEvent.change(screen.getByLabelText('搜索书名'), { target: { value: 'night' } })
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'night' }))

    // Neither move may overwrite the recorded exit source or the snapshot.
    expect(router.state.location.state.archiveReturn).toEqual({ search: ENTRY_SEARCH, scrollTop: ENTRY_SCROLL })
    expect(router.state.location.state.librarySearchReturn).toMatchObject({
      search: SNAPSHOT_SEARCH,
      scrollTop: SNAPSHOT_SCROLL,
      back: true,
    })

    // Scroll both archive containers (jsdom has no layout, so pin the
    // values the handlers read): the save path must capture nonzeros.
    const main = document.querySelector('main')!
    const left = document.querySelector('aside')!.parentElement!
    Object.defineProperty(main, 'scrollTop', { value: 400, configurable: true })
    Object.defineProperty(left, 'scrollTop', { value: 250, configurable: true })
    fireEvent.scroll(main)
    fireEvent.scroll(left)

    // Real top-bar exit click.
    const header = screen.getByText('阅读档案').closest('header')!
    fireEvent.click(within(header).getByLabelText('返回'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(router.state.location.search).toMatchObject({ q: 'entry', page: 2 })
    expect(router.state.location.state.archiveReturn).toBeUndefined()
    // Snapshot preserved with back downgraded: the archive pushes broke its
    // one-step-back assumption, so clearing the search takes the explicit
    // restore path with the original scroll position.
    expect(router.state.location.state.librarySearchReturn).toMatchObject({
      search: SNAPSHOT_SEARCH,
      scrollTop: SNAPSHOT_SCROLL,
      back: false,
    })
    // The library restores the requested scroll once its own list renders;
    // nothing scrolls blindly at exit time.
    expect(router.state.location.state.archiveExitScroll).toBe(ENTRY_SCROLL)

    // Leaving writes the save-side record for a later same-view return.
    const saved = JSON.parse(sessionStorage.getItem('bd-archive-scroll')!)
    expect(saved.key).toContain('night')
    expect(saved.positions).toMatchObject({ left: 250, main: 400, win: expect.any(Number) })
  })

  it('traverses back to the original profile entry without duplicating it', async () => {
    const history = createMemoryHistory({ initialEntries: ['/', '/profile'] })
    const router = buildRouter(history)
    await router.load()

    await act(async () => {
      await router.navigate({
        to: '/archive',
        search: { view: 'overview' },
        state: () => ({
          archiveReturn: { to: '/profile', scrollTop: 0, sourceHistoryIndex: 1 },
        }),
      })
    })
    render(<RouterProvider router={router} />)
    expect(await screen.findByText('阅读档案')).toBeInTheDocument()

    fireEvent.click(within(screen.getByText('阅读档案').closest('header')!).getByLabelText('返回'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/profile'))
    expect(router.state.location.state.__TSR_index).toBe(1)

    await act(async () => {
      router.history.back()
    })
    expect(router.state.location.pathname).toBe('/')
  })

  it('restores a saved same-view position when the archive remounts', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const history = createMemoryHistory({ initialEntries: ['/'] })
    const router = buildRouter(history)
    await router.load()

    // Same-view return (e.g. reader back): the entry was recorded on leave.
    const { period, anchor, query } = resolveArchiveScope({})
    saveArchiveScrollRecord(archiveScrollKey({ period, anchor: localDateString(anchor), timezone: query.timezone }), { left: 0, main: 0, win: 150 })
    await act(async () => {
      await router.navigate({ to: '/archive' })
    })
    render(<RouterProvider router={router} />)
    expect(await screen.findByText('阅读档案')).toBeInTheDocument()

    // The record is consumed once and the window position re-applied.
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 150 }))
    expect(sessionStorage.getItem('bd-archive-scroll')).toBeNull()
  })

  it('replaces internal book selection and exits directly to the origin without stepping backwards through books', async () => {
    const history = createMemoryHistory({ initialEntries: ['/'] })
    const router = buildRouter(history)
    await router.load()

    await act(async () => {
      await router.navigate({
        to: '/archive',
        state: (previous) => ({
          ...previous,
          ...archiveEntryState(ENTRY_SEARCH, ENTRY_SCROLL, previous.archiveReturn),
        }),
      })
    })
    render(<RouterProvider router={router} />)
    expect(await screen.findByText('阅读档案')).toBeInTheDocument()
    const archiveIndex = router.state.location.state.__TSR_index

    // Selecting Book A via sidebar search (patch)
    fireEvent.change(screen.getByLabelText('搜索书名'), { target: { value: 'Book A' } })
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'Book A' }))
    expect(router.state.location.state.__TSR_index).toBe(archiveIndex)

    // Selecting Book B via sidebar search (patch)
    fireEvent.change(screen.getByLabelText('搜索书名'), { target: { value: 'Book B' } })
    await waitFor(() => expect(router.state.location.search).toMatchObject({ q: 'Book B' }))
    expect(router.state.location.state.__TSR_index).toBe(archiveIndex)

    // Exit click must return directly to '/' without stopping at Book A
    const header = screen.getByText('阅读档案').closest('header')!
    fireEvent.click(within(header).getByLabelText('返回'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(router.state.location.search).toMatchObject({ q: 'entry', page: 2 })
  })
})

function render(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return baseRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
