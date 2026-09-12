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
  useReorderShelves: vi.fn(),
  useCreateTag: vi.fn(),
  useRenameTag: vi.fn(),
  useDeleteTag: vi.fn(),
}))

vi.mock('@/features/auth/AccountMenu', () => ({
  default: () => null,
}))

interface ShelfItemData { id: string; name: string; bookCount: number }
interface TagItemData { id: string; name: string; bookCount: number }

function mockHooks({ shelves = [], tags = [], uncategorizedTotal = 1 }: { shelves?: ShelfItemData[]; tags?: TagItemData[]; uncategorizedTotal?: number } = {}) {
  ;(libraryHooks.useShelves as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: shelves },
    isLoading: false,
  })
  ;(libraryHooks.useBooks as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: [], total: uncategorizedTotal },
  })
  ;(libraryHooks.useTags as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: tags },
  })
  ;(libraryHooks.useCreateShelf as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useRenameShelf as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useDeleteShelf as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  ;(libraryHooks.useReorderShelves as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useCreateTag as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useRenameTag as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useDeleteTag as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
}

describe('LibrarySidebar', () => {
  it('renders shelves and trash entry', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }] })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)

    expect(screen.getByText('Favorites')).toBeInTheDocument()
    expect(screen.getByText('回收站')).toBeInTheDocument()
  })

  it('reserves menu space on mobile while keeping desktop counts aligned to the row edge', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }] })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)

    expect(screen.getByText('Favorites').closest('button')).toHaveClass('pr-10', 'md:pr-3')
  })

  it('selects a shelf when clicked', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }] })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    fireEvent.click(screen.getByText('Favorites'))
    expect(navSearch).toHaveBeenCalledWith({ shelf: 'shelf-1', tag: undefined, status: undefined, trash: undefined })
  })

  it('closes the mobile drawer after selecting a shelf', () => {
    const onMobileClose = vi.fn()
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }] })

    render(
      <LibrarySidebar
        navSearch={navSearch}
        shelfId={null}
        tagId={null}
        trash={false}
        mobileOpen
        onMobileClose={onMobileClose}
      />,
    )
    fireEvent.click(screen.getByText('Favorites'))
    expect(onMobileClose).toHaveBeenCalled()
  })

  it('renders the uncategorized entry and filters with the none sentinel', () => {
    mockHooks()

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    fireEvent.click(screen.getByText('未分类'))
    expect(navSearch).toHaveBeenCalledWith({ shelf: 'none', tag: undefined, status: undefined, trash: undefined })
    expect(screen.queryByText('暂无书架')).toBeNull()
  })

  it('uses a three-quarter width mobile drawer', () => {
    mockHooks()

    render(
      <LibrarySidebar
        navSearch={navSearch}
        shelfId={null}
        tagId={null}
        trash={false}
        mobileOpen
      />,
    )

    expect(screen.getByText('未分类').closest('aside')).toHaveClass('w-[min(19rem,75vw)]')
  })

  it('places uncategorized inside the shelves section, before real shelves', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }] })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    const shelvesHeader = screen.getByText('书架')
    const uncategorized = screen.getByText('未分类')
    const firstShelf = screen.getByText('Favorites')
    expect(shelvesHeader.compareDocumentPosition(uncategorized) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(uncategorized.compareDocumentPosition(firstShelf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('hides an empty uncategorized entry when a real shelf exists', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }], uncategorizedTotal: 0 })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)

    expect(screen.queryByText('未分类')).toBeNull()
  })

  it('keeps an empty uncategorized entry visible when it is selected', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }], uncategorizedTotal: 0 })

    render(<LibrarySidebar navSearch={navSearch} shelfId="none" tagId={null} trash={false} />)

    expect(screen.getByText('未分类')).toBeInTheDocument()
  })

  it('enters trash view when trash is clicked', () => {
    mockHooks()

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    fireEvent.click(screen.getByText('回收站'))
    expect(navSearch).toHaveBeenCalledWith({ trash: true, shelf: undefined, tag: undefined, status: undefined })
  })

  it('opens the tag context menu with rename and delete actions', () => {
    mockHooks({ tags: [{ id: 'tag-1', name: '小说', bookCount: 3 }] })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    fireEvent.click(screen.getAllByLabelText('更多操作')[0])

    expect(screen.getByText('重命名')).toBeInTheDocument()
    expect(screen.getByText('删除')).toBeInTheDocument()
    expect(screen.getByText('3', { exact: true })).toHaveClass('opacity-0')
  })

  it('confirms before deleting a tag and calls the delete mutation', () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockHooks({ tags: [{ id: 'tag-1', name: '小说', bookCount: 3 }] })
    ;(libraryHooks.useDeleteTag as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync, isPending: false })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    fireEvent.click(screen.getAllByLabelText('更多操作')[0])
    fireEvent.click(screen.getByText('删除'))

    expect(screen.getByText('删除标签')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '删除' }).at(-1)!)
    expect(mutateAsync).toHaveBeenCalledWith('tag-1')
  })

  it('opens the new tag dialog from the tags section header', () => {
    mockHooks()

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    fireEvent.click(screen.getByTitle('新建标签'))

    expect(screen.getByPlaceholderText('标签名称')).toBeInTheDocument()
  })

  it('updates scroll shadows based on scroll position', () => {
    mockHooks({
      shelves: Array.from({ length: 15 }, (_, i) => ({ id: `shelf-${i}`, name: `Shelf ${i}`, bookCount: i })),
    })

    const { container } = render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    const topShadow = screen.getByTestId('sidebar-scroll-shadow-top')
    const bottomShadow = screen.getByTestId('sidebar-scroll-shadow-bottom')
    const nav = container.querySelector('nav')!

    expect(topShadow).toHaveClass('opacity-0')
    expect(bottomShadow).toBeInTheDocument()

    // Mock dimensions to simulate overflow
    Object.defineProperty(nav, 'clientHeight', { value: 300, configurable: true })
    Object.defineProperty(nav, 'scrollHeight', { value: 600, configurable: true })
    Object.defineProperty(nav, 'scrollTop', { value: 50, configurable: true })

    fireEvent.scroll(nav)

    expect(topShadow).toHaveClass('opacity-100')
    expect(bottomShadow).toHaveClass('opacity-100')

    // Scroll to bottom
    Object.defineProperty(nav, 'scrollTop', { value: 300, configurable: true })
    fireEvent.scroll(nav)

    expect(topShadow).toHaveClass('opacity-100')
    expect(bottomShadow).toHaveClass('opacity-0')
  })

  it('applies elevated contrast active styles and pill badge classes when a shelf is selected', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 5 }] })

    render(<LibrarySidebar navSearch={navSearch} shelfId="shelf-1" tagId={null} trash={false} />)

    const button = screen.getByText('Favorites').closest('button')!
    expect(button).toHaveClass('dark:bg-stone-800', 'dark:text-stone-50')

    const badge = screen.getByText('5')
    expect(badge).toHaveClass('rounded-full', 'dark:bg-stone-700/60', 'dark:text-stone-200')
  })
})
