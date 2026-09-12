import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import ReadingDetailList from '../features/reader/components/ReadingDetailList'
import { useReadingDetailInfinite } from '@/api/hooks/reading-records'

vi.mock('@/api/hooks/reading-records', () => ({
  useReadingDetailInfinite: vi.fn(),
  useUpdateSession: () => ({ mutate: vi.fn() }),
  useDeleteSession: () => ({ mutate: vi.fn() }),
}))

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('ReadingDetailList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders auto-recorded session with unit-bearing duration, avoiding clock ambiguity', () => {
    vi.mocked(useReadingDetailInfinite).mockReturnValue({
      data: {
        pages: [
          {
            data: [
              {
                kind: 'autoDay',
                date: '2026-09-13',
                durationSeconds: 131, // 2 minutes 11 seconds
              },
            ],
            nextCursor: null,
          },
        ],
        pageParams: [null],
      },
      isError: false,
      isFetching: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as any)

    renderWithClient(<ReadingDetailList bookId="book-1" />)

    expect(screen.getByText('reader.detailRecords')).toBeInTheDocument()
    expect(screen.getByText('reader.detailAutoBadge')).toBeInTheDocument()

    // Verifies duration format includes minutes and seconds rather than bare clock format "2:11"
    const sessionItem = screen.getByText(/2026-09-13/)
    expect(sessionItem.textContent).not.toContain('2:11')
    expect(sessionItem.textContent).toMatch(/stats\.durationMinutes.*stats\.durationSeconds|2.*11/)
  })

  it('renders manual session item with progress range', () => {
    vi.mocked(useReadingDetailInfinite).mockReturnValue({
      data: {
        pages: [
          {
            data: [
              {
                kind: 'manual',
                id: 'sess-1',
                bookId: 'book-1',
                startedAt: 1726200000000,
                durationSeconds: 3600,
                date: '2026-09-13',
                startChapterIndex: 0,
                endChapterIndex: 1,
                startFraction: 0.1,
                endFraction: 0.35,
              },
            ],
            nextCursor: null,
          },
        ],
        pageParams: [null],
      },
      isError: false,
      isFetching: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
    } as any)

    renderWithClient(<ReadingDetailList bookId="book-1" />)

    expect(screen.getByText(/10% →.*35%/)).toBeInTheDocument()
  })
})
