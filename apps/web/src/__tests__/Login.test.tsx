import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Login from '../features/auth/Login'
import { apiPost } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@/api/client', () => ({ apiPost: vi.fn() }))

describe('Login', () => {
  beforeEach(() => {
    useAuthStore.getState().clearAuth()
    vi.clearAllMocks()
  })

  it('submits credentials and stores auth on success', async () => {
    ;(apiPost as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { token: 'token-123', user: { id: 'u1', username: 'admin', role: 'owner' } },
    })

    render(<Login />)
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret' } })
    fireEvent.click(screen.getByText('登录'))

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/auth/login', { username: 'admin', password: 'secret' })
    })
    expect(useAuthStore.getState().token).toBe('token-123')
    expect(useAuthStore.getState().user).toEqual({ id: 'u1', username: 'admin', role: 'owner' })
  })

  it('shows error on failure', async () => {
    ;(apiPost as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('unauthorized'))
    render(<Login />)
    fireEvent.click(screen.getByText('登录'))
    await waitFor(() => {
      expect(screen.getByText('登录失败，请检查用户名和密码')).toBeInTheDocument()
    })
  })
})
