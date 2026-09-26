import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BookCard from '../features/library/components/BookCard'

const mutateMock = vi.fn()
vi.mock('../features/library/hooks', () => ({
  useUpdateBook: () => ({ mutate: mutateMock }),
}))

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}))

vi.mock('@/api/client', () => ({
  apiGet: vi.fn(async () => ({ data: {} })),
}))

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

  it('renders no unpin button for unpinned books', () => {
    render(<BookCard book={baseBook} />)
    expect(screen.queryByLabelText('library.unpin')).not.toBeInTheDocument()
  })

  it('unpin button unpins the book without toggling selection', () => {
    const onToggleSelect = vi.fn()
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <BookCard book={{ ...baseBook, pinnedAt: 1 }} onToggleSelect={onToggleSelect} />
      </QueryClientProvider>,
    )

    fireEvent.click(screen.getByLabelText('library.unpin'))
    expect(mutateMock).toHaveBeenCalledWith({ bookId: 'book-1', pinned: false })
    expect(onToggleSelect).not.toHaveBeenCalled()
  })

  it('renders trash meta and a grayscaled cover for trash cards', () => {
    const DAY_MS = 24 * 60 * 60 * 1000
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['settings'], { data: { trash: { autoCleanDays: 30 } } })
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <BookCard
          book={{ ...baseBook, deletedAt: Date.now() - 2 * DAY_MS }}
          onRestore={vi.fn()}
          onPermanentDelete={vi.fn()}
        />
      </QueryClientProvider>,
    )
    expect(screen.getByText('library.trashPurgeInDays')).toBeInTheDocument()
    expect(screen.getByLabelText('library.restore')).toBeInTheDocument()
    expect(container.querySelector('[class*="grayscale"]')).not.toBeNull()
  })

  it('renders progress text for active books with progress', () => {
    render(<BookCard book={{ ...baseBook, progress: 45 }} />)
    expect(screen.getByText('45%')).toBeInTheDocument()
  })

  it('renders author and progress combined', () => {
    render(<BookCard book={{ ...baseBook, author: 'Author Name', progress: 45 }} />)
    expect(screen.getByText('Author Name')).toBeInTheDocument()
    expect(screen.getByText('45%')).toBeInTheDocument()
  })

  it('hides author and progress when gridCardFields contains only title', () => {
    render(<BookCard book={{ ...baseBook, author: 'Author Name', progress: 45 }} gridCardFields={['title']} />)
    expect(screen.getByRole('heading', { name: 'Test Book' })).toBeInTheDocument()
    expect(screen.queryByText('Author Name')).not.toBeInTheDocument()
    expect(screen.queryByText('45%')).not.toBeInTheDocument()
  })

  it('renders 100% on completion and hides 0%', () => {
    const { rerender } = render(<BookCard book={{ ...baseBook, progress: 100 }} />)
    expect(screen.getByText('100%')).toBeInTheDocument()

    rerender(<BookCard book={{ ...baseBook, progress: 0 }} />)
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('does not render progress on trash cards even if progress is set', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <BookCard
          book={{ ...baseBook, progress: 45, deletedAt: Date.now() }}
          onRestore={vi.fn()}
          onPermanentDelete={vi.fn()}
        />
      </QueryClientProvider>,
    )
    expect(screen.queryByText('45%')).not.toBeInTheDocument()
  })
})
