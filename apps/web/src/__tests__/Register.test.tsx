import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ApiError } from '@/api/client'
import { PENDING_INVITE_KEY } from '@/features/library/invite-link'
import Register from '../features/auth/Register'
import { useInstanceInfo, useRegister } from '@/features/auth/hooks'

const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}))

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}))

vi.mock('@/features/auth/hooks', () => ({
  useRegister: vi.fn(),
  useInstanceInfo: vi.fn(),
}))

function setupMocks(opts: {
  registrationMode?: 'closed' | 'invite' | 'open'
  mutateAsync?: ReturnType<typeof vi.fn>
} = {}) {
  const mode = opts.registrationMode ?? 'open'
  ;(useRegister as ReturnType<typeof vi.fn>).mockReturnValue({
    mutateAsync: opts.mutateAsync ?? vi.fn().mockResolvedValue({ data: { user: { id: 'u1', username: 'alice', role: 'member', avatarKey: null } } }),
    isPending: false,
  })
  ;(useInstanceInfo as ReturnType<typeof vi.fn>).mockReturnValue({
    data: {
      data: {
        initialized: true,
        registrationMode: mode,
        allowRegistration: mode === 'open',
        allowGuestAccess: false,
      },
    },
  })
}

describe('Register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    window.history.replaceState({}, '', '/register')
  })

  it('requires an invite code in invite mode and prevents submitting empty code', () => {
    const mutateAsync = vi.fn()
    setupMocks({ registrationMode: 'invite', mutateAsync })
    render(<Register />)

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'auth.register' }))

    expect(screen.getByText('auth.errors.inviteCodeRequired')).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('renders invite code directly below confirmPassword in open mode without requiring a click', () => {
    setupMocks({ registrationMode: 'open' })
    render(<Register />)

    expect(screen.getByLabelText('auth.inviteCode')).toHaveAttribute('placeholder', 'auth.inviteCodePlaceholderOptional')
  })

  it('pre-fills Chinese invite codes from URL without eager preview and redirects to first joined library on submit', async () => {
    window.history.replaceState({}, '', `/register?invite=${encodeURIComponent('书香门第')}`)
    const mutateAsync = vi.fn().mockResolvedValue({
      data: {
        user: { id: 'u1', username: 'alice', role: 'member', avatarKey: null },
        joinedLibraries: [
          { id: 'lib-1', name: '科幻共读' },
          { id: 'lib-2', name: '悬疑推理' },
        ],
      },
    })
    setupMocks({
      registrationMode: 'invite',
      mutateAsync,
    })

    render(<Register />)

    expect(screen.getByLabelText('auth.inviteCode')).toHaveValue('书香门第')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'auth.register' }))

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({
        username: 'alice',
        password: 'password123',
        inviteCode: '书香门第',
      })
    })
    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { libraryId: 'lib-1' } })
  })

  it('preserves PENDING_INVITE_KEY redirect priority over auto-joined libraries', async () => {
    sessionStorage.setItem(PENDING_INVITE_KEY, '0123456789ABCDEF')
    window.history.replaceState({}, '', '/register?invite=ABC123')
    const mutateAsync = vi.fn().mockResolvedValue({
      data: {
        user: { id: 'u1', username: 'alice', role: 'member', avatarKey: null },
        joinedLibraries: [{ id: 'lib-1', name: '科幻共读' }],
      },
    })
    setupMocks({ registrationMode: 'invite', mutateAsync })

    render(<Register />)
    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'auth.register' }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: '/library/$token', params: { token: '+0123456789ABCDEF' } })
    })
  })

  it('reports invalid invite code on submit using login-style form alert without input error border', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new ApiError('INVITE_CODE_INVALID', 'Invalid invite code'))
    setupMocks({ registrationMode: 'invite', mutateAsync })

    render(<Register />)
    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('auth.inviteCode'), { target: { value: 'BAD123' } })
    fireEvent.click(screen.getByRole('button', { name: 'auth.register' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('auth.errors.inviteCodeInvalid')
    })
    expect(screen.getByLabelText('auth.inviteCode')).toHaveAttribute('aria-invalid', 'false')

    // Editing invite input clears the form error alert
    fireEvent.change(screen.getByLabelText('auth.inviteCode'), { target: { value: 'NEWCODE' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('navigates home without joinedLibraries when bound libraries were deleted before redemption', async () => {
    window.history.replaceState({}, '', '/register?invite=DEL123')
    const mutateAsync = vi.fn().mockResolvedValue({
      data: {
        user: { id: 'u1', username: 'alice', role: 'member', avatarKey: null },
      },
    })
    setupMocks({
      registrationMode: 'invite',
      mutateAsync,
    })

    render(<Register />)

    fireEvent.change(screen.getByLabelText('auth.username'), { target: { value: 'alice' } })
    fireEvent.change(screen.getByLabelText('auth.password'), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText('auth.confirmPassword'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'auth.register' }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith({ to: '/' })
    })
  })
})
