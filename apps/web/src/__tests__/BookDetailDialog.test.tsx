import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { BookListItem, CatalogBook, Library } from '@bookdock/shared'

import i18n from '../i18n/i18n'
import { useBookReplacements } from '@/api/hooks/useReplacements'
import { downloadBook, downloadEditedTxt, downloadEpub, downloadOriginalTxt } from '../features/library/download'
import BookDetailDialog from '../features/library/components/BookDetailDialog'
import { formatDate } from '../lib/utils'

const apiPatch = vi.fn()
const apiPut = vi.fn()
const apiDelete = vi.fn()
const apiUpload = vi.fn()
const createShelfMutate = vi.fn()
const createTagMutate = vi.fn()
const updateBookMutate = vi.fn()
const collectBookMutate = vi.fn()
const updateCatalogVersionMutate = vi.fn()
const updateCatalogBookMutate = vi.fn()
const deleteCatalogVersionMutate = vi.fn()
const navigateMock = vi.fn()

vi.mock('@/api/client', () => ({
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

vi.mock('../features/library/hooks', () => ({
  useBook: () => ({ data: bookDetail }),
  useBookMembership: () => ({
    shelves: { data: { data: membershipShelf } },
    tags: { data: { data: membershipTags } },
  }),
  useShelves: () => ({ data: { data: [{ id: 'shelf-1', name: 'Favorites', bookCount: 2 }] } }),
  useTags: () => ({ data: { data: [{ id: 'tag-1', name: '小说', bookCount: 1 }] } }),
  useCreateShelf: () => ({ mutateAsync: createShelfMutate, isPending: false }),
  useCreateTag: () => ({ mutateAsync: createTagMutate, isPending: false }),
  useUpdateBook: () => ({ mutate: updateBookMutate, isPending: false }),
  useUploadCover: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveCover: () => ({ mutate: vi.fn(), isPending: false }),
  useResetMetadata: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCollectBook: () => ({ mutate: collectBookMutate, isPending: false }),
  useUpdateCatalogVersion: () => ({ mutate: updateCatalogVersionMutate, isPending: false }),
  useUpdateCatalogBook: () => ({ mutate: updateCatalogBookMutate, mutateAsync: updateCatalogBookMutate, isPending: false }),
  useLibraryCategories: () => ({ data: { data: [] } }),
  useLibraryTags: () => ({ data: { data: [] } }),
  useUploadBooks: () => ({
    items: [], addFiles: vi.fn(), startUpload: vi.fn(), retry: vi.fn(), retryAll: vi.fn(),
    abortAll: vi.fn(), pruneSettled: vi.fn(), isUploading: false, clearQueue: vi.fn(), patchItem: vi.fn(),
  }),
  useUploadSettings: () => ({}),
  useUploadCatalogBookCover: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveCatalogBookCover: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUploadCatalogVersionCover: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveCatalogVersionCover: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

function renderDialog() {
  return render(<BookDetailDialog book={book} onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })
}

beforeEach(async () => {
  vi.clearAllMocks()
  apiPatch.mockResolvedValue({})
  apiPut.mockResolvedValue({})
  apiDelete.mockResolvedValue({})
  apiUpload.mockResolvedValue({})
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:cover-preview') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  createShelfMutate.mockResolvedValue({ data: { id: 'shelf-new', name: '科幻' } })
  vi.mocked(useBookReplacements).mockReturnValue({ data: { data: [] } } as ReturnType<typeof useBookReplacements>)
  createTagMutate.mockResolvedValue({ data: { id: 'tag-new' } })
  membershipShelf = null
  membershipTags = []
  bookDetail = undefined
  await i18n.changeLanguage('zh-CN')
})

describe('BookDetailDialog shelf chips', () => {
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

  it('does not render an uncategorized chip for books without a shelf', () => {
    renderDialog()

    expect(screen.queryByRole('button', { name: '未分类' })).toBeNull()
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
  it('renders the current status as the first identity chip', () => {
    renderDialog()

    const chip = screen.getByRole('button', { name: '在读' })
    const row = chip.parentElement!.parentElement!
    expect(row.firstElementChild).toBe(chip.parentElement)
  })

  it('opens the five-option menu and patches the selected status', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '在读' }))
    for (const label of ['想读', '在读', '读完', '闲置', '弃读']) {
      expect(screen.getAllByRole('button', { name: label }).length).toBeGreaterThan(0)
    }
    // current status carries a check mark; pick a different one
    fireEvent.click(screen.getByRole('button', { name: '读完' }))

    expect(updateBookMutate).toHaveBeenCalledWith({ bookId: 'book-1', readStatus: 'finished' })
  })

  it('closes the menu on outside mousedown without changing the status', () => {
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '在读' }))
    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('button', { name: '读完' })).toBeNull()
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

    expect(screen.getByText('添加时间')).toBeInTheDocument()
    expect(screen.getByText('格式')).toBeInTheDocument()
    expect(screen.getByText('大小')).toBeInTheDocument()
  })

  it('shows the original file name as a copyable row', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    bookDetail = { data: { ...book, meta: { fileName: 'my-old-book.txt' } } }
    renderDialog()

    expect(screen.getByText('原始文件')).toBeInTheDocument()
    const button = screen.getByTitle('my-old-book.txt')
    expect(button).toBeInTheDocument()

    fireEvent.click(button)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('my-old-book.txt'))
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
  it('copies the full identifier from the middle-truncated metadata row', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    withMeta({ identifier: LONG_IDENTIFIER })
    renderDialog()

    const button = screen.getByTitle(LONG_IDENTIFIER)
    expect(button.textContent).not.toBe(LONG_IDENTIFIER)
    expect(button.textContent).toContain('…')
    fireEvent.click(button)

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LONG_IDENTIFIER))
  })

  it('is read-only in edit mode and never written back on save', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    withMeta({ identifier: LONG_IDENTIFIER, publisher: 'Pub' })
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(screen.queryByDisplayValue(LONG_IDENTIFIER)).toBeNull()

    fireEvent.click(screen.getByTitle(LONG_IDENTIFIER))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LONG_IDENTIFIER))

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(apiPatch).toHaveBeenCalled())
    const body = apiPatch.mock.calls[0][1] as { bookmeta: Record<string, unknown> }
    expect(body.bookmeta).not.toHaveProperty('identifier')
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
  it('opens the TOC rule picker from edit mode', async () => {
    bookDetail = { data: { ...book, format: 'txt', meta: {} } }
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
    fireEvent.click(await screen.findByRole('button', { name: '更换目录规则' }))

    expect(await screen.findByRole('heading', { name: '目录规则' })).toBeInTheDocument()
  })
})

