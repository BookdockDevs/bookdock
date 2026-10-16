import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, act } from '@testing-library/react'

import i18n from '@/i18n/i18n'

import AllRecordsView from './AllRecordsView'
import RecordsHome from './RecordsHome'
import SortMenu from './components/SortMenu'
import { archiveCountParts, hasReadableText } from './components/archive-helpers'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, search }: { children: React.ReactNode; search?: unknown }) => (
    <span data-search={search ? JSON.stringify(search) : undefined}>{children}</span>
  ),
}))

const mockOverview = vi.fn()
const mockBooks = vi.fn()

vi.mock('./hooks', () => ({
  useArchiveOverview: (...args: Array<unknown>) => mockOverview(...args),
  useArchiveBooks: (...args: Array<unknown>) => mockBooks(...args),
  useArchiveBookDetail: () => ({ data: undefined, isPending: true, isError: false }),
}))

const BOOK_ONE = {
  bookVersionId: 'v1',
  title: 'Book One',
  author: 'Author A',
  coverKey: null,
  format: 'epub',
  readStatus: 'finished',
  highlights: 75,
  bookmarks: 2,
  ideas: 5,
  reviews: 1,
  total: 83,
  lastRecordAt: 200,
  firstRecordAt: 100,
}

const BOOK_TWO = {
  bookVersionId: 'v2',
  title: 'Book Two',
  author: 'Author B',
  coverKey: null,
  format: 'txt',
  readStatus: 'reading',
  highlights: 8,
  bookmarks: 0,
  ideas: 2,
  reviews: 0,
  total: 10,
  lastRecordAt: 100,
  firstRecordAt: 50,
}

describe('RecordsHome', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    mockOverview.mockReset()
    mockOverview.mockReturnValue({
      data: {
        data: {
          counts: { highlights: 83, bookmarks: 2, ideas: 7, reviews: 1 },
          recent: [BOOK_ONE, BOOK_TWO],
        },
      },
      isPending: false,
      isError: false,
    })
  })

  it('renders real counts and recent books without hardcoded numbers', () => {
    const { container } = render(<RecordsHome baseSearch={{}} onOpenChild={vi.fn()} />)
    expect(screen.getByText('83')).toBeInTheDocument()
    expect(screen.getAllByText('2').length).toBeGreaterThan(1)
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('Book One')).toBeInTheDocument()
    const body = container.textContent ?? ''
    expect(body).toContain('划线 75')
    expect(body).toContain('书签 2')
    expect(body).toContain('想法 5')
    expect(body).toContain('书评 1')
    expect(body).toContain('划线 8')
    expect(body).not.toContain('条划线')
    expect(body).not.toContain('个书签')
    expect(body).not.toContain('篇书评')
    expect(body).not.toContain('书签 0')
    expect(body).not.toContain('书评 0')
    expect(screen.getByText('查看全部')).toBeInTheDocument()
  })

  it('shows the empty state when nothing was recorded', () => {
    mockOverview.mockReturnValue({
      data: { data: { counts: { highlights: 0, bookmarks: 0, ideas: 0, reviews: 0 }, recent: [] } },
      isPending: false,
      isError: false,
    })
    render(<RecordsHome baseSearch={{}} onOpenChild={vi.fn()} />)
    expect(screen.getByText('还没有阅读记录，去读一本书并留下第一条划线吧')).toBeInTheDocument()
  })
})

