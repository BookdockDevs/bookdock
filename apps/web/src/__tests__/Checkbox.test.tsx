import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import Checkbox from '@/components/ui/Checkbox'

describe('Checkbox', () => {
  it('renders unchecked and checked states and emits onChange', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Checkbox checked={false} onChange={onChange} label="全选" />)

    const checkbox = screen.getByRole('checkbox', { name: '全选' }) as HTMLInputElement
    expect(checkbox).not.toBeChecked()
    expect(checkbox).toHaveAttribute('aria-checked', 'false')
    expect(checkbox.indeterminate).toBe(false)

    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(true)

    rerender(<Checkbox checked={true} onChange={onChange} label="全选" />)
    expect(checkbox).toBeChecked()
    expect(checkbox).toHaveAttribute('aria-checked', 'true')
    expect(checkbox.indeterminate).toBe(false)
  })

  it('syncs indeterminate state to DOM property and aria-checked="mixed"', () => {
    const { rerender } = render(<Checkbox checked={false} indeterminate={true} onChange={() => {}} label="全选" />)

    const checkbox = screen.getByRole('checkbox', { name: '全选' }) as HTMLInputElement
    expect(checkbox.indeterminate).toBe(true)
    expect(checkbox).toHaveAttribute('aria-checked', 'mixed')
    expect(checkbox).toBePartiallyChecked()

    rerender(<Checkbox checked={true} indeterminate={false} onChange={() => {}} label="全选" />)
    expect(checkbox.indeterminate).toBe(false)
    expect(checkbox).toHaveAttribute('aria-checked', 'true')
    expect(checkbox).toBeChecked()
  })

  it('respects disabled state', () => {
    const onChange = vi.fn()
    render(<Checkbox checked={false} disabled onChange={onChange} label="禁用项" />)

    const checkbox = screen.getByRole('checkbox', { name: '禁用项' })
    expect(checkbox).toBeDisabled()
  })

  it('works inside an outer label with withinLabel', () => {
    const onChange = vi.fn()
    render(
      <label>
        <Checkbox withinLabel checked={false} onChange={onChange} aria-label="权限项" />
        <span>上传书籍</span>
      </label>,
    )

    fireEvent.click(screen.getByText('上传书籍'))
    expect(onChange).toHaveBeenCalledWith(true)
  })
})
