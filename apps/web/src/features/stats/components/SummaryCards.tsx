import type { ReactNode } from 'react'

import { useReadingSummary } from '@/api/hooks/reading-records'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { isAccessRevocationError } from '@/lib/error-message'
import { formatDuration } from '@/lib/format-duration'
import { cn } from '@/lib/utils'

interface DeltaInfo {
  text: string
  positive: boolean
  negative: boolean
}

function periodDelta(
  current: number,
  previous: number,
  format: (v: number) => string,
  _: (key: string, options?: Record<string, string | number>) => string,
  vsKey: string,
): DeltaInfo {
  const diff = current - previous
  const delta = diff === 0 ? _('stats.noChange') : `${diff > 0 ? '+' : '-'}${format(Math.abs(diff))}`
  return {
    text: _(vsKey, { delta }),
    positive: diff > 0,
    negative: diff < 0,
  }
}

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

interface CardItem {
  key: string
  label: string
  value: string
  sub?: string
  delta?: DeltaInfo
  icon: ReactNode
  iconBgClass: string
  hero?: boolean
}

export default function SummaryCards() {
  const _ = useTranslation()
  const summaryQuery = useReadingSummary()
  const { data } = summaryQuery
  const s = data?.data
  const mc = s?.monthlyComparison

  if (summaryQuery.isError && (!s || isAccessRevocationError(summaryQuery.error))) {
    return (
      <QueryErrorState
        className="col-span-full rounded-2xl border border-stone-200 bg-white px-4 dark:border-stone-800 dark:bg-stone-900"
        isRetrying={summaryQuery.isFetching}
        onRetry={() => summaryQuery.refetch()}
      />
    )
  }

  const cards: CardItem[] = [
    {
      key: 'totalTime',
      label: _('stats.totalTime'),
      value: s ? formatDuration(s.totalSeconds, _) : '-',
      sub: s ? `${_('stats.today')} ${formatDuration(s.todaySeconds, _)}` : undefined,
      delta: mc
        ? periodDelta(mc.currentPeriodSeconds, mc.previousPeriodSeconds, (v) => formatDuration(v, _), _, 'stats.vsLastMonth')
        : undefined,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
      iconBgClass: 'bg-stone-100 text-stone-800 dark:bg-stone-800 dark:text-stone-100',
      hero: true,
    },
    {
      key: 'streak',
      label: _('stats.streak'),
      value: s ? `${s.currentStreak} ${_('stats.days')}` : '-',
      sub: s && s.longestStreak > 0 ? `${_('stats.streakLongest')} ${s.longestStreak} ${_('stats.days')}` : undefined,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
        </svg>
      ),
      iconBgClass: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
    },
    {
      key: 'totalWords',
      label: _('stats.totalWords'),
      value: s ? formatWords(s.totalWordsRead, _) : '-',
      sub: _('stats.cumulativeRead'),
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      ),
      iconBgClass: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
    },
    {
      key: 'totalDays',
      label: _('stats.totalDays'),
      value: s ? `${s.totalDays} ${_('stats.days')}` : '-',
      delta: mc
        ? periodDelta(mc.currentPeriodDays, mc.previousPeriodDays, (v) => `${v} ${_('stats.days')}`, _, 'stats.vsLastMonth')
        : undefined,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
          <line x1="16" x2="16" y1="2" y2="6" />
          <line x1="8" x2="8" y1="2" y2="6" />
          <line x1="3" x2="21" y1="10" y2="10" />
        </svg>
      ),
      iconBgClass: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
    },
    {
      key: 'totalBooks',
      label: _('stats.totalBooks'),
      value: s ? String(s.totalBooks) : '-',
      delta: mc
        ? periodDelta(mc.currentPeriodBooks, mc.previousPeriodBooks, (v) => _('stats.booksUnit', { n: v }), _, 'stats.vsLastMonth')
        : undefined,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
          <path d="M6 6h10" />
          <path d="M6 10h10" />
        </svg>
      ),
      iconBgClass: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
    },
    {
      key: 'thisWeek',
      label: _('stats.thisWeek'),
      value: s ? formatDuration(s.weekSeconds, _) : '-',
      delta: s ? periodDelta(s.weekSeconds, s.prevWeekSeconds, (v) => formatDuration(v, _), _, 'stats.vsLastWeek') : undefined,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
        </svg>
      ),
      iconBgClass: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
    },
    {
      key: 'thisMonth',
      label: _('stats.thisMonth'),
      value: s ? formatDuration(s.monthSeconds, _) : '-',
      delta: s ? periodDelta(s.monthSeconds, s.prevMonthSeconds, (v) => formatDuration(v, _), _, 'stats.vsPrevMonth') : undefined,
      icon: (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
        </svg>
      ),
      iconBgClass: 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300',
    },
  ]

  const isSummaryLoading = summaryQuery.isLoading && !s

  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4" aria-busy={isSummaryLoading}>
      {summaryQuery.isError && s && !isAccessRevocationError(summaryQuery.error) && (
        <div className="col-span-full flex items-center justify-between rounded-xl border border-amber-200/80 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-700 dark:border-amber-800/80 dark:bg-amber-500/20 dark:text-amber-300">
          <span>{_('stats.revalidateFailed') || '数据刷新失败，正在显示缓存数据'}</span>
          <button
            type="button"
            onClick={() => summaryQuery.refetch()}
            disabled={summaryQuery.isFetching}
            className="font-medium underline hover:no-underline cursor-pointer"
          >
            {_('common.retry') || '重试'}
          </button>
        </div>
      )}
      {cards.map((c) => (
        <section
          key={c.key}
          className={cn(
            'flex flex-col justify-between rounded-2xl border border-stone-200/70 bg-white p-4 shadow-2xs transition-shadow hover:border-stone-300 dark:border-stone-800/80 dark:bg-stone-900/60 dark:hover:border-stone-700',
            c.hero && 'col-span-2',
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500 dark:text-stone-400">{c.label}</span>
            <div className={cn('flex h-7 w-7 items-center justify-center rounded-lg', c.iconBgClass)}>
              {c.icon}
            </div>
          </div>

          <div className="mt-3">
            {isSummaryLoading ? (
              <div className="space-y-2">
                <div className="h-7 w-20 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800 motion-reduce:animate-none" />
                <div className="h-3.5 w-14 animate-pulse rounded bg-stone-200/50 dark:bg-stone-800/80 motion-reduce:animate-none" />
              </div>
            ) : (
              <>
                <p className={cn('font-bold tracking-tight tabular-nums text-stone-900 dark:text-stone-100', c.hero ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl')}>
                  {c.value}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {c.sub && (
                    <span className="text-xs text-stone-400 dark:text-stone-500">
                      {c.sub}
                    </span>
                  )}
                  {c.delta && (
                    <span
                      className={cn(
                        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none',
                        c.delta.positive
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : c.delta.negative
                            ? 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400'
                            : 'bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400',
                      )}
                    >
                      {c.delta.text}
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      ))}
    </div>
  )
}
