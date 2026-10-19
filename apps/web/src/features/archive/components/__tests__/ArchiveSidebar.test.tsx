import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

import i18n from '@/i18n/i18n'

import ArchiveSidebar from '../ArchiveSidebar'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, search, onClick, className }: { children: React.ReactNode; search?: unknown; onClick?: () => void; className?: string }) => (
    <a href="#" data-search={search ? JSON.stringify(search) : undefined} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}))

const mockBooksInfinite = vi.fn()
const mockOverview = vi.fn()
const mockReadingSummary = vi.fn((_from?: string, _to?: string) => ({
  data: {
    data: {
      totalSeconds: 3600,
      scope: { totalSeconds: 1800 },
    },
  },
  isLoading: false,
  isError: false,
}))

vi.mock('../../hooks', () => ({
  useArchiveBooksInfinite: (...args: unknown[]) => mockBooksInfinite(...args),
  useArchiveOverview: (...args: unknown[]) => mockOverview(...args),
}))

vi.mock('@/api/hooks/reading-records', () => ({
  useReadingSummary: (...args: unknown[]) => mockReadingSummary(...args),
}))

const BOOK_ONE = {
  bookVersionId: 'b1',
  title: 'Test Book One',
  author: 'Author A',
  coverKey: null,
  format: 'epub' as const,
  readStatus: 'reading' as const,
  highlights: 5,
  bookmarks: 1,
  ideas: 2,
  reviews: 0,
  total: 8,
  lastRecordAt: 1000,
  firstRecordAt: 500,
}

