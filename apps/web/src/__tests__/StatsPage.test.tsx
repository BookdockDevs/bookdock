import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as baseRender, screen, fireEvent } from '@testing-library/react'
import i18n from '../i18n/i18n'

import Stats from '../features/stats/Stats'
import { useAuthStore } from '../stores/auth.store'
import { localDateString, usePreviousReadingSummary, useReadingByTag, useReadingDaily, useReadingHourly, useReadingSummary } from '@/api/hooks/reading-records'
import { usePreviousArchiveOverview } from '@/features/archive/hooks'
import { eachDay, periodRange } from '../features/stats/date-utils'

vi.mock('@/api/hooks/reading-records', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/hooks/reading-records')>()
  return {
    ...original,
    useReadingSummary: vi.fn(),
    usePreviousReadingSummary: vi.fn(() => ({ data: undefined, isLoading: false })),
    useReadingDaily: vi.fn(),
    useReadingByTag: vi.fn(),
    useReadingHourly: vi.fn(),
  }
})

vi.mock('@/features/archive/hooks', () => ({
  useArchiveOverview: vi.fn(() => ({
    data: { data: { counts: { highlights: 10, bookmarks: 5, ideas: 3, reviews: 2, total: 20 }, totalBooks: 5 } },
    isLoading: false,
    isError: false,
  })),
  usePreviousArchiveOverview: vi.fn(() => ({
    data: undefined,
    isLoading: false,
    isError: false,
  })),
}))

// The page header uses Link for the back button; no router is mounted here.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to?: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouter: () => ({
    history: {
      canGoBack: () => false,
      back: vi.fn(),
    },
  }),
}))

const SUMMARY = {
  totalSeconds: 7384,
  totalBooks: 5,
  totalDays: 12,
  todaySeconds: 600,
  currentStreak: 4,
  longestStreak: 9,
  weekSeconds: 3600,
  prevWeekSeconds: 1800,
  monthSeconds: 7200,
  prevMonthSeconds: 5400,
  totalWordsRead: 12345,
  scope: { totalSeconds: 7384, totalDays: 12, totalBooks: 5, totalWordsRead: 12345, finishedBooks: 2, finishedRounds: 2, longestStreak: 2 },
}

// The stats locale keys are managed separately; pin them to identity values so
// assertions stay stable no matter how the locale files evolve.
const STATS_KEYS = [
  'title',
  'readingTrend',
  'today',
  'streak',
  'streakCurrent',
  'streakLongest',
  'totalTime',
  'totalDays',
  'totalBooks',
  'totalNotes',
  'avgReadingTime',
  'finishedBooks',
  'totalWords',
  'days',
  'week',
  'month',
  'year',
  'prevPeriod',
  'nextPeriod',
  'yearHeatmap',
  'hourDistribution',
  'tagDistribution',
  'emptyTags',
  'durationHours',
  'durationMinutes',
  'durationSeconds',
]

type Mock = ReturnType<typeof vi.fn>

const hasText = (s: string) => screen.getAllByText((_, el) => el?.textContent?.replace(/\s+/g, '') === s.replace(/\s+/g, '')).length > 0

