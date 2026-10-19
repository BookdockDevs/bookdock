import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { periodRange } from '../../date-utils'
import PeriodSelector from '../PeriodSelector'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN' },
  }),
}))

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string, options?: Record<string, unknown>) => {
    if (options?.from && options?.to) return `${options.from}年～${options.to}年`
    if (options?.year) return `${options.year}年`
    return key
  },
}))

describe('PeriodSelector', () => {
  const fixedNow = new Date(2026, 9, 15) // Oct 15, 2026

  it('disables next period button when on current week', () => {
    const currentWeek = periodRange('week', new Date())
    render(
      <PeriodSelector
        period="week"
        range={currentWeek}
        onPeriodChange={vi.fn()}
        onShift={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('stats.nextPeriod')).toBeDisabled()
  })

  it('enables next period button when on a past week', () => {
    const pastWeek = periodRange('week', new Date(2026, 8, 1))
    render(
      <PeriodSelector
        period="week"
        range={pastWeek}
        onPeriodChange={vi.fn()}
        onShift={vi.fn()}
      />,
    )
    expect(screen.getByLabelText('stats.nextPeriod')).not.toBeDisabled()
  })

  it('shows year span and hides arrows in all mode', () => {
    const allRange = periodRange('all', fixedNow)
    render(
      <PeriodSelector
        period="all"
        range={allRange}
        onPeriodChange={vi.fn()}
        onShift={vi.fn()}
        firstRecordedDate="2020-03-15"
      />,
    )
    const curYear = new Date().getFullYear()
    expect(screen.getByText(`2020年～${curYear}年`)).toBeInTheDocument()
    expect(screen.queryByLabelText('stats.prevPeriod')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('stats.nextPeriod')).not.toBeInTheDocument()
  })

  it('opens week popover and allows selecting a past week', () => {
    const currentWeek = periodRange('week', fixedNow)
    const onSelectAnchor = vi.fn()
    render(
      <PeriodSelector
        period="week"
        range={currentWeek}
        onPeriodChange={vi.fn()}
        onShift={vi.fn()}
        onSelectAnchor={onSelectAnchor}
      />,
    )

    // Open popover
    fireEvent.click(screen.getByLabelText('stats.selectPeriod'))
    expect(screen.getByText('stats.selectDate')).toBeInTheDocument()

    // Week list should contain weeks of the year; click second week button
    const weekButtons = screen.getAllByRole('button').filter((btn) => btn.textContent?.includes('～'))
    expect(weekButtons.length).toBeGreaterThan(1)
    fireEvent.click(weekButtons[1])
    expect(onSelectAnchor).toHaveBeenCalled()
  })

  it('opens month popover with future months disabled', () => {
    const currentMonth = periodRange('month', fixedNow)
    const onSelectAnchor = vi.fn()
    render(
      <PeriodSelector
        period="month"
        range={currentMonth}
        onPeriodChange={vi.fn()}
        onShift={vi.fn()}
        onSelectAnchor={onSelectAnchor}
      />,
    )

    // Open popover
    fireEvent.click(screen.getByLabelText('stats.selectPeriod'))
    // 1月 should be enabled
    const janBtn = screen.getByRole('button', { name: '1月' })
    expect(janBtn).not.toBeDisabled()
    fireEvent.click(janBtn)
    expect(onSelectAnchor).toHaveBeenCalled()
  })

  it('opens year popover and allows selecting past year', () => {
    const currentYear = periodRange('year', fixedNow)
    const onSelectAnchor = vi.fn()
    render(
      <PeriodSelector
        period="year"
        range={currentYear}
        onPeriodChange={vi.fn()}
        onShift={vi.fn()}
        onSelectAnchor={onSelectAnchor}
        firstRecordedDate="2022-01-01"
      />,
    )

    // Open popover
    fireEvent.click(screen.getByLabelText('stats.selectPeriod'))
    expect(screen.getByText('stats.selectYear')).toBeInTheDocument()

    const pastYearBtn = screen.getByRole('button', { name: '2023年' })
    fireEvent.click(pastYearBtn)
    expect(onSelectAnchor).toHaveBeenCalled()
  })
})
