import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import Radio from '@/components/ui/Radio'

describe('Radio', () => {
  it('renders checked state and emits onChange', () => {
    const onChange = vi.fn()
    render(
      <div>
        <Radio name="vis" value="private" checked={false} onChange={onChange} label="私有" />
        <Radio name="vis" value="shared" checked={true} onChange={() => {}} label="共享" />
      </div>,
    )

    const priv = screen.getByRole('radio', { name: '私有' })
    const shared = screen.getByRole('radio', { name: '共享' })
    expect(priv).not.toBeChecked()
    expect(shared).toBeChecked()

    fireEvent.click(priv)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('works inside an outer label with withinLabel', () => {
    const onChange = vi.fn()
    render(
      <label>
        <Radio withinLabel name="vis" value="private" checked={false} onChange={onChange} aria-label="私有" />
        <span>私有书库</span>
      </label>,
    )

    fireEvent.click(screen.getByText('私有书库'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
