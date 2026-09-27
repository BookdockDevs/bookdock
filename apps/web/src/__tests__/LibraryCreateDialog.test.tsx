import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import i18n from '../i18n/i18n'
import LibraryCreateDialog from '../features/library/components/LibraryCreateDialog'
import type { Library } from '@bookdock/shared'

const HOOKS = vi.hoisted(() => ({ useCreateLibrary: vi.fn() }))
vi.mock('../features/library/hooks', () => HOOKS)
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), info: vi.fn(), error: vi.fn() } }))

describe('LibraryCreateDialog', () => {
  const mutate = vi.fn()
  const onClose = vi.fn()
  const onCreated = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    HOOKS.useCreateLibrary.mockReturnValue({ mutate, isPending: false })
  })

  function renderDialog() {
    render(<LibraryCreateDialog onClose={onClose} onCreated={onCreated} />)
  }

  it('creates a private library and switches to it', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '  城市书库  ' } })
    fireEvent.change(screen.getByLabelText('简介'), { target: { value: '大家共读' } })
    fireEvent.click(screen.getAllByRole('button', { name: '新建书库' })[0])

    expect(mutate).toHaveBeenCalledWith(
      { body: { name: '城市书库', description: '大家共读', visibility: 'private' } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
    const created = { id: 'lib_new', type: 'shared' } as Library
    act(() => mutate.mock.calls[0]![1].onSuccess({ data: created }))
    expect(onCreated).toHaveBeenCalledWith(created)
    expect(onClose).toHaveBeenCalled()
  })

  it('requires a name and, for a password library, the password', () => {
    renderDialog()
    const submit = () => screen.getAllByRole('button', { name: '新建书库' })[0]
    expect(submit()).toBeDisabled()

    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Locked' } })
    fireEvent.click(screen.getByRole('radio', { name: /密码/ }))
    // A password library without a password is not submittable.
    expect(submit()).toBeDisabled()
    fireEvent.change(screen.getByLabelText('访问密码'), { target: { value: 'pw' } })
    expect(submit()).toBeDisabled()
    fireEvent.change(screen.getByLabelText('访问密码'), { target: { value: 'pw12' } })
    expect(submit()).not.toBeDisabled()

    fireEvent.click(submit())
    expect(mutate).toHaveBeenCalledWith(
      { body: { name: 'Locked', description: '', visibility: 'password', accessPassword: 'pw12' } },
      expect.any(Object),
    )
  })

  it('asks before discarding a half-typed library', () => {
    renderDialog()
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Unsaved' } })
    fireEvent.click(screen.getByLabelText('关闭'))

    // Nothing is lost silently, and cancelling keeps the dialog open.
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '放弃' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes without a prompt when nothing was typed', () => {
    renderDialog()
    fireEvent.click(screen.getByLabelText('关闭'))
    expect(onClose).toHaveBeenCalled()
  })
})
