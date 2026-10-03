import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { BookListItem, CatalogBook, Category, Library } from '@bookdock/shared'

import i18n from '../i18n/i18n'
import { useBookReplacements } from '@/api/hooks/useReplacements'
import { downloadBook, downloadEditedTxt, downloadEpub, downloadOriginalTxt } from '../features/library/download'
import BookDetailDialog from '../features/library/components/BookDetailDialog'
import DownloadDialogHost from '../features/library/components/DownloadDialogHost'
import { useDownloadStore } from '../stores/download.store'
import { useAuthStore } from '../stores/auth.store'
import { useToastStore } from '../stores/toast.store'
import { formatDate } from '../lib/utils'

const apiPatch = vi.fn()
const apiPut = vi.fn()
const apiDelete = vi.fn()
const apiUpload = vi.fn()
const createShelfMutate = vi.fn()
const createTagMutate = vi.fn()
const updateBookMutate = vi.fn()
const updateBookMutateAsync = vi.fn()
const uploadCoverMutate = vi.fn()
const removeCoverMutate = vi.fn()
const updateMembershipMutate = vi.fn()
const collectBookMutate = vi.fn()
const updateCatalogVersionMutate = vi.fn()
const uploadVersionCoverMutate = vi.fn()
const removeVersionCoverMutate = vi.fn()
const updateCatalogBookMutate = vi.fn()
const deleteCatalogVersionMutate = vi.fn()
const navigateMock = vi.fn()

vi.mock('@/api/client', async (original) => ({
  ...await original<typeof import('@/api/client')>(),
  apiGet: vi.fn().mockResolvedValue({ data: [] }),
  apiPatch: (...args: unknown[]) => apiPatch(...args),
  apiPut: (...args: unknown[]) => apiPut(...args),
  apiDelete: (...args: unknown[]) => apiDelete(...args),
  apiUpload: (...args: unknown[]) => apiUpload(...args),
}))

vi.mock('@/api/hooks/useReplacements', () => ({
  useBookReplacements: vi.fn(() => ({ data: { data: [] } })),
}))

vi.mock('../features/library/download', () => ({
  downloadBook: vi.fn(),
  downloadEditedTxt: vi.fn(),
  downloadEpub: vi.fn(),
  downloadOriginalTxt: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

let membershipShelf: string | null = null
let membershipTags: string[] = []
let bookDetail: { data: unknown } | undefined
let quickEditPending = false
let membershipUnavailable = false
let sharedCategories: Category[] = []
let categoriesPending = false
let categoriesError = false

vi.mock('../features/library/hooks', () => ({
  useBook: () => ({ data: bookDetail }),
  useBookMembership: () => ({
    shelves: membershipUnavailable ? { data: undefined, isError: true } : { data: { data: membershipShelf } },
    tags: { data: { data: membershipTags } },
  }),
  useShelves: () => ({ data: { data: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }] } }),
  useTags: () => ({ data: { data: [{ id: 'tag-1', name: '小说', bookCount: 1 }] } }),
  useCreateShelf: () => ({ mutateAsync: createShelfMutate, isPending: false }),
  useCreateTag: () => ({ mutateAsync: createTagMutate, isPending: false }),
  useUpdateBook: () => ({ mutate: updateBookMutate, mutateAsync: updateBookMutateAsync, isPending: quickEditPending }),
  useUpdateBookMembership: () => ({ mutate: updateMembershipMutate, isPending: quickEditPending }),
  useUploadCover: () => ({ mutate: uploadCoverMutate, mutateAsync: vi.fn(), isPending: quickEditPending }),
  useRemoveCover: () => ({ mutate: removeCoverMutate, isPending: quickEditPending }),
  useResetMetadata: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBookMetadataSource: () => ({ data: undefined, isFetching: false, isError: false, refetch: vi.fn() }),
  useCatalogVersionMetadataSource: () => ({ data: undefined, isFetching: false, isError: false, refetch: vi.fn() }),
  useCollectBook: () => ({ mutate: collectBookMutate, isPending: false }),
  useForkBook: () => ({ mutate: vi.fn(), isPending: false }),
  usePushVersion: () => ({ mutate: vi.fn(), isPending: false }),
  useVersionTocState: () => ({ data: undefined }),
  useUpdateCatalogVersion: () => ({ mutate: updateCatalogVersionMutate, mutateAsync: updateCatalogVersionMutate, isPending: quickEditPending }),
  useUpdateCatalogBook: () => ({ mutate: updateCatalogBookMutate, mutateAsync: updateCatalogBookMutate, isPending: false }),
  useLibraries: () => ({ data: undefined }),
  useLibraryCategories: () => ({ data: categoriesPending ? undefined : { data: sharedCategories }, isPending: categoriesPending, isError: categoriesError }),
  useLibraryTags: () => ({ data: { data: [] } }),
  useCreateLibraryCategory: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateLibraryTag: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadBooks: () => ({
    items: [], addFiles: vi.fn(), startUpload: vi.fn(), retry: vi.fn(), retryAll: vi.fn(),
    abortAll: vi.fn(), pruneSettled: vi.fn(), isUploading: false, clearQueue: vi.fn(), patchItem: vi.fn(),
  }),
  useUploadSettings: () => ({}),
  useUploadCatalogBookCover: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveCatalogBookCover: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadCatalogVersionCover: () => ({ mutate: uploadVersionCoverMutate, mutateAsync: vi.fn(), isPending: quickEditPending }),
  useRemoveCatalogVersionCover: () => ({ mutate: removeVersionCoverMutate, mutateAsync: vi.fn(), isPending: quickEditPending }),
  useResetCatalogVersionMetadata: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCatalogVersion: () => ({ mutate: deleteCatalogVersionMutate, mutateAsync: deleteCatalogVersionMutate, isPending: false }),
}))

const book: BookListItem = {
  id: 'book-1',
  title: 'Test Book',
  author: 'Author',
  authors: ['Author'],
  format: 'epub',
  coverKey: null,
  size: 100,
  readStatus: 'reading',
  progress: 0,
  createdAt: 1,
  updatedAt: 1,
}

const LONG_IDENTIFIER = 'urn:isbn:9787020002207-extra-long'

function withMeta(bookmeta: Record<string, unknown>) {
  bookDetail = { data: { ...book, meta: { bookmeta } } }
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}<DownloadDialogHost /></QueryClientProvider>
}

function renderDialog() {
  return render(<BookDetailDialog book={book} onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })
}

beforeEach(async () => {
  vi.clearAllMocks()
  useToastStore.getState().clearToasts()
  useDownloadStore.getState().close()
  useAuthStore.setState({ user: { id: "test-user", username: "owner", role: "owner" } })
  localStorage.removeItem("bd-download-choice:test-user")
  apiPatch.mockResolvedValue({})
  apiPut.mockResolvedValue({})
  apiDelete.mockResolvedValue({})
  apiUpload.mockResolvedValue({})
  updateBookMutateAsync.mockResolvedValue({ data: book })
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:cover-preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  createShelfMutate.mockResolvedValue({ data: { id: 'shelf-new', name: '科幻' } })
  vi.mocked(useBookReplacements).mockReturnValue({ data: { data: [] } } as ReturnType<typeof useBookReplacements>)
  createTagMutate.mockResolvedValue({ data: { id: 'tag-new' } })
  membershipShelf = null
  membershipTags = []
  bookDetail = undefined
  quickEditPending = false
  membershipUnavailable = false
  sharedCategories = []
  categoriesPending = false
  categoriesError = false
  await i18n.changeLanguage('zh-CN')
})

describe('BookDetailDialog shelf chips', () => {
  it('waits for every save request and retains a partial result in the form for retry', async () => {
    let finishShelf!: () => void
    apiPut.mockImplementationOnce(() => new Promise((resolve) => { finishShelf = () => resolve({}) }))
      .mockRejectedValueOnce(new TypeError('Network failed'))
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: '保存...' })).toBeDisabled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await act(async () => { finishShelf() })
    expect(screen.getByRole('alert')).toHaveTextContent('已保存 2 项，1 项未完成')
    expect(screen.getByDisplayValue('Test Book')).toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('keeps a complete save failure as an inline error without reporting partial success', async () => {
    apiPatch.mockRejectedValueOnce(new TypeError('Network failed'))
    apiPut.mockRejectedValueOnce(new TypeError('Network failed')).mockRejectedValueOnce(new TypeError('Network failed'))
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(String(i18n.t('errors.network'))))
    expect(screen.getByRole('alert')).not.toHaveTextContent('已保存')
    expect(screen.getByDisplayValue('Test Book')).toBeInTheDocument()
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('keeps personal status, source, shelf and tags together without update or collection notices', () => {
    membershipShelf = 'shelf-1'
    membershipTags = ['tag-1']
    bookDetail = { data: { ...book, kind: 'shared', ownsSource: true, hasUnreadUpdate: true, source: { libraryId: 'lib_city', libraryBookVersionId: 'lbv1', libraryName: 'City' } } }
    renderDialog()
    const row = screen.getByRole('button', { name: '在读' }).parentElement!.parentElement!
    expect(row.textContent).toBe('在读City📁Favorites#小说')
    expect(row).not.toContainElement(screen.getByText('有更新'))
    expect(row).not.toContainElement(screen.getByRole('button', { name: '已在书库中' }))
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { shelf: 'shelf-1' } })
  })

  it('saves a single shelf via chip selection', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/books/book-1/shelves', { shelfId: 'shelf-1' })
    })
  })

  it('keeps the clicked chip selected instead of toggling off', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const uncategorized = screen.getByRole('button', { name: '未分类' })
    expect(uncategorized).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(uncategorized)
    expect(uncategorized).toHaveAttribute('aria-pressed', 'true')
  })

  it('saves uncategorized as shelfId null', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }))
    fireEvent.click(screen.getByRole('button', { name: '未分类' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/books/book-1/shelves', { shelfId: null })
    })
  })
})

