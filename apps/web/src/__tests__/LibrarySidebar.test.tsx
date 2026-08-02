import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import i18n from '../i18n/i18n'
import LibrarySidebar from '../features/library/components/LibrarySidebar'
import * as libraryHooks from '../features/library/hooks'

const navSearch = vi.fn()

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('zh-CN')
})

vi.mock('../features/library/hooks', () => ({
  useShelves: vi.fn(),
  useBooks: vi.fn(),
  useTags: vi.fn(),
  useCreateShelf: vi.fn(),
  useRenameShelf: vi.fn(),
  useDeleteShelf: vi.fn(),
}))

vi.mock('@/features/auth/AccountMenu', () => ({
  default: () => null,
}))

function mockHooks({ shelves = [], trashTotal = 0 }: { shelves?: { id: string; name: string; bookCount: number }[]; trashTotal?: number } = {}) {
  ;(libraryHooks.useShelves as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: shelves },
    isLoading: false,
  })
  ;(libraryHooks.useBooks as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: [], total: trashTotal },
  })
  ;(libraryHooks.useTags as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: [] },
  })
  ;(libraryHooks.useCreateShelf as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useRenameShelf as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useDeleteShelf as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
}

describe('LibrarySidebar', () => {
  it('renders shelves and trash entry', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }] })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)

    expect(screen.getByText('Favorites')).toBeInTheDocument()
    expect(screen.getByText('回收站')).toBeInTheDocument()
  })

  it('selects a shelf when clicked', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }] })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    fireEvent.click(screen.getByText('Favorites'))
    expect(navSearch).toHaveBeenCalledWith({ shelf: 'shelf-1', tag: undefined, status: undefined, trash: undefined })
  })

  it('enters trash view when trash is clicked', () => {
    mockHooks()

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    fireEvent.click(screen.getByText('回收站'))
    expect(navSearch).toHaveBeenCalledWith({ trash: true, shelf: undefined, tag: undefined, status: undefined })
  })
})
