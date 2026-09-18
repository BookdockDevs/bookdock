import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { BookListItem } from '@bookdock/shared'

import i18n from '../i18n/i18n'
import { useBookReplacements } from '@/api/hooks/useReplacements'
import { downloadBook, downloadEditedTxt, downloadEpub, downloadOriginalTxt } from '../features/library/download'
import BookDetailDialog from '../features/library/components/BookDetailDialog'

const apiPatch = vi.fn()
const apiPut = vi.fn()
const apiDelete = vi.fn()
const apiUpload = vi.fn()
const createShelfMutate = vi.fn()
const createTagMutate = vi.fn()
const updateBookMutate = vi.fn()
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
}))

const book: BookListItem = {
  id: 'book-1',
  title: 'Test Book',
  author: 'Author',
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
    fireEvent.click(await screen.findByRole('button', { name: '修改分章规则' }))

    expect(await screen.findByRole('heading', { name: '分章规则' })).toBeInTheDocument()
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
