import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BookCover from '../features/library/components/BookCover'

const baseBook = {
  id: 'book-1',
  title: 'Test Book',
  author: '',
  format: 'txt' as const,
  coverKey: null,
  size: 1024,
  createdAt: 0,
  updatedAt: 0,
}

describe('BookCover', () => {
  it('renders fallback when coverKey is null', () => {
    render(<BookCover book={baseBook} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders img when coverKey is present', () => {
    render(<BookCover book={{ ...baseBook, coverKey: 'covers/book-1.jpg' }} />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', '/api/v1/books/book-1/cover')
  })
})
