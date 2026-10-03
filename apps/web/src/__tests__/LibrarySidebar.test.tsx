import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'

import type { LibraryListItem } from '@bookdock/shared'

import i18n from '../i18n/i18n'
import LibrarySidebar from '../features/library/components/LibrarySidebar'
import * as libraryHooks from '../features/library/hooks'
import { formatDate } from '@/lib/format-date'

const navSearch = vi.fn()

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('zh-CN')
})

vi.mock('../features/library/hooks', () => ({
  useShelves: vi.fn(),
  useBooks: vi.fn(),
  useTags: vi.fn(),
  useTrashEnabled: vi.fn(),
  useLibraryPrefs: vi.fn(),
  useHiddenLibraries: vi.fn(),
  useUpdateLibraryPrefs: vi.fn(),
  useCreateShelf: vi.fn(),
  useRenameShelf: vi.fn(),
  useDeleteShelf: vi.fn(),
  useToggleShelfPin: vi.fn(),
  useToggleShelfHidden: vi.fn(),
  useReorderShelves: vi.fn(),
  useCreateTag: vi.fn(),
  useRenameTag: vi.fn(),
  useDeleteTag: vi.fn(),
  useToggleTagPin: vi.fn(),
  useToggleTagHidden: vi.fn(),
  useLibraryCategories: vi.fn(),
  useLibraryTags: vi.fn(),
  useLibraryCatalog: vi.fn(),
  useLibraryRelation: vi.fn(),
  useCreateLibraryCategory: vi.fn(),
  useUpdateLibraryCategory: vi.fn(),
  useDeleteLibraryCategory: vi.fn(),
  useCreateLibraryTag: vi.fn(),
  useUpdateLibraryTag: vi.fn(),
  useDeleteLibraryTag: vi.fn(),
  useUpdateLibrary: vi.fn(),
}))

vi.mock('@/features/auth/AccountMenu', () => ({
  default: () => null,
}))


interface ShelfItemData { id: string; name: string; bookCount: number; pinned?: boolean; hidden?: boolean }
interface TagItemData { id: string; name: string; bookCount: number; pinned?: boolean; hidden?: boolean }

function mockHooks({ shelves = [], tags = [], uncategorizedTotal = 1, trashEnabled = true }: { shelves?: ShelfItemData[]; tags?: TagItemData[]; uncategorizedTotal?: number; trashEnabled?: boolean } = {}) {
  ;(libraryHooks.useShelves as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: shelves },
    isLoading: false,
  })
  ;(libraryHooks.useTrashEnabled as ReturnType<typeof vi.fn>).mockReturnValue(trashEnabled)
  ;(libraryHooks.useBooks as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: [], total: uncategorizedTotal },
  })
  ;(libraryHooks.useTags as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: tags },
    isLoading: false,
  })
  ;(libraryHooks.useCreateShelf as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useRenameShelf as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useDeleteShelf as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  ;(libraryHooks.useToggleShelfPin as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useToggleShelfHidden as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useReorderShelves as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useCreateTag as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useRenameTag as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useDeleteTag as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  ;(libraryHooks.useToggleTagPin as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useToggleTagHidden as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useUpdateLibraryCategory as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useDeleteLibraryCategory as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  ;(libraryHooks.useUpdateLibraryTag as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useDeleteLibraryTag as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  ;(libraryHooks.useUpdateLibrary as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  // Nothing hidden by default; the hide/show tests override this.
  ;(libraryHooks.useHiddenLibraries as ReturnType<typeof vi.fn>).mockReturnValue({
    hiddenIds: [],
    isHidden: () => false,
    setHidden: vi.fn(),
  })
  ;(libraryHooks.useLibraryPrefs as ReturnType<typeof vi.fn>).mockReturnValue(undefined)
  // Inert library context: these tests are about the private library, and the
  // sidebar still calls the shared-library hooks on every render.
  mockLibraryHooks()
}

/**
 * The sidebar shows one taxonomy, read from whichever library is in context:
 * a private one lists shelves and tags, a shared one lists its categories and
 * tags. Only the endpoint changes, so these tests cover both through the same
 * row assertions.
 */
function mockLibraryHooks({
  categories = [],
  tags = [],
  relation = 'owner',
  uncategorizedTotal = 0,
  trashTotal = 0,
}: {
  categories?: ShelfItemData[]
  tags?: TagItemData[]
  relation?: string
  uncategorizedTotal?: number
  trashTotal?: number
} = {}) {
  ;(libraryHooks.useLibraryCategories as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: categories },
    isLoading: false,
  })
  ;(libraryHooks.useLibraryTags as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: tags },
    isLoading: false,
  })
  ;(libraryHooks.useLibraryRelation as ReturnType<typeof vi.fn>).mockReturnValue({
    data: { data: { relation } },
  })
  ;(libraryHooks.useLibraryCatalog as ReturnType<typeof vi.fn>).mockImplementation(
    (_libraryId: unknown, params?: { trash?: boolean }) => ({
      data: { data: { items: [], total: params?.trash ? trashTotal : uncategorizedTotal } },
      isLoading: false,
    }),
  )
  // The name dialogs mount with the sidebar (closed), so their mutations are
  // called on every render even in a private-library test.
  ;(libraryHooks.useCreateLibraryCategory as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
  ;(libraryHooks.useCreateLibraryTag as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: vi.fn(), isPending: false })
}