describe('BookDetailDialog tag chips', () => {
  it('selects a tag chip and saves it', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const tag = screen.getByRole('button', { name: '小说' })
    expect(tag).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(tag)
    expect(tag).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/books/book-1/tags', { tagIds: ['tag-1'] })
    })
  })

  it('creates a tag from the inline chip and auto-selects it', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '+ 新建标签' }))
    const input = screen.getByPlaceholderText('新标签名称')
    fireEvent.change(input, { target: { value: '科幻' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(createTagMutate).toHaveBeenCalledWith('科幻'))
    // the input collapses back to the new-tag chip after a successful create
    await waitFor(() => expect(screen.getByRole('button', { name: '+ 新建标签' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/books/book-1/tags', { tagIds: ['tag-new'] })
    })
  })

  it('cancels the inline tag input with Escape without creating', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '+ 新建标签' }))
    const input = screen.getByPlaceholderText('新标签名称')
    fireEvent.change(input, { target: { value: '科幻' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(createTagMutate).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('新标签名称')).toBeNull()
    expect(screen.getByRole('button', { name: '+ 新建标签' })).toBeInTheDocument()
  })

  it('cancels the inline tag input when clicking away', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '+ 新建标签' }))
    const input = screen.getByPlaceholderText('新标签名称')
    fireEvent.change(input, { target: { value: '科幻' } })
    fireEvent.mouseDown(document.body)

    expect(createTagMutate).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('新标签名称')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ 新建标签' }))
    expect(screen.getByPlaceholderText('新标签名称')).toHaveValue('')
  })
})

describe('BookDetailDialog shelf chips', () => {
  it('keeps personal status, source, shelf and tags together without update or collection notices', () => {
    membershipShelf = 'shelf-1'
    membershipTags = ['tag-1']
    bookDetail = { data: { ...book, kind: 'shared', ownsSource: true, hasUnreadUpdate: true, source: { libraryId: 'lib_city', libraryBookVersionId: 'lbv1', libraryName: 'City' } } }
    renderDialog()
    const row = screen.getByRole('button', { name: '在读' }).parentElement!.parentElement!
    expect(row.textContent).toBe('在读City📁Favorites#小说')
    expect(row).not.toContainElement(screen.getByText('有更新'))
    expect(row).not.toContainElement(screen.getByRole('button', { name: '已在书库中' }))
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { shelf: 'shelf-1' } })
  })

  it('creates a shelf from the inline chip and auto-selects it', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '+ 新建书架' }))
    const input = screen.getByPlaceholderText('新书架名称')
    fireEvent.change(input, { target: { value: '科幻' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(createShelfMutate).toHaveBeenCalledWith('科幻'))
    await waitFor(() => expect(screen.getByRole('button', { name: '+ 新建书架' })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith('/books/book-1/shelves', { shelfId: 'shelf-new' })
    })
  })

  it('cancels the inline shelf input when clicking away', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '+ 新建书架' }))
    const input = screen.getByPlaceholderText('新书架名称')
    fireEvent.change(input, { target: { value: '科幻' } })
    fireEvent.mouseDown(document.body)

    expect(createShelfMutate).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('新书架名称')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '+ 新建书架' }))
    expect(screen.getByPlaceholderText('新书架名称')).toHaveValue('')
  })
})

describe('BookDetailDialog cover draft', () => {
  it('previews a selected cover locally and uploads it only on save', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['cover'], 'cover.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:cover-preview'))
    expect(apiUpload).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(apiUpload).toHaveBeenCalledWith('/books/book-1/cover', file, 'PUT'))
  })

  it('discards a selected cover when editing is cancelled', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['cover'], 'cover.png', { type: 'image/png' })] } })
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument())

    const cancelButtons = screen.getAllByRole('button', { name: '取消' })
    fireEvent.click(cancelButtons[cancelButtons.length - 1])
    expect(apiUpload).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/v1/books/book-1/cover?v=auto')
  })

  it('defers cover removal until save', async () => {
    render(<BookDetailDialog book={{ ...book, coverKey: 'covers/book-1.jpg' }} onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '移除封面' }))
    expect(apiDelete).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/books/book-1/cover'))
  })

  it('shows cover copy and download buttons when a cover image exists', () => {
    render(<BookDetailDialog book={{ ...book, coverKey: 'covers/book-1.jpg' }} onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })

    expect(screen.getByRole('button', { name: '复制封面' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下载封面' })).toBeInTheDocument()
  })

  it('does not show cover copy and download buttons when no cover image exists', () => {
    render(<BookDetailDialog book={{ ...book, format: 'txt', coverKey: null }} onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })

    expect(screen.queryByRole('button', { name: '复制封面' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '下载封面' })).not.toBeInTheDocument()
  })
})

describe('BookDetailDialog cover palette', () => {
  it('pins a palette color from the popover and sends it on save', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '封面配色' }))
    const swatch = screen.getByRole('button', { name: 'Sage Green' })
    expect(swatch).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(swatch)

    expect(screen.getByRole('button', { name: 'Sage Green' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalled())
    const body = apiPatch.mock.calls[0][1] as { coverPaletteId?: string | null }
    expect(body.coverPaletteId).toBe('sage')
  })

  it('pre-selects the swatch pinned in detail meta', () => {
    bookDetail = { data: { ...book, meta: { coverPaletteId: 'amber' } } }
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '封面配色' }))

    expect(screen.getByRole('button', { name: 'Warm Amber' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('sends a null palette when nothing was picked', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(apiPatch).toHaveBeenCalled())
    const body = apiPatch.mock.calls[0][1] as { coverPaletteId?: string | null }
    expect(body.coverPaletteId).toBeNull()
  })

  it('hides the palette button while a real cover is shown', () => {
    render(<BookDetailDialog book={{ ...book, coverKey: 'covers/book-1.jpg' }} onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByRole('button', { name: '移除封面' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '封面配色' })).toBeNull()
  })
})

describe('BookDetailDialog identity chips', () => {
  it('navigates to the exact author filter from the author link', () => {
    const onClose = vi.fn()
    render(<BookDetailDialog book={book} onClose={onClose} onDelete={vi.fn()} />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'Author' }))

    expect(onClose).toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { author: 'Author' } })
  })

  it('renders one filter chip per author and filters by the clicked name', () => {
    const onClose = vi.fn()
    render(
      <BookDetailDialog
        book={{ ...book, authors: ['甲', '乙'], author: '甲' }}
        onClose={onClose}
        onDelete={vi.fn()}
      />,
      { wrapper },
    )

    fireEvent.click(screen.getByRole('button', { name: '乙' }))

    expect(onClose).toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { author: '乙' } })
  })

  it('toggles the private work hidden from its detail actions', async () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '书籍显示中，点击隐藏' }))

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith('/books/book-1', { hidden: true })
    })
  })

  it('navigates to the series filter from the series metadata link', () => {
    withMeta({ series: 'Trilogy', seriesIndex: 2 })
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'Trilogy #2' }))

    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { series: 'Trilogy' } })
  })

  it('renders format in specs and navigates to the shelf filter on shelf chip click', () => {
    membershipShelf = 'shelf-1'
    const onClose = vi.fn()
    render(<BookDetailDialog book={book} onClose={onClose} onDelete={vi.fn()} />, { wrapper })

    expect(screen.getByText('EPUB')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }))

    expect(onClose).toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { shelf: 'shelf-1' } })
  })

  it('filters unassigned books from the unassigned shelf chip', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '未分类' }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { shelf: 'none' } })
  })

  it('navigates to the tag filter on tag chip click', () => {
    membershipTags = ['tag-1']
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '小说' }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { tag: 'tag-1' } })
  })

  it('renders no tag chips when the book has no tags', () => {
    renderDialog()
    expect(screen.queryByRole('button', { name: '小说' })).toBeNull()
  })
})

