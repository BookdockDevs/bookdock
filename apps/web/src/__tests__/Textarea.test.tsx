import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import Textarea from '@/components/ui/Textarea'

describe('Textarea', () => {
  it('renders value, forwards ref, and emits onChange', () => {
    const ref = createRef<HTMLTextAreaElement>()
    const onChange = vi.fn()
    render(<Textarea ref={ref} aria-label="简介" value="初始内容" onChange={(e) => onChange(e.target.value)} />)

    const textarea = screen.getByRole('textbox', { name: '简介' })
    expect(ref.current).toBe(textarea)
    expect(textarea).toHaveValue('初始内容')

    fireEvent.change(textarea, { target: { value: '更新内容' } })
    expect(onChange).toHaveBeenCalledWith('更新内容')
  })

  it('sets aria-invalid when invalid is true', () => {
    render(<Textarea aria-label="简介" invalid value="" onChange={() => {}} />)
    expect(screen.getByRole('textbox', { name: '简介' })).toHaveAttribute('aria-invalid', 'true')
  })
})