describe('ArchiveSidebar', () => {
  it('labels reading-only books without showing a misleading record time', () => {
    const readingOnly = { ...BOOK_ONE, highlights: 0, bookmarks: 0, ideas: 0, reviews: 0, total: 0, firstRecordAt: null, lastRecordAt: null }
    mockOverview.mockReturnValue({ data: { data: { counts: { highlights: 0, bookmarks: 0, ideas: 0, reviews: 0, total: 0 }, totalBooks: 1 } }, isPending: false, isError: false })
    mockBooksInfinite.mockReturnValue({ data: { pages: [{ data: { entries: [readingOnly], hasMore: false } }] }, isPending: false, isError: false })
    const { container } = render(<ArchiveSidebar params={{ q: '', type: 'all', sort: 'recent' }} baseSearch={{}} onChange={vi.fn()} onSelectOverview={vi.fn()} onSelectBook={vi.fn()} />)
    expect(screen.getByText('在读')).toBeInTheDocument()
    expect(screen.queryByText('暂无笔记')).not.toBeInTheDocument()
    expect(container.querySelector('time')).toBeNull()
  })

  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    mockOverview.mockReturnValue({
      data: {
        data: {
          counts: { highlights: 5, bookmarks: 1, ideas: 2, reviews: 0, total: 8 },
          totalBooks: 12,
        },
      },
      isPending: false,
      isError: false,
    })
    mockBooksInfinite.mockReturnValue({
      data: {
        pages: [
          {
            data: {
              entries: [BOOK_ONE],
              page: 1,
              hasMore: false,
            },
          },
        ],
      },
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      isPending: false,
      isError: false,
    })
  })

  it('renders overview card and highlights active item', () => {
    const onSelectOverview = vi.fn()
    const onSelectBook = vi.fn()

    render(
      <ArchiveSidebar
        selectedBookId={undefined}
        params={{ q: '', type: 'all', sort: 'recent' }}
        baseSearch={{}}
        onChange={vi.fn()}
        onSelectOverview={onSelectOverview}
        onSelectBook={onSelectBook}
      />,
    )

    expect(screen.getByText('全部档案')).toBeInTheDocument()
    expect(screen.getByText('12 本书 · 8 条笔记')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Test Book One' })).toBeInTheDocument()
    expect(screen.getByText(/1\s*小时/)).toBeInTheDocument()
  })

  it('notifies on book selection', () => {
    const onSelectBook = vi.fn()
    render(
      <ArchiveSidebar
        selectedBookId="b1"
        params={{ q: '', type: 'all', sort: 'recent' }}
        baseSearch={{}}
        onChange={vi.fn()}
        onSelectOverview={vi.fn()}
        onSelectBook={onSelectBook}
      />,
    )

    const bookRow = screen.getByRole('heading', { name: 'Test Book One' })
    fireEvent.click(bookRow)
    expect(onSelectBook).toHaveBeenCalledWith('b1')
  })

  it('renders scoped period overview numbers and title when range is provided', () => {
    const scopedRange = { from: '2026-10-12', to: '2026-10-18', timezone: 'Asia/Shanghai' }
    mockOverview.mockReturnValue({
      data: {
        data: {
          counts: { highlights: 2, bookmarks: 0, ideas: 1, reviews: 0, total: 3 },
          totalBooks: 2,
        },
      },
      isPending: false,
      isError: false,
    })

    render(
      <ArchiveSidebar
        range={scopedRange}
        params={{ q: '', type: 'all', sort: 'recent' }}
        baseSearch={{}}
        onChange={vi.fn()}
        onSelectOverview={vi.fn()}
        onSelectBook={vi.fn()}
      />,
    )

    expect(screen.getByText('总览')).toBeInTheDocument()
    expect(screen.getByText('2 本书 · 3 条笔记')).toBeInTheDocument()
    expect(screen.getByText(/30\s*分钟/)).toBeInTheDocument()
    expect(mockReadingSummary).toHaveBeenCalledWith('2026-10-12', '2026-10-18', 'Asia/Shanghai')
    expect(mockOverview).toHaveBeenCalledWith(scopedRange)
  })

  it('passes the type and search to the live list and exposes all sort options', () => {
    const onChange = vi.fn()
    const { rerender } = render(<ArchiveSidebar params={{ q: 'Test', type: 'bookmark', sort: 'recent' }} baseSearch={{ type: 'bookmark' }} onChange={onChange} onSelectOverview={vi.fn()} onSelectBook={vi.fn()} />)
    expect(mockBooksInfinite).toHaveBeenLastCalledWith({ search: 'Test', type: 'bookmark', sort: 'recent', pageSize: 20 })
    expect(screen.getByLabelText('移除类型筛选')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('移除类型筛选'))
    expect(onChange).toHaveBeenCalledWith({ type: 'all' })

    rerender(<ArchiveSidebar params={{ q: 'Test', type: 'all', sort: 'recent' }} baseSearch={{ type: 'all' }} onChange={onChange} onSelectOverview={vi.fn()} onSelectBook={vi.fn()} />)
    fireEvent.click(screen.getByTitle('筛选'))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '书评' }))
    expect(onChange).toHaveBeenCalledWith({ type: 'review' })
    fireEvent.click(screen.getByRole('menuitemradio', { name: '阅读时长' }))
    expect(onChange).toHaveBeenCalledWith({ sort: 'reading-time' })
  })

  it('supports multi-select for note types and toggling sort direction', () => {
    const onChange = vi.fn()
    // 1. Multi-select: start with 'highlight' already selected
    const { rerender } = render(
      <ArchiveSidebar
        params={{ q: '', type: 'highlight', sort: 'reading-time' }}
        baseSearch={{}}
        onChange={onChange}
        onSelectOverview={vi.fn()}
        onSelectBook={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTitle('筛选'))
    // Clicking another type appends it
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '想法' }))
    expect(onChange).toHaveBeenCalledWith({ type: 'highlight,idea' })

    // 2. Sort direction toggle: clicking active 'reading-time' toggles to 'reading-time-asc'
    fireEvent.click(screen.getByRole('menuitemradio', { name: /阅读时长/ }))
    expect(onChange).toHaveBeenCalledWith({ sort: 'reading-time-asc' })

    // 3. Status single-select (aligned with home page)
    rerender(
      <ArchiveSidebar
        params={{ q: '', type: 'all', sort: 'recent', readStatus: 'reading' }}
        baseSearch={{}}
        onChange={onChange}
        onSelectOverview={vi.fn()}
        onSelectBook={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('menuitemradio', { name: '读完' }))
    expect(onChange).toHaveBeenCalledWith({ readStatus: 'finished' })
  })

  it('renders reading duration and progress on book row, or days if no duration', () => {
    const bookWithStats = {
      ...BOOK_ONE,
      durationSeconds: 240,
      readingDays: 3,
      progress: 47,
    }
    mockBooksInfinite.mockReturnValue({
      data: { pages: [{ data: { entries: [bookWithStats], hasMore: false } }] },
      isPending: false,
      isError: false,
    })
    render(<ArchiveSidebar params={{ q: '', type: 'all', sort: 'recent' }} baseSearch={{}} onChange={vi.fn()} onSelectOverview={vi.fn()} onSelectBook={vi.fn()} />)
    expect(screen.getByText('阅读 4 分钟')).toBeInTheDocument()
    expect(screen.getByText('47%')).toBeInTheDocument()
  })

  it('debounces search changes without an obsolete page-number parameter', () => {
    vi.useFakeTimers()
    try {
      const onChange = vi.fn()
      render(<ArchiveSidebar params={{ q: '', type: 'all', sort: 'recent' }} baseSearch={{}} onChange={onChange} onSelectOverview={vi.fn()} onSelectBook={vi.fn()} />)
      fireEvent.change(screen.getByLabelText('搜索书名'), { target: { value: 'Night' } })
      expect(onChange).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(300) })
      expect(onChange).toHaveBeenCalledWith({ q: 'Night' })
    } finally { vi.useRealTimers() }
  })

  it('conditionally shows active note type count or total notes on book row', () => {
    // With type: 'all', shows total notes in compact format
    const { rerender } = render(
      <ArchiveSidebar params={{ q: '', type: 'all', sort: 'recent' }} baseSearch={{}} onChange={vi.fn()} onSelectOverview={vi.fn()} onSelectBook={vi.fn()} />,
    )
    expect(screen.getByText('笔记 8')).toBeInTheDocument()

    // With type: 'highlight', shows only highlight count in compact format
    rerender(
      <ArchiveSidebar params={{ q: '', type: 'highlight', sort: 'recent' }} baseSearch={{ type: 'highlight' }} onChange={vi.fn()} onSelectOverview={vi.fn()} onSelectBook={vi.fn()} />,
    )
    expect(screen.getByText('划线 5')).toBeInTheDocument()
    expect(screen.queryByText('笔记 8')).not.toBeInTheDocument()
  })
})
