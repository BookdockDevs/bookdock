import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
    expect(img).toHaveAttribute('src', '/api/v1/books/book-1/cover?v=covers%2Fbook-1.jpg')
  })

  it('requests an EPUB cover when the stored cover key is missing', () => {
    render(<BookCover book={{ ...baseBook, format: 'epub' }} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/v1/books/book-1/cover?v=auto')
  })

  it('shows the title under a pending EPUB cover instead of a blank card', () => {
    // The artwork is an overlay on the placeholder, so the title never waits on
    // the cover request that a coverless EPUB can only ever answer 404 to.
    render(<BookCover book={{ ...baseBook, title: 'Pending Book', format: 'epub' }} />)
    expect(screen.getByRole('img')).toHaveClass('opacity-0')
    expect(screen.getByText('Pending Book')).toBeVisible()
  })

  it('keeps the title underneath a loaded cover', () => {
    render(<BookCover book={{ ...baseBook, title: 'Real Cover', coverKey: 'covers/book-1.jpg' }} />)
    fireEvent.load(screen.getByRole('img'))
    expect(screen.getByRole('img')).toHaveClass('opacity-100')
    expect(screen.getByText('Real Cover')).toBeInTheDocument()
  })

  it('renders an explicitly supplied cover source', () => {
    render(<BookCover book={baseBook} coverSrc="blob:cover-preview" />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:cover-preview')
  })

  it('renders fallback cover with title, format, author, and book spine simulation', () => {
    const bookWithAuthor = { ...baseBook, author: 'Author Name' }
    const { container } = render(<BookCover book={bookWithAuthor} />)

    expect(screen.getByText('Test Book')).toBeInTheDocument()
    expect(screen.getByText('txt')).toBeInTheDocument()

    // Spine simulation line elements
    expect(container.querySelector('.w-1')).toBeInTheDocument()
    expect(container.querySelector('.left-2.w-px')).toBeInTheDocument()
  })

  it('supports custom coverPaletteId override', () => {
    const { container } = render(<BookCover book={baseBook} coverPaletteId="sage" />)
    const card = container.firstChild as HTMLElement
    expect(card.className).toContain('bg-emerald-100/70')
  })

  it('renders compact initial fallback for size="sm"', () => {
    render(<BookCover book={baseBook} size="sm" />)
    expect(screen.getByText('T')).toBeInTheDocument()
  })

  it('renders compact size="sm" when cover image is present', () => {
    const { container } = render(<BookCover book={{ ...baseBook, coverKey: 'covers/book-1.jpg' }} size="sm" />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('h-16')
    expect(wrapper.className).toContain('w-12')
    expect(wrapper.className).toContain('shrink-0')
  })

  it('renders book title and card dimensions for size="card"', () => {
    const { container } = render(<BookCover book={baseBook} size="card" />)
    const wrapper = container.firstChild as HTMLElement
    expect(wrapper.className).toContain('h-20')
    expect(wrapper.className).toContain('w-14')
    expect(screen.getByText('Test Book')).toBeInTheDocument()
    expect(screen.getByText('txt')).toBeInTheDocument()
  })
})