describe('BookDetailDialog download menu (2×2)', () => {
  const transformRule = (overrides: Record<string, unknown> = {}) => ({
    id: 'r1',
    bookId: null,
    scope: 'global',
    matchType: 'pattern',
    pattern: 'x',
    replacement: null,
    isRegex: false,
    caseSensitive: true,
    enabled: true,
    name: null,
    group: null,
    spineHref: null,
    textOffset: null,
    originalText: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  })

  function mockEffectiveRules() {
    vi.mocked(useBookReplacements).mockReturnValue({
      data: { data: [transformRule({ enabled: true, effectiveEnabled: true })] },
    } as ReturnType<typeof useBookReplacements>)
  }

  // 原文/校订版 rows only render inside the SmartMenu; their format submenus
  // open on click (the flyout toggles), then the EPUB/TXT row fires.
  function openFormatMenu(version: '原文' | '校订版') {
    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    fireEvent.click(screen.getByText(version))
  }

  it('shows both 校订版 and 原文 branches for a txt book with effective rules', () => {
    mockEffectiveRules()
    bookDetail = { data: { ...book, format: 'txt' } }
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    expect(screen.getByText('校订版')).toBeInTheDocument()
    expect(screen.getByText('原文')).toBeInTheDocument()
  })

  it('shows only the 原文 branch for a txt book without rules', () => {
    bookDetail = { data: { ...book, format: 'txt' } }
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    expect(screen.getByText('原文')).toBeInTheDocument()
    expect(screen.queryByText('校订版')).not.toBeInTheDocument()
  })

  it('never opens the menu for an EPUB book (stored-file download)', () => {
    mockEffectiveRules()
    renderDialog()

    fireEvent.click(screen.getByRole('button', { name: '下载' }))
    expect(screen.queryByText('校订版')).not.toBeInTheDocument()
    expect(screen.queryByText('原文')).not.toBeInTheDocument()
    expect(downloadBook).toHaveBeenCalledWith('book-1', 'Test Book')
  })

  it('exports the edited epub from the 校订版 branch', () => {
    mockEffectiveRules()
    bookDetail = { data: { ...book, format: 'txt' } }
    renderDialog()

    openFormatMenu('校订版')
    fireEvent.click(screen.getByRole('button', { name: 'EPUB' }))
    expect(downloadEpub).toHaveBeenCalledWith('book-1', 'Test Book', { plain: false })
  })

  it('exports the edited txt from the 校订版 branch', () => {
    mockEffectiveRules()
    bookDetail = { data: { ...book, format: 'txt' } }
    renderDialog()

    openFormatMenu('校订版')
    fireEvent.click(screen.getByRole('button', { name: 'TXT' }))
    expect(downloadEditedTxt).toHaveBeenCalledWith('book-1', 'Test Book')
  })

  it('downloads the original epub from the 原文 branch', () => {
    mockEffectiveRules()
    bookDetail = { data: { ...book, format: 'txt' } }
    renderDialog()

    openFormatMenu('原文')
    fireEvent.click(screen.getByRole('button', { name: 'EPUB' }))
    expect(downloadEpub).toHaveBeenCalledWith('book-1', 'Test Book', { plain: true })
  })

  it('downloads the original txt from the 原文 branch', () => {
    mockEffectiveRules()
    bookDetail = { data: { ...book, format: 'txt' } }
    renderDialog()

    openFormatMenu('原文')
    fireEvent.click(screen.getByRole('button', { name: 'TXT' }))
    expect(downloadOriginalTxt).toHaveBeenCalledWith('book-1', 'Test Book')
  })
})