describe('Stats page', () => {
  const today = new Date()
  const todayStr = localDateString(today)
  const weekRange = periodRange('week', today)
  const weekDays = eachDay(weekRange.from, weekRange.to).map((d) => localDateString(d))
  const dataDay = weekDays[2]
  const otherDataDay = weekDays[3]
  const emptyDay = weekDays.find((d) => d !== todayStr && d !== dataDay && d !== otherDataDay)!

  const DAILY = [
    { date: dataDay, durationSeconds: 3661 },
    { date: otherDataDay, durationSeconds: 600 },
  ]

  beforeEach(async () => {
    useAuthStore.setState({ user: { id: 'reader', username: 'reader', role: 'member' } })
    vi.clearAllMocks()
    i18n.addResourceBundle(
      'zh-CN',
      'translation',
      { stats: Object.fromEntries(STATS_KEYS.map((k) => [k, `stats.${k}`])) },
      true,
      true,
    )
    await i18n.changeLanguage('zh-CN')
    ;(useReadingSummary as Mock).mockReturnValue({ data: { data: SUMMARY } })
    ;(useReadingDaily as Mock).mockImplementation((from?: string, to?: string) => ({
      data: { data: DAILY.filter((d) => (!from || d.date >= from) && (!to || d.date <= to)) },
    }))
    ;(useReadingHourly as Mock).mockImplementation(() => ({
      data: { data: [{ hour: 21, durationSeconds: 1200 }] },
    }))
    ;(useReadingByTag as Mock).mockReturnValue({ data: { data: [] } })
  })

  it('renders the summary cards', () => {
    render(<Stats />)
    expect(screen.getByText('stats.title')).toBeInTheDocument()
    expect(screen.getByText('stats.totalTime')).toBeInTheDocument()
    expect(screen.getByText('stats.totalDays')).toBeInTheDocument()
    expect(screen.getByText('stats.totalBooks')).toBeInTheDocument()
    expect(screen.getByText('stats.totalNotes')).toBeInTheDocument()
    expect(screen.getByText('stats.streakLongest')).toBeInTheDocument()
    // 7384s -> 2h 3m; with missing locale keys `_` falls back to the key itself
    expect(screen.getAllByText('stats.durationHours').length).toBeGreaterThan(0)
    expect(hasText('12 stats.days')).toBe(true)
    expect(hasText('5')).toBe(true)
    expect(hasText('20')).toBe(true)
    expect(hasText('2 stats.days')).toBe(true)
  })

  it('shows the current week range and switches periods', () => {
    render(<Stats />)
    const monthRange = periodRange('month', today)
    const weekLabel = `${weekRange.from.getFullYear()}.${weekRange.from.getMonth() + 1}.${weekRange.from.getDate()} - ${weekRange.to.getMonth() + 1}.${weekRange.to.getDate()}`
    expect(screen.getByText(weekLabel)).toBeInTheDocument()

    fireEvent.click(screen.getByText('stats.month'))
    expect(screen.getByText(`${today.getFullYear()}.${today.getMonth() + 1}`)).toBeInTheDocument()
    expect(useReadingDaily).toHaveBeenCalledWith(localDateString(monthRange.from), localDateString(monthRange.to))

    fireEvent.click(screen.getByText('stats.year'))
    expect(hasText(`${today.getFullYear()}`)).toBe(true)
  })

  it('shows the selected hour details on the time distribution chart', () => {
    render(<Stats />)

    const hourBar = screen.getByRole('button', { name: /^21:00:/ })
    expect(hourBar).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(hourBar)

    expect(hourBar).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText(/21:00/)[0]).toBeInTheDocument()
  })

  it('navigates to the previous and next period', () => {
    render(<Stats />)
    expect(screen.getByLabelText('stats.nextPeriod')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('stats.prevPeriod'))
    expect(screen.getByLabelText('stats.nextPeriod')).not.toBeDisabled()
    fireEvent.click(screen.getByLabelText('stats.nextPeriod'))
    expect(screen.getByLabelText('stats.nextPeriod')).toBeDisabled()
  })

  it('lists books of the current period by default', () => {
    render(<Stats />)
    expect(screen.getByText('stats.hourDistribution')).toBeInTheDocument()
    expect(screen.getByText('stats.tagDistribution')).toBeInTheDocument()
    expect(useReadingHourly).toHaveBeenCalledWith(localDateString(weekRange.from), localDateString(weekRange.to))
    expect(useReadingByTag).toHaveBeenCalledWith(localDateString(weekRange.from), localDateString(weekRange.to))
  })

  it('drills into a day when its bar is clicked', () => {
    render(<Stats />)
    fireEvent.click(screen.getByTestId(`bar-${dataDay}`))
    expect(useReadingHourly).toHaveBeenCalledWith(dataDay, dataDay)
    expect(useReadingByTag).toHaveBeenCalledWith(dataDay, dataDay)
    expect(screen.getByText('stats.tagDistribution')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '返回周期' })).toBeInTheDocument()
  })

  it('drills into a day when its heatmap cell is clicked', () => {
    render(<Stats />)
    fireEvent.click(screen.getByRole('button', { name: 'stats.year' }))
    fireEvent.click(screen.getByTestId(`heat-${todayStr}`))
    expect(useReadingHourly).toHaveBeenCalledWith(todayStr, todayStr)
    expect(useReadingByTag).toHaveBeenCalledWith(todayStr, todayStr)
  })

  it('shows an empty state for tags when a day without records is clicked', () => {
    render(<Stats />)
    fireEvent.click(screen.getByTestId(`bar-${emptyDay}`))
    expect(screen.getByText('stats.emptyTags')).toBeInTheDocument()
    expect(useReadingHourly).toHaveBeenCalledWith(emptyDay, emptyDay)
    expect(useReadingByTag).toHaveBeenCalledWith(emptyDay, emptyDay)
  })

  it('drills from a year month bar into month view', () => {
    render(<Stats />)
    fireEvent.click(screen.getByText('stats.year'))
    const monthBar = screen.getByTestId(`bar-month-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`)
    fireEvent.click(monthBar)
    expect(screen.getByText(`${today.getFullYear()}.${today.getMonth() + 1}`)).toBeInTheDocument()
  })

  it('uses lifetime scope for all history and queries hourly and tag distributions', () => {
    render(<Stats />)
    fireEvent.click(screen.getByRole('button', { name: '全部' }))
    expect(useReadingSummary).toHaveBeenLastCalledWith(undefined, undefined, Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(screen.getByTestId(`bar-year-${today.getFullYear()}`)).toBeInTheDocument()
    expect(useReadingByTag).toHaveBeenLastCalledWith(undefined, undefined)
    expect(useReadingHourly).toHaveBeenLastCalledWith(undefined, undefined)
    expect(screen.getByText('stats.streakCurrent')).toBeInTheDocument()
  })

  it('clears a selected day back to the active period for every reading query', () => {
    render(<Stats />)
    fireEvent.click(screen.getByTestId(`bar-${dataDay}`))
    expect(useReadingSummary).toHaveBeenLastCalledWith(dataDay, dataDay, Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(useReadingHourly).toHaveBeenLastCalledWith(dataDay, dataDay)
    expect(useReadingByTag).toHaveBeenLastCalledWith(dataDay, dataDay)
    fireEvent.click(screen.getByRole('button', { name: '返回周期' }))
    expect(useReadingSummary).toHaveBeenLastCalledWith(localDateString(weekRange.from), localDateString(weekRange.to), Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(useReadingHourly).toHaveBeenLastCalledWith(localDateString(weekRange.from), localDateString(weekRange.to))
    expect(useReadingByTag).toHaveBeenLastCalledWith(localDateString(weekRange.from), localDateString(weekRange.to))
  })

  it('keeps controlled period and day state with the parent until the parent changes props', () => {
    const onPeriodChange = vi.fn()
    const onShift = vi.fn()
    const onSelectDate = vi.fn()
    render(<Stats period="week" range={weekRange} selectedDate={null} onPeriodChange={onPeriodChange} onShift={onShift} onSelectDate={onSelectDate} />)
    fireEvent.click(screen.getByText('stats.month'))
    expect(onPeriodChange).toHaveBeenCalledWith('month')
    fireEvent.click(screen.getByLabelText('stats.prevPeriod'))
    expect(onShift).toHaveBeenCalledWith(-1)
    fireEvent.click(screen.getByTestId(`bar-${dataDay}`))
    expect(onSelectDate).toHaveBeenCalledWith(dataDay)
    expect(useReadingHourly).toHaveBeenLastCalledWith(localDateString(weekRange.from), localDateString(weekRange.to))
    expect(useReadingByTag).toHaveBeenLastCalledWith(localDateString(weekRange.from), localDateString(weekRange.to))
  })

  it('keeps a day selected within all history bounded and delegates clearing it to the parent', () => {
    const onSelectDate = vi.fn()
    render(<Stats period="all" range={periodRange('all', today)} selectedDate={dataDay} onSelectDate={onSelectDate} />)
    expect(useReadingSummary).toHaveBeenLastCalledWith(dataDay, dataDay, Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(useReadingHourly).toHaveBeenLastCalledWith(dataDay, dataDay)
    expect(useReadingByTag).toHaveBeenLastCalledWith(dataDay, dataDay)
    fireEvent.click(screen.getByRole('button', { name: '返回周期' }))
    expect(onSelectDate).toHaveBeenCalledWith('')
  })

  it('does not show lifetime values as period facts when a scoped summary is missing', () => {
    ;(useReadingSummary as Mock).mockReturnValue({ data: { data: { ...SUMMARY, scope: undefined } } })
    render(<Stats period="week" range={weekRange} />)
    expect(screen.queryByText('12 stats.days')).not.toBeInTheDocument()
    expect(screen.queryByText('4 stats.days')).not.toBeInTheDocument()
    expect(screen.getAllByText('—')).toHaveLength(7)
  })


  it('renders skeleton loading states when queries are loading without flashing empty states', () => {
    ;(useReadingSummary as Mock).mockReturnValue({ isLoading: true, data: undefined })
    ;(useReadingDaily as Mock).mockReturnValue({ isLoading: true, data: undefined })
    ;(useReadingHourly as Mock).mockReturnValue({ isLoading: true, data: undefined })
    ;(useReadingByTag as Mock).mockReturnValue({ isLoading: true, isPending: true, data: undefined })

    const { container } = render(<Stats />)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
    expect(screen.queryByText('stats.emptyTags')).not.toBeInTheDocument()
  })

  it('renders period delta badges in scoped views and hides them in all-time view', () => {
    ;(useReadingSummary as Mock).mockReturnValue({
      data: {
        data: {
          ...SUMMARY,
          scope: { totalSeconds: 7200, totalDays: 3, totalBooks: 5, totalWordsRead: 12000, finishedBooks: 1, longestStreak: 2 },
        },
      },
    })
    ;(usePreviousReadingSummary as Mock).mockReturnValue({
      data: {
        data: {
          ...SUMMARY,
          scope: { totalSeconds: 3600, totalDays: 2, totalBooks: 3, totalWordsRead: 6000, finishedBooks: 0, longestStreak: 1 },
        },
      },
    })
    ;(usePreviousArchiveOverview as Mock).mockReturnValue({
      data: { data: { counts: { total: 15 } } },
      isLoading: false,
    })

    // In week view: delta badges should appear on all summary cards
    const { rerender } = render(<Stats period="week" range={weekRange} />)
    expect(screen.getAllByText(/较上周/)).toHaveLength(8)

    // In all-time view: delta badges should NOT appear
    rerender(<Stats period="all" range={periodRange('all', today)} />)
    expect(screen.queryByText(/较上/)).not.toBeInTheDocument()
  })
})
vi.mock('@/features/notifications/components/NotificationBell', () => ({ default: () => null }))

function render(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return baseRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}