function openLibrarySwitcher() {
  fireEvent.click(screen.getByRole('button', { name: '切换书库' }))
}

function showTagsPanel() {
  fireEvent.click(screen.getByText('标签'))
}

describe('LibrarySidebar', () => {
  it('shows panel tabs with an empty hint to read-only guests', () => {
    mockHooks({ uncategorizedTotal: 0 })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} readOnly />)

    expect(screen.getByText('书架')).toBeInTheDocument()
    expect(screen.getByText('标签')).toBeInTheDocument()
    expect(screen.getByText('暂无书架')).toBeInTheDocument()
  })

  it('shows populated shelf and tag groups for read-only guests', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: '公开分类', bookCount: 1 }], tags: [{ id: 'tag-1', name: '公开标签', bookCount: 1 }] })

    render(<LibrarySidebar sessionKey="guest-populated" navSearch={navSearch} shelfId={null} tagId={null} trash={false} readOnly />)

    expect(screen.getByText('书架')).toBeInTheDocument()
    expect(screen.getByText('公开分类')).toBeInTheDocument()
    showTagsPanel()
    expect(screen.getByText('公开标签')).toBeInTheDocument()
  })

  it('renders shelves and trash entry', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }] })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)

    expect(screen.getByText('Favorites')).toBeInTheDocument()
    expect(screen.getByText('回收站')).toBeInTheDocument()
  })

  it('badges hidden shelves and tags instead of dimming them', () => {
    mockHooks({
      shelves: [{ id: 'shelf-1', name: 'Vault', bookCount: 2, hidden: true }],
      tags: [{ id: 'tag-1', name: 'Secret', bookCount: 1, hidden: true }],
    })

    render(<LibrarySidebar sessionKey="hidden-badges" navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)

    expect(screen.getByText('Vault')).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: '作品已隐藏' })).toHaveLength(1)
    showTagsPanel()
    expect(screen.getByText('Secret')).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: '作品已隐藏' })).toHaveLength(1)
  })

  it('keeps a zero-count pill so the badge column never shifts', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Empty', bookCount: 0 }] })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)

    expect(screen.getByText('Empty')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
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
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }] })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    fireEvent.click(screen.getByText('未分类'))
    expect(navSearch).toHaveBeenCalledWith({ shelf: 'none', tag: undefined, status: undefined, trash: undefined })
    expect(screen.queryByText('暂无书架')).toBeNull()
  })

  it('shows the empty-shelf hint alongside the uncategorized entry when bare', () => {

    mockHooks({ uncategorizedTotal: 0 })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)

    expect(screen.getByText('暂无书架')).toBeInTheDocument()
    expect(screen.getByText('未分类')).toBeInTheDocument()
  })

  it('shows the empty-category hint for a shared library without categories', () => {
    mockHooks()
    mockLibraryHooks({ relation: 'owner', uncategorizedTotal: 0 })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} activeLibraryId="lib-1" />)

    expect(screen.getByText('分类')).toBeInTheDocument()
    expect(screen.getByText('暂无分类')).toBeInTheDocument()
    expect(screen.getByText('未分类')).toBeInTheDocument()
  })

  it('keeps the uncategorized row for read-only readers when categories are empty', () => {
    mockHooks()
    mockLibraryHooks({ relation: 'member', uncategorizedTotal: 3 })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} readOnly activeLibraryId="lib-1" />)

    expect(screen.getByText('分类')).toBeInTheDocument()
    expect(screen.getByText('未分类')).toBeInTheDocument()
    expect(screen.getByText('暂无分类')).toBeInTheDocument()
  })

  it('offers no create entry: creating moved to the settings library list', () => {
    mockHooks()
    const memberLibraries: LibraryListItem[] = [{
      id: 'lib-1', type: 'shared', ownerUserId: 'u9', name: 'Club', description: '',
      visibility: 'public', createdAt: 1, updatedAt: 2, relation: 'member',
    }]

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} libraries={memberLibraries} />)
    openLibrarySwitcher()

    expect(screen.getByText('Club')).toBeInTheDocument()
    expect(screen.queryByText('新建书库')).toBeNull()
  })

  it('lists only joined libraries, never discoverable strangers', () => {
    mockHooks()
    const mixedLibraries: LibraryListItem[] = [
      {
        id: 'lib-1', type: 'shared', ownerUserId: 'u9', name: 'Club', description: '',
        visibility: 'public', createdAt: 1, updatedAt: 2, relation: 'member',
      },
      {
        id: 'lib-2', type: 'shared', ownerUserId: 'u9', name: 'Strangers', description: '',
        visibility: 'public', createdAt: 1, updatedAt: 2, relation: 'non-member',
      },
    ]

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} libraries={mixedLibraries} />)
    openLibrarySwitcher()

    expect(screen.getByText('Club')).toBeInTheDocument()
    expect(screen.queryByText('Strangers')).toBeNull()
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

  it('places uncategorized in the top navigation before the shelves list', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }] })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    const allBooks = screen.getByText('全部书籍')
    const uncategorized = screen.getByText('未分类')
    const firstShelf = screen.getByText('Favorites')
    expect(allBooks.compareDocumentPosition(uncategorized) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(uncategorized.compareDocumentPosition(firstShelf) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the uncategorized entry visible even when empty', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }], uncategorizedTotal: 0 })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)

    expect(screen.getByText('未分类')).toBeInTheDocument()
  })

  it('keeps an empty uncategorized entry visible when it is selected', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }], uncategorizedTotal: 0 })

    render(<LibrarySidebar navSearch={navSearch} shelfId="none" tagId={null} trash={false} />)

    expect(screen.getByText('未分类')).toBeInTheDocument()
  })

  it('shows a skeleton while taxonomy loads', () => {
    mockHooks()
    ;(libraryHooks.useShelves as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
    })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)

    expect(screen.getByText('书架')).toBeInTheDocument()
    expect(document.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.queryByText('Favorites')).toBeNull()
  })

  it('enters trash view when trash is clicked', () => {
    mockHooks()

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    fireEvent.click(screen.getByText('回收站'))
    expect(navSearch).toHaveBeenCalledWith({ trash: true, shelf: undefined, tag: undefined, status: undefined })
  })

  it('hides the trash entry when the trash feature is disabled', () => {
    mockHooks({ trashEnabled: false })

    render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    expect(screen.queryByText('回收站')).toBeNull()
  })

  it('opens the tag context menu with edit and delete actions', () => {
    mockHooks({ tags: [{ id: 'tag-1', name: '小说', bookCount: 3 }] })

    render(<LibrarySidebar sessionKey="tag-menu" navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    showTagsPanel()
    fireEvent.click(screen.getAllByLabelText('更多操作')[0])

    expect(screen.getByText('编辑')).toBeInTheDocument()
    expect(screen.getByText('删除')).toBeInTheDocument()
    expect(screen.getByText('3', { exact: true })).toHaveClass('group-hover:opacity-0')
  })

  it('toggles a tag pin from the context menu', () => {
    const mutate = vi.fn()
    mockHooks({ tags: [{ id: 'tag-1', name: '小说', bookCount: 3 }] })
    ;(libraryHooks.useToggleTagPin as ReturnType<typeof vi.fn>).mockReturnValue({ mutate, isPending: false })

    render(<LibrarySidebar sessionKey="tag-pin" navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    showTagsPanel()
    fireEvent.click(screen.getAllByLabelText('更多操作')[0])
    fireEvent.click(screen.getByText('置顶'))

    expect(mutate).toHaveBeenCalledWith({ id: 'tag-1', pinned: true })
  })

  it('shows the unpin action for a pinned tag', () => {
    mockHooks({ tags: [{ id: 'tag-1', name: '小说', bookCount: 3, pinned: true }] })

    render(<LibrarySidebar sessionKey="tag-unpin" navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    showTagsPanel()
    fireEvent.click(screen.getAllByLabelText('更多操作')[0])

    expect(screen.getByText('取消置顶')).toBeInTheDocument()
  })

  it('confirms before deleting a tag and calls the delete mutation', () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    mockHooks({ tags: [{ id: 'tag-1', name: '小说', bookCount: 3 }] })
    ;(libraryHooks.useDeleteTag as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync, isPending: false })

    render(<LibrarySidebar sessionKey="tag-delete" navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    showTagsPanel()
    fireEvent.click(screen.getAllByLabelText('更多操作')[0])
    fireEvent.click(screen.getByText('删除'))

    expect(screen.getByText('删除标签')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '删除' }).at(-1)!)
    expect(mutateAsync).toHaveBeenCalledWith('tag-1')
  })

  it('opens the new tag dialog from the tags panel button', () => {
    mockHooks()

    render(<LibrarySidebar sessionKey="tag-new" navSearch={navSearch} shelfId={null} tagId={null} trash={false} />)
    showTagsPanel()
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

  it('highlights the selected shelf row and keeps a static count pill', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 5 }] })

    render(<LibrarySidebar navSearch={navSearch} shelfId="shelf-1" tagId={null} trash={false} />)

    const button = screen.getByText('Favorites').closest('button')!
    expect(button).toHaveClass('bg-white', 'shadow-sm')

    const badge = screen.getByText('5')
    expect(badge).toHaveClass('rounded-full')
    expect(badge).toHaveTextContent('5')
  })

  it('names the active library in the switcher and highlights its row', () => {
    mockHooks({ shelves: [{ id: 'shelf-1', name: 'Favorites', bookCount: 5 }] })

    const { rerender } = render(
      <LibrarySidebar
        navSearch={navSearch}
        shelfId={null}
        tagId={null}
        trash={false}
        libraries={[
          { id: 'p1', type: 'private', ownerUserId: 'u1', name: 'My Library', description: '', visibility: null, createdAt: 1, updatedAt: 1, relation: 'owner', memberCount: 1, workCount: 5, ownerUsername: 'u1' },
          { id: 'lib-1', type: 'shared', ownerUserId: 'u1', name: 'Club', description: '', visibility: 'public', createdAt: 2, updatedAt: 2, relation: 'owner', memberCount: 2, workCount: 3, ownerUsername: 'u1' },
        ]}
      />,
    )

    // No filter: the switcher names the library in context.
    expect(screen.getByRole('button', { name: '切换书库' })).toHaveTextContent('My Library')
    openLibrarySwitcher()
    const myLibBtn = screen.getAllByText('My Library')[1].closest('button')!
    expect(myLibBtn).toHaveClass('bg-stone-100/80', 'font-semibold')

    // Filter active: shelf selected
    rerender(
      <LibrarySidebar
        navSearch={navSearch}
        shelfId="shelf-1"
        tagId={null}
        trash={false}
        libraries={[
          { id: 'p1', type: 'private', ownerUserId: 'u1', name: 'My Library', description: '', visibility: null, createdAt: 1, updatedAt: 1, relation: 'owner', memberCount: 1, workCount: 5, ownerUsername: 'u1' },
          { id: 'lib-1', type: 'shared', ownerUserId: 'u1', name: 'Club', description: '', visibility: null, createdAt: 2, updatedAt: 2, relation: 'owner', memberCount: 2, workCount: 3, ownerUsername: 'u1' },
        ]}
      />,
    )

    // Filter active: the shelf row becomes the highlighted focus
    const shelfBtn = screen.getByText('Favorites').closest('button')!
    expect(shelfBtn).toHaveClass('bg-white', 'shadow-sm')
  })

  // 0.4.0: a shared library is not a second sidebar. The rows below the library
  // switcher are the same rows, reading the library in context.
  describe('shared library context', () => {
    it('lists the library categories under a 分类 heading instead of the private shelves', () => {
      mockHooks({ shelves: [{ id: 'shelf-1', name: 'PrivateShelf', bookCount: 2 }] })
      mockLibraryHooks({ categories: [{ id: 'cat-1', name: 'Sci-Fi', bookCount: 4 }] })

      render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} activeLibraryId="lib-1" />)

      expect(screen.getByText('分类')).toBeInTheDocument()
      expect(screen.queryByText('书架')).toBeNull()
      expect(screen.getByText('Sci-Fi')).toBeInTheDocument()
      // The private shelf must not leak into another library's taxonomy.
      expect(screen.queryByText('PrivateShelf')).toBeNull()
    })

    it('filters a shared library by one of its categories through the same navigation', () => {
      mockHooks()
      mockLibraryHooks({ categories: [{ id: 'cat-1', name: 'Sci-Fi', bookCount: 4 }] })

      render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} activeLibraryId="lib-1" />)
      fireEvent.click(screen.getByText('Sci-Fi'))

      expect(navSearch).toHaveBeenCalledWith({ shelf: 'cat-1', categoryScope: 'subtree', trash: undefined, directory: undefined })
    })

    it('offers the uncategorized entry for works filed under no category', () => {
      mockHooks({ uncategorizedTotal: 0 })
      mockLibraryHooks({ uncategorizedTotal: 7 })

      render(<LibrarySidebar navSearch={navSearch} shelfId="none" tagId={null} trash={false} activeLibraryId="lib-1" />)

      expect(screen.getByText('未分类')).toBeInTheDocument()
      expect(screen.getAllByText('7')).toHaveLength(2)
    })

    it('lets an owner curate the taxonomy but not a plain member', () => {
      mockHooks()
      mockLibraryHooks({ categories: [{ id: 'cat-1', name: 'Sci-Fi', bookCount: 4 }], memberCount: 3, workCount: 7, ownerUsername: 'u2', relation: 'member' })

      const { unmount } = render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} activeLibraryId="lib-1" />)
      expect(screen.queryByTitle('新建分类')).toBeNull()
      expect(screen.getByText('Sci-Fi')).toBeInTheDocument()
      unmount()

      mockHooks()
      mockLibraryHooks({ categories: [{ id: 'cat-1', name: 'Sci-Fi', bookCount: 4 }], memberCount: 3, workCount: 7, ownerUsername: 'u2', relation: 'owner' })
      render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} activeLibraryId="lib-1" />)
      expect(screen.getByTitle('新建分类')).toBeInTheDocument()
    })

    it('renames a category through the shared-library endpoint', () => {
      mockHooks()
      mockLibraryHooks({ categories: [{ id: 'cat-1', name: 'Sci-Fi', bookCount: 4 }] })
      const mutate = vi.fn()
      ;(libraryHooks.useUpdateLibraryCategory as ReturnType<typeof vi.fn>).mockReturnValue({ mutate, isPending: false })

      render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} activeLibraryId="lib-1" />)
      fireEvent.click(screen.getAllByLabelText('更多操作')[0])
      fireEvent.click(screen.getByText('编辑'))
      fireEvent.change(screen.getByPlaceholderText('分类名称'), { target: { value: '科幻' } })
      fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0])

      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({ libraryId: 'lib-1', categoryId: 'cat-1', patch: { name: '科幻', parentId: null } }),
        expect.anything(),
      )
    })

    it('creates a category through the shared-library endpoint', () => {
      mockHooks()
      mockLibraryHooks({ categories: [{ id: 'cat-1', name: 'Sci-Fi', bookCount: 4 }] })
      const createCategory = vi.fn()
      ;(libraryHooks.useCreateLibraryCategory as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: createCategory, isPending: false })

      render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} activeLibraryId="lib-1" />)
      fireEvent.click(screen.getByTitle('新建分类'))
      // Names are trimmed before they are sent.
      fireEvent.change(screen.getByPlaceholderText('分类名称'), { target: { value: '  Poetry  ' } })
      fireEvent.click(screen.getAllByRole('button', { name: '创建' })[0])

      expect(createCategory).toHaveBeenCalledWith({ libraryId: 'lib-1', name: 'Poetry' }, expect.anything())
    })

    it('creates a tag through the shared-library endpoint', () => {
      mockHooks()
      mockLibraryHooks({ tags: [{ id: 'tag-1', name: 'Award', bookCount: 2 }] })
      const createTag = vi.fn()
      ;(libraryHooks.useCreateLibraryTag as ReturnType<typeof vi.fn>).mockReturnValue({ mutate: createTag, isPending: false })

      render(<LibrarySidebar sessionKey="shared-new-tag" navSearch={navSearch} shelfId={null} tagId={null} trash={false} activeLibraryId="lib-1" />)
      showTagsPanel()
      fireEvent.click(screen.getByTitle('新建标签'))
      fireEvent.change(screen.getByPlaceholderText('标签名称'), { target: { value: '  Prize  ' } })
      fireEvent.click(screen.getAllByRole('button', { name: '创建' })[0])

      expect(createTag).toHaveBeenCalledWith({ libraryId: 'lib-1', name: 'Prize' }, expect.anything())
    })

    it('says what happens to the works filed under a deleted category', async () => {
      mockHooks()
      mockLibraryHooks({ categories: [{ id: 'cat-1', name: 'Sci-Fi', bookCount: 4 }] })
      const mutateAsync = vi.fn().mockResolvedValue({})
      ;(libraryHooks.useDeleteLibraryCategory as ReturnType<typeof vi.fn>).mockReturnValue({ mutateAsync, isPending: false })

      render(<LibrarySidebar navSearch={navSearch} shelfId="cat-1" tagId={null} trash={false} activeLibraryId="lib-1" />)
      fireEvent.click(screen.getAllByLabelText('更多操作')[0])
      fireEvent.click(screen.getByText('删除'))

      expect(screen.getByText(/移至未分类/)).toBeInTheDocument()
      fireEvent.click(screen.getAllByRole('button', { name: '删除' }).at(-1)!)
      expect(mutateAsync).toHaveBeenCalledWith({ libraryId: 'lib-1', categoryId: 'cat-1' })
      // Deleting the category being viewed is a dead end, so leave the filter.
      await waitFor(() => expect(navSearch).toHaveBeenCalledWith({ shelf: undefined, categoryScope: undefined, directory: undefined }))
    })

    it('shows the trash to a shared-library owner but hides it from members', () => {
      mockHooks({ trashEnabled: true })
      mockLibraryHooks({ categories: [{ id: 'cat-1', name: 'Sci-Fi', bookCount: 1 }], relation: 'owner', trashTotal: 3 })

      const { unmount } = render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} activeLibraryId="lib-1" />)
      expect(screen.getByText('回收站')).toBeInTheDocument()
      unmount()

      mockLibraryHooks({ categories: [{ id: 'cat-1', name: 'Sci-Fi', bookCount: 1 }], relation: 'member', trashTotal: 3 })
      render(<LibrarySidebar navSearch={navSearch} shelfId={null} tagId={null} trash={false} activeLibraryId="lib-1" />)
      expect(screen.queryByText('回收站')).toBeNull()
    })

    it('leaves a shared library in one navigation so the private row can get back', () => {
      mockHooks()
      const onSelectLibrary = vi.fn()
      render(
        <LibrarySidebar
          navSearch={navSearch}
          shelfId={null}
          tagId={null}
          trash={false}
          libraries={[
            { id: 'p1', type: 'private', ownerUserId: 'u1', name: '个人书库', description: '', visibility: null, createdAt: 1, updatedAt: 1, memberCount: 3, workCount: 7, ownerUsername: 'u2', relation: 'owner' },
            { id: 'lib-1', type: 'shared', ownerUserId: 'u2', name: 'City', description: '', visibility: 'public', createdAt: 1, updatedAt: 1, memberCount: 3, workCount: 7, ownerUsername: 'u2', relation: 'owner' },
          ]}
          activeLibraryId="lib-1"
          onSelectLibrary={onSelectLibrary}
        />,
      )

      openLibrarySwitcher()
      fireEvent.click(screen.getByText('个人书库'))
      expect(onSelectLibrary).toHaveBeenCalledTimes(1)
      expect(onSelectLibrary).toHaveBeenCalledWith(null)
    })

    it('renames the private library from its sidebar menu', () => {
      mockHooks()
      const mutate = vi.fn()
      ;(libraryHooks.useUpdateLibrary as ReturnType<typeof vi.fn>).mockReturnValue({ mutate, isPending: false })
      render(
        <LibrarySidebar
          navSearch={navSearch}
          shelfId={null}
          tagId={null}
          trash={false}
          libraries={[
            { id: 'p1', type: 'private', ownerUserId: 'u1', name: 'My books', description: '', visibility: null, createdAt: 1, updatedAt: 1, memberCount: 3, workCount: 7, ownerUsername: 'u2', relation: 'owner' },
          ]}
          onExploreLibraries={vi.fn()}
        />,
      )

      expect(screen.getByText('My books')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '切换书库' }))
      fireEvent.click(screen.getAllByLabelText('更多操作')[0])
      fireEvent.click(screen.getByText('改名'))
      const input = screen.getByPlaceholderText('名称')
      fireEvent.change(input, { target: { value: '  小说角落  ' } })
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
      expect(mutate).toHaveBeenCalledWith(
        { libraryId: 'p1', patch: { name: '小说角落' } },
        expect.anything(),
      )
    })

    it('opens a details panel from the row menu with the library facts', () => {
      mockHooks()
      render(
        <LibrarySidebar
          navSearch={navSearch}
          shelfId={null}
          tagId={null}
          trash={false}
          libraries={[{
            id: 'lib-1', type: 'shared', ownerUserId: 'u2', name: 'City', description: 'Shared city books',
            visibility: 'public', createdAt: 1758000000000, updatedAt: 1, relation: 'owner',
            memberCount: 12, workCount: 34, ownerUsername: 'alice',
          }]}
          onExploreLibraries={vi.fn()}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: '切换书库' }))
      fireEvent.click(screen.getAllByLabelText('更多操作')[0])
      fireEvent.click(screen.getByText('详情'))

      // The sidebar row stays a switching surface; the numbers live here.
      const panel = within(screen.getByRole('dialog'))
      expect(panel.getByText('书库详情')).toBeInTheDocument()
      expect(panel.getByText('City')).toBeInTheDocument()
      expect(panel.getByText('Shared city books')).toBeInTheDocument()
      expect(panel.getByText('alice')).toBeInTheDocument()
      expect(panel.getByText('12')).toBeInTheDocument()
      expect(panel.getByText('34')).toBeInTheDocument()
      expect(panel.getByText('创建于')).toBeInTheDocument()
      expect(panel.getByText(formatDate(1758000000000))).toBeInTheDocument()
    })

    it('keeps the personal library visible and offers no hide action for it', () => {
      mockHooks()
      const setHidden = vi.fn()
      ;(libraryHooks.useHiddenLibraries as ReturnType<typeof vi.fn>).mockReturnValue({
        // A stale preference from before the personal library became un-hideable.
        hiddenIds: ['p1'],
        isHidden: (id: string) => id === 'p1',
        setHidden,
      })

      const view = () => (
        <LibrarySidebar
          navSearch={navSearch}
          shelfId={null}
          tagId={null}
          trash={false}
          libraries={[
            { id: 'p1', type: 'private', ownerUserId: 'u1', name: 'My books', description: '', visibility: null, createdAt: 1, updatedAt: 1, relation: 'owner', memberCount: 1, workCount: 3, ownerUsername: 'u1' },
          ]}
          onExploreLibraries={vi.fn()}
        />
      )

      const { rerender } = render(view())
      // The personal library is the way back to your own books, so a stale id
      // in the settings blob cannot take it off the sidebar. It also has no
      // roster or owner to report, so its menu stops at renaming.
      expect(document.querySelector('aside')?.textContent).toContain('My books')
      openLibrarySwitcher()
      fireEvent.click(screen.getAllByLabelText('更多操作')[0])
      expect(screen.queryByText('隐藏')).toBeNull()
      expect(screen.queryByText('显示')).toBeNull()
      expect(screen.queryByText('详情')).toBeNull()
      expect(screen.getByText('改名')).toBeInTheDocument()
      expect(setHidden).not.toHaveBeenCalled()
      rerender(view())
      expect(document.querySelector('aside')?.textContent).toContain('My books')
    })

    it('makes joined shared rows draggable, and leaves the personal one alone', () => {
      mockHooks()
      render(
        <LibrarySidebar
          navSearch={navSearch}
          shelfId={null}
          tagId={null}
          trash={false}
          libraries={[
            { id: 'p1', type: 'private', ownerUserId: 'u1', name: 'My books', description: '', visibility: null, createdAt: 1, updatedAt: 1, relation: 'owner', memberCount: 1, workCount: 3, ownerUsername: 'u1' },
            { id: 'lib-1', type: 'shared', ownerUserId: 'u1', name: 'Secret', description: '', visibility: 'private', createdAt: 2, updatedAt: 2, relation: 'owner', memberCount: 1, workCount: 1, ownerUsername: 'u1' },
            { id: 'lib-2', type: 'shared', ownerUserId: 'u1', name: 'Open', description: '', visibility: 'public', createdAt: 3, updatedAt: 3, relation: 'owner', memberCount: 1, workCount: 1, ownerUsername: 'u1' },
          ]}
          onExploreLibraries={vi.fn()}
        />,
      )

      // dnd-kit's attributes and pointer listeners have to reach the real
      // element. NavItem renders its own button instead of spreading unknown
      // props, so a row that drops them looks draggable and silently is not —
      // which is exactly how this shipped broken once already.
      openLibrarySwitcher()
      const byLabel = new Map(
        screen.getAllByRole('button', { name: /Secret|Open|My books/ }).map((row) => [row.textContent, row]),
      )
      expect(byLabel.get('Secret')).toHaveAttribute('aria-roledescription', 'sortable')
      expect(byLabel.get('Open')).toHaveAttribute('aria-roledescription', 'sortable')
      // The personal library is pinned to the top by design and never drags.
      expect(byLabel.get('My books')).not.toHaveAttribute('aria-roledescription')
    })

    it('renders shared libraries in the reader manual order, not the server order', () => {
      mockHooks()
      ;(libraryHooks.useLibraryPrefs as ReturnType<typeof vi.fn>).mockReturnValue({
        libraryOrder: ['lib-2', 'lib-1'],
      })

      render(
        <LibrarySidebar
          navSearch={navSearch}
          shelfId={null}
          tagId={null}
          trash={false}
          libraries={[
            { id: 'lib-1', type: 'shared', ownerUserId: 'u2', name: 'Alpha', description: '', visibility: 'public', createdAt: 1, updatedAt: 1, relation: 'owner', memberCount: 1, workCount: 1, ownerUsername: 'u2' },
            { id: 'lib-2', type: 'shared', ownerUserId: 'u2', name: 'Bravo', description: '', visibility: 'public', createdAt: 2, updatedAt: 2, relation: 'member', memberCount: 1, workCount: 1, ownerUsername: 'u2' },
          ]}
          onExploreLibraries={vi.fn()}
        />,
      )

      // The server answers in join order (Alpha first); the manual order wins.
      openLibrarySwitcher()
      const bravo = screen.getByRole('button', { name: 'Bravo' })
      const alpha = screen.getByRole('button', { name: 'Alpha' })
      expect(bravo.compareDocumentPosition(alpha) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('keeps a library the manual order omits at the bottom', () => {
      mockHooks()
      ;(libraryHooks.useLibraryPrefs as ReturnType<typeof vi.fn>).mockReturnValue({
        libraryOrder: ['lib-3'],
      })

      render(
        <LibrarySidebar
          navSearch={navSearch}
          shelfId={null}
          tagId={null}
          trash={false}
          libraries={[
            { id: 'lib-1', type: 'shared', ownerUserId: 'u2', name: 'Alpha', description: '', visibility: 'public', createdAt: 1, updatedAt: 1, relation: 'owner', memberCount: 1, workCount: 1, ownerUsername: 'u2' },
            { id: 'lib-2', type: 'shared', ownerUserId: 'u2', name: 'Bravo', description: '', visibility: 'public', createdAt: 2, updatedAt: 2, relation: 'member', memberCount: 1, workCount: 1, ownerUsername: 'u2' },
            { id: 'lib-3', type: 'shared', ownerUserId: 'u2', name: 'Charlie', description: '', visibility: 'public', createdAt: 3, updatedAt: 3, relation: 'member', memberCount: 1, workCount: 1, ownerUsername: 'u2' },
          ]}
          onExploreLibraries={vi.fn()}
        />,
      )

      // A library joined after the last drag has no place in the stored order
      // and keeps its base position at the end.
      openLibrarySwitcher()
      const charlie = screen.getByRole('button', { name: 'Charlie' })
      const alpha = screen.getByRole('button', { name: 'Alpha' })
      const bravo = screen.getByRole('button', { name: 'Bravo' })
      expect(charlie.compareDocumentPosition(alpha) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(alpha.compareDocumentPosition(bravo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('hides a joined shared library without touching the others', () => {
      mockHooks()
      let hiddenIds: string[] = []
      ;(libraryHooks.useHiddenLibraries as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        hiddenIds,
        isHidden: (id: string) => hiddenIds.includes(id),
        setHidden: (id: string, next: boolean) => {
          hiddenIds = next ? [...hiddenIds, id] : hiddenIds.filter((x) => x !== id)
        },
      }))

      const view = () => (
        <LibrarySidebar
          navSearch={navSearch}
          shelfId={null}
          tagId={null}
          trash={false}
          libraries={[
            { id: 'lib-1', type: 'shared', ownerUserId: 'u2', name: 'City', description: '', visibility: 'public', createdAt: 1, updatedAt: 1, memberCount: 3, workCount: 7, ownerUsername: 'u2', relation: 'owner' },
            { id: 'lib-2', type: 'shared', ownerUserId: 'u2', name: 'Book club', description: '', visibility: 'public', createdAt: 1, updatedAt: 1, memberCount: 3, workCount: 7, ownerUsername: 'u2', relation: 'member' },
          ]}
          onExploreLibraries={vi.fn()}
        />
      )

      const { rerender } = render(view())
      openLibrarySwitcher()
      const rows = screen.getAllByLabelText('更多操作')
      fireEvent.click(rows[0])
      fireEvent.click(screen.getByText('隐藏'))
      rerender(view())

      expect(screen.queryByText('City')).toBeNull()
      expect(screen.getByText('Book club')).toBeInTheDocument()
    })

    it('lists only joined libraries; unjoined public rows moved to future discovery', () => {
      mockHooks()
      const onJoinLibrary = vi.fn()
      const onManageLibrary = vi.fn()
      const row = (relation: string, name: string) => ({
        id: `lib-${name}`, type: 'shared' as const, ownerUserId: 'u2', name, description: '',
        visibility: 'public' as const, createdAt: 1, updatedAt: 1, relation,
      })
      render(
        <LibrarySidebar
          navSearch={navSearch}
          shelfId={null}
          tagId={null}
          trash={false}
          libraries={[row('non-member', 'Open'), row('owner', 'Mine')]}
          onJoinLibrary={onJoinLibrary}
          onManageLibrary={onManageLibrary}
        />,
      )

      // The unjoined library is not a switching row at all anymore.
      openLibrarySwitcher()
      expect(screen.queryByText('Open')).toBeNull()
      expect(screen.getByText('Mine')).toBeInTheDocument()
      fireEvent.click(screen.getAllByLabelText('更多操作')[0])
      expect(screen.queryByText('加入书库')).toBeNull()
      fireEvent.click(screen.getByText('管理'))
      expect(onManageLibrary).toHaveBeenCalledWith(expect.objectContaining({ id: 'lib-Mine' }))
    })

    it('shows a library row\'s identity even when it has nothing to act on', () => {
      mockHooks()
      render(
        <LibrarySidebar
          navSearch={navSearch}
          shelfId={null}
          tagId={null}
          trash={false}
          libraries={[
            { id: 'lib-x', type: 'shared', ownerUserId: 'u2', name: 'Closed', description: '', visibility: 'private', createdAt: 1, updatedAt: 1, memberCount: 3, workCount: 7, ownerUsername: 'u2', relation: 'member' },
          ]}
        />,
      )
      openLibrarySwitcher()
      fireEvent.click(screen.getAllByLabelText('更多操作')[0])
      expect(screen.getByText('私密')).toBeInTheDocument()
      expect(screen.queryByText('加入书库')).toBeNull()
      expect(screen.queryByText('管理')).toBeNull()
    })

    it('triggers onExploreLibraries when clicking explore button', () => {
      mockHooks()
      const onExploreLibraries = vi.fn()
      render(
        <LibrarySidebar
          navSearch={navSearch}
          shelfId={null}
          tagId={null}
          trash={false}
          libraries={[]}
          onExploreLibraries={onExploreLibraries}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: '切换书库' }))
      const exploreButton = screen.getByText('探索书库')
      fireEvent.click(exploreButton)
      expect(onExploreLibraries).toHaveBeenCalledTimes(1)
    })
  })
})


