import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import i18n from '../i18n/i18n'
import LibraryManageDialog from '../features/library/components/LibraryManageDialog'
import type { Library, LibraryMembersRes } from '@bookdock/shared'

const HOOKS = vi.hoisted(() => ({
  useLibraryMembers: vi.fn(),
  useUpdateLibrary: vi.fn(),
  useAddLibraryMember: vi.fn(),
  useSetLibraryMemberRole: vi.fn(),
  useRemoveLibraryMember: vi.fn(),
  useTransferLibrary: vi.fn(),
  useDeleteLibrary: vi.fn(),
}))
vi.mock('../features/library/hooks', () => HOOKS)
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }))

const LIBRARY: Library = {
  id: 'lib_city', userId: 'u1', type: 'shared', name: 'City', description: 'All the books',
  visibility: 'public', createdAt: 1, updatedAt: 1,
  // The wire field is ownerUserId; keep the fixture honest.
  ...{ ownerUserId: 'u1' },
} as Library

const MEMBERS: LibraryMembersRes = {
  owner: { id: 'u1', username: 'alice' },
  members: [
    { id: 'lbm1', userId: 'u2', username: 'bob', role: 'admin', createdAt: 1, updatedAt: 1 },
    { id: 'lbm2', userId: 'u3', username: 'carol', role: 'member', createdAt: 1, updatedAt: 1 },
  ],
}

describe('LibraryManageDialog', () => {
  const onClose = vi.fn()
  const onDeleted = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    HOOKS.useLibraryMembers.mockReturnValue({ data: { data: MEMBERS } })
    for (const key of ['useUpdateLibrary', 'useAddLibraryMember', 'useSetLibraryMemberRole', 'useRemoveLibraryMember', 'useTransferLibrary', 'useDeleteLibrary'] as const) {
      HOOKS[key].mockReturnValue({ mutate: vi.fn(), isPending: false })
    }
  })

  function renderDialog(canManage = true, isOwner = true) {
    render(
      <LibraryManageDialog
        library={LIBRARY}
        canManage={canManage}
        isOwner={isOwner}
        onClose={onClose}
        onDeleted={onDeleted}
      />,
    )
  }

  it('shows the roster with names and the owner outside the member list', () => {
    renderDialog()
    expect(screen.getByText('alice')).toBeInTheDocument()
    // Members also appear in the transfer picker, so assert on the roster rows.
    expect(screen.getAllByText('bob').length).toBeGreaterThan(0)
    expect(screen.getAllByText('carol').length).toBeGreaterThan(0)
    expect(screen.getByText('所有者')).toBeInTheDocument()
  })

  it('saves settings only after a change', () => {
    renderDialog()
    const save = () => screen.getByRole('button', { name: '保存' })
    expect(save()).toBeDisabled()

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Renamed' } })
    expect(save()).not.toBeDisabled()
    fireEvent.click(save())
    expect(HOOKS.useUpdateLibrary().mutate).toHaveBeenCalledWith(
      { libraryId: 'lib_city', patch: { name: 'Renamed', description: 'All the books', visibility: 'public' } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('sends a new access password only when one was typed', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('radio', { name: '密码' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    // Empty means "keep the current password", so it is sent as null.
    expect(HOOKS.useUpdateLibrary().mutate).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ visibility: 'password', accessPassword: null }) }),
      expect.any(Object),
    )
  })

  it('adds a member by username and clears the field', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('用户名'), { target: { value: 'dave' } })
    fireEvent.change(screen.getByLabelText('新成员角色'), { target: { value: 'admin' } })
    fireEvent.click(screen.getByRole('button', { name: '添加' }))
    const mutate = HOOKS.useAddLibraryMember().mutate
    expect(mutate).toHaveBeenCalledWith(
      { libraryId: 'lib_city', username: 'dave', role: 'admin' },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
    act(() => mutate.mock.calls[0]![1].onSuccess())
    expect(screen.getByLabelText('用户名')).toHaveValue('')
  })

  it('confirms before removing a member, and the wording says what survives', () => {
    renderDialog()
    const carolRow = screen.getAllByText('carol')[0]!.closest('div')!
    fireEvent.click(within(carolRow).getByLabelText('移除'))
    // The prompt states the consequence instead of just "are you sure".
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/自己的书库和阅读数据不受影响/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '移除' }))
    expect(HOOKS.useRemoveLibraryMember().mutate).toHaveBeenCalledWith(
      { libraryId: 'lib_city', userId: 'u3' },
      expect.any(Object),
    )
  })

  it('states that deleting a library leaves collected copies unreadable', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '删除书库' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/保留自己的书卡，但无法再阅读/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '删除书库' }))
    expect(HOOKS.useDeleteLibrary().mutate).toHaveBeenCalledWith({ libraryId: 'lib_city' }, expect.any(Object))
  })

  it('offers ownership transfer only to the owner, from existing members', () => {
    renderDialog()
    const transfer = screen.getByRole('button', { name: '转让所有者' })
    expect(transfer).toBeDisabled()
    fireEvent.change(screen.getByLabelText('转让所有者'), { target: { value: 'u2' } })
    expect(transfer).not.toBeDisabled()
    fireEvent.click(transfer)
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '转让所有者' }))
    expect(HOOKS.useTransferLibrary().mutate).toHaveBeenCalledWith(
      { libraryId: 'lib_city', userId: 'u2' },
      expect.any(Object),
    )
  })

  it('hides owner actions from a plain member', () => {
    renderDialog(false, false)
    expect(screen.getByText('只有书库所有者可以转让或删除这个书库。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除书库' })).not.toBeInTheDocument()
    expect(screen.queryByText('成员')).not.toBeInTheDocument()
  })

  it('lets an admin add members but never hand out admin seats', () => {
    renderDialog(true, false)
    // The role picker offers member only; admins cannot create admins.
    const options = within(screen.getByLabelText('新成员角色')).getAllByRole('option')
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(['member'])
    // Removing a fellow admin is owner-only; removing a member is allowed.
    const bobRow = screen.getAllByText('bob')[0]!.closest('div')!
    expect(within(bobRow).getByLabelText('移除')).toBeDisabled()
    const carolRow = screen.getAllByText('carol')[0]!.closest('div')!
    expect(within(carolRow).getByLabelText('移除')).not.toBeDisabled()
  })

  it('lets the owner hand out admin seats and remove anyone', () => {
    renderDialog(true, true)
    const options = within(screen.getByLabelText('新成员角色')).getAllByRole('option')
    expect(options.map((o) => (o as HTMLOptionElement).value)).toEqual(['member', 'admin'])
    const bobRow = screen.getAllByText('bob')[0]!.closest('div')!
    expect(within(bobRow).getByLabelText('移除')).not.toBeDisabled()
  })
})
