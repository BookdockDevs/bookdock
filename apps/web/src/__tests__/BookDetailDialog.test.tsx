import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

import type { BookListItem } from '@bookdock/shared'

import i18n from '../i18n/i18n'
import BookDetailDialog from '../features/library/components/BookDetailDialog'

const apiPatch = vi.fn()
const apiPut = vi.fn()
const createTagMutate = vi.fn()
const updateBookMutate = vi.fn()
const navigateMock = vi.fn()

vi.mock('@/api/client', () => ({
  apiPatch: (...args: unknown[]) => apiPatch(...args),
  apiPut: (...args: unknown[]) => apiPut(...args),
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
})

describe('BookDetailDialog identity chips', () => {
  it('renders the format chip and navigates to the shelf filter on shelf chip click', () => {
    membershipShelf = 'shelf-1'
    const onClose = vi.fn()
    render(<BookDetailDialog book={book} onClose={onClose} onDelete={vi.fn()} />, { wrapper })

    expect(screen.getAllByText('epub').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Favorites' }))

    expect(onClose).toHaveBeenCalled()
    expect(navigateMock).toHaveBeenCalledWith({ to: '/', search: { shelf: 'shelf-1' } })
  })

  it('renders a muted uncategorized chip that navigates to shelf=none', () => {
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

    expect(screen.getByText('更新日期')).toBeInTheDocument()
    expect(screen.getByText('添加时间')).toBeInTheDocument()
    expect(screen.getByText('格式')).toBeInTheDocument()
    expect(screen.getByText('大小')).toBeInTheDocument()
  })

  it('renders rows with values and merges series name with its index', () => {
    withMeta({ publisher: 'Pub House', series: 'Trilogy', seriesIndex: 2, description: 'desc' })
    renderDialog()

    expect(screen.getByText('出版商')).toBeInTheDocument()
    expect(screen.getByText('Pub House')).toBeInTheDocument()
    expect(screen.getByText('Trilogy #2')).toBeInTheDocument()
    expect(screen.getByText('desc')).toBeInTheDocument()
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
