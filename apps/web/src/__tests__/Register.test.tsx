import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Register from '../features/auth/Register'
import { ApiError } from '@/api/client'
import { useRegister } from '@/features/auth/hooks'

const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

vi.mock('@/features/auth/hooks', () => ({
  useRegister: vi.fn(),
}))

describe('Register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(useRegister as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  })

  function fillForm(username = 'newuser', password = 'secret1', confirm = password) {
    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: username } })
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: password } })
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: confirm } })
  }

  it('registers and navigates home on success', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    ;(useRegister as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync, isPending: false })

    render(<Register />)
    fillForm()
    fireEvent.click(screen.getByText('auth.register'))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ username: 'newuser', password: 'secret1' })
    })
    expect(navigateMock).toHaveBeenCalledWith({ to: '/' })
  })

  it('blocks submit when passwords do not match', async () => {
    const mutateAsync = vi.fn()
    ;(useRegister as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync, isPending: false })

    render(<Register />)
    fillForm('newuser', 'secret1', 'different')
    fireEvent.click(screen.getByText('auth.register'))

    await waitFor(() => {
      expect(screen.getByText('auth.passwordMismatch')).toBeInTheDocument()
    })
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('shows username-taken error from the server', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new ApiError('USERNAME_TAKEN', 'Username is already taken'))
    ;(useRegister as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync, isPending: false })

    render(<Register />)
    fillForm()
    fireEvent.click(screen.getByText('auth.register'))

    await waitFor(() => {
      expect(screen.getByText('auth.errors.usernameTaken')).toBeInTheDocument()
    })
  })
})
