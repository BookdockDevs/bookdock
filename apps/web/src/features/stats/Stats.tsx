import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import { useTranslation } from '@/hooks/useTranslation'

import SummaryCards from './components/SummaryCards'
import PeriodBarChart from './components/PeriodBarChart'
import HourDistribution from './components/HourDistribution'
import YearHeatmap from './components/YearHeatmap'
import BookTimeList from './components/BookTimeList'
import { periodRange, shiftPeriod } from './date-utils'
import type { StatsPeriod } from './date-utils'

export default function Stats() {
  const _ = useTranslation()
  const [period, setPeriod] = useState<StatsPeriod>('week')
  const [anchor, setAnchor] = useState(() => new Date())
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const range = periodRange(period, anchor)

  const changePeriod = (p: StatsPeriod) => {
    setPeriod(p)
    setAnchor(new Date())
    setSelectedDate(null)
  }

  const drillToMonth = (d: Date) => {
    setAnchor(d)
    setPeriod('month')
    setSelectedDate(null)
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <Link
          to="/"
          aria-label={_('settings.back')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-300"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold">{_('stats.title')}</h1>
      </div>

      <SummaryCards />

      <PeriodBarChart
        period={period}
        range={range}
        selectedDate={selectedDate}
        onPeriodChange={changePeriod}
        onShift={(delta) => {
          setAnchor((a) => shiftPeriod(period, a, delta))
          setSelectedDate(null)
        }}
        onDrillMonth={drillToMonth}
        onSelectDate={setSelectedDate}
      />

      <YearHeatmap selectedDate={selectedDate} onSelectDate={setSelectedDate} />

      <HourDistribution date={selectedDate} period={period} range={range} />

      <BookTimeList date={selectedDate} period={period} range={range} />
    </div>
  )
}
