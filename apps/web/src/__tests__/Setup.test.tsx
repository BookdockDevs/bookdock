import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { apiPost } from '@/api/client'
import Setup from '../features/auth/Setup'
import { useAuthStore } from '@/stores/auth.store'

const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}))

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return {
    ...actual,
    apiPost: vi.fn(),
  }
})

describe('Setup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.getState().clearAuth()
  })

  it('renders brand header, password hint, and provisions the owner account', async () => {
    vi.mocked(apiPost).mockResolvedValue({
      data: { user: { id: 'u-owner', username: 'owner', role: 'owner', avatarKey: null } },
    })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <QueryClientProvider client={queryClient}>
        <Setup />
      </QueryClientProvider>,
    )

    expect(screen.getByText('auth.welcome')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'owner' } })
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'auth.completeSetup' }))

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/auth/setup', { username: 'owner', password: 'password123' })
    })
    expect(navigateMock).toHaveBeenCalledWith({ to: '/' })
  })
})
