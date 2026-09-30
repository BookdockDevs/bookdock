import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import i18n from '../i18n/i18n'
import LibraryManageDialog from '../features/library/components/LibraryManageDialog'
import type { Library } from '@bookdock/shared'

const HOOKS = vi.hoisted(() => ({
  useUpdateLibrary: vi.fn(),
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

  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    HOOKS.useUpdateLibrary.mockReturnValue({ mutate: vi.fn(), isPending: false })
  })

  function renderDialog(isOwner = true) {
    render(
      <LibraryManageDialog
        library={LIBRARY}
        isOwner={isOwner}
        onClose={onClose}
      />,
    )
  }

  it('renders library settings for owner without member section or delete button', () => {
    renderDialog()
    expect(screen.getByLabelText('名称')).toHaveValue('City')
    expect(screen.queryByRole('button', { name: '删除书库' })).not.toBeInTheDocument()
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
      { libraryId: 'lib_city', patch: { name: 'Renamed', description: 'All the books', visibility: 'public', trashEnabled: true, trashAutoCleanDays: 30, trashMaxBytes: 0 } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('requires a 4+ char password when visibility is password', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('radio', { name: '密码' }))
    // Empty password cannot be saved
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

    // Too short password cannot be saved
    fireEvent.change(screen.getByLabelText('访问密码'), { target: { value: '123' } })
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

    // 4+ chars password enables save and sends the password
    fireEvent.change(screen.getByLabelText('访问密码'), { target: { value: 'pass123' } })
    expect(screen.getByRole('button', { name: '保存' })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(HOOKS.useUpdateLibrary().mutate).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ visibility: 'password', accessPassword: 'pass123' }) }),
      expect.any(Object),
    )
  })

  it('shows admins a read-only notice instead of the settings form', () => {
    renderDialog(false)
    expect(screen.queryByLabelText('名称')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
    expect(screen.getByText('书库设置仅所有者可修改')).toBeInTheDocument()
  })
})
