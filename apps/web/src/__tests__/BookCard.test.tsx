import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
