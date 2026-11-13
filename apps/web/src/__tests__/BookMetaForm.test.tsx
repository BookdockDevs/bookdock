import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { BookMetadataSourceRes } from '@bookdock/shared'

import BookMetaForm from '../features/library/components/book-detail/BookMetaForm'
import type { MetaDraft } from '../features/library/components/book-detail/types'

const draft: MetaDraft = { title: 'Book', authors: '', publisher: '', published: '', isbn: '', language: '', subjects: '', series: '', seriesIndex: '', description: '', coverPaletteId: null }

describe('book metadata description', () => {
  it('keeps the description resizable and scrollable after an external draft update', () => {
    const { rerender } = render(<BookMetaForm values={draft} onChange={vi.fn()} />)
    const field = screen.getByRole('textbox', { name: /简介|Description/ })
    rerender(<BookMetaForm values={{ ...draft, description: 'Long imported description' }} onChange={vi.fn()} />)
    expect(field).toHaveValue('Long imported description')
    expect(field).toHaveAttribute('rows', '6')
    expect(field).toHaveClass('resize-y!', 'overflow-y-auto!')
  })

  it('only reserves room for a restore action when one is actually offered', () => {
    const { unmount } = render(<BookMetaForm values={draft} onChange={vi.fn()} />)
    const withoutAction = screen.getByRole('textbox', { name: /简介|Description/ })
    expect(withoutAction.className).not.toContain('pr-12')
    unmount()

    const source = {
      kind: 'file',
      values: { description: 'Description from the file' },
      provenance: { description: 'file' },
    } as unknown as BookMetadataSourceRes
    render(<BookMetaForm values={draft} onChange={vi.fn()} source={source} onRestoreField={vi.fn()} />)
    const withAction = screen.getByRole('textbox', { name: /简介|Description/ })
    expect(withAction.className).toContain('pr-12')
  })
})