describe('BookDetailDialog read-status chip', () => {
  it('filters the private library on status left click without saving', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: '在读' }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { status: 'reading' } })
    expect(updateBookMutate).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('right-clicks status, marks the current value and skips unchanged writes', () => {
    renderDialog()
    fireEvent.contextMenu(screen.getByRole('button', { name: '在读' }))
    const current = screen.getByRole('menuitemradio', { name: '在读' })
    expect(current).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(current)
    expect(updateBookMutate).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('closes only the menu on Escape and restores the field focus', () => {
    const onClose = vi.fn()
    render(<BookDetailDialog book={book} onClose={onClose} onDelete={vi.fn()} />, { wrapper })
    const trigger = screen.getByRole('button', { name: '在读' })
    fireEvent.contextMenu(trigger)
    fireEvent.keyDown(screen.getByRole('menuitemradio', { name: '在读' }), { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
  })

  it('supports keyboard navigation and touch dismissal', () => {
    renderDialog()
    fireEvent.contextMenu(screen.getByRole('button', { name: '在读' }))
    const current = screen.getByRole('menuitemradio', { name: '在读' })
    fireEvent.keyDown(current, { key: 'ArrowDown' })
    expect(screen.getByRole('menuitemradio', { name: '读完' })).toHaveFocus()
    fireEvent.pointerDown(document.body, { pointerType: 'touch' })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('blocks repeated edits while pending and retains the confirmed value', () => {
    quickEditPending = true
    renderDialog()
    expect(screen.queryByRole('button', { name: '修改阅读状态' })).toBeNull()
    fireEvent.contextMenu(screen.getByRole('button', { name: membershipUnavailable ? '书架信息暂不可用' : '未分类' }))
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.contextMenu(screen.getByRole('button', { name: '在读' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(updateBookMutate).not.toHaveBeenCalled()
  })

  it('does not offer edits in read-only or uncollected detail views', () => {
    const { rerender } = render(<BookDetailDialog book={book} readOnly onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })
    expect(screen.queryByRole('button', { name: '修改阅读状态' })).toBeNull()
    expect(screen.queryByRole('button', { name: '修改书架' })).toBeNull()
    fireEvent.contextMenu(screen.getByRole('button', { name: '在读' }))
    expect(screen.queryByRole('menu')).toBeNull()
    bookDetail = { data: { ...book, collected: false } }
    rerender(<BookDetailDialog book={book} onClose={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '修改阅读状态' })).toBeNull()
    expect(screen.queryByRole('button', { name: '修改书架' })).toBeNull()
  })

  it('edits only the private shelf and supports clearing its assignment', () => {
    membershipShelf = 'shelf-1'
    membershipTags = ['tag-1']
    renderDialog()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Favorites' }))
    expect(screen.getByRole('menuitemradio', { name: 'Favorites' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: '未分类' }))
    expect(updateMembershipMutate).toHaveBeenCalledWith({ bookId: 'book-1', shelfId: null })
    expect(navigateMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '小说' })).toBeInTheDocument()
  })

  it('disables shelf editing when membership is unavailable rather than claiming unassigned', () => {
    membershipUnavailable = true
    renderDialog()
    fireEvent.contextMenu(screen.getByRole('button', { name: membershipUnavailable ? '书架信息暂不可用' : '未分类' }))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByRole('button', { name: '未分类' })).toBeNull()
    expect(screen.getByRole('button', { name: '书架信息暂不可用' })).toBeInTheDocument()
  })

  it('renders the current status as the first identity chip', () => {
    renderDialog()

    const chip = screen.getByRole('button', { name: '在读' })
    const row = chip.parentElement!.parentElement!
    expect(row.firstElementChild).toBe(chip.parentElement)
  })

  it('opens the five-option menu and patches the selected status', () => {
    renderDialog()

    fireEvent.contextMenu(screen.getByRole('button', { name: '在读' }))
    for (const label of ['想读', '在读', '读完', '闲置', '弃读']) {
      expect(screen.getByRole('menuitemradio', { name: label })).toBeInTheDocument()
    }
    // current status carries a check mark; pick a different one
    fireEvent.click(screen.getByRole('menuitemradio', { name: '读完' }))

    expect(updateBookMutate).toHaveBeenCalledWith({ bookId: 'book-1', readStatus: 'finished' })
  })

  it('closes the menu on outside mousedown without changing the status', () => {
    renderDialog()

    fireEvent.contextMenu(screen.getByRole('button', { name: '在读' }), { clientX: 100, clientY: 100 })
    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('menuitemradio', { name: '读完' })).toBeNull()
    expect(updateBookMutate).not.toHaveBeenCalled()
  })
})

describe('BookDetailDialog metadata rows', () => {
  it('hides rows without values and keeps the always-known rows', () => {
    renderDialog()

    expect(screen.queryByText('出版商')).toBeNull()
    expect(screen.queryByText('出版日期')).toBeNull()
    expect(screen.queryByText('语言')).toBeNull()
    expect(screen.queryByText('主题')).toBeNull()
    expect(screen.queryByText('标识符')).toBeNull()
    expect(screen.queryByText('系列')).toBeNull()
    expect(screen.queryByText('更新日期')).toBeNull()
    expect(screen.queryByText('原始文件')).toBeNull()
    expect(screen.queryByText('字数')).toBeNull()

    expect(screen.getByText('添加时间')).toBeInTheDocument()
    expect(screen.getByText('格式')).toBeInTheDocument()
    expect(screen.getByText('大小')).toBeInTheDocument()
  })

  it('shows the word count row when the detail meta carries it', () => {
    bookDetail = { data: { ...book, meta: { bookmeta: {}, wordCount: 454385 } } }
    renderDialog()

    expect(screen.getByText('字数')).toBeInTheDocument()
    expect(screen.getByText('45.4万字')).toBeInTheDocument()
  })

  it('shows the original file name as a copyable row', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const LONG_FILE_NAME = '《韵母攻略》作者：流浪老师.txt'
    bookDetail = { data: { ...book, meta: { fileName: LONG_FILE_NAME } } }
    renderDialog()

    expect(screen.getByText('原始文件')).toBeInTheDocument()
    const button = screen.getByTitle('复制文件名')
    expect(button).toBeInTheDocument()
    expect(button.textContent).toBe(LONG_FILE_NAME)
    expect(button.closest('dl > div')?.className).toContain('sm:col-span-2')

    fireEvent.click(button)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LONG_FILE_NAME))
  })

  it('marks a card whose content grew since the reader last opened it', () => {
    // The pin already moved for everyone, so the notice is a plain mark rather
    // than an action: there is nothing to click, the next read picks it up.
    bookDetail = {
      data: {
        ...book,
        kind: 'shared',
        source: { libraryId: 'lib_city', libraryBookVersionId: 'lbv1', libraryName: 'City' },
        meta: { bookmeta: {} },
        hasUnreadUpdate: true,
      },
    }
    renderDialog()

    const mark = screen.getByText('有更新')
    expect(mark).toBeInTheDocument()
    expect(mark.closest('button')).toBeNull()
    expect(screen.queryByRole('button', { name: '更新' })).toBeNull()
  })

  it('shows no mark once the reader has caught up', () => {
    bookDetail = {
      data: {
        ...book,
        kind: 'shared',
        source: { libraryId: 'lib_city', libraryBookVersionId: 'lbv1', libraryName: 'City' },
        meta: { bookmeta: {} },
        hasUnreadUpdate: false,
      },
    }
    renderDialog()

    expect(screen.queryByText('有更新')).toBeNull()
  })

  it('shows owns-source exactly like a collected version in the book detail', () => {
    bookDetail = {
      data: {
        ...book,
        collected: false,
        source: { libraryId: 'lib_city', libraryBookVersionId: 'lbv1', libraryName: 'City' },
        meta: { bookmeta: {} },
        ownsSource: true,
      },
    }
    renderDialog()

    expect(screen.queryByRole('button', { name: '加入书库' })).toBeNull()
    const joined = screen.getByRole('button', { name: '已在书库中' })
    expect(joined).toBeInTheDocument()
    expect(joined).toBeDisabled()
  })

  it('keeps a text selection instead of hijacking it with the full value', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    bookDetail = { data: { ...book, meta: { fileName: 'my-old-book.txt' } } }
    renderDialog()

    const selection = window.getSelection()
    selection?.removeAllRanges()
    const range = document.createRange()
    range.selectNodeContents(screen.getByText('my-old-book.txt'))
    selection?.addRange(range)

    fireEvent.click(screen.getByTitle('复制文件名'))
    expect(writeText).not.toHaveBeenCalled()

    selection?.removeAllRanges()
  })

  it('shows the updated time only when the book changed after upload', () => {
    bookDetail = { data: { ...book, meta: { bookmeta: {} } } }
    const { unmount } = renderDialog()
    expect(screen.queryByText('更新日期')).toBeNull()
    unmount()

    bookDetail = { data: { ...book, updatedAt: 86400002, meta: { bookmeta: {} } } }
    renderDialog()
    expect(screen.getByText('更新日期')).toBeInTheDocument()
    expect(screen.getByText('1970-01-02')).toBeInTheDocument()
  })

  it('reveals the exact word count behind the compact display', () => {
    bookDetail = { data: { ...book, meta: { bookmeta: {}, wordCount: 454385 } } }
    renderDialog()

    expect(screen.getByText('45.4万字').closest('dd')).toHaveAttribute('title', '454,385 字')
  })

  it('expands a long file name in place', () => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>
    const hadScrollHeight = Object.prototype.hasOwnProperty.call(proto, 'scrollHeight')
    const hadClientHeight = Object.prototype.hasOwnProperty.call(proto, 'clientHeight')
    const savedScrollHeight = hadScrollHeight
      ? Object.getOwnPropertyDescriptor(proto, 'scrollHeight')
      : undefined
    const savedClientHeight = hadClientHeight
      ? Object.getOwnPropertyDescriptor(proto, 'clientHeight')
      : undefined
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, value: 100 })
    Object.defineProperty(proto, 'clientHeight', { configurable: true, value: 20 })
    try {
      const longName = `《${'很长'.repeat(30)}》未删减完整版01_32连载_本站首发_作品作者：某某某.txt`
      bookDetail = { data: { ...book, meta: { fileName: longName } } }
      renderDialog()

      const row = screen.getByText('原始文件').closest('div')!
      const toggle = within(row).getByTitle('展开')
      expect(toggle).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(toggle)
      expect(within(row).getByTitle('收起')).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText(longName)).toBeInTheDocument()
    } finally {
      if (hadScrollHeight && savedScrollHeight) Object.defineProperty(proto, 'scrollHeight', savedScrollHeight)
      else delete proto.scrollHeight
      if (hadClientHeight && savedClientHeight) Object.defineProperty(proto, 'clientHeight', savedClientHeight)
      else delete proto.clientHeight
    }
  })

  it('hides the expand chevron when the value fits on one line', () => {
    bookDetail = { data: { ...book, meta: { fileName: 'my-old-book.txt' } } }
    renderDialog()

    const row = screen.getByText('原始文件').closest('div')!
    expect(within(row).queryByTitle('展开')).toBeNull()
    expect(within(row).queryByTitle('收起')).toBeNull()
    expect(screen.getByText('my-old-book.txt')).toBeInTheDocument()
  })

  it('renders lastRead in reading progress area when lastReadAt is present', () => {
    render(
      <BookDetailDialog
        book={{ ...book, lastReadAt: Date.now() - 3600_000 }}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
      { wrapper },
    )

    expect(screen.getByText(/小时前/)).toBeInTheDocument()
  })

  it('shows 0% and an empty progress bar when reading has started without progress', () => {
    render(
      <BookDetailDialog
        book={{ ...book, lastReadAt: Date.now() - 3600_000 }}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
      { wrapper },
    )

    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '阅读进度' })).toHaveAttribute('aria-valuenow', '0')
  })

  it('renders localized simplified Chinese for zh-CN language', () => {
    withMeta({ language: 'zh-CN' })
    renderDialog()

    expect(screen.getByText('简体中文')).toBeInTheDocument()
  })

  it('renders rows with values and merges series name with its index', () => {
    withMeta({ publisher: 'Pub House', series: 'Trilogy', seriesIndex: 2, description: 'desc' })
    renderDialog()

    expect(screen.getByText('出版商')).toBeInTheDocument()
    expect(screen.getByText('Pub House')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trilogy #2' })).toBeInTheDocument()
    expect(screen.getByText('desc')).toBeInTheDocument()
  })
})

