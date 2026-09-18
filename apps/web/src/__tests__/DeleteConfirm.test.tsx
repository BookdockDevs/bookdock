import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import DeleteConfirm from '../features/library/components/DeleteConfirm'

vi.mock('../hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
}))

function renderConfirm(bookTitle?: string) {
  render(<DeleteConfirm open bookTitle={bookTitle} onConfirm={vi.fn()} onCancel={vi.fn()} />)
}

describe('DeleteConfirm', () => {
  it('uses the bracketed message for plain titles', () => {
    renderConfirm('三体')
    expect(screen.getByText('library.deleteConfirm:三体')).toBeInTheDocument()
  })

  it('uses the bare message when the title already carries 《》', () => {
    renderConfirm('《逍遥军医》作者：中秋月明')
    expect(
      screen.getByText('library.deleteConfirmBare:《逍遥军医》作者：中秋月明'),
    ).toBeInTheDocument()
  })

  it('prefers a custom message over the default', () => {
    render(
      <DeleteConfirm open message={<span>custom-message</span>} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    )
    expect(screen.getByText('custom-message')).toBeInTheDocument()
    expect(screen.queryByText(/deleteConfirm/)).not.toBeInTheDocument()
  })
})
