import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import i18n from '../i18n/i18n'
import UserManagementSection from '../features/settings/components/UserManagementSection'
import { useAdminUsers, useTransferInstanceOwnership, useUpdateUser } from '@/features/auth/hooks'
import { useAuthStore } from '@/stores/auth.store'
import type { AdminUserRes } from '@bookdock/shared'

vi.mock('@/features/auth/hooks', () => ({
  useAdminUsers: vi.fn(),
  useUpdateUser: vi.fn(),
  useTransferInstanceOwnership: vi.fn(),
}))

const USERS: AdminUserRes[] = [
  { id: 'u1', username: 'alice', role: 'owner', disabled: false, createdAt: 1700000000000, bookCount: 12 },
  { id: 'u2', username: 'bob', role: 'member', disabled: true, createdAt: 1700000000000, bookCount: 3 },
  { id: 'u3', username: 'carol', role: 'member', disabled: false, createdAt: 1700000000000, bookCount: 1 },
]

describe('UserManagementSection', () => {
  const mutate = vi.fn()
  const transfer = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    useAuthStore.getState().setAuth({ id: 'u1', username: 'alice', role: 'owner' })
    ;(useAdminUsers as ReturnType<typeof vi.fn>).mockReturnValue({ data: { data: USERS }, isLoading: false })
    ;(useUpdateUser as ReturnType<typeof vi.fn>).mockReturnValue({ mutate })
    ;(useTransferInstanceOwnership as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: transfer })
  })

  it('renders the user table with roles and status', () => {
    render(<UserManagementSection />)
    expect(screen.getByText('用户管理')).toBeInTheDocument()
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()
    expect(screen.getByText('所有者')).toBeInTheDocument()
    expect(screen.getAllByText('成员')).toHaveLength(2)
    expect(screen.getByText('已禁用')).toBeInTheDocument()
    expect(screen.getAllByText('正常')).toHaveLength(2)
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

  it('transfers instance ownership instead of patching roles', () => {
    render(<UserManagementSection />)
    // The menu is portaled to the body, so query the document, not the row.
    fireEvent.click(within(screen.getByText('carol').closest('tr')!).getByLabelText('更多操作'))
    fireEvent.click(screen.getByText('转让所有者'))

    // Ownership moves through its own action, never a PATCH with a role.
    expect(transfer).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '转让所有者' }))
    expect(transfer).toHaveBeenCalledWith('u3', expect.objectContaining({ onSuccess: expect.any(Function) }))
    expect(mutate).not.toHaveBeenCalled()
  })

  it('offers no transfer for disabled accounts or the current owner', () => {
    render(<UserManagementSection />)
    fireEvent.click(within(screen.getByText('bob').closest('tr')!).getByLabelText('更多操作'))
    expect(screen.queryByText('转让所有者')).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })

    fireEvent.click(within(screen.getByText('alice').closest('tr')!).getByLabelText('更多操作'))
    expect(screen.queryByText('转让所有者')).not.toBeInTheDocument()
  })
})
