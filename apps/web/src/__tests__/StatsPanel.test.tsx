import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReadingLedgerRes } from '@bookdock/shared'

import StatsPanel from '@/features/reader/components/StatsPanel'

const state = vi.hoisted(() => ({ ledger: null as ReadingLedgerRes | null, error: false, retry: vi.fn() }))
vi.mock('@/api/hooks/reading-records', async (original) => ({
  ...await original<typeof import('@/api/hooks/reading-records')>(),
  useReadingLedger: () => ({ data: { data: state.ledger }, isPending: false, isError: state.error, isFetching: false, refetch: state.retry }),
  useDeleteSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))
vi.mock('@tanstack/react-router', () => ({ Link: ({ children, search, to, ...props }: { children: React.ReactNode; to: string; search: unknown }) => <a href={to} data-search={JSON.stringify(search)} {...props}>{children}</a> }))
vi.mock('@/features/library/hooks', () => ({
  useBook: () => ({ data: null, isPending: false, isError: false }),
}))
vi.mock('@/features/reader/components/AddRecordDialog', () => ({ default: () => <div data-testid="quick-add" /> }))

beforeEach(() => {
  vi.clearAllMocks()
  state.error = false
  state.ledger = {
    bookId: 'b1', title: 'A book', author: 'An author', sourceAvailable: true, currentRoundId: 'r2', coverage: 0.25, totalSeconds: 9000,
    legacyCoverage: true, legacyDaily: [{ date: '2026-10-16', durationSeconds: 3600 }], legacyIntervals: [[0, 0.1]], legacyWordCount: 10000,
    rounds: [
      { id: 'r2', ordinal: 2, status: 'reading', startedAt: Date.parse('2026-10-18T10:00:00Z'), endedAt: null, coverage: 0.25, totalSeconds: 120, wordCount: 10000, legacyCoverage: false },
      { id: 'r1', ordinal: 1, status: 'finished', startedAt: Date.parse('2026-10-16T10:00:00Z'), endedAt: Date.parse('2026-10-17T10:00:00Z'), coverage: 1, totalSeconds: 8880, wordCount: 10000, legacyCoverage: true },
    ],
    sessions: [{ id: 's1', roundId: 'r2', source: 'auto', date: '2026-10-18', startedAt: null, endedAt: null, durationSeconds: 120, startFraction: 0, endFraction: 0.25, wordCount: 10000, coverage: [[0, 0.25]], fragments: [], timezone: 'Asia/Shanghai' }],
  }
})

describe('reader statistics overview', () => {
  it('shows combined history without exposing reading rounds', () => {
    render(<StatsPanel bookId="b1" />)
    expect(within(screen.getByText('reader.statsProgress').parentElement!).getByText('25%')).toBeInTheDocument()
    expect(within(screen.getByText('reader.statsReadingDays').parentElement!).getByText('2')).toBeInTheDocument()
    expect(screen.getByText(/readingData.roundOrdinal/)).toBeInTheDocument()
    expect(screen.queryByText('readingData.legacyHint')).not.toBeInTheDocument()
    expect(screen.queryByText('reader.statsTrend30')).not.toBeInTheDocument()
    expect(screen.getByText('reader.detailRecords')).toBeInTheDocument()
  })

  it('offers the shared quick entry', () => {
    render(<StatsPanel bookId="b1" />)
    fireEvent.click(screen.getByText('reader.detailAdd'))
    expect(screen.getByTestId('quick-add')).toBeInTheDocument()
  })

  it('keeps quick entry available for empty history', () => {
    state.ledger!.totalSeconds = 0
    state.ledger!.legacyDaily = []
    state.ledger!.legacyIntervals = []
    state.ledger!.rounds = []
    state.ledger!.sessions = []
    render(<StatsPanel bookId="b1" />)
    expect(screen.getByText('reader.statsEmptyTitle')).toBeInTheDocument()
    expect(screen.getByText('reader.statsEmptyDesc')).toBeInTheDocument()
  })

  it('uses an explicit retry state when the ledger cannot be loaded', () => {
    state.error = true
    render(<StatsPanel bookId="b1" />)
    expect(screen.queryByText('reader.statsProgress')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(state.retry).toHaveBeenCalledOnce()
  })
})
