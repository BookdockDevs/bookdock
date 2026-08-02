import { Link } from '@tanstack/react-router'

import { useReadingSummary } from '@/api/hooks/reading-records'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'

export default function ReadingStatsCard() {
  const _ = useTranslation()
  const { data } = useReadingSummary()
  const summary = data?.data
  if (!summary || summary.totalSeconds === 0) return null

  return (
    <section className="mb-8">
      <Link
        to="/stats"
        className="flex items-center gap-8 rounded-xl bg-white px-5 py-4 shadow-sm ring-1 ring-stone-200/70 transition-shadow hover:shadow-md dark:bg-stone-900 dark:ring-stone-800"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">{_('stats.today')}</span>
          <span className="text-sm font-medium tabular-nums text-stone-900 dark:text-stone-100">{formatDuration(summary.todaySeconds, _)}</span>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">{_('stats.streak')}</span>
          <span className="text-sm font-medium tabular-nums text-stone-900 dark:text-stone-100">{_('stats.streakDays', { n: summary.currentStreak })}</span>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">{_('stats.totalTime')}</span>
          <span className="text-sm font-medium tabular-nums text-stone-900 dark:text-stone-100">{formatDuration(summary.totalSeconds, _)}</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto shrink-0 text-stone-300 dark:text-stone-600">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </Link>
    </section>
  )
}
