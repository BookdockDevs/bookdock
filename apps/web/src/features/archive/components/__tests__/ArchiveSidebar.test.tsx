import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

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

vi.mock('../../hooks', () => ({
  useArchiveBooksInfinite: (...args: unknown[]) => mockBooksInfinite(...args),
  useArchiveOverview: (...args: unknown[]) => mockOverview(...args),
}))

vi.mock('@/api/hooks/reading-records', () => ({
  useReadingSummary: () => ({
    data: { data: { totalSeconds: 3600 } },
    isLoading: false,
    isError: false,
  }),
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
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
    mockOverview.mockReturnValue({
      data: {
        data: {
          counts: { highlights: 5, bookmarks: 1, ideas: 2, reviews: 0 },
          recent: [BOOK_ONE],
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

    expect(screen.getByText('总览')).toBeInTheDocument()
    expect(screen.getByText('Test Book One')).toBeInTheDocument()
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

    const bookRow = screen.getByText('Test Book One')
    fireEvent.click(bookRow)
    expect(onSelectBook).toHaveBeenCalledWith('b1')
  })
})
