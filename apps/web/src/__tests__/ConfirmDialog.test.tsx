import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

import ConfirmDialog from '../components/ui/ConfirmDialog'

vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}))

describe('ConfirmDialog', () => {
  it('renders title, message, warning, and action buttons', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(
      <ConfirmDialog
        title="确认删除"
        message="确定要删除这本书吗？"
        warning="此操作无法撤销"
        confirmLabel="删除"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('确认删除')).toBeInTheDocument()
    expect(screen.getByText('确定要删除这本书吗？')).toBeInTheDocument()
    expect(screen.getByText('此操作无法撤销')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'library.cancel' })).toBeInTheDocument()
  })

  it('calls onConfirm when confirm button is clicked', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(
      <ConfirmDialog
        title="测试标题"
        message="测试消息"
        confirmLabel="确定"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('calls onClose when cancel button is clicked or Escape is pressed', () => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(
      <ConfirmDialog
        title="测试标题"
        message="测试消息"
        confirmLabel="确定"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'library.cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('supports custom ReactNode message', () => {
    render(
      <ConfirmDialog
        title="测试"
        message={<span data-testid="custom-msg">自定义富文本消息</span>}
        confirmLabel="确定"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByTestId('custom-msg')).toBeInTheDocument()
  })
})
