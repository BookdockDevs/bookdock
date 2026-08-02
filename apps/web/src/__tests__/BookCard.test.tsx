import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import BookCard from '../features/library/components/BookCard'

const baseBook = {
  id: 'book-1',
  title: 'Test Book',
  author: '',
  format: 'txt',
  coverKey: null,
  size: 1024,
  createdAt: 0,
  updatedAt: 0,
}

describe('BookCard', () => {
  it('hides author when empty', () => {
    render(<BookCard book={baseBook} />)
    expect(screen.queryByText('未知')).not.toBeInTheDocument()
  })

  it('shows author when present', () => {
    render(<BookCard book={{ ...baseBook, author: 'Author Name' }} />)
    expect(screen.getByText('Author Name')).toBeInTheDocument()
  })

  it('ctrl+click toggles selection', () => {
    const onToggleSelect = vi.fn()
    const { container } = render(<BookCard book={baseBook} onToggleSelect={onToggleSelect} />)
    fireEvent.click(container.querySelector('article')!, { ctrlKey: true })
    expect(onToggleSelect).toHaveBeenCalledWith('book-1', false)
  })

  it('passes shiftKey through when selection is active', () => {
    const onToggleSelect = vi.fn()
    const { container } = render(<BookCard book={baseBook} selectionActive onToggleSelect={onToggleSelect} />)
    fireEvent.click(container.querySelector('article')!, { shiftKey: true })
    expect(onToggleSelect).toHaveBeenCalledWith('book-1', true)
  })

  it('plain click does not toggle selection outside selection mode', () => {
    const onToggleSelect = vi.fn()
    const { container } = render(<BookCard book={baseBook} onToggleSelect={onToggleSelect} />)
    fireEvent.click(container.querySelector('article')!)
    expect(onToggleSelect).not.toHaveBeenCalled()
  })
})
