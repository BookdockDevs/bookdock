import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import LibrarySidebar from '../features/library/components/LibrarySidebar'
import * as libraryHooks from '../features/library/hooks'
import * as libraryState from '../features/library/state/library-state'

const setShelfId = vi.fn()
const setTrash = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
})

vi.mock('../features/library/hooks', () => ({
  useShelves: vi.fn(),
  useBooks: vi.fn(),
  useCreateShelf: vi.fn(),
  useRenameShelf: vi.fn(),
  useDeleteShelf: vi.fn(),
}))

vi.mock('../features/library/state/library-state', () => ({
  useLibraryState: vi.fn(),
}))

function mockHooks({ shelves = [], trashTotal = 0 }: { shelves?: { id: string; name: string; bookCount: number }[]; trashTotal?: number } = {}) {
  ;(libraryState.useLibraryState as ReturnType<typeof vi.fn>).mockReturnValue({
    shelfId: null,
    trash: false,
    setShelfId,
    setTrash,
  })
  ;(libraryHooks.useShelves as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: shelves },
    isLoading: false,
  })
  ;(libraryHooks.useBooks as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: [], total: trashTotal },
  })
  ;(libraryHooks.useCreateShelf as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useRenameShelf as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useDeleteShelf as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
}

describe('LibrarySidebar', () => {
  it('renders shelves and trash entry', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }] })

    render(<LibrarySidebar />)

    expect(screen.getByText('Favorites')).toBeInTheDocument()
    expect(screen.getByText('回收站')).toBeInTheDocument()
  })

  it('selects a shelf when clicked', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }] })

    render(<LibrarySidebar />)
    fireEvent.click(screen.getByText('Favorites'))
    expect(setShelfId).toHaveBeenCalledWith('shelf-1')
  })

  it('enters trash view when trash is clicked', () => {
    mockHooks()

    render(<LibrarySidebar />)
    fireEvent.click(screen.getByText('回收站'))
    expect(setTrash).toHaveBeenCalledWith(true)
  })
})
