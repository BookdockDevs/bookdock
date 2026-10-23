import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReadingLedgerRes, ReadingRange } from '@bookdock/shared'

import BookReadingData from './BookReadingData'
import { ledgerScopedWords, ledgerTimeDistribution } from './reading-ledger-stats'

const state = vi.hoisted(() => ({ ledger: null as ReadingLedgerRes | null, mutate: vi.fn(), pageSize: 50 }))
vi.mock('@/api/hooks/reading-records', async (original) => ({
  ...await original<typeof import('@/api/hooks/reading-records')>(),
  useReadingLedger: () => ({ data: { data: state.ledger }, isPending: false, isError: false }),
  useReadingRound: () => ({ mutate: state.mutate, isPending: false }),
  useDeleteSession: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSession: () => ({ mutate: vi.fn(), isPending: false }),
  useBookReadingLedgerStats: (_bookId: string, range?: ReadingRange) => {
    const ledger = state.ledger
    const sessions = ledger?.sessions ?? []
    const coverage = Math.max(ledger?.coverage ?? 0, ...sessions.flatMap((session) => session.coverage.map(([, end]) => end)))
    const distribution = ledgerTimeDistribution(sessions, range)
    for (const day of ledger?.legacyDaily ?? []) if ((!range?.from || day.date >= range.from) && (!range?.to || day.date <= range.to)) distribution.days.set(day.date, (distribution.days.get(day.date) ?? 0) + day.durationSeconds)
    const scopedWords = ledgerScopedWords(sessions, range).words + (!range?.from && !range?.to ? (ledger?.legacyIntervals ?? []).reduce((sum, [start, end]) => sum + end - start, 0) * (ledger?.legacyWordCount ?? 0) : 0)
    return { data: { data: { dataVersion: 1, totalSeconds: [...distribution.days.values()].reduce((sum, value) => sum + value, 0), totalWordsRead: Math.round(scopedWords), wordState: 'known', readingDays: [...distribution.days.values()].filter((value) => value >= 60).length, daily: [...distribution.days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, durationSeconds]) => ({ date, durationSeconds, totalWordsRead: null, wordState: 'known', progressDelta: 0, cumulativeCoverage: coverage })), hourly: [], legacyDaily: (ledger?.legacyDaily ?? []).filter((day) => (!range?.from || day.date >= range.from) && (!range?.to || day.date <= range.to)), remainingSeconds: null } } }
  },
  useBookReadingSessions: (_bookId: string, range?: ReadingRange) => {
    const [pageSize, setPageSize] = useState(50)
    useEffect(() => setPageSize(50), [range?.from, range?.to])
    const allItems = (state.ledger?.sessions ?? []).filter((session) => {
      const dates = session.contributionDates ?? [session.date]
      return (!range?.from || dates.some((date) => date >= range.from!)) && (!range?.to || dates.some((date) => date <= range.to!))
    })
    const items = allItems.slice(0, pageSize)
    return { data: { pages: [{ data: { dataVersion: 1, items, nextCursor: pageSize < allItems.length ? 'next' : null, hasMore: pageSize < allItems.length } }] }, hasNextPage: pageSize < allItems.length, fetchNextPage: () => setPageSize(allItems.length), isFetchingNextPage: false, isError: false }
  },
}))
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string, params?: Record<string, string | number>) => params ? `${key} ${JSON.stringify(params)}` : key }))

function renderData(range?: ReadingRange, onSelectDate?: (date: string | null) => void) {
  return render(<QueryClientProvider client={new QueryClient()}><BookReadingData bookId="b1" range={range} onSelectDate={onSelectDate} /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  state.pageSize = 50
  state.ledger = {
    bookId: 'b1', title: 'A book', author: 'An author', sourceAvailable: false, currentRoundId: 'r1', legacyCoverage: true,
    coverage: 0.2, totalSeconds: 3661, legacyDaily: [{ date: '2026-10-17', durationSeconds: 3600 }], legacyIntervals: [[0, 0.1]], legacyWordCount: 10000,
    rounds: [{ id: 'r1', ordinal: 1, status: 'reading', startedAt: Date.parse('2026-10-17T12:00:00Z'), endedAt: null, coverage: 0.2, totalSeconds: 3661, wordCount: 10000, legacyCoverage: true }],
    sessions: [{ id: 's1', roundId: 'r1', source: 'auto', date: '2026-10-17', startedAt: null, endedAt: null, durationSeconds: 61, startFraction: 0.1, endFraction: 0.2, wordCount: 10000, coverage: [[0.1, 0.2]], fragments: [], timezone: 'Asia/Shanghai' }],
  }
})

