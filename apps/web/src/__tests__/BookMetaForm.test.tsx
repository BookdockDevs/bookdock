import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import BookMetaForm from '../features/library/components/book-detail/BookMetaForm'
import type { MetaDraft } from '../features/library/components/book-detail/types'

describe('book metadata description', () => {
  it('keeps the description resizable and scrollable after an external draft update', () => {
    const draft: MetaDraft = { title: 'Book', authors: '', publisher: '', published: '', isbn: '', language: '', subjects: '', series: '', seriesIndex: '', description: '', coverPaletteId: null }
    const { rerender } = render(<BookMetaForm draft={draft} onChange={vi.fn()} />)
    const field = screen.getByRole('textbox', { name: /简介|Description/ })
    rerender(<BookMetaForm draft={{ ...draft, description: 'Long imported description' }} onChange={vi.fn()} />)
    expect(field).toHaveValue('Long imported description')
    expect(field).toHaveAttribute('rows', '3')
    expect(field).toHaveClass('resize-y!', 'overflow-y-auto!')
  })
})
