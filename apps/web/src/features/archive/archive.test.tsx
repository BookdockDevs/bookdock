import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, act } from '@testing-library/react'

import i18n from '@/i18n/i18n'

import AllRecordsView from './AllRecordsView'
import RecordsHome from './RecordsHome'
import { hasReadableText } from './components/archive-helpers'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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
    render(<RecordsHome baseSearch={{}} onOpenChild={vi.fn()} />)
    expect(screen.getByText('83')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('Book One')).toBeInTheDocument()
    expect(screen.getByText('75 条划线 · 2 个书签 · 5 条想法 · 1 篇书评')).toBeInTheDocument()
    expect(screen.getByText('8 条划线 · 2 条想法')).toBeInTheDocument()
    expect(screen.queryByText(/0 条划线/)).not.toBeInTheDocument()
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
})