describe('BookDetailDialog header semantics', () => {
  it('renders 书籍详情 title and 关闭 button in view mode', () => {
    renderDialog()

    expect(screen.getByRole('heading', { name: '书籍详情' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument()
  })

  it('renders 编辑书籍 title in edit mode', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.getByRole('heading', { name: '编辑书籍' })).toBeInTheDocument()
  })
})

describe('BookDetailDialog description draft', () => {
  it('preserves leading whitespace when saving the description', async () => {
    withMeta({ description: '原简介' })
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const description = screen.getByRole('textbox', { name: '简介' })
    fireEvent.change(description, { target: { value: '  第一行\n第二行' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(apiPatch).toHaveBeenCalled())
    const body = apiPatch.mock.calls[0][1] as { bookmeta: { description?: string } }
    expect(body.bookmeta.description).toBe('  第一行\n第二行')
  })
})

describe('BookDetailDialog identifier', () => {
  it('copies the full identifier from the truncated metadata row', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    withMeta({ identifier: LONG_IDENTIFIER })
    renderDialog()

    const button = screen.getByTitle('点击复制')
    expect(button.textContent).toBe(LONG_IDENTIFIER)
    fireEvent.click(button)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LONG_IDENTIFIER))
  })

  it('is read-only in edit mode but preserved on save', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    withMeta({ identifier: LONG_IDENTIFIER, publisher: 'Pub' })
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.queryByDisplayValue(LONG_IDENTIFIER)).toBeNull()

    fireEvent.click(screen.getByTitle('点击复制'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LONG_IDENTIFIER))

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalled())
    const body = apiPatch.mock.calls[0][1] as { bookmeta: Record<string, unknown> }
    expect(body.bookmeta).toHaveProperty('identifier', LONG_IDENTIFIER)
  })
})

describe('BookDetailDialog direct metadata editing', () => {
  it('shows no shortcut edit icons and labels the description only in its dialog title', () => {
    withMeta({ description: 'Description' })
    renderDialog()
    expect(screen.queryByRole('button', { name: /^修改/ })).toBeNull()
    fireEvent.contextMenu(screen.getByText('Description'))
    const dialog = within(screen.getByRole('dialog', { name: '修改简介' }))
    expect(dialog.queryByText('简介')).toBeNull()
    expect(dialog.getByRole('textbox', { name: '简介' })).toHaveValue('Description')
  })

  it('edits the title directly without writing unrelated fields', async () => {
    renderDialog()
    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Test Book' }))
    const dialog = within(screen.getByRole('dialog', { name: '修改书名' }))
    fireEvent.change(dialog.getByRole('textbox', { name: '书名' }), { target: { value: ' New Title ' } })
    fireEvent.click(dialog.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateBookMutateAsync).toHaveBeenCalledWith({ bookId: 'book-1', title: 'New Title' }))
    expect(apiPut).not.toHaveBeenCalled()
  })

  it('edits all authors together while preserving left-click author filtering', async () => {
    renderDialog()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Author' }))
    const dialog = within(screen.getByRole('dialog', { name: '修改作者' }))
    fireEvent.change(dialog.getByRole('textbox', { name: '作者' }), { target: { value: 'Alice、Bob、Alice' } })
    fireEvent.click(dialog.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateBookMutateAsync).toHaveBeenCalledWith({ bookId: 'book-1', authors: ['Alice', 'Bob'], author: 'Alice' }))
    fireEvent.click(screen.getByRole('button', { name: 'Author' }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { author: 'Author' } })
  })

  it.each([
    ['publisher', '出版商', 'Old Publisher', 'New Publisher'],
    ['published', '出版日期', '2020', '2026-10'],
    ['language', '语言', 'en', 'zh-CN'],
    ['isbn', 'ISBN', '9781234567890', '9781234567891'],
  ])('edits %s and preserves unrelated metadata', async (field, label, oldValue, newValue) => {
    withMeta({ [field]: oldValue, identifier: 'source-id', rights: 'Copyright', subjects: ['Other'] })
    renderDialog()
    fireEvent.contextMenu(screen.getByText(label))
    const dialog = within(screen.getByRole('dialog', { name: `修改${label}` }))
    expect(dialog.getByRole('textbox', { name: label })).toHaveValue(oldValue)
    fireEvent.change(dialog.getByRole('textbox', { name: label }), { target: { value: newValue } })
    fireEvent.click(dialog.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateBookMutateAsync).toHaveBeenCalledWith({ bookId: 'book-1', bookmeta: { [field]: newValue, identifier: 'source-id', rights: 'Copyright', subjects: ['Other'] } }))
  })

  it('clears an optional field without clearing other metadata', async () => {
    withMeta({ publisher: 'Pub', isbn: '9781234567890' })
    renderDialog()
    fireEvent.contextMenu(screen.getByText('Pub'))
    fireEvent.change(screen.getByRole('textbox', { name: '出版商' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateBookMutateAsync).toHaveBeenCalledWith({ bookId: 'book-1', bookmeta: { isbn: '9781234567890' } }))
  })

  it('edits description and subjects with existing text parsing', async () => {
    withMeta({ description: 'Old description', subjects: ['Old'], language: 'en' })
    renderDialog()
    fireEvent.contextMenu(screen.getByText('Old description'))
    fireEvent.change(screen.getByRole('textbox', { name: '简介' }), { target: { value: '  First line\nSecond line' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateBookMutateAsync).toHaveBeenCalledWith({ bookId: 'book-1', bookmeta: { description: '  First line\nSecond line', subjects: ['Old'], language: 'en' } }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '修改简介' })).toBeNull())
    fireEvent.contextMenu(screen.getByText('主题'))
    fireEvent.change(screen.getByRole('textbox', { name: '主题' }), { target: { value: '科幻，冒险、小说' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateBookMutateAsync).toHaveBeenLastCalledWith({ bookId: 'book-1', bookmeta: { description: 'Old description', subjects: ['科幻', '冒险', '小说'], language: 'en' } }))
  })

  it('edits series with its numeric index and rejects malformed numbers', async () => {
    withMeta({ series: 'Trilogy', seriesIndex: 2, publisher: 'Pub' })
    renderDialog()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Trilogy #2' }))
    expect(screen.getByRole('textbox', { name: '系列' })).toHaveValue('Trilogy')
    fireEvent.change(screen.getByRole('textbox', { name: '系列编号' }), { target: { value: '3abc' } })
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '系列编号' }), { target: { value: '3.5' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateBookMutateAsync).toHaveBeenCalledWith({ bookId: 'book-1', bookmeta: { series: 'Trilogy', seriesIndex: 3.5, publisher: 'Pub' } }))
  })

  it('keeps failed edits available for retry and retains the displayed value', async () => {
    updateBookMutateAsync.mockRejectedValueOnce(new Error('Offline'))
    renderDialog()
    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Test Book' }))
    fireEvent.change(screen.getByRole('textbox', { name: '书名' }), { target: { value: 'Retry Title' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateBookMutateAsync).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('textbox', { name: '书名' })).toHaveValue('Retry Title')
    expect(screen.getByRole('heading', { name: 'Test Book' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '修改书名' })).toBeNull())
  })

  it('rejects an empty title and closes only the field dialog on Escape', () => {
    const onClose = vi.fn()
    render(<BookDetailDialog book={book} onClose={onClose} onDelete={vi.fn()} />, { wrapper })
    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Test Book' }))
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: '书名' }), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '修改书名' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers only card-local metadata edits on a collected shared version', () => {
    bookDetail = { data: { ...book, source: { libraryId: 'lib_city', libraryBookVersionId: 'lbv1', libraryName: 'City' }, meta: { bookmeta: { publisher: 'Pub', description: 'Description' } } } }
    renderDialog()
    fireEvent.contextMenu(screen.getByRole('heading', { name: 'Test Book' }))
    expect(screen.getByRole('dialog', { name: '修改书名' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '取消' }).at(-1)!)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Author' }))
    expect(screen.getByRole('dialog', { name: '修改作者' })).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: '取消' }).at(-1)!)
    expect(screen.queryByRole('button', { name: '修改出版商' })).toBeNull()
    expect(screen.queryByRole('button', { name: '修改简介' })).toBeNull()
    fireEvent.contextMenu(screen.getByText('Pub'))
    expect(screen.queryByRole('dialog', { name: '修改出版商' })).toBeNull()
  })

  it('keeps identifiers and computed fields read-only and hides edits in read-only views', () => {
    withMeta({ identifier: 'public-source-id', publisher: 'Pub' })
    const { rerender } = renderDialog()
    expect(screen.queryByRole('button', { name: '修改标识符' })).toBeNull()
    expect(screen.queryByRole('button', { name: '修改格式' })).toBeNull()
    rerender(<BookDetailDialog book={book} readOnly onClose={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '修改书名' })).toBeNull()
    expect(screen.queryByRole('button', { name: '修改出版商' })).toBeNull()
    expect(screen.queryByRole('button', { name: '修改封面' })).toBeNull()
  })
})

