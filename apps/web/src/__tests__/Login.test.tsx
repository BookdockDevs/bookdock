import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Login from '../features/auth/Login'
import { ApiError } from '@/api/client'
import { useInstanceInfo, useLogin } from '@/features/auth/hooks'

const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

vi.mock('@/features/auth/hooks', () => ({
  useLogin: vi.fn(),
  useInstanceInfo: vi.fn(),
}))

function mockHooks({ mutateAsync, allowRegistration = false }: { mutateAsync: ReturnType<typeof vi.fn>; allowRegistration?: boolean }) {
  ;(useLogin as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync, isPending: false })
  ;(useInstanceInfo as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: { initialized: true, allowRegistration, allowGuestAccess: false } },
  })
}

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('submits credentials and navigates home on success', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockHooks({ mutateAsync })

    render(<Login />)
    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText('auth.signIn'))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ username: 'admin', password: 'secret' })
    })
    expect(navigateMock).toHaveBeenCalledWith({ to: '/' })
  })

  it('maps error codes to messages on failure', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new ApiError('ACCOUNT_DISABLED', 'Account is disabled'))
    mockHooks({ mutateAsync })

    render(<Login />)
    fireEvent.click(screen.getByText('auth.signIn'))

    await waitFor(() => {
      expect(screen.getByText('auth.errors.accountDisabled')).toBeInTheDocument()
    })
  })

  it('shows register link only when registration is open', () => {
    mockHooks({ mutateAsync: vi.fn(), allowRegistration: true })
    render(<Login />)
    expect(screen.getByText('auth.registerAccount')).toBeInTheDocument()
  })

  it('hides register link when registration is closed', () => {
    mockHooks({ mutateAsync: vi.fn(), allowRegistration: false })
    render(<Login />)
    expect(screen.queryByText('auth.registerAccount')).not.toBeInTheDocument()
  })
})
