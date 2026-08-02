import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import i18n from '../i18n/i18n'

import Stats from '../features/stats/Stats'
import { localDateString, useReadingByBook, useReadingDaily, useReadingHourly, useReadingSummary } from '@/api/hooks/reading-records'
import { eachDay, periodRange } from '../features/stats/date-utils'
import type { ReadingRecordBookItem } from '@bookdock/shared'

vi.mock('@/api/hooks/reading-records', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/hooks/reading-records')>()
  return {
    ...original,
    useReadingSummary: vi.fn(),
    useReadingDaily: vi.fn(),
    useReadingByBook: vi.fn(),
    useReadingHourly: vi.fn(),
  }
})

// The page header uses Link for the back button; no router is mounted here.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: { children: React.ReactNode; to?: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

const SUMMARY = {
  totalSeconds: 7384,
  totalBooks: 5,
  totalDays: 12,
  todaySeconds: 600,
  currentStreak: 4,
  longestStreak: 9,
}

// The stats locale keys are managed separately; pin them to identity values so
// assertions stay stable no matter how the locale files evolve.
const STATS_KEYS = [
  'title',
  'today',
  'streak',
  'streakLongest',
  'totalTime',
  'totalDays',
  'totalBooks',
  'days',
  'week',
  'month',
  'year',
  'prevPeriod',
  'nextPeriod',
  'yearHeatmap',
  'bookRanking',
  'emptyBooks',
  'durationHours',
  'durationMinutes',
  'durationSeconds',
]

const WEEK_BOOKS: ReadingRecordBookItem[] = [
  { bookId: 'b1', title: 'Alpha Book', author: 'Author A', coverKey: null, progress: 45, durationSeconds: 3600, days: 2, readStatus: 'reading' },
]
const DAY_BOOKS: ReadingRecordBookItem[] = [
  { bookId: 'b2', title: 'Beta Book', author: 'Author B', coverKey: null, progress: 80, durationSeconds: 1800, days: 1, readStatus: 'finished' },
]

type Mock = ReturnType<typeof vi.fn>

const hasText = (s: string) => screen.getAllByText((_, el) => el?.textContent === s).length > 0

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
    ;(useReadingByBook as Mock).mockImplementation((from?: string, to?: string) => ({
      data: { data: from === to ? (from === emptyDay ? [] : DAY_BOOKS) : WEEK_BOOKS },
    }))
    ;(useReadingHourly as Mock).mockImplementation(() => ({
      data: { data: [{ hour: 21, durationSeconds: 1200 }] },
    }))
  })

  it('renders the summary cards', () => {
    render(<Stats />)
    expect(screen.getByText('stats.title')).toBeInTheDocument()
    expect(screen.getByText('stats.totalTime')).toBeInTheDocument()
    expect(screen.getByText('stats.totalDays')).toBeInTheDocument()
    expect(screen.getByText('stats.totalBooks')).toBeInTheDocument()
    expect(screen.getByText('stats.streak')).toBeInTheDocument()
    // 7384s -> 2h 3m; with missing locale keys `_` falls back to the key itself
    expect(screen.getAllByText('stats.durationHours').length).toBeGreaterThan(0)
    expect(hasText('12 stats.days')).toBe(true)
    expect(hasText('5')).toBe(true)
    expect(hasText('4 stats.days')).toBe(true)
    expect(hasText('stats.streakLongest 9 stats.days')).toBe(true)
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

  it('navigates to the previous and next period', () => {
    render(<Stats />)
    fireEvent.click(screen.getByLabelText('stats.nextPeriod'))
    const next = periodRange('week', new Date(weekRange.from.getFullYear(), weekRange.from.getMonth(), weekRange.from.getDate() + 7))
    const nextLabel = `${next.from.getFullYear()}.${next.from.getMonth() + 1}.${next.from.getDate()} - ${next.to.getMonth() + 1}.${next.to.getDate()}`
    expect(screen.getByText(nextLabel)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('stats.prevPeriod'))
    const weekLabel = `${weekRange.from.getFullYear()}.${weekRange.from.getMonth() + 1}.${weekRange.from.getDate()} - ${weekRange.to.getMonth() + 1}.${weekRange.to.getDate()}`
    expect(screen.getByText(weekLabel)).toBeInTheDocument()
  })

  it('lists books of the current period by default', () => {
    render(<Stats />)
    expect(screen.getByText('stats.bookRanking')).toBeInTheDocument()
    expect(screen.getByText('Alpha Book')).toBeInTheDocument()
  })

  it('drills into a day when its bar is clicked', () => {
    render(<Stats />)
    fireEvent.click(screen.getByTestId(`bar-${dataDay}`))
    expect(screen.getByText('Beta Book')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Book')).not.toBeInTheDocument()
    expect(useReadingByBook).toHaveBeenCalledWith(dataDay, dataDay)
    expect(hasText(`stats.bookRanking · ${dataDay}`)).toBe(true)
  })

  it('drills into a day when its heatmap cell is clicked', () => {
    render(<Stats />)
    fireEvent.click(screen.getByTestId(`heat-${todayStr}`))
    expect(screen.getByText('Beta Book')).toBeInTheDocument()
    expect(useReadingByBook).toHaveBeenCalledWith(todayStr, todayStr)
  })

  it('shows an empty state for a day without records', () => {
    render(<Stats />)
    fireEvent.click(screen.getByTestId(`bar-${emptyDay}`))
    expect(screen.getByText('stats.emptyBooks')).toBeInTheDocument()
  })

  it('drills from a year month bar into month view', () => {
    render(<Stats />)
    fireEvent.click(screen.getByText('stats.year'))
    const monthBar = screen.getByTestId(`bar-month-${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`)
    fireEvent.click(monthBar)
    expect(screen.getByText(`${today.getFullYear()}.${today.getMonth() + 1}`)).toBeInTheDocument()
  })
})
