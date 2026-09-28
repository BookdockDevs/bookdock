import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import i18n from '../i18n/i18n'
import UserManagementSection from '../features/settings/components/UserManagementSection'
import { useAdminUsers, useTransferInstanceOwnership, useUpdateUser } from '@/features/auth/hooks'
import {
  useLibraries,
  useLibraryMembers,
  useRemoveLibraryMember,
  useSetLibraryMemberRole,
  useTransferLibrary,
} from '@/features/library/hooks'
import { useAuthStore } from '@/stores/auth.store'
import type { AdminUserRes, LibraryListItem, LibraryMembersRes } from '@bookdock/shared'

vi.mock('@/features/auth/hooks', () => ({
  useAdminUsers: vi.fn(),
  useUpdateUser: vi.fn(),
  useTransferInstanceOwnership: vi.fn(),
}))

vi.mock('@/features/library/hooks', () => ({
  useLibraries: vi.fn(),
  useLibraryMembers: vi.fn(),
  useSetLibraryMemberRole: vi.fn(),
  useRemoveLibraryMember: vi.fn(),
  useTransferLibrary: vi.fn(),
}))

const USERS: AdminUserRes[] = [
  { id: 'u1', username: 'alice', role: 'owner', disabled: false, createdAt: 1700000000000, bookCount: 12 },
  { id: 'u2', username: 'bob', role: 'member', disabled: true, createdAt: 1700000000000, bookCount: 3 },
  { id: 'u3', username: 'carol', role: 'member', disabled: false, createdAt: 1700000000000, bookCount: 1 },
]

const LIBRARIES: LibraryListItem[] = [
  {
    id: 'lib_shared_1',
    type: 'shared',
    name: 'City Library',
    description: 'Shared city books',
    visibility: 'public',
    relation: 'owner',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  },
]

const MEMBERS: LibraryMembersRes = {
  owner: { id: 'u1', username: 'alice' },
  members: [
    { id: 'm1', userId: 'u2', username: 'bob', role: 'admin', createdAt: 1700000000000, updatedAt: 1700000000000 },
    { id: 'm2', userId: 'u3', username: 'carol', role: 'member', createdAt: 1700000000000, updatedAt: 1700000000000 },
  ],
}

describe('UserManagementSection', () => {
  const mutateUser = vi.fn()
  const transferInstance = vi.fn()
  const setMemberRole = vi.fn()
  const removeMember = vi.fn()
  const transferLibrary = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    useAuthStore.getState().setAuth({ id: 'u1', username: 'alice', role: 'owner' })
    ;(useAdminUsers as ReturnType<typeof vi.fn>).mockReturnValue({ data: { data: USERS }, isLoading: false })
    ;(useUpdateUser as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: mutateUser })
    ;(useTransferInstanceOwnership as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: transferInstance })

    ;(useLibraries as ReturnType<typeof vi.fn>).mockReturnValue({ data: { data: LIBRARIES }, isLoading: false })
    ;(useLibraryMembers as ReturnType<typeof vi.fn>).mockReturnValue({ data: { data: MEMBERS }, isLoading: false })
    ;(useSetLibraryMemberRole as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: setMemberRole })
    ;(useRemoveLibraryMember as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: removeMember })
    ;(useTransferLibrary as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: transferLibrary })
  })

  describe('Instance Users Tab', () => {
    it('renders the user table with roles and status', () => {
      render(<UserManagementSection />)
      expect(screen.getByText('用户管理')).toBeInTheDocument()
      expect(screen.getByText('实例用户')).toBeInTheDocument()
      expect(screen.getByText('书库成员')).toBeInTheDocument()
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
      expect(mutateUser).not.toHaveBeenCalled()
      fireEvent.click(screen.getByText('确定'))
      expect(mutateUser).toHaveBeenCalledWith(
        { id: 'u2', disabled: false },
        expect.objectContaining({ onError: expect.any(Function) }),
      )
    })

    it('transfers instance ownership instead of patching roles', () => {
      render(<UserManagementSection />)
      fireEvent.click(within(screen.getByText('carol').closest('tr')!).getByLabelText('更多操作'))
      fireEvent.click(screen.getByText('转让所有者'))

      expect(transferInstance).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: '转让所有者' }))
      expect(transferInstance).toHaveBeenCalledWith('u3', expect.objectContaining({ onSuccess: expect.any(Function) }))
      expect(mutateUser).not.toHaveBeenCalled()
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

  describe('Library Members Tab', () => {
    it('switches to library members tab and displays library selector and members', () => {
      render(<UserManagementSection />)
      fireEvent.click(screen.getByText('书库成员'))

      expect(screen.getByLabelText('选择书库')).toBeInTheDocument()
      expect(screen.getByText('City Library')).toBeInTheDocument()
      expect(screen.queryByText('公开')).not.toBeInTheDocument()
      expect(screen.getAllByText('alice').length).toBeGreaterThanOrEqual(1)
      const aliceRow = screen.getAllByText('alice').find((el) => el.closest('tr'))!.closest('tr')!
      expect(within(aliceRow).getByText('2023/11/15')).toBeInTheDocument()
      expect(screen.getByText('bob')).toBeInTheDocument()
      expect(screen.getByText('carol')).toBeInTheDocument()
    })

    it('changes library member role from the action menu', () => {
      render(<UserManagementSection initialTab="library" />)
      const bobRow = screen.getByText('bob').closest('tr')!
      fireEvent.click(within(bobRow).getByLabelText('更多操作'))
      expect(screen.getByRole('button', { name: '设为普通成员' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '设为普通成员' }))

      expect(setMemberRole).toHaveBeenCalledWith(
        { libraryId: 'lib_shared_1', userId: 'u2', role: 'member' },
        expect.any(Object),
      )
    })

    it('transfers library ownership from the member action menu', () => {
      render(<UserManagementSection initialTab="library" />)
      const carolRow = screen.getByText('carol').closest('tr')!
      fireEvent.click(within(carolRow).getByLabelText('更多操作'))
      fireEvent.click(screen.getByRole('button', { name: '转让所有者' }))

      const dialog = screen.getByRole('alertdialog')
      expect(within(dialog).getByText(/把所有者转让给该成员/)).toBeInTheDocument()
      fireEvent.click(within(dialog).getByRole('button', { name: '转让所有者' }))

      expect(transferLibrary).toHaveBeenCalledWith(
        { libraryId: 'lib_shared_1', userId: 'u3' },
        expect.any(Object),
      )
    })

    it('confirms and removes a member from the library', () => {
      render(<UserManagementSection initialTab="library" />)
      const carolRow = screen.getByText('carol').closest('tr')!
      fireEvent.click(within(carolRow).getByLabelText('更多操作'))
      fireEvent.click(screen.getByRole('button', { name: '移出书库' }))

      const dialog = screen.getByRole('alertdialog')
      expect(within(dialog).getByText(/自己的书库和阅读数据不受影响/)).toBeInTheDocument()
      fireEvent.click(within(dialog).getByRole('button', { name: '移出书库' }))

      expect(removeMember).toHaveBeenCalledWith(
        { libraryId: 'lib_shared_1', userId: 'u3' },
        expect.any(Object),
      )
    })

    it('does not show noOtherMembers prompt when only owner is present', () => {
      ;(useLibraryMembers as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { data: { owner: { id: 'u1', username: 'alice' }, members: [] } },
        isLoading: false,
      })
      render(<UserManagementSection initialTab="library" />)
      expect(screen.queryByText('暂无其他成员')).not.toBeInTheDocument()
    })
  })
})
