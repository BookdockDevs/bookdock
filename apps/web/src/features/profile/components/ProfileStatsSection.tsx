import { Link } from '@tanstack/react-router'

import { useReadingSummary } from '@/api/hooks/reading-records'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'

function formatWords(n: number, _: (key: string, options?: Record<string, string | number>) => string): string {
  if (n >= 10000) {
    const formatted = (n / 10000).toFixed(1).replace(/\.0$/, '')
    const localized = _('stats.wordsWan', { n: formatted })
    return localized === 'stats.wordsWan' ? `${formatted}万字` : localized
  }
  const rounded = Math.round(n)
  const localized = _('stats.words', { n: rounded })
  return localized === 'stats.words' ? `${rounded}字` : localized
}

export default function ProfileStatsSection() {
  const _ = useTranslation()
  const { data, isLoading, isError, isFetching, refetch } = useReadingSummary()
  const s = data?.data

  if (isError) {
    return (
      <section className="rounded-2xl border border-stone-200/80 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
        <QueryErrorState isRetrying={isFetching} onRetry={() => void refetch()} />
      </section>
    )
  }

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold tracking-tight text-stone-900 sm:text-base dark:text-stone-100">
          {_('profile.achievements')}
        </h2>
        <Link
          to="/stats"
          className="group inline-flex items-center gap-1 text-xs font-medium text-stone-500 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200"
        >
          <span>{_('profile.allStats')}</span>
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-transform group-hover:translate-x-0.5"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {/* Streak Card */}
        <div className="flex flex-col justify-between rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs transition-shadow hover:shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">{_('stats.streak')}</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-50 text-orange-500 dark:bg-orange-950/40 dark:text-orange-400">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
              </svg>
            </div>
          </div>
          <div className="mt-3">
            {isLoading ? (
              <div className="h-7 w-16 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800" />
            ) : (
              <div className="text-xl font-bold tabular-nums text-stone-900 sm:text-2xl dark:text-stone-100">
                {s ? `${s.currentStreak} ${_('stats.days')}` : '-'}
              </div>
            )}
            <p className="mt-1 truncate text-[11px] text-stone-400 dark:text-stone-500">
              {s && s.longestStreak > 0 ? `${_('stats.streakLongest')} ${s.longestStreak} ${_('stats.days')}` : '保持节奏'}
            </p>
          </div>
        </div>

        {/* Total Time Card */}
        <div className="flex flex-col justify-between rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs transition-shadow hover:shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">{_('stats.totalTime')}</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-500 dark:bg-blue-950/40 dark:text-blue-400">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
          </div>
          <div className="mt-3">
            {isLoading ? (
              <div className="h-7 w-20 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800" />
            ) : (
              <div className="text-xl font-bold tabular-nums text-stone-900 sm:text-2xl dark:text-stone-100">
                {s ? formatDuration(s.totalSeconds, _) : '-'}
              </div>
            )}
            <p className="mt-1 truncate text-[11px] text-stone-400 dark:text-stone-500">
              {s ? `${_('stats.today')} ${formatDuration(s.todaySeconds, _)}` : '-'}
            </p>
          </div>
        </div>

        {/* Total Books Card */}
        <div className="flex flex-col justify-between rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs transition-shadow hover:shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">{_('stats.totalBooks')}</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50 text-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-400">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
                <path d="M6 6h10" />
                <path d="M6 10h10" />
              </svg>
            </div>
          </div>
          <div className="mt-3">
            {isLoading ? (
              <div className="h-7 w-12 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800" />
            ) : (
              <div className="text-xl font-bold tabular-nums text-stone-900 sm:text-2xl dark:text-stone-100">
                {s ? _('stats.booksUnit', { n: s.totalBooks }) : '-'}
              </div>
            )}
            <p className="mt-1 truncate text-[11px] text-stone-400 dark:text-stone-500">
              {s ? _('stats.bookDays', { n: s.totalDays }) : '-'}
            </p>
          </div>
        </div>

        {/* Words Read Card */}
        <div className="flex flex-col justify-between rounded-2xl border border-stone-200/80 bg-white p-4 shadow-xs transition-shadow hover:shadow-sm dark:border-stone-800 dark:bg-stone-900">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">{_('stats.totalWords')}</span>
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-50 text-purple-500 dark:bg-purple-950/40 dark:text-purple-400">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
            </div>
          </div>
          <div className="mt-3">
            {isLoading ? (
              <div className="h-7 w-16 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800" />
            ) : (
              <div className="text-xl font-bold tabular-nums text-stone-900 sm:text-2xl dark:text-stone-100">
                {s ? formatWords(s.totalWordsRead, _) : '-'}
              </div>
            )}
            <p className="mt-1 truncate text-[11px] text-stone-400 dark:text-stone-500">
              累计已读
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