describe('AllRecordsView', () => {
  const onChange = vi.fn()
  const onBack = vi.fn()

  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    vi.useFakeTimers()
    onChange.mockClear()
    onBack.mockClear()
    mockBooks.mockReturnValue({
      data: { data: { entries: [BOOK_ONE, BOOK_TWO], page: 1, hasMore: false } },
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('switching the type tab notifies the parent so filtering takes effect', () => {
    render(<AllRecordsView params={{ q: '', type: 'all', sort: 'recent', page: 1 }} baseSearch={{}} onChange={onChange} onOpenBook={vi.fn()} onBack={onBack} />)
    fireEvent.click(screen.getByRole('tab', { name: '书评' }))
    expect(onChange).toHaveBeenCalledWith({ type: 'review', page: 1 })
  })

  it('opens the sort menu and picks a new order', () => {    render(<AllRecordsView params={{ q: '', type: 'all', sort: 'recent', page: 1 }} baseSearch={{}} onChange={onChange} onOpenBook={vi.fn()} onBack={onBack} />)
    fireEvent.click(screen.getByRole('button', { name: '最近记录' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(6)
    fireEvent.click(screen.getByRole('menuitemradio', { name: '最早记录' }))
    expect(onChange).toHaveBeenCalledWith({ sort: 'earliest', page: 1 })
  })

  it('passes the active type filter to the book detail link', () => {
    render(<AllRecordsView params={{ q: '', type: 'bookmark', sort: 'recent', page: 1 }} baseSearch={{}} onChange={onChange} onOpenBook={vi.fn()} onBack={onBack} />)
    const link = screen.getByText('Book One').closest('[data-search]')
    expect(link).not.toBeNull()
    expect(JSON.parse(link!.getAttribute('data-search')!)).toMatchObject({
      view: 'book',
      bookId: 'v1',
      from: 'all',
      bookType: 'bookmark',
    })
  })

  it('passes bookType all when entering from the unfiltered list', () => {
    render(<AllRecordsView params={{ q: '', type: 'all', sort: 'recent', page: 1 }} baseSearch={{}} onChange={onChange} onOpenBook={vi.fn()} onBack={onBack} />)
    const link = screen.getByText('Book One').closest('[data-search]')
    expect(JSON.parse(link!.getAttribute('data-search')!)).toMatchObject({ bookType: 'all' })
  })

  it('typing in search notifies the parent after a debounce', () => {
    render(<AllRecordsView params={{ q: '', type: 'all', sort: 'recent', page: 1 }} baseSearch={{}} onChange={onChange} onOpenBook={vi.fn()} onBack={onBack} />)
    fireEvent.change(screen.getByPlaceholderText('搜索书名'), { target: { value: 'One' } })
    expect(onChange).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(onChange).toHaveBeenCalledWith({ q: 'One', page: 1 })
  })

  it('shows the no-match state when filters hide every book', () => {
    mockBooks.mockReturnValue({
      data: { data: { entries: [], page: 1, hasMore: false } },
      isPending: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    })
    render(<AllRecordsView params={{ q: 'missing', type: 'all', sort: 'recent', page: 1 }} baseSearch={{}} onChange={onChange} onOpenBook={vi.fn()} onBack={onBack} />)
    expect(screen.getByText('没有找到匹配的书籍')).toBeInTheDocument()
  })
})

describe('archive display helpers', () => {
  it('hides whitespace and punctuation-only source excerpts without rejecting short text', () => {
    expect(hasReadableText('   ')).toBe(false)
    expect(hasReadableText('。')).toBe(false)
    expect(hasReadableText('好')).toBe(true)
    expect(hasReadableText('OK')).toBe(true)
  })

  it('lists nonzero counts in card order without measure words', () => {
    const t = (key: string) => ({ 'archive.highlights': '划线', 'archive.bookmarks': '书签', 'archive.ideas': '想法', 'archive.reviews': '书评' })[key]!
    expect(archiveCountParts({ highlights: 5, bookmarks: 0, ideas: 4, reviews: 1 }, t)).toEqual([
      { key: 'highlights', label: '划线', value: 5 },
      { key: 'ideas', label: '想法', value: 4 },
      { key: 'reviews', label: '书评', value: 1 },
    ])
    expect(archiveCountParts({ highlights: 0, bookmarks: 0, ideas: 0, reviews: 0 }, t)).toEqual([])
  })
})

describe('SortMenu', () => {
  const options = [
    { value: 'chapter' as const, label: '章节顺序' },
    { value: 'recent' as const, label: '最近记录' },
  ]

  it('shows the active option and notifies on pick', () => {
    const onChange = vi.fn()
    render(<SortMenu value="chapter" options={options} onChange={onChange} label="排序方式" />)
    fireEvent.click(screen.getByRole('button', { name: '章节顺序' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
    expect(screen.getByRole('menuitemradio', { name: '章节顺序' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: '最近记录' }))
    expect(onChange).toHaveBeenCalledWith('recent')
  })
})
