import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import MetadataFieldAction from '../features/library/components/book-detail/MetadataFieldAction'

describe('MetadataFieldAction', () => {
  it('previews on focus without applying and dismisses with Escape', () => {
    const apply = vi.fn()
    render(<MetadataFieldAction label="恢复文件值" preview="File Title" provenance="文件内" onApply={apply} />)
    const button = screen.getByRole('button', { name: '恢复文件值' })
    fireEvent.focus(button)
    expect(screen.getByText('File Title')).toBeInTheDocument()
    expect(apply).not.toHaveBeenCalled()
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(screen.queryByText('File Title')).not.toBeInTheDocument()
    fireEvent.click(button)
    expect(apply).toHaveBeenCalledOnce()
  })

  it('requires an explicit apply after a touch preview', () => {
    const apply = vi.fn()
    render(<MetadataFieldAction label="恢复跟随" preview="Work Title" provenance="跟随作品" kind="inherit" onApply={apply} />)
    const button = screen.getByRole('button', { name: '恢复跟随' })
    const pointer = new Event('pointerdown', { bubbles: true })
    Object.defineProperty(pointer, 'pointerType', { value: 'touch' })
    fireEvent(button, pointer)
    fireEvent.click(button)
    expect(screen.getByText('Work Title')).toBeInTheDocument()
    expect(apply).not.toHaveBeenCalled()
    fireEvent.click(screen.getAllByRole('button', { name: '恢复跟随' })[1]!)
    expect(apply).toHaveBeenCalledOnce()
  })
})
