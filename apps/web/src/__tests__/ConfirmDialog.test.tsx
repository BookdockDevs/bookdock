import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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

  it('requires an exact name and prevents duplicate submits and closing while pending', async () => {
    let finish!: () => void
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    const onClose = vi.fn()
    render(<ConfirmDialog title="Delete" message="Warning" confirmLabel="Delete" confirmationText="City Library" confirmationLabel="Library name" onConfirm={onConfirm} onClose={onClose} />)
    const input = screen.getByRole('textbox', { name: 'Library name' })
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(input).toHaveFocus()
    expect(button).toBeDisabled()
    for (const value of ['city Library', 'City Library ', ' City Library', '']) {
      fireEvent.change(input, { target: { value } })
      expect(button).toBeDisabled()
    }
    fireEvent.change(input, { target: { value: 'City Library' } })
    expect(input).toHaveFocus()
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'library.cancel' }))
    fireEvent.click(screen.getByRole('alertdialog').parentElement!)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(input).toBeDisabled()
    finish()
    await waitFor(() => expect(input).not.toBeDisabled())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps input on failure, permits retry, and resets on remount', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new TypeError('Network unavailable')).mockResolvedValue(undefined)
    const props = { title: 'Transfer', message: 'Warning', confirmLabel: 'Transfer', confirmationText: 'carol', confirmationLabel: 'Username', onConfirm, onClose: vi.fn() }
    const { unmount } = render(<ConfirmDialog {...props} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'carol' } })
    fireEvent.click(screen.getByRole('button', { name: 'Transfer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('errors.network')
    expect(screen.getByRole('textbox')).toHaveValue('carol')
    fireEvent.click(screen.getByRole('button', { name: 'Transfer' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByRole('textbox')).not.toBeDisabled())
    expect(screen.queryByRole('alert')).toBeNull()
    unmount()
    render(<ConfirmDialog {...props} />)
    expect(screen.getByRole('textbox')).toHaveValue('')
  })
})
