import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import MetadataFieldAction from '../features/library/components/book-detail/MetadataFieldAction'

describe('MetadataFieldAction', () => {
  it('applies on click', () => {
    const apply = vi.fn()
    render(<MetadataFieldAction label="恢复文件值" onApply={apply} />)
    const button = screen.getByRole('button', { name: '恢复文件值' })
    fireEvent.click(button)
    expect(apply).toHaveBeenCalledOnce()
  })

  it('is disabled when disabled prop is true', () => {
    const apply = vi.fn()
    render(<MetadataFieldAction label="恢复文件值" disabled onApply={apply} />)
    const button = screen.getByRole('button', { name: '恢复文件值' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(apply).not.toHaveBeenCalled()
  })
})
