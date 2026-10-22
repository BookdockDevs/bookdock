import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'

import type { ReaderProfile } from '@bookdock/shared'

import i18n from '@/i18n/i18n'
import { useAuthStore } from '@/stores/auth.store'

import Profile from './Profile'

const mocks = vi.hoisted(() => ({ apiGet: vi.fn() }))

vi.mock('@/api/client', () => ({
  BASE_URL: '/api/v1',
  apiDelete: vi.fn(),
  apiGet: mocks.apiGet,
  apiPatch: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiUpload: vi.fn(),
}))

function buildRouter() {
  const root = createRootRoute()
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    validateSearch: (search: Record<string, unknown>) => search,
    component: () => null,
  })
  const profile = createRoute({
    getParentRoute: () => root,
    path: '/profile',
    validateSearch: (search: Record<string, unknown>) => search as { userId?: string; activity?: 'all' | 'idea' | 'review' },
    component: Profile,
  })
  const archive = createRoute({
    getParentRoute: () => root,
    path: '/archive',
    validateSearch: (search: Record<string, unknown>) => search,
    component: () => null,
  })
  return createRouter({ routeTree: root.addChildren([index, profile, archive]), history: createBrowserHistory() })
}

describe('Profile activity query integration', () => {
  afterEach(() => {
    cleanup()
    mocks.apiGet.mockReset()
    localStorage.clear()
    window.history.replaceState(null, '', '/')
    useAuthStore.setState({ user: null })
    vi.restoreAllMocks()
  })

  it('renders a complete profile through the real router without updating it during Link rendering', async () => {
    await i18n.changeLanguage('zh-CN')
    const profile: ReaderProfile = {
      author: { id: 'reader-1', name: 'Reader', avatarKey: null, bio: 'Existing biography', createdAt: 1_800_000_000_000 },
      isOwner: true,
      visibility: 'public',
      showStats: true,
      showShowcase: false,
      showPublicActivity: false,
      reviews: { entries: [], page: 1, hasMore: false },
    }
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/reviews/author/reader-1?')) return { data: profile }
      if (path === '/settings') return { data: { profile: { isPublic: true } } }
      if (path.startsWith('/activity?')) return { data: { items: [], nextCursor: null, canManage: false } }
      throw new Error(`Unexpected API request: ${path}`)
    })
    useAuthStore.setState({ user: { id: 'reader-1', username: 'Reader', role: 'owner' } })
    window.history.replaceState({ __TSR_index: 1 }, '', '/profile')
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const router = buildRouter()
    await router.load()

    const view = render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)

    await waitFor(() => expect(screen.getByText(i18n.t('profile.timelineEmpty'))).toBeInTheDocument())
    expect(screen.getByText('Reader')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('profile.readingArchive'))).toBeInTheDocument()
    expect(mocks.apiGet.mock.calls.filter(([path]) => String(path).startsWith('/reviews/author/reader-1?'))).toHaveLength(1)
    expect(mocks.apiGet.mock.calls.filter(([path]) => path === '/settings')).toHaveLength(0)
    expect(mocks.apiGet.mock.calls.filter(([path]) => String(path).startsWith('/activity?'))).toHaveLength(1)
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('Cannot update a component')

    await act(async () => fireEvent.click(screen.getByRole('button', { name: i18n.t('profile.settings') })))
    expect(screen.getByText(i18n.t('profile.settingShowActivity'))).toBeInTheDocument()
    const bioField = screen.getByRole('textbox', { name: i18n.t('profile.bio') })
    expect(bioField).toHaveValue('Existing biography')
    expect(mocks.apiGet.mock.calls.filter(([path]) => path === '/settings')).toHaveLength(1)
    await act(async () => fireEvent.change(bioField, { target: { value: 'Unsaved biography' } }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: i18n.t('library.cancel') })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: i18n.t('profile.settings') })))
    expect(screen.getByRole('textbox', { name: i18n.t('profile.bio') })).toHaveValue('Existing biography')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: i18n.t('library.cancel') })))

    const archiveLink = screen.getByText(i18n.t('profile.readingArchive'))
    await act(async () => fireEvent.click(archiveLink, { ctrlKey: true }))
    expect(router.state.location.pathname).toBe('/profile')
    expect(window.history.state.archiveExitScroll).toBeUndefined()

    await act(async () => fireEvent.click(archiveLink))
    await waitFor(() => expect(router.state.location.pathname).toBe('/archive'))
    expect(router.state.location.state.archiveReturn).toMatchObject({ to: '/profile', scrollTop: 0 })
    expect(window.history.state).toMatchObject({ archiveExitScroll: 0 })
    expect(consoleError.mock.calls.flat().join(' ')).not.toContain('Cannot update a component')

    view.unmount()
    queryClient.clear()
  })

  it.each(['owner', 'visitor'] as const)(
    'replaces activity filters in history for a %s profile so top back returns to its library entry',
    async (viewer) => {
      await i18n.changeLanguage('zh-CN')
      const isOwner = viewer === 'owner'
      const profile: ReaderProfile = {
        author: { id: 'reader-1', name: 'Reader', avatarKey: null, bio: '', createdAt: 1_800_000_000_000 },
        isOwner,
        visibility: 'public',
        showStats: false,
        showShowcase: false,
        showPublicActivity: true,
        reviews: { entries: [], page: 1, hasMore: false },
      }
      mocks.apiGet.mockImplementation(async (path: string) => {
        if (path.startsWith('/reviews/author/reader-1?')) return { data: profile }
        if (path === '/settings') return { data: { profile: { isPublic: true } } }
        if (path.startsWith('/activity?')) return { data: { items: [], nextCursor: null, canManage: false } }
        throw new Error(`Unexpected API request: ${path}`)
      })
      useAuthStore.setState({ user: { id: isOwner ? 'reader-1' : 'visitor-1', username: viewer, role: 'owner' } })
      window.history.replaceState({ __TSR_index: 0 }, '', '/')
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const router = buildRouter()
      await router.load()
      const view = render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)

      await act(async () => {
        await router.navigate({ to: '/profile', search: isOwner ? {} : { userId: 'reader-1' }, state: { profileEntryMarker: 'keep' } })
      })
      await waitFor(() => expect(screen.getByText(i18n.t('profile.timelineEmpty'))).toBeInTheDocument())
      const profileEntryIndex = router.state.location.state.__TSR_index
      expect(router.state.location.pathname).toBe('/profile')

      await act(async () => fireEvent.click(screen.getByRole('tab', { name: i18n.t('activity.ideas') })))
      await waitFor(() => expect(router.state.location.search.activity).toBe('idea'))
      await act(async () => fireEvent.click(screen.getByRole('tab', { name: i18n.t('activity.reviews') })))
      await waitFor(() => expect(router.state.location.search.activity).toBe('review'))
      expect(router.state.location.state.__TSR_index).toBe(profileEntryIndex)
      expect(router.state.location.state.profileEntryMarker).toBe('keep')

      await act(async () => fireEvent.click(screen.getByRole('link', { name: i18n.t('profile.back') })))
      await waitFor(() => expect(router.state.location.pathname).toBe('/'))
      expect(router.state.location.state.__TSR_index).toBe(0)

      view.unmount()
      queryClient.clear()
    },
  )

  it('uses the home fallback when top back is used on a directly opened profile', async () => {
    await i18n.changeLanguage('zh-CN')
    const profile: ReaderProfile = {
      author: { id: 'reader-1', name: 'Reader', avatarKey: null, bio: '', createdAt: 1_800_000_000_000 },
      isOwner: true,
      visibility: 'public',
      showStats: false,
      showShowcase: false,
      showPublicActivity: true,
      reviews: { entries: [], page: 1, hasMore: false },
    }
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path.startsWith('/reviews/author/reader-1?')) return { data: profile }
      if (path === '/settings') return { data: { profile: { isPublic: true } } }
      if (path.startsWith('/activity?')) return { data: { items: [], nextCursor: null, canManage: false } }
      throw new Error(`Unexpected API request: ${path}`)
    })
    useAuthStore.setState({ user: { id: 'reader-1', username: 'Reader', role: 'owner' } })
    window.history.replaceState({ __TSR_index: 0 }, '', '/profile')
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const router = buildRouter()
    await router.load()
    const view = render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>)

    await waitFor(() => expect(screen.getByText(i18n.t('profile.timelineEmpty'))).toBeInTheDocument())
    await act(async () => fireEvent.click(screen.getByRole('tab', { name: i18n.t('activity.ideas') })))
    await waitFor(() => expect(router.state.location.search.activity).toBe('idea'))
    await act(async () => fireEvent.click(screen.getByRole('tab', { name: i18n.t('activity.reviews') })))
    await waitFor(() => expect(router.state.location.search.activity).toBe('review'))
    await act(async () => fireEvent.click(screen.getByRole('link', { name: i18n.t('profile.back') })))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(router.state.location.state.__TSR_index).toBe(0)

    view.unmount()
    queryClient.clear()
  })
})
