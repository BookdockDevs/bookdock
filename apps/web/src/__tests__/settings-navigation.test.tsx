import { act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryHistory, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import Settings from '@/features/settings/Settings'
import { useBackNavigation } from '@/hooks/useBackNavigation'
import i18n from '@/i18n/i18n'
import { rootRoute } from '@/routes/__root'
import { settingsRoute } from '@/routes/settings'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/routes/__root', async () => {
  const { createRootRoute } = await import('@tanstack/react-router')
  return { rootRoute: createRootRoute() }
})

vi.mock('@/features/auth/hooks', () => ({
  useInstanceInfo: () => ({ data: { data: {} } }),
  useAdminUsers: () => ({ data: { data: [
    { id: 'owner', username: 'Alice', role: 'owner', disabled: false, bookCount: 0, createdAt: 1, ownedLibraries: [] },
    { id: 'reader', username: 'Bob', role: 'member', disabled: false, bookCount: 0, createdAt: 1, ownedLibraries: [] },
  ] } }),
  useUpdateUser: () => ({}),
  useCreateUser: () => ({}),
  useDeleteUser: () => ({}),
  useTransferInstanceOwnership: () => ({}),
}))

vi.mock('@/features/library/hooks', () => ({
  useLibraries: () => ({ data: { data: [
    { id: 'first', name: 'First Library', type: 'shared', relation: 'owner' },
    { id: 'second', name: 'Second Library', type: 'shared', relation: 'owner' },
  ] } }),
  useLibraryMembers: () => ({ data: { data: {
    owner: { id: 'owner', username: 'Alice' },
    members: [{ id: 'membership', userId: 'reader', username: 'Bob', role: 'member', createdAt: 1 }],
  } } }),
  useRemoveLibraryMember: () => ({}),
  useSetLibraryMemberRole: () => ({}),
  useTransferLibrary: () => ({}),
}))

vi.mock('@/features/settings/components/InstanceSettingsSection', () => ({ default: () => null }))
vi.mock('@/features/settings/components/StorageBackendSection', () => ({ default: () => null }))
vi.mock('@/features/settings/components/LibraryManagementSection', () => ({ default: () => null }))
vi.mock('@/features/settings/components/LanguageSwitcher', () => ({ default: () => null }))
vi.mock('@/features/settings/components/LibraryPreferenceRows', () => ({ default: () => null }))
vi.mock('@/features/settings/components/TrashSettingsRow', () => ({ default: () => null }))
vi.mock('@/features/settings/components/TitleSettingsRow', () => ({ default: () => null }))
vi.mock('@/features/settings/components/UploadSettingsSection', () => ({ default: () => null }))
vi.mock('@/features/settings/components/FontsSettingsSection', () => ({ default: () => null }))
vi.mock('@/features/settings/components/ReplacementsSettingsSection', () => ({ default: () => null }))
vi.mock('@/features/settings/components/TocRulesSettingsSection', () => ({ default: () => null }))
vi.mock('@/features/settings/components/TtsSettingsSection', () => ({ default: () => <div>Reading settings</div> }))
vi.mock('@/features/settings/components/AiSettingsSection', () => ({ default: () => null }))
vi.mock('@/features/settings/components/LegadoSettingsSection', () => ({ default: () => null }))
vi.mock('@/features/settings/components/StorageConnectionsSection', () => ({ default: () => null }))
vi.mock('@/features/settings/components/AccessTokensSection', () => ({ default: () => null }))
vi.mock('@/features/settings/components/AboutSettingsSection', () => ({ default: () => null }))

function ProfileBack() {
  const onBack = useBackNavigation('/')
  return <button onClick={onBack}>Return from profile</button>
}

function buildRouter(history: ReturnType<typeof createMemoryHistory>) {
  const home = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <div>Home</div> })
  const profile = createRoute({ getParentRoute: () => rootRoute, path: '/profile', component: ProfileBack })
  settingsRoute.update({ component: Settings })
  return createRouter({ routeTree: rootRoute.addChildren([home, settingsRoute, profile]), history })
}

const visibilityStyles = document.createElement('style')
visibilityStyles.textContent = '.hidden { display: none; }'
beforeAll(() => { document.head.append(visibilityStyles) })
afterAll(() => { visibilityStyles.remove() })

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  useAuthStore.getState().setAuth({ id: 'owner', username: 'Alice', role: 'owner' })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('settings URL navigation', () => {
  it.each(['instance', 'library'] as const)('restores the %s user context after profile return and refresh', async (tab) => {
    const history = createMemoryHistory({ initialEntries: ['/'] })
    const router = buildRouter(history)
    await router.load()
    const view = render(<RouterProvider router={router} />)
    await act(async () => {
      await router.navigate({ to: '/settings', state: (prev) => ({ ...prev, settingsTestMarker: 'kept' }) })
    })
    const settingsIndex = history.location.state.__TSR_index
    fireEvent.click(await screen.findByRole('button', { name: '管理' }))
    await waitFor(() => expect(router.state.location.search).toMatchObject({ section: 'admin' }))
    fireEvent.click(await screen.findByRole('button', { name: tab === 'library' ? '书库成员' : '实例用户' }))
    await waitFor(() => expect(router.state.location.search).toMatchObject({ userTab: tab }))
    if (tab === 'library') {
      fireEvent.click(screen.getByRole('button', { name: '选择书库' }))
      fireEvent.click(screen.getByRole('button', { name: 'Second Library' }))
      await waitFor(() => expect(router.state.location.search).toMatchObject({ libraryId: 'second' }))
    }
    const expectedSearch = router.state.location.search
    expect(history.location.state.__TSR_index).toBe(settingsIndex)
    expect(router.state.location.state).toMatchObject({ settingsTestMarker: 'kept' })
    fireEvent.click(screen.getByRole('link', { name: 'Bob' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Return from profile' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'))
    expect(router.state.location.search).toEqual(expectedSearch)
    expect(await screen.findByRole('link', { name: 'Bob' })).toBeVisible()
    view.unmount()

    const refreshed = buildRouter(history)
    await refreshed.load()
    render(<RouterProvider router={refreshed} />)
    expect(await screen.findByRole('link', { name: 'Bob' })).toBeVisible()
    if (tab === 'library') expect(screen.getByRole('button', { name: '选择书库' })).toHaveTextContent('Second Library')
    expect(refreshed.state.location.search).toEqual(expectedSearch)
    await act(async () => { history.back() })
    expect(await screen.findByText('Home')).toBeVisible()
  })

  it('clears the focus target when changing sections and respects a bare settings URL', async () => {
    const history = createMemoryHistory({ initialEntries: ['/settings?section=reading&focus=tts'] })
    const router = buildRouter(history)
    await router.load()
    render(<RouterProvider router={router} />)
    expect(await screen.findByText('Reading settings')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '通用' }))
    await waitFor(() => expect(router.state.location.search).toMatchObject({ section: 'general' }))
    expect(router.state.location.search).not.toHaveProperty('focus')
    await waitFor(() => expect(screen.getByText('Reading settings')).not.toBeVisible())
    await act(async () => { await router.navigate({ to: '/settings', search: { section: 'reading' } }) })
    await waitFor(() => expect(screen.getByText('Reading settings')).toBeVisible())
    await act(async () => { await router.navigate({ to: '/settings', search: {} }) })
    await waitFor(() => expect(screen.getByText('Reading settings')).not.toBeVisible())
  })
})
