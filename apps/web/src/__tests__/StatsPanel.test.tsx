import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import StatsPanel from '../features/reader/components/StatsPanel'
import { useBookReadingRecords } from '@/api/hooks/reading-records'

vi.mock('@/api/hooks/reading-records', () => ({
  useBookReadingRecords: vi.fn(),
  localDateString: (d: Date) => d.toISOString().slice(0, 10),
}))

vi.mock('@/features/reader/components/ReadingDetailList', () => ({
  default: () => <div data-testid="reading-detail-list">Mock ReadingDetailList</div>,
}))

vi.mock('@/api/client', () => ({
  apiGet: vi.fn().mockImplementation((url: string) => {
    if (url.includes('/books/')) {
      return Promise.resolve({ data: { id: 'book-1', title: 'Test Book', meta: { wordCount: 100000 } } })
    }
    if (url.includes('/progress/')) {
      return Promise.resolve({ data: { fraction: 0.5, readFraction: 0.5, rateSamples: [] } })
    }
    return Promise.resolve({ data: null })
  }),
}))

function renderWithClient(ui: React.ReactElement, queryClient?: QueryClient) {
  const client =
    queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('StatsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders warm empty state when there are no reading records', () => {
    vi.mocked(useBookReadingRecords).mockReturnValue({
      data: {
        data: {
          bookId: 'book-1',
          totalSeconds: 0,
          records: [],
        },
      },
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as any)

    renderWithClient(<StatsPanel bookId="book-1" />)

    expect(screen.getByText('reader.statsEmptyTitle')).toBeInTheDocument()
    expect(screen.getByText('reader.statsEmptyDesc')).toBeInTheDocument()
    expect(screen.getByTestId('reading-detail-list')).toBeInTheDocument()
  })

  it('renders KPI cards and 30-day trend chart when records exist', async () => {
    vi.mocked(useBookReadingRecords).mockReturnValue({
      data: {
        data: {
          bookId: 'book-1',
          totalSeconds: 7200, // 2 hours
          records: [
            { date: '2026-09-10', durationSeconds: 3600 },
            { date: '2026-09-11', durationSeconds: 3600 },
          ],
        },
      },
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as any)

    renderWithClient(<StatsPanel bookId="book-1" />)

    // KPI cards
    expect(screen.getByText('reader.statsTotalTime')).toBeInTheDocument()
    expect(screen.getAllByText('reader.statsProgress').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('reader.statsReadingDays')).toBeInTheDocument()
    expect(screen.getByText('reader.statsStartDate')).toBeInTheDocument()

    // Values in KPI cards
    expect(await screen.findByText('50')).toBeInTheDocument() // Progress value
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1) // Reading days & total hours
    expect(screen.getByText('2026-09-10')).toBeInTheDocument() // Start date

    // 30-day trend chart
    expect(screen.getByText('reader.statsTrend30')).toBeInTheDocument()
    expect(screen.getByText('reader.stats30DaysAgo')).toBeInTheDocument()
    expect(screen.getByText('reader.statsToday')).toBeInTheDocument()

    // Words & ETA section
    expect(await screen.findByText('reader.statsWordsRead')).toBeInTheDocument()
    expect(screen.getByText(/5万字/)).toBeInTheDocument()
    expect(screen.getByTestId('reading-detail-list')).toBeInTheDocument()
  })

  it('updates trend header on bar hover', () => {
    vi.mocked(useBookReadingRecords).mockReturnValue({
      data: {
        data: {
          bookId: 'book-1',
          totalSeconds: 3600,
          records: [
            { date: '2026-09-11', durationSeconds: 3600 },
          ],
        },
      },
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    } as any)

    renderWithClient(<StatsPanel bookId="book-1" />)

    const bars = screen.getAllByRole('img')
    expect(bars.length).toBe(30)

    // Find the bar with non-zero duration (the one with title containing 2026-09-11)
    const activeBar = bars.find((b) => b.getAttribute('title')?.includes('2026-09-11'))
    expect(activeBar).toBeDefined()

    if (activeBar) {
      fireEvent.mouseEnter(activeBar)
      // Tooltip header displays date and duration
      expect(screen.getByText(/09-11 · /)).toBeInTheDocument()

      fireEvent.mouseLeave(activeBar)
      // Restores to default daily avg
      expect(screen.getByText(/reader\.statsDailyAvg/)).toBeInTheDocument()
    }
  })
})