describe('arrowless category navigation', () => {
  const rows = [
    { id: 'parent', name: 'Parent', bookCount: 1, subtreeBookCount: 2, parentId: null, pinned: false, hidden: false },
    { id: 'child', name: 'Child', bookCount: 1, subtreeBookCount: 1, parentId: 'parent', pinned: false, hidden: false },
    { id: 'other', name: 'Other', bookCount: 0, subtreeBookCount: 0, parentId: null, pinned: false, hidden: false },
  ]

  it('opens the current root from its menu header without collapsing its children', () => {
    mockHooks()
    mockLibraryHooks({ categories: rows })
    const close = vi.fn()
    render(<LibrarySidebar sessionKey={`header-${Math.random()}`} navSearch={navSearch} shelfId="parent" tagId={null} trash={false} activeLibraryId="lib-1" onMobileClose={close} />)
    expect(screen.getByText('Child')).toBeInTheDocument()
    fireEvent.contextMenu(screen.getByText('Parent'))
    fireEvent.click(screen.getByRole('button', { name: /Parent 共 2 本/ }))
    expect(navSearch).toHaveBeenCalledWith({ shelf: 'parent', categoryScope: 'subtree', trash: undefined, directory: undefined })
    expect(screen.getByText('Child')).toBeInTheDocument()
    expect(close).toHaveBeenCalledOnce()
  })

  it('enters and expands a root then toggles the current root without navigating or closing the drawer', () => {
    mockHooks()
    mockLibraryHooks({ categories: rows })
    const close = vi.fn()
    const props = { sessionKey: `arrowless-${Math.random()}`, navSearch, shelfId: null as string | null, tagId: null, trash: false, activeLibraryId: 'lib-1', onMobileClose: close }
    const { rerender } = render(<LibrarySidebar {...props} />)
    expect(screen.queryByText('Child')).toBeNull()
    expect(screen.queryByText('↳')).toBeNull()
    fireEvent.click(screen.getByText('Parent'))
    expect(screen.getByText('Child')).toBeInTheDocument()
    expect(navSearch).toHaveBeenCalledWith({ shelf: 'parent', categoryScope: 'subtree', trash: undefined, directory: undefined })
    expect(close).toHaveBeenCalledOnce()
    rerender(<LibrarySidebar {...props} shelfId="parent" />)
    fireEvent.click(screen.getByText('Parent'))
    expect(screen.queryByText('Child')).toBeNull()
    expect(navSearch).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
    mockLibraryHooks({ categories: rows.map((row) => ({ ...row, bookCount: row.bookCount + 1 })) })
    rerender(<LibrarySidebar {...props} shelfId="parent" />)
    expect(screen.queryByText('Child')).toBeNull()
    fireEvent.click(screen.getByText('Parent'))
    expect(screen.getByText('Child')).toBeInTheDocument()
    expect(navSearch).toHaveBeenCalledOnce()
  })

  it('expands external child navigation without offering collapse or management in a read-only menu', () => {
    mockHooks()
    mockLibraryHooks({ categories: rows, relation: 'member' })
    const close = vi.fn()
    render(<LibrarySidebar sessionKey={`arrowless-${Math.random()}`} navSearch={navSearch} shelfId="child" tagId={null} trash={false} activeLibraryId="lib-1" onMobileClose={close} />)
    expect(screen.getByText('Child')).toBeInTheDocument()
    fireEvent.contextMenu(screen.getByText('Parent'))
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.queryByRole('button', { name: '收起' })).toBeNull()
    expect(screen.queryByRole('button', { name: '展开' })).toBeNull()
    expect(navSearch).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })
})