describe('BookDetailDialog pinned cover editing', () => {
  it('preserves the loaded TXT artwork element when entering and leaving cover editing', () => {
    render(<BookDetailDialog book={{ ...book, format: 'txt', coverKey: 'original-cover' }} onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })
    const image = screen.getByRole('img', { name: 'Test Book' })
    fireEvent.load(image)
    expect(image.className).toContain('opacity-100')
    fireEvent.contextMenu(image)
    expect(screen.getByRole('img', { name: 'Test Book' })).toBe(image)
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Test Book' }))
    expect(screen.getByRole('img', { name: 'Test Book' })).toBe(image)
    expect(image.className).toContain('opacity-100')
    expect(screen.queryByRole('button', { name: '更换封面' })).toBeNull()
  })

  it('allows a collected version cover override without offering revision palette writes', () => {
    bookDetail = { data: { ...book, format: 'txt', source: { libraryId: 'lib_city', libraryBookVersionId: 'lbv1', libraryName: 'City' } } }
    renderDialog()
    fireEvent.contextMenu(document.querySelector('input[type="file"]')!.parentElement!)
    expect(screen.getByRole('button', { name: '更换封面' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '封面配色' })).toBeNull()
  })

  it('disables cover tools while a save is pending', () => {
    quickEditPending = true
    render(<BookDetailDialog book={{ ...book, coverKey: 'original-cover' }} onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })
    fireEvent.contextMenu(document.querySelector('input[type="file"]')!.parentElement!)
    expect(screen.getByRole('button', { name: '更换封面' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '移除封面' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '移除封面' }))
    expect(removeCoverMutate).not.toHaveBeenCalled()
  })

  it('pins the overlay until outside click or Escape without closing details', () => {
    const onClose = vi.fn()
    render(<BookDetailDialog book={{ ...book, format: 'txt' }} onClose={onClose} onDelete={vi.fn()} />, { wrapper })
    fireEvent.contextMenu(document.querySelector('input[type="file"]')!.parentElement!)
    const change = screen.getByRole('button', { name: '更换封面' })
    fireEvent.mouseLeave(change)
    expect(change).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'Test Book' }))
    expect(screen.queryByRole('button', { name: '更换封面' })).toBeNull()
    fireEvent.contextMenu(document.querySelector('input[type="file"]')!.parentElement!)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: '更换封面' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('uploads or removes directly without changing metadata or shelf', () => {
    render(<BookDetailDialog book={{ ...book, coverKey: 'original-cover' }} onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })
    fireEvent.contextMenu(document.querySelector('input[type="file"]')!.parentElement!)
    const file = new File(['cover'], 'cover.png', { type: 'image/png' })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    expect(uploadCoverMutate).toHaveBeenCalledWith({ bookId: 'book-1', file })
    fireEvent.click(screen.getByRole('button', { name: '移除封面' }))
    expect(removeCoverMutate).toHaveBeenCalledWith('book-1')
    expect(apiPut).not.toHaveBeenCalled()
    expect(updateBookMutate).not.toHaveBeenCalled()
  })

  it('keeps the palette interactive and consumes Escape before dismissing the overlay', () => {
    render(<BookDetailDialog book={{ ...book, format: 'txt' }} onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })
    fireEvent.contextMenu(document.querySelector('input[type="file"]')!.parentElement!)
    fireEvent.click(screen.getByRole('button', { name: '封面配色' }))
    const palette = screen.getByRole('button', { name: 'Sage Green' })
    fireEvent.pointerDown(palette)
    fireEvent.click(palette)
    expect(updateBookMutate).toHaveBeenCalledWith({ bookId: 'book-1', coverPaletteId: 'sage' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Sage Green' })).toBeNull()
    expect(screen.getByRole('button', { name: '更换封面' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: '更换封面' })).toBeNull()
  })
})

describe('BookDetailDialog primary action', () => {
  it('shows start-reading without progress and navigates to the reader', () => {
    const onClose = vi.fn()
    render(<BookDetailDialog book={book} onClose={onClose} onDelete={vi.fn()} />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    expect(onClose).toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/books/$id', params: { id: 'book-1' } })
  })

  it('shows continue-reading when progress exists', () => {
    render(<BookDetailDialog book={{ ...book, progress: 42 }} onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })
    expect(screen.getByRole('button', { name: '继续阅读' })).toBeInTheDocument()
  })
})

describe('BookDetailDialog TOC rule menu', () => {
  it('opens the TOC rule picker from more actions menu', async () => {
    bookDetail = { data: { ...book, format: 'txt', meta: {} } }
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
    fireEvent.click(await screen.findByRole('button', { name: '更换目录规则' }))

    expect(await screen.findByRole('heading', { name: '目录规则' })).toBeInTheDocument()
  })
})

describe('BookDetailDialog download dialog', () => {
  function openDownload() {
    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    return within(screen.getByRole('dialog', { name: /^下载《/ }))
  }

  it('opens an EPUB download dialog without starting a download', () => {
    renderDialog()
    const dialog = openDownload()
    expect(dialog.getByRole('button', { name: 'EPUB' })).toHaveAttribute('aria-pressed', 'true')
    expect(downloadBook).not.toHaveBeenCalled()
    fireEvent.click(dialog.getByRole('button', { name: '下载' }))
    expect(downloadBook).toHaveBeenCalledWith('book-1', 'Test Book')
  })

  it('offers TXT for an EPUB and downloads extracted original text', () => {
    renderDialog()
    const dialog = openDownload()
    fireEvent.click(dialog.getByRole('button', { name: 'TXT' }))
    fireEvent.click(dialog.getByRole('button', { name: '下载' }))
    expect(downloadOriginalTxt).toHaveBeenCalledWith('book-1', 'Test Book')
  })

  it.each(['epub', 'txt'] as const)('offers edited %s for a TXT source', (format) => {
    vi.mocked(useBookReplacements).mockReturnValue({ data: { data: [{ enabled: true, effectiveEnabled: true }] } } as ReturnType<typeof useBookReplacements>)
    bookDetail = { data: { ...book, format: 'txt' } }
    renderDialog()
    const dialog = openDownload()
    fireEvent.click(dialog.getByRole('button', { name: format.toUpperCase() }))
    fireEvent.click(dialog.getByRole('radio', { name: '校订版' }))
    fireEvent.click(dialog.getByRole('button', { name: '下载' }))
    if (format === 'epub') expect(downloadEpub).toHaveBeenCalledWith('book-1', 'Test Book', { plain: false })
    else expect(downloadEditedTxt).toHaveBeenCalledWith('book-1', 'Test Book')
  })

  it('hides edited EPUB for uploaded EPUB but offers edited TXT', () => {
    vi.mocked(useBookReplacements).mockReturnValue({ data: { data: [{ enabled: true, effectiveEnabled: true }] } } as ReturnType<typeof useBookReplacements>)
    renderDialog()
    const dialog = openDownload()
    expect(dialog.queryByRole('radio', { name: '校订版' })).not.toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: 'TXT' }))
    fireEvent.click(dialog.getByRole('radio', { name: '校订版' }))
    fireEvent.click(dialog.getByRole('button', { name: '下载' }))
    expect(downloadEditedTxt).toHaveBeenCalledWith('book-1', 'Test Book')
  })

  it('closes only the download dialog on Escape and restores focus', () => {
    renderDialog()
    const trigger = screen.getByRole('button', { name: '下载' })
    trigger.focus()
    openDownload()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /^下载《/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument()
    expect(document.activeElement).toBe(trigger)
  })
})

