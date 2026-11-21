import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
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
    HOOKS.useUpdateLibrary.mockReturnValue({ mutateAsync: vi.fn(async () => undefined), isPending: false })
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
    expect(HOOKS.useUpdateLibrary().mutateAsync).toHaveBeenCalledWith(
      { libraryId: 'lib_city', patch: { name: 'Renamed', description: 'All the books', visibility: 'public', trashEnabled: true, trashAutoCleanDays: 30, trashMaxBytes: 0, allowMemberUpload: false } },
    )
  })

  it('saves the member-upload switch with the settings', () => {
    renderDialog()
    // The switch reuses the instance-level upload wording: it is the same
    // decision at library scope, and the key must resolve to text rather than
    // falling back to printing the key itself.
    fireEvent.click(screen.getByRole('switch', { name: '允许上传文件' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(HOOKS.useUpdateLibrary().mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ allowMemberUpload: true }) }),
    )
  })

  it('shows the resolved upload wording, never a raw i18n key', () => {
    renderDialog()
    expect(screen.getByText('允许上传文件')).toBeInTheDocument()
    expect(screen.getByText('允许成员上传书籍文件')).toBeInTheDocument()
    expect(screen.queryByText(/settings\.allowUserUpload|admin\.allowUserUpload/)).toBeNull()
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
    expect(HOOKS.useUpdateLibrary().mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ visibility: 'password', accessPassword: 'pass123' }) }),
    )
  })

  it('confirms disabling trash before saving and closes the confirm on success', async () => {
    const mutateAsync = vi.fn(async () => undefined)
    HOOKS.useUpdateLibrary.mockReturnValue({ mutateAsync, isPending: false })
    renderDialog()
    fireEvent.click(screen.getByRole('switch', { name: '启用回收站' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    // Disabling purges the trash, so nothing is sent before the confirmation.
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(screen.getByText(/确定要关闭吗？/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认关闭' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ patch: expect.objectContaining({ trashEnabled: false }) }),
    ))
    await waitFor(() => expect(screen.queryByText(/确定要关闭吗？/)).not.toBeInTheDocument())
  })

  it('keeps the disable-trash confirm open with an inline error when the save fails', async () => {
    const mutateAsync = vi.fn(async () => { throw new Error('boom') })
    HOOKS.useUpdateLibrary.mockReturnValue({ mutateAsync, isPending: false })
    renderDialog()
    fireEvent.click(screen.getByRole('switch', { name: '启用回收站' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    fireEvent.click(screen.getByRole('button', { name: '确认关闭' }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByText(/确定要关闭吗？/)).toBeInTheDocument()
    expect(mutateAsync).toHaveBeenCalledTimes(1)
  })

  it('shows admins a read-only notice instead of the settings form', () => {
    renderDialog(false)
    expect(screen.queryByLabelText('名称')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
    expect(screen.getByText('书库设置仅所有者可修改')).toBeInTheDocument()
  })
})
