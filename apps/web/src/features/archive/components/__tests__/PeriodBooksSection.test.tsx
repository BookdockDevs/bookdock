import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import i18n from '@/i18n/i18n'
import PeriodBooksSection from '../PeriodBooksSection'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, search, onClick, className }: { children: React.ReactNode; search?: unknown; onClick?: () => void; className?: string }) => (
    <a href="#" data-search={search ? JSON.stringify(search) : undefined} onClick={onClick} className={className}>
      {children}
    </a>
  ),
}))

const mockBooksInfinite = vi.fn()

vi.mock('../../hooks', () => ({
  useArchiveBooksInfinite: (...args: unknown[]) => mockBooksInfinite(...args),
}))

const BOOK_ONE = {
  bookVersionId: 'b1',
  title: '三体',
  author: '刘慈欣',
  coverKey: null,
  format: 'epub' as const,
  readStatus: 'reading' as const,
  durationSeconds: 3600,
  readingDays: 3,
  progress: 45.2,
  highlights: 2,
  bookmarks: 0,
  ideas: 1,
  reviews: 0,
  total: 3,
  lastRecordAt: 1000,
  firstRecordAt: 500,
}

const BOOK_TWO = {
  bookVersionId: 'b2',
  title: '百年孤独',
  author: '马尔克斯',
  coverKey: null,
  format: 'epub' as const,
  readStatus: 'finished' as const,
  durationSeconds: 5400,
  readingDays: 5,
  progress: 100,
  highlights: 10,
  bookmarks: 2,
  ideas: 0,
  reviews: 1,
  total: 13,
  lastRecordAt: 2000,
  firstRecordAt: 1000,
}

describe('PeriodBooksSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    void i18n.changeLanguage('zh-CN')
  })

  it('renders books with period metrics and triggers selection on click', () => {
    mockBooksInfinite.mockReturnValue({
      data: { pages: [{ data: { entries: [BOOK_ONE, BOOK_TWO], hasMore: false } }] },
      isLoading: false,
    })

    const onSelect = vi.fn()
    render(
      <PeriodBooksSection
        period="week"
        baseSearch={{}}
        onSelectBook={onSelect}
      />,
    )

    expect(screen.getByText('本周读过的书')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('三体')).toBeInTheDocument()
    expect(screen.getByText('刘慈欣')).toBeInTheDocument()
    expect(screen.getByText('读了 3 天')).toBeInTheDocument()
    expect(screen.getByText('百年孤独')).toBeInTheDocument()
    expect(screen.getByText('读了 5 天')).toBeInTheDocument()

    fireEvent.click(screen.getByText('三体'))
    expect(onSelect).toHaveBeenCalledWith('b1')
  })

  it('adapts title according to period', () => {
    mockBooksInfinite.mockReturnValue({
      data: { pages: [{ data: { entries: [BOOK_ONE], hasMore: false } }] },
      isLoading: false,
    })

    const { rerender } = render(<PeriodBooksSection period="month" baseSearch={{}} />)
    expect(screen.getByText('本月读过的书')).toBeInTheDocument()

    rerender(<PeriodBooksSection period="year" baseSearch={{}} />)
    expect(screen.getByText('今年读过的书')).toBeInTheDocument()

    rerender(<PeriodBooksSection period="all" baseSearch={{}} />)
    expect(screen.getByText('全部读过的书')).toBeInTheDocument()

    rerender(<PeriodBooksSection selectedDate="2026-10-20" baseSearch={{}} />)
    expect(screen.getByText('10月20日读过的书')).toBeInTheDocument()
  })

  it('shows friendly empty state when no books were read in the period', () => {
    mockBooksInfinite.mockReturnValue({
      data: { pages: [{ data: { entries: [], hasMore: false } }] },
      isLoading: false,
    })

    const { rerender } = render(<PeriodBooksSection period="week" baseSearch={{}} />)
    expect(screen.getByText('本周还没有阅读记录')).toBeInTheDocument()

    rerender(<PeriodBooksSection period="month" baseSearch={{}} />)
    expect(screen.getByText('本月还没有阅读记录')).toBeInTheDocument()

    rerender(<PeriodBooksSection selectedDate="2026-10-20" baseSearch={{}} />)
    expect(screen.getByText('当天还没有阅读记录')).toBeInTheDocument()
  })
})
