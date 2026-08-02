import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import i18n from '../i18n/i18n'
import UserManagementSection from '../features/settings/components/UserManagementSection'
import { useAdminUsers, useUpdateUser } from '@/features/auth/hooks'
import { useAuthStore } from '@/stores/auth.store'
import type { AdminUserRes } from '@bookdock/shared'

vi.mock('@/features/auth/hooks', () => ({
  useAdminUsers: vi.fn(),
  useUpdateUser: vi.fn(),
}))

const USERS: AdminUserRes[] = [
  { id: 'u1', username: 'alice', role: 'owner', disabled: false, createdAt: 1700000000000, bookCount: 12 },
  { id: 'u2', username: 'bob', role: 'member', disabled: true, createdAt: 1700000000000, bookCount: 3 },
]

describe('UserManagementSection', () => {
  const mutate = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    useAuthStore.getState().setAuth({ id: 'u1', username: 'alice', role: 'owner' })
    ;(useAdminUsers as ReturnType<typeof vi.fn>).mockReturnValue({ data: { data: USERS }, isLoading: false })
    ;(useUpdateUser as ReturnType<typeof vi.fn>).mockReturnValue({ mutate })
  })

  it('renders the user table with roles and status', () => {
    render(<UserManagementSection />)
    expect(screen.getByText('用户管理')).toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getByText('所有者')).toBeInTheDocument()
    expect(screen.getByText('成员')).toBeInTheDocument()
    expect(screen.getByText('已禁用')).toBeInTheDocument()
    expect(screen.getByText('正常')).toBeInTheDocument()
  })

  it('confirms before disabling a user', () => {
    render(<UserManagementSection />)
    const bobRow = screen.getByText('bob').closest('tr')!
    fireEvent.click(within(bobRow).getByLabelText('更多操作'))
    fireEvent.click(screen.getByText('启用'))

    // enable requires confirmation first
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('确定'))
    expect(mutate).toHaveBeenCalledWith(
      { id: 'u2', disabled: false },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  })

  it('confirms before changing a role', () => {
    render(<UserManagementSection />)
    const bobRow = screen.getByText('bob').closest('tr')!
    fireEvent.click(within(bobRow).getByLabelText('更多操作'))
    fireEvent.click(screen.getByText('设为所有者'))
    fireEvent.click(screen.getByText('确定'))
    expect(mutate).toHaveBeenCalledWith(
      { id: 'u2', role: 'owner' },
      expect.objectContaining({ onError: expect.any(Function) }),
    )
  })
})
