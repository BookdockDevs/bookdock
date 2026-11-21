import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import i18n from '../i18n/i18n'
import ShelfDialog from '../features/library/components/ShelfDialog'

const HOOKS = vi.hoisted(() => ({
  useCreateShelf: vi.fn(),
  useRenameShelf: vi.fn(),
}))

vi.mock('../features/library/hooks', () => HOOKS)

describe('ShelfDialog', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await i18n.changeLanguage('zh-CN')
    HOOKS.useCreateShelf.mockReturnValue({ mutate: vi.fn(), isPending: false })
    HOOKS.useRenameShelf.mockReturnValue({ mutate: vi.fn(), isPending: false })
  })

  it('reports creating in flight and blocks close entries until it settles', () => {
    HOOKS.useCreateShelf.mockReturnValue({ mutate: vi.fn(), isPending: true })
    const onClose = vi.fn()
    render(<ShelfDialog open onClose={onClose} />)
    fireEvent.change(screen.getByPlaceholderText('书架名称'), { target: { value: '新书架' } })

    const save = screen.getByRole('button', { name: '创建中…' })
    expect(save).toBeDisabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows the plain create label when idle and submits the trimmed name', () => {
    const createShelf = { mutate: vi.fn(), isPending: false }
    HOOKS.useCreateShelf.mockReturnValue(createShelf)
    render(<ShelfDialog open onClose={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText('书架名称'), { target: { value: '  新书架  ' } })

    expect(screen.getByRole('button', { name: '创建' })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(createShelf.mutate).toHaveBeenCalledWith('新书架', expect.any(Object))
  })

  it('reports the rename label family when renaming an existing shelf', () => {
    HOOKS.useRenameShelf.mockReturnValue({ mutate: vi.fn(), isPending: false })
    render(<ShelfDialog open shelfId="s1" initialName="旧名" onClose={vi.fn()} />)

    // The initial name fills the input, so the save button starts enabled.
    expect(screen.getByRole('button', { name: '保存' })).not.toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('书架名称'), { target: { value: '新名' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(HOOKS.useRenameShelf().mutate).toHaveBeenCalledWith({ id: 's1', name: '新名' }, expect.any(Object))
  })
})
