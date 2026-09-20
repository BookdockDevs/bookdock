import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { RootComponent } from '../routes/RootComponent'
import { apiGet } from '@/api/client'
import { INSTANCE_QUERY_KEY, ME_QUERY_KEY } from '@/features/auth/hooks'
import { useAuthStore } from '@/stores/auth.store'
import type { InstanceInfoRes } from '@bookdock/shared'

const navigateMock = vi.fn()
let currentPath = '/'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => ({ pathname: currentPath }),
  Outlet: () => <div data-testid="outlet" />,
}))

vi.mock('@/api/client', () => ({
  apiGet: vi.fn(),
  UNAUTHORIZED_EVENT: 'bd:unauthorized',
}))

function mockApi({ instance, me }: { instance: InstanceInfoRes; me?: { id: string; username: string; role: string } }) {
  ;(apiGet as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    if (path === '/auth/instance') return Promise.resolve({ data: instance })
    if (path === '/auth/me') {
      return me ? Promise.resolve({ data: me }) : Promise.reject(new Error('unauthorized'))
    }
    return Promise.reject(new Error(`unexpected ${path}`))
  })
}

function renderRoot(queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={queryClient}>
      <RootComponent />
    </QueryClientProvider>,
  )
}

const INITIALIZED: InstanceInfoRes = { initialized: true, allowRegistration: false, allowGuestAccess: false, uploadMaxBytes: 104857600 }

describe('RootComponent guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentPath = '/'
    useAuthStore.getState().clearAuth()
  })

  it('redirects to /setup when the instance is not initialized', async () => {
    mockApi({ instance: { ...INITIALIZED, initialized: false } })
    renderRoot()
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: '/setup' })
    })
  })

  it('redirects to /setup when not initialized even if guest access is on', async () => {
    mockApi({ instance: { ...INITIALIZED, initialized: false, allowGuestAccess: true } })
    renderRoot()
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: '/setup' })
    })
  })

  it('stores guest-flagged sessions and passes through', async () => {
    const me = { id: 'u1', username: 'admin', role: 'owner', guest: true }
    mockApi({ instance: { ...INITIALIZED, allowGuestAccess: true }, me })
    renderRoot()
    await waitFor(() => {
      expect(screen.getByTestId('outlet')).toBeInTheDocument()
    })
    expect(useAuthStore.getState().user).toEqual(me)
    expect(navigateMock).not.toHaveBeenCalledWith({ to: '/login' })
  })

  it('redirects to /login when there is no session and guest access is off', async () => {
    mockApi({ instance: INITIALIZED })
    renderRoot()
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: '/login' })
    })
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument()
  })

  it('passes through as guest when guest access is on and there is no session', async () => {
    mockApi({ instance: { ...INITIALIZED, allowGuestAccess: true } })
    renderRoot()
    await waitFor(() => {
      expect(screen.getByTestId('outlet')).toBeInTheDocument()
    })
    expect(navigateMock).not.toHaveBeenCalledWith({ to: '/login' })
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('stores the session user and renders when /auth/me succeeds', async () => {
    const me = { id: 'u1', username: 'admin', role: 'owner' }
    mockApi({ instance: INITIALIZED, me })
    renderRoot()
    await waitFor(() => {
      expect(screen.getByTestId('outlet')).toBeInTheDocument()
    })
    expect(useAuthStore.getState().user).toEqual(me)
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('keeps protected content hidden while revalidating a cached session', async () => {
    const me = { id: 'u1', username: 'admin', role: 'owner' }
    let resolveMe: (value: { data: typeof me }) => void = () => undefined
    const mePromise = new Promise<{ data: typeof me }>((resolve) => {
      resolveMe = resolve
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(INSTANCE_QUERY_KEY, { data: INITIALIZED })
    queryClient.setQueryData(ME_QUERY_KEY, { data: me })
    ;(apiGet as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path === '/auth/me') return mePromise
      return Promise.reject(new Error(`unexpected ${path}`))
    })

    renderRoot(queryClient)

    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/auth/me'))
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument()

    resolveMe({ data: me })
    await waitFor(() => {
      expect(screen.getByTestId('outlet')).toBeInTheDocument()
    })
  })

  it('redirects an already authenticated client away from the login page', async () => {
    currentPath = '/login'
    const me = { id: 'u1', username: 'admin', role: 'owner' }
    mockApi({ instance: INITIALIZED, me })
    renderRoot()

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: '/', replace: true })
    })
    expect(useAuthStore.getState().user).toEqual(me)
  })

  it('redirects /register to /login when registration is closed', async () => {
    currentPath = '/register'
    mockApi({ instance: INITIALIZED })
    renderRoot()
    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: '/login' })
    })
  })

  it('shows a retryable error when instance information cannot be loaded', async () => {
    ;(apiGet as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('server unavailable'))
    renderRoot()

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('auth.instanceLoadFailed')
    })
    expect(screen.getByRole('button', { name: 'auth.retry' })).toBeInTheDocument()
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument()
  })
})
