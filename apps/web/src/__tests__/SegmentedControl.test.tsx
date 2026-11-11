import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import SegmentedControl from '@/components/ui/SegmentedControl'

const options = [
  { value: 'first', label: 'First' },
  { value: 'second', label: 'Second' },
] as const

describe('SegmentedControl', () => {
  it.each(['group', 'radiogroup', 'multiple'] as const)('locks %s selections during saving without dimming or changing selection', (mode) => {
    const onChange = vi.fn()
    const props = mode === 'multiple'
      ? { multiple: true as const, value: ['first'] as const, onChange }
      : { role: mode, value: 'first' as const, onChange }
    const { rerender } = render(<SegmentedControl {...props} options={options} ariaLabel="Options" />)
    const role = mode === 'multiple' ? 'checkbox' : mode === 'radiogroup' ? 'radio' : 'button'
    const first = screen.getByRole(role, { name: 'First' })
    const second = screen.getByRole(role, { name: 'Second' })
    const classes = [first.className, second.className]

    rerender(<SegmentedControl {...props} options={options} ariaLabel="Options" pending />)

    expect([first.className, second.className]).toEqual(classes)
    expect(first).not.toHaveClass('disabled:opacity-50')
    expect(first).not.toHaveClass('opacity-50')
    expect(first).toBeDisabled()
    expect(second).toBeDisabled()
    expect(first).toHaveAttribute(mode === 'group' ? 'aria-pressed' : 'aria-checked', 'true')
    expect(screen.getByRole(mode === 'radiogroup' ? 'radiogroup' : 'group', { name: 'Options' })).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(second)
    expect(onChange).not.toHaveBeenCalled()

    rerender(<SegmentedControl {...props} options={options} ariaLabel="Options" />)
    expect(second).toBeEnabled()
    fireEvent.click(second)
    expect(onChange).toHaveBeenCalledExactlyOnceWith('second')
  })

  it('keeps unavailable options disabled and dimmed before, during, and after saving', () => {
    const onChange = vi.fn()
    const unavailableOptions = [options[0], { ...options[1], disabled: true }]
    const { rerender } = render(<SegmentedControl options={unavailableOptions} value="first" onChange={onChange} />)
    const unavailable = screen.getByRole('button', { name: 'Second' })

    for (const pending of [false, true, false]) {
      rerender(<SegmentedControl options={unavailableOptions} value="first" onChange={onChange} pending={pending} />)
      expect(unavailable).toBeDisabled()
      expect(unavailable).toHaveClass('opacity-50')
      fireEvent.click(unavailable)
    }
    expect(onChange).not.toHaveBeenCalled()
  })

  it('dims all options when the whole control is unavailable', () => {
    render(<SegmentedControl options={options} value="first" onChange={vi.fn()} disabled />)

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled()
      expect(button).toHaveClass('opacity-50')
    }
  })
})
