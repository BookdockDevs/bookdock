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

function mockHooks({ shelves = [], tags = [], trashTotal = 0 }: { shelves?: ShelfItemData[]; tags?: TagItemData[]; trashTotal?: number } = {}) {
  ;(libraryHooks.useShelves as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: shelves },
    isLoading: false,
  })
  ;(libraryHooks.useBooks as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: [], total: trashTotal },
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
})