describe('single-book reading data', () => {
  it('displays appended-content progress without changing historical facts', () => {
    state.ledger!.sessions[0].progressScale = 0.5
    const original = structuredClone(state.ledger!.sessions[0])
    renderData()
    expect(screen.getByText('5-10')).toBeInTheDocument()
    expect(state.ledger!.sessions[0]).toEqual(original)
  })

  it('shows only a cross-midnight contribution while retaining the complete record for maintenance', () => {
    state.ledger!.legacyDaily = []
    state.ledger!.sessions[0] = { ...state.ledger!.sessions[0], durationSeconds: 120, fragments: [{ startedAt: Date.parse('2026-10-17T15:59:30Z'), endedAt: Date.parse('2026-10-17T16:01:30Z') }], contributionDates: ['2026-10-17', '2026-10-18'] }
    const original = structuredClone(state.ledger!.sessions[0])
    renderData({ from: '2026-10-18', to: '2026-10-18' })
    expect(within(screen.getAllByText('readingData.words')[0].parentElement!).getByText('750')).toBeInTheDocument()
    expect(screen.getAllByLabelText('readingData.moreActions')).toHaveLength(1)
    fireEvent.click(screen.getByLabelText('readingData.moreActions'))
    expect(screen.getByText('reader.sessionDelete')).toBeInTheDocument()
    expect(state.ledger!.sessions[0]).toEqual(original)
  })

  it('filters legacy days and unknown-time sessions together without assigning undated baseline words', () => {
    state.ledger!.legacyDaily!.push({ date: '2026-10-16', durationSeconds: 3600 })
    renderData({ from: '2026-10-17', to: '2026-10-17' })
    expect(within(screen.getAllByText('readingData.words')[0].parentElement!).getByText('1,000')).toBeInTheDocument()
    expect(screen.queryByText('readingData.partialWords')).not.toBeInTheDocument()
    expect(screen.queryByText('readingData.remaining')).not.toBeInTheDocument()
    expect(screen.queryByText('readingData.coverage')).not.toBeInTheDocument()
    expect(screen.queryByText(/2026-10-16 ·/)).not.toBeInTheDocument()
  })

  it('renders calendar days as non-clickable items without exposing round controls', () => {
    const select = vi.fn()
    renderData({ from: '2026-10-17', to: '2026-10-18' }, select)
    expect(screen.getByLabelText('17')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '17' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('readingData.round')).not.toBeInTheDocument()
    expect(select).not.toHaveBeenCalled()
  })

  it('resets paging when an externally selected range changes', () => {
    const template = state.ledger!.sessions[0]
    state.ledger!.sessions = Array.from({ length: 60 }, (_unused, index) => ({ ...template, id: `s${index}` }))
    const client = new QueryClient()
    const view = render(<QueryClientProvider client={client}><BookReadingData bookId="b1" range={{ from: '2026-10-17', to: '2026-10-17' }} /></QueryClientProvider>)
    expect(screen.getAllByLabelText('readingData.moreActions')).toHaveLength(50)
    fireEvent.click(screen.getByText('reader.sessionLoadMore'))
    expect(screen.getAllByLabelText('readingData.moreActions')).toHaveLength(60)
    view.rerender(<QueryClientProvider client={client}><BookReadingData bookId="b1" range={{ from: '2026-10-18', to: '2026-10-18' }} /></QueryClientProvider>)
    expect(screen.queryByLabelText('readingData.moreActions')).not.toBeInTheDocument()
  })

  it('retains baseline duration, reading days and words when the source is gone', () => {
    renderData()
    const timeCard = screen.getAllByText('readingData.duration')[0].parentElement!
    expect(within(timeCard).getByText(/stats.durationHours/)).toBeInTheDocument()
    expect(within(screen.getByText('readingData.days').parentElement!).getByText('1')).toBeInTheDocument()
    expect(within(screen.getAllByText('readingData.words')[0].parentElement!).getByText('2,000')).toBeInTheDocument()
    expect(screen.getByText(/readingData.legacyDuration/)).toBeInTheDocument()
  })

  it('offers automatic session deletion without offering edit', () => {
    renderData()
    fireEvent.click(screen.getByLabelText('readingData.moreActions'))
    expect(screen.getByText('reader.sessionDelete')).toBeInTheDocument()
    expect(screen.queryByText('reader.sessionEdit')).not.toBeInTheDocument()
  })

  it('unions coverage across rounds instead of showing only current-round progress', () => {
    state.ledger!.sessions.push({ ...state.ledger!.sessions[0], id: 's2', roundId: 'r2', coverage: [[0.2, 0.3]] })
    renderData()
    expect(screen.getAllByText('30%')[0]).toBeInTheDocument()
  })

  it('shows no round lifecycle shortcuts or compatibility banners', () => {
    state.ledger!.unalignedCoverage = true
    state.ledger!.rounds[0].coverageEstimated = true
    renderData()
    expect(screen.queryByLabelText('readingData.round')).not.toBeInTheDocument()
    for (const key of ['unalignedHint', 'legacyHint', 'partialWords', 'coverageEstimated', 'scopedHint', 'estimateHint', 'action.finish', 'action.abandon', 'action.reread']) {
      expect(screen.queryByText(`readingData.${key}`)).not.toBeInTheDocument()
    }
  })

  it('pages records without changing totals and resets paging on date changes', () => {
    const template = state.ledger!.sessions[0]
    state.ledger!.sessions = Array.from({ length: 60 }, (_unused, index) => ({ ...template, id: `s${index}` }))
    const client = new QueryClient()
    const view = render(<QueryClientProvider client={client}><BookReadingData bookId="b1" /></QueryClientProvider>)
    expect(screen.getAllByLabelText('readingData.moreActions')).toHaveLength(50)
    fireEvent.click(screen.getByText('reader.sessionLoadMore'))
    expect(screen.getAllByLabelText('readingData.moreActions')).toHaveLength(60)
    view.rerender(<QueryClientProvider client={client}><BookReadingData bookId="b1" range={{ from: '2026-10-17', to: '2026-10-17' }} /></QueryClientProvider>)
    expect(screen.getAllByLabelText('readingData.moreActions')).toHaveLength(50)
    expect(within(screen.getAllByText('readingData.duration')[0].parentElement!).getByText(/stats.durationHours/)).toBeInTheDocument()
  })

  it('displays multi-month lifetime calendar with start marker', () => {
    renderData()
    expect(screen.getAllByText('S').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByLabelText('17')).toBeInTheDocument()
  })

  it('keeps proportional coverage flags internal', () => {
    state.ledger!.rounds[0].coverageEstimated = true
    renderData()
    expect(screen.queryByText('readingData.coverageEstimated')).not.toBeInTheDocument()
  })
})