describe('BookDetailDialog publish action', () => {
  it('renders publish in the action bar for a publishable book and invokes onPublish', () => {
    const onPublish = vi.fn()
    render(<BookDetailDialog book={book} onClose={vi.fn()} onDelete={vi.fn()} onPublish={onPublish} />, { wrapper })

    const publish = screen.getByRole('button', { name: '发布' })
    expect(publish.querySelector('path[d="M12 17V3"]')).not.toBeNull()
    fireEvent.click(publish)
    expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({ id: book.id }))
  })

  it('does not render publish when onPublish is not provided or readOnly', () => {
    const { rerender } = render(<BookDetailDialog book={book} onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })
    expect(screen.queryByRole('button', { name: '发布' })).not.toBeInTheDocument()

    rerender(<BookDetailDialog book={book} readOnly onClose={vi.fn()} onDelete={vi.fn()} onPublish={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '发布' })).not.toBeInTheDocument()
  })
})

describe('BookDetailDialog more actions', () => {
  it('keeps TXT-only actions available for a TXT book', () => {
    render(<BookDetailDialog book={{ ...book, format: 'txt' }} onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
    expect(screen.getByRole('button', { name: '更换目录规则' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '追加内容' })).toBeInTheDocument()
  })

  it('does not show more actions for a non-TXT book', () => {
    render(<BookDetailDialog book={book} onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })
    expect(screen.queryByRole('button', { name: '更多操作' })).not.toBeInTheDocument()
  })
})

