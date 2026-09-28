import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import i18n from '../i18n/i18n'
import LibraryManageDialog from '../features/library/components/LibraryManageDialog'
import type { Library } from '@bookdock/shared'

const HOOKS = vi.hoisted(() => ({
  useUpdateLibrary: vi.fn(),
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

describe('LibraryManageDialog', () => {
  const onClose = vi.fn()
  const onDeleted = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    HOOKS.useUpdateLibrary.mockReturnValue({ mutate: vi.fn(), isPending: false })
    HOOKS.useDeleteLibrary.mockReturnValue({ mutate: vi.fn(), isPending: false })
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

  it('renders library settings and delete button for owner without member section', () => {
    renderDialog()
    expect(screen.getByLabelText('名称')).toHaveValue('City')
    expect(screen.getByRole('button', { name: '删除书库' })).toBeInTheDocument()
    expect(screen.queryByText('成员')).not.toBeInTheDocument()
    expect(screen.queryByText('危险区域')).not.toBeInTheDocument()
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

  it('states that deleting a library leaves collected copies unreadable in confirmation dialog', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '删除书库' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/保留自己的书卡，但无法再阅读/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: '删除书库' }))
    expect(HOOKS.useDeleteLibrary().mutate).toHaveBeenCalledWith({ libraryId: 'lib_city' }, expect.any(Object))
  })

  it('hides delete button when isOwner is false', () => {
    renderDialog(true, false)
    expect(screen.queryByRole('button', { name: '删除书库' })).not.toBeInTheDocument()
  })
})
