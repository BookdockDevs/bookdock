import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import Input from '@/components/ui/Input'

describe('Input', () => {
  it('renders value, forwards ref, and emits onChange', () => {
    const ref = createRef<HTMLInputElement>()
    const onChange = vi.fn()
    render(<Input ref={ref} aria-label="书名" value="三体" onChange={(e) => onChange(e.target.value)} />)

    const input = screen.getByRole('textbox', { name: '书名' })
    expect(ref.current).toBe(input)
    expect(input).toHaveValue('三体')

    fireEvent.change(input, { target: { value: '球状闪电' } })
    expect(onChange).toHaveBeenCalledWith('球状闪电')
  })

  it('sets aria-invalid when invalid is true', () => {
    render(<Input aria-label="书名" invalid value="" onChange={() => {}} />)
    expect(screen.getByRole('textbox', { name: '书名' })).toHaveAttribute('aria-invalid', 'true')
  })
})