describe('BookDetailDialog shared work mode', () => {
  const cityLibrary: Library = {
    id: 'lib_city', userId: 'u2', type: 'shared', name: 'City', description: '',
    visibility: 'public', createdAt: 1, updatedAt: 1,
  }

  function catalogVersion(overrides: Partial<CatalogBook['versions'][number]> = {}): CatalogBook['versions'][number] {
    return {
      id: 'lbv1', libraryBookId: 'lb1', bookVersionId: 'v1', kind: 'personal', status: 'published',
      name: '', title: null, author: null, description: null, coverKey: null,
      inherited: { title: 'Work Title', authors: ['Work Author'], description: 'Work description', bookmeta: { publisher: 'Work Press', series: 'Work Series', seriesIndex: 1 } },
      effective: {
        title: 'City Book', author: 'Someone', description: 'A tale', coverKey: null,
        bookmeta: { publisher: 'Pub House', series: 'Trilogy', seriesIndex: 2 },
        fileName: 'city-book.txt',
      },
      format: 'txt', size: 160900, chapterCount: 220, wordCount: 454385, guestReadable: false, pinnedAt: null, createdAt: 1, updatedAt: 1,
      ...overrides,
    }
  }

  function catalogWork(overrides: Partial<CatalogBook> = {}): CatalogBook {
    return {
      id: 'lb1', libraryId: 'lib_city', categoryId: null, title: 'City Book', author: 'Someone',
      description: 'A tale', coverKey: null, hidden: false, effectiveHidden: false, hiddenReason: null,
      tags: [{ id: 't1', name: 'classic' }],
      versions: [catalogVersion()], createdAt: 1710000000000, updatedAt: 1710000000000, ...overrides,
    }
  }

  function renderWorkDialog(target: CatalogBook, { canManage = false, canCollect = true, canContribute = false } = {}) {
    const onClose = vi.fn()
    const rendered = render(
      <BookDetailDialog
        book={null}
        work={{ work: target, library: cityLibrary, canManage, canCollect, canContribute }}
        onClose={onClose}
        onDelete={vi.fn()}
      />,
      { wrapper },
    )
    return { onClose, container: rendered.container }
  }

  it('tells the work in the private layout: header, facts, actions, no personal state', () => {
    renderWorkDialog(catalogWork())

    expect(screen.getByRole('heading', { name: '书籍详情' })).toBeInTheDocument()
    expect(screen.getByText('A tale')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'classic' })).toBeInTheDocument()
    expect(screen.getByText('格式')).toBeInTheDocument()
    expect(screen.getByText('TXT')).toBeInTheDocument()
    expect(screen.getByText('大小')).toBeInTheDocument()
    expect(screen.getByText('字数')).toBeInTheDocument()
    expect(screen.getByText('45.4万字')).toBeInTheDocument()
    expect(screen.getByText('添加时间')).toBeInTheDocument()
    expect(screen.queryByText('更新日期')).toBeNull()
    expect(screen.getByRole('button', { name: '开始阅读' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '加入书库' })).toBeInTheDocument()
    expect(screen.getByLabelText('下载')).toBeInTheDocument()
    // A work belongs to nobody: no read-status chip, no progress, no editor.
    expect(screen.queryByRole('button', { name: '在读' })).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.queryByText('0%')).toBeNull()
  })


  it('shows category before shared tags and filters within the current library', () => {
    sharedCategories = [{ id: 'c1', libraryId: 'lib_city', userId: 'u2', name: 'Fiction', parentId: null, sortOrder: 0, pinned: false, hidden: false, createdAt: 1, updatedAt: 1, bookCount: 1 }]
    const { onClose } = renderWorkDialog(catalogWork({ categoryId: 'c1' }))
    const category = screen.getByRole('button', { name: 'Fiction' })
    const tag = screen.getByRole('button', { name: 'classic' })
    expect(category.parentElement!.children[0]).toBe(category)
    expect(category.parentElement!.children[1]).toBe(tag)
    expect(screen.queryByText('City', { exact: true })).toBeNull()
    fireEvent.click(category)
    expect(onClose).toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { libraryId: 'lib_city', shelf: 'c1' } })
    fireEvent.click(tag)
    expect(navigateMock).toHaveBeenLastCalledWith({ to: '/', search: { libraryId: 'lib_city', tag: 't1' } })
    expect(updateCatalogBookMutate).not.toHaveBeenCalled()
  })

  it('shows uncategorized even without tags and filters the shared library', () => {
    renderWorkDialog(catalogWork({ tags: [] }))
    fireEvent.click(screen.getByRole('button', { name: '未分类' }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { libraryId: 'lib_city', shelf: 'none' } })
  })

  it.each(['loading', 'error', 'missing'])('never labels an unresolved category as uncategorized (%s)', (state) => {
    categoriesPending = state === 'loading'
    categoriesError = state === 'error'
    sharedCategories = state === 'error' ? [{ id: 'c1', name: 'Stale' } as Category] : []
    renderWorkDialog(catalogWork({ categoryId: 'c1' }))
    expect(screen.queryByRole('button', { name: '未分类' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stale' })).toBeNull()
    expect(screen.getByText(state === 'loading' ? '分类' : '分类信息暂不可用')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'classic' })).toBeInTheDocument()
  })


  it('edits only the selected shared version metadata and preserves raw overrides', async () => {
    const version = catalogVersion({ id: 'lbv2', name: 'Second Edition', bookVersionId: 'v2', meta: { rights: 'Keep', language: null } })
    renderWorkDialog(catalogWork({ defaultVersionLinkId: 'lbv2', versions: [catalogVersion(), version] }), { canManage: true })
    fireEvent.click(screen.getByRole('tab', { name: 'Second Edition' }))
    fireEvent.contextMenu(screen.getByText('Pub House'))
    fireEvent.change(screen.getByRole('textbox', { name: '出版商' }), { target: { value: 'New Pub' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateCatalogVersionMutate).toHaveBeenCalledWith({ libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv2', patch: { meta: { rights: 'Keep', language: null, publisher: 'New Pub' } } }))
    expect(updateCatalogBookMutate).not.toHaveBeenCalled()
    expect(updateBookMutateAsync).not.toHaveBeenCalled()
  })

  it.each([false, true])('distinguishes explicit empty metadata from inheritance (%s)', async (inherit) => {
    renderWorkDialog(catalogWork({ versions: [catalogVersion({ meta: { publisher: 'Override', rights: 'Keep' } })] }), { canManage: true })
    fireEvent.contextMenu(screen.getByText('Pub House'))
    if (inherit) fireEvent.click(screen.getByRole('button', { name: '恢复跟随' }))
    else fireEvent.change(screen.getByRole('textbox', { name: '出版商' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateCatalogVersionMutate).toHaveBeenCalledWith({ libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1', patch: { meta: inherit ? { rights: 'Keep' } : { publisher: null, rights: 'Keep' } } }))
  })

  it.each(['title', 'authors', 'description'])('restores the %s override without changing other fields', async (field) => {
    const version = catalogVersion({ title: 'Override', authors: ['Override'], description: 'Override' })
    renderWorkDialog(catalogWork({ versions: [version] }), { canManage: true })
    const target = field === 'title' ? screen.getByRole('heading', { name: 'City Book' }) : field === 'authors' ? screen.getByRole('button', { name: 'Someone' }) : screen.getByText('A tale')
    fireEvent.contextMenu(target)
    fireEvent.click(screen.getByRole('button', { name: '恢复跟随' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateCatalogVersionMutate).toHaveBeenCalledWith({ libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1', patch: { [field]: null } }))
  })


  it('restores series and index inheritance together while preserving other masks', async () => {
    renderWorkDialog(catalogWork({ versions: [catalogVersion({ meta: { series: 'Override', seriesIndex: 0, publisher: null, rights: 'Keep' } })] }), { canManage: true })
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Trilogy #2' }))
    fireEvent.change(screen.getByRole('textbox', { name: '系列编号' }), { target: { value: '2abc' } })
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.click(screen.getAllByRole('button', { name: '恢复跟随' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateCatalogVersionMutate).toHaveBeenCalledWith({ libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1', patch: { meta: { publisher: null, rights: 'Keep' } } }))
  })

  it('blocks shared cover tools during writes', () => {
    quickEditPending = true
    const version = catalogVersion({ coverKey: 'version-cover', effective: { ...catalogVersion().effective, coverKey: 'version-cover' } })
    renderWorkDialog(catalogWork({ versions: [version] }), { canManage: true })
    fireEvent.contextMenu(screen.getByRole('img', { name: 'City Book' }))
    expect(screen.getByRole('button', { name: '更换封面' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '移除版本封面' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '移除版本封面' }))
    expect(removeVersionCoverMutate).not.toHaveBeenCalled()
  })

  it('retains a failed shared edit draft for retry', async () => {
    updateCatalogVersionMutate.mockRejectedValueOnce(new Error('Offline'))
    renderWorkDialog(catalogWork(), { canManage: true })
    fireEvent.contextMenu(screen.getByRole('heading', { name: 'City Book' }))
    fireEvent.change(screen.getByRole('textbox', { name: '书名' }), { target: { value: 'Retry Title' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(updateCatalogVersionMutate).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('textbox', { name: '书名' })).toHaveValue('Retry Title')
    expect(screen.getByRole('heading', { name: 'City Book' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '修改书名' })).toBeNull())
  })

  it('shows a TXT version cover, preserves its image and uploads/removes only the version override', () => {
    const version = catalogVersion({ coverKey: 'version-cover', effective: { ...catalogVersion().effective, coverKey: 'version-cover' } })
    renderWorkDialog(catalogWork({ versions: [version] }), { canManage: true })
    const image = screen.getByRole('img', { name: 'City Book' })
    fireEvent.load(image)
    fireEvent.contextMenu(image)
    expect(screen.queryByRole('button', { name: '封面配色' })).toBeNull()
    const file = new File(['cover'], 'cover.png', { type: 'image/png' })
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } })
    expect(uploadVersionCoverMutate).toHaveBeenCalledWith(expect.objectContaining({ libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1', file }), expect.any(Object))
    fireEvent.click(screen.getByRole('button', { name: '移除版本封面' }))
    expect(removeVersionCoverMutate).toHaveBeenCalledWith(expect.objectContaining({ versionLinkId: 'lbv1' }), expect.any(Object))
    fireEvent.pointerDown(screen.getByRole('heading', { name: 'City Book' }))
    expect(screen.getByRole('img', { name: 'City Book' })).toBe(image)
    expect(image.className).toContain('opacity-100')
    expect(removeCoverMutate).not.toHaveBeenCalled()
  })

  it('does not offer removal of inherited artwork', () => {
    const version = catalogVersion({ effective: { ...catalogVersion().effective, coverKey: 'work-cover' } })
    renderWorkDialog(catalogWork({ coverKey: 'work-cover', versions: [version] }), { canManage: true })
    fireEvent.contextMenu(screen.getByRole('img', { name: 'City Book' }))
    expect(screen.getByRole('button', { name: '更换封面' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '移除版本封面' })).toBeNull()
  })

  it.each([false, true])('rejects shortcuts for ordinary readers and contributors (%s)', (canContribute) => {
    renderWorkDialog(catalogWork({ versions: [catalogVersion({ maintainable: true })] }), { canContribute })
    fireEvent.contextMenu(screen.getByRole('heading', { name: 'City Book' }))
    fireEvent.contextMenu(screen.getByText('Pub House'))
    expect(screen.queryByRole('dialog', { name: /修改/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '更换封面' })).toBeNull()
    expect(updateCatalogVersionMutate).not.toHaveBeenCalled()
  })

  it('reads the first version from the primary action', () => {
    const { onClose } = renderWorkDialog(catalogWork())

    fireEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    expect(onClose).toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/books/$id', params: { id: 'v1' } })
  })

  it('shows owns-source exactly like a collected version in the work detail', () => {
    renderWorkDialog(catalogWork({ versions: [catalogVersion({ ownsSource: true })] }))
    expect(screen.queryByRole('button', { name: '加入书库' })).toBeNull()
    const joined = screen.getByRole('button', { name: '已在书库中' })
    expect(joined).toBeInTheDocument()
    expect(joined).toBeDisabled()
  })

  it('hides content edits from a contributor on a version they did not upload', () => {
    // canContribute is a library-level right; the per-version `maintainable`
    // flag is what the server actually gates on, and it says no here.
    renderWorkDialog(catalogWork({ versions: [catalogVersion({ maintainable: false })] }), { canContribute: true })
    expect(screen.queryByRole('button', { name: '追加内容' })).toBeNull()
    expect(screen.queryByRole('button', { name: '更换目录规则' })).toBeNull()
    // Uploading a version for the work is still theirs to do.
    expect(screen.getByRole('button', { name: '上传新版本' })).toBeInTheDocument()
  })

  it('offers content edits to a contributor on a version they uploaded', () => {
    renderWorkDialog(catalogWork({ versions: [catalogVersion({ maintainable: true })] }), { canContribute: true })
    // Same overflow menu the private library uses for the same two actions,
    // rather than a second pair of icons in the action row.
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
    expect(screen.getByRole('button', { name: '追加内容' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '更换目录规则' })).toBeInTheDocument()
  })

  it('hangs the work overflow off the action row, consistent with the private book', () => {
    // Both private books and shared-library works place the overflow menu
    // at the end of the action row before delete.
    renderWorkDialog(catalogWork({ versions: [catalogVersion({ maintainable: true })] }), { canManage: true })
    const overflow = screen.getByRole('button', { name: '更多操作' })
    const deleteBtn = screen.getByRole('button', { name: '删除' })
    expect(overflow.compareDocumentPosition(deleteBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('never offers the city-side push; that lives on the private book', () => {
    renderWorkDialog(catalogWork({ versions: [catalogVersion({ maintainable: true })] }), { canManage: true })
    expect(screen.queryByRole('button', { name: '同步来源更新' })).toBeNull()
  })

  it('offers delete to a contributor on their own version only', () => {
    const work = catalogWork({ versions: [catalogVersion({ id: 'lbv1', maintainable: true }), catalogVersion({ id: 'lbv2', maintainable: false })] })
    renderWorkDialog(work, { canContribute: true })
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
  })

  it('hides delete from a contributor who maintains nothing on this work', () => {
    renderWorkDialog(catalogWork({ versions: [catalogVersion({ maintainable: false })] }), { canContribute: true })
    expect(screen.queryByRole('button', { name: '删除' })).toBeNull()
  })

  it('filters by author and tag inside the library', () => {
    const { onClose } = renderWorkDialog(catalogWork())

    fireEvent.click(screen.getByRole('button', { name: 'Someone' }))
    expect(onClose).toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { libraryId: 'lib_city', author: 'Someone' } })
  })

  it('manages through the hide toggle and delete', () => {
    // A one-version work reads its control as a work-level switch, so hiding it
    // needs no confirmation: the version layer is never written.
    renderWorkDialog(catalogWork(), { canManage: true })
    fireEvent.click(screen.getByRole('button', { name: '版本显示中，点击隐藏' }))
    expect(updateCatalogBookMutate).toHaveBeenCalledWith(
      expect.objectContaining({ libraryId: 'lib_city', libraryBookId: 'lb1', patch: { hidden: true } }),
      expect.anything(),
    )
    cleanup()

    // Deleting the last version removes the whole work: confirmed.
    renderWorkDialog(catalogWork(), { canManage: true })
    fireEvent.click(screen.getByLabelText('删除'))
    expect(deleteCatalogVersionMutate).not.toHaveBeenCalled()
    const deleteDialog = screen.getByRole('alertdialog')
    expect(within(deleteDialog).getByText(/将整体移入回收站/)).toBeInTheDocument()
    fireEvent.click(within(deleteDialog).getByRole('button', { name: '删除' }))
    expect(deleteCatalogVersionMutate).toHaveBeenCalledWith({ libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1' })
  })

  it('confirms before hiding the last published version of a many-version work', () => {
    // The other version is already hidden, so hiding this one leaves the work
    // with no published version and breaks every collected B at once.
    renderWorkDialog(catalogWork({
      versions: [catalogVersion(), catalogVersion({ id: 'lbv2', bookVersionId: 'v2', status: 'unlisted' })],
    }), { canManage: true })

    fireEvent.click(screen.getByRole('button', { name: '版本显示中，点击隐藏' }))
    expect(updateCatalogVersionMutate).not.toHaveBeenCalled()
    const unlistDialog = screen.getByRole('alertdialog')
    expect(within(unlistDialog).getByText(/隐藏后，已收藏的成员将无法继续阅读/)).toBeInTheDocument()
    fireEvent.click(within(unlistDialog).getByRole('button', { name: '隐藏' }))
    expect(updateCatalogVersionMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: 'lib_city', libraryBookId: 'lb1', versionLinkId: 'lbv1', patch: { status: 'unlisted' },
      }),
      expect.anything(),
    )
    // With several versions the control is a version control, not a work one.
    expect(updateCatalogBookMutate).not.toHaveBeenCalled()
  })

  it('shows a directly hidden one-version work as hidden, and only for managers', () => {
    renderWorkDialog(catalogWork({ hidden: true, effectiveHidden: true }), { canManage: true })
    expect(screen.getByRole('button', { name: '版本已隐藏，点击显示' })).toBeInTheDocument()
    cleanup()
    renderWorkDialog(catalogWork({ hidden: true, effectiveHidden: true }))
    expect(screen.queryByRole('button', { name: '版本已隐藏，点击显示' })).not.toBeInTheDocument()
  })

  it('switches the visible version from the tabs and acts on it', () => {
    renderWorkDialog(catalogWork({
      versions: [
        catalogVersion({ name: '初版' }),
        catalogVersion({ id: 'lbv2', bookVersionId: 'v2', name: '修订版', effective: { title: 'City Book 修订版', author: 'Someone', description: '', coverKey: null, bookmeta: {}, fileName: null } }),
      ],
    }), { canManage: true })

    // Header follows the first version until another tab is picked.
    expect(screen.getByRole('heading', { name: 'City Book' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /修订版/ }))
    expect(screen.getByRole('heading', { name: 'City Book 修订版' })).toBeInTheDocument()

    // Manager delete presets the visible version.
    fireEvent.click(screen.getByLabelText('删除'))
    const dialog = screen.getByRole('alertdialog')
    const boxes = within(dialog).getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes).toHaveLength(2)
    expect(boxes[1]!.checked).toBe(true)
    expect(boxes[0]!.checked).toBe(false)
  })

  it('downloads the selected shared version with its effective title and version label', async () => {
    renderWorkDialog(catalogWork({ versions: [catalogVersion({ name: '初版' }),
      catalogVersion({ id: 'lbv2', bookVersionId: 'v2', name: '修订版', format: 'epub', effective: { title: '修订书名', author: 'Someone', description: '', coverKey: null, bookmeta: {}, fileName: null } }),
    ] }), { canManage: true })
    fireEvent.click(screen.getByRole('tab', { name: /修订版/ }))
    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    const dialog = within(screen.getByRole('dialog', { name: /^下载《/ }))
    expect(dialog.getByRole('heading', { name: '下载《修订书名》' })).toBeInTheDocument()
    expect(dialog.getByText('修订版')).toBeInTheDocument()
    fireEvent.click(dialog.getByRole('button', { name: '下载' }))
    await waitFor(() => expect(downloadBook).toHaveBeenCalledWith('v2', '修订书名'))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^下载《/ })).not.toBeInTheDocument())
  })

  it('keeps shared actions in private-detail order and dates the selected version', () => {
    const firstCreatedAt = 1700000000000
    const secondCreatedAt = 1730000000000
    renderWorkDialog(catalogWork({
      versions: [
        catalogVersion({ name: '初版', createdAt: firstCreatedAt }),
        catalogVersion({ id: 'lbv2', bookVersionId: 'v2', name: '修订版', createdAt: secondCreatedAt }),
      ],
    }), { canManage: true })

    const edit = screen.getByRole('button', { name: '编辑作品' })
    const download = screen.getByRole('button', { name: '下载' })
    expect(edit.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const addedAt = screen.getByText('添加时间').parentElement!
    expect(within(addedAt).getByText(formatDate(firstCreatedAt))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /修订版/ }))
    expect(within(addedAt).getByText(formatDate(secondCreatedAt))).toBeInTheDocument()
  })

  it('opens the work editor for managers only', () => {
    renderWorkDialog(catalogWork(), { canManage: true })
    fireEvent.click(screen.getByRole('button', { name: '编辑作品' }))
    expect(screen.getByText('作品信息')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /版本 1/ })).toBeInTheDocument()
    cleanup()

    renderWorkDialog(catalogWork())
    expect(screen.queryByRole('button', { name: '编辑作品' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '上传新版本' })).not.toBeInTheDocument()
  })

  it('opens the version-bound upload sheet for managers', () => {
    renderWorkDialog(catalogWork(), { canManage: true })
    fireEvent.click(screen.getByRole('button', { name: '上传新版本' }))
    expect(screen.getByText('版本 2').parentElement).toHaveAttribute('title', '将作为「City Book」的新版本上传')
  })

  it('shows no tabs for a single version and tabs past one', () => {
    const { unmount } = render(
      <BookDetailDialog
        book={null}
        work={{ work: catalogWork(), library: cityLibrary, canManage: false, canCollect: true }}
        onClose={vi.fn()}
        onDelete={vi.fn()}
      />,
      { wrapper },
    )
    expect(screen.queryByRole('tablist')).toBeNull()
    unmount()

    renderWorkDialog(catalogWork({ versions: [catalogVersion(), catalogVersion({ id: 'lbv2', bookVersionId: 'v2' })] }), { canManage: true })
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    // Unnamed versions fall back to an ordinal label.
    expect(screen.getByRole('tab', { name: /版本 1/ })).toBeInTheDocument()
  })

  it('locks reading and download on a hidden version for members', () => {
    renderWorkDialog(catalogWork({ versions: [catalogVersion({ status: 'unlisted' })] }), { canManage: false })

    expect(screen.getByRole('button', { name: '开始阅读' })).toBeDisabled()
    expect(screen.queryByLabelText('下载')).toBeNull()
  })

  it('keeps a hidden version readable and collectable for managers', () => {
    renderWorkDialog(catalogWork({ versions: [catalogVersion({ status: 'unlisted' })] }), { canManage: true })

    // Hiding is a member-facing switch; the curator keeps full access.
    expect(screen.getByRole('button', { name: '开始阅读' })).not.toBeDisabled()
    expect(screen.getByLabelText('下载')).toBeInTheDocument()
  })

  it('keeps the hide icon but makes it inert for a taxonomy-derived hide', () => {
    // A hidden category sets effectiveHidden without the direct flag, so there
    // is no work-level action to take: same icon, disabled, and the tooltip
    // names the exact hiding layer.
    renderWorkDialog(catalogWork({ hidden: false, effectiveHidden: true, hiddenReason: 'category', hiddenVia: { categoryName: 'Vault' } }), { canManage: true })

    const icon = screen.getByLabelText('分类已隐藏')
    expect(icon).toBeDisabled()
    expect(icon).toHaveAttribute('title', '所属分类「Vault」已隐藏')
    expect(screen.queryByLabelText('版本显示中，点击隐藏')).toBeNull()
    expect(screen.queryByLabelText('版本已隐藏，点击显示')).toBeNull()
    // Reading is untouched: the curator still reads what they hid.
    expect(screen.getByRole('button', { name: '开始阅读' })).not.toBeDisabled()
  })

  it('names the hiding tag for a tag-derived hide', () => {
    renderWorkDialog(catalogWork({ hidden: false, effectiveHidden: true, hiddenReason: 'tag', hiddenVia: { tagNames: ['Secret'] } }), { canManage: true })

    const icon = screen.getByLabelText('标签已隐藏')
    expect(icon).toBeDisabled()
    expect(icon).toHaveAttribute('title', '所属标签「Secret」已隐藏')
  })

  it('reads the direct work hide as a work-level control on a one-version work', () => {
    renderWorkDialog(catalogWork({ hidden: true, effectiveHidden: true }), { canManage: true })

    expect(screen.getByLabelText('版本已隐藏，点击显示')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('版本已隐藏，点击显示'))
    // The action must land on the work, not on the version: writing the
    // version left the work badged while the button claimed it was shown.
    expect(updateCatalogBookMutate).toHaveBeenCalledWith(
      expect.objectContaining({ libraryBookId: 'lb1', patch: { hidden: false } }),
      expect.anything(),
    )
    expect(updateCatalogVersionMutate).not.toHaveBeenCalled()
  })

  it('shows the version publication metadata like a private book', () => {
    renderWorkDialog(catalogWork())

    expect(screen.getByText('出版商')).toBeInTheDocument()
    expect(screen.getByText('Pub House')).toBeInTheDocument()
    expect(screen.getByText('原始文件')).toBeInTheDocument()
    expect(screen.getByText('系列')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Trilogy #2' }))
    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { libraryId: 'lib_city', series: 'Trilogy' } })
  })
})