describe('BookDetailDialog more actions', () => {
  it('shows only publish for a publishable EPUB and uses the home-menu icon', () => {
    const onPublish = vi.fn()
    render(<BookDetailDialog book={book} onClose={vi.fn()} onDelete={vi.fn()} onPublish={onPublish} />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
    expect(screen.queryByRole('button', { name: '更换目录规则' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '追加内容' })).not.toBeInTheDocument()
    const publish = screen.getByRole('button', { name: '发布' })
    expect(publish.querySelector('path[d="M12 17V3"]')).not.toBeNull()
    fireEvent.click(publish)
    expect(onPublish).toHaveBeenCalledWith(expect.objectContaining({ id: book.id }))
  })

  it('keeps TXT-only actions available for a TXT book', () => {
    render(<BookDetailDialog book={{ ...book, format: 'txt' }} onClose={vi.fn()} onDelete={vi.fn()} />, { wrapper })

    fireEvent.click(screen.getByRole('button', { name: '更多操作' }))
    expect(screen.getByRole('button', { name: '更换目录规则' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '追加内容' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '发布' })).not.toBeInTheDocument()
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
      description: 'A tale', coverKey: null, hidden: false, effectiveHidden: false,
      tags: [{ id: 't1', name: 'classic' }],
      versions: [catalogVersion()], createdAt: 1710000000000, updatedAt: 1710000000000, ...overrides,
    }
  }

  function renderWorkDialog(target: CatalogBook, { canManage = false, canCollect = true } = {}) {
    const onClose = vi.fn()
    const rendered = render(
      <BookDetailDialog
        book={null}
        work={{ work: target, library: cityLibrary, canManage, canCollect }}
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
    expect(screen.getByText('添加时间')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '开始阅读' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '加入我的书库' })).toBeInTheDocument()
    expect(screen.getByLabelText('下载')).toBeInTheDocument()
    // A work belongs to nobody: no read-status chip, no progress, no editor.
    expect(screen.queryByRole('button', { name: '在读' })).toBeNull()
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull()
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('reads the first version from the primary action', () => {
    const { onClose } = renderWorkDialog(catalogWork())

    fireEvent.click(screen.getByRole('button', { name: '开始阅读' }))
    expect(onClose).toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/books/$id', params: { id: 'v1' } })
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
    expect(within(deleteDialog).getByText(/删除后整个作品会被移除/)).toBeInTheDocument()
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
    // explains where the hide actually lives.
    renderWorkDialog(catalogWork({ hidden: false, effectiveHidden: true }), { canManage: true })

    const icon = screen.getByLabelText('作品已隐藏')
    expect(icon).toBeDisabled()
    expect(icon).toHaveAttribute('title', '此作品所属分类或标签被隐藏')
    expect(screen.queryByLabelText('版本显示中，点击隐藏')).toBeNull()
    expect(screen.queryByLabelText('版本已隐藏，点击显示')).toBeNull()
    // Reading is untouched: the curator still reads what they hid.
    expect(screen.getByRole('button', { name: '开始阅读' })).not.toBeDisabled()
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
