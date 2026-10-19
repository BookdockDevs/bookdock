import { localDateString, useReadingHourly } from '@/api/hooks/reading-records'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { resolveArchiveScope } from '@/features/archive/archive-scope'
import { useTranslation } from '@/hooks/useTranslation'
import { isAccessRevocationError } from '@/lib/error-message'

import type { DayRange, StatsPeriod } from '../date-utils'
import HourDistributionView from './HourDistributionView'

interface HourDistributionProps {
  date: string | null
  period: StatsPeriod
  range: DayRange
}

function getPeriodLabel(period: StatsPeriod, hasDate: boolean): string {
  if (hasDate) return '今日'
  if (period === 'week') return '本周'
  if (period === 'month') return '本月'
  if (period === 'year') return '本年'
  return ''
}

export default function HourDistribution({ date, period, range }: HourDistributionProps) {
  const _ = useTranslation()
  const { from, to } = resolveArchiveScope({ period, anchor: localDateString(range.from), date: date ?? undefined }).query
  const hourlyQuery = useReadingHourly(from, to)
  const { data } = hourlyQuery
  const items = data?.data ?? []

  const byHour = new Map(items.map((i) => [i.hour, { seconds: i.durationSeconds, days: i.days ?? 0 }]))
  const bars = Array.from({ length: 24 }, (_, hour) => {
    const record = byHour.get(hour)
    return {
      hour,
      seconds: record?.seconds ?? 0,
      days: record?.days ?? 0,
    }
  })

  if (hourlyQuery.isError && (!data || isAccessRevocationError(hourlyQuery.error))) {
    return (
      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
        <QueryErrorState isRetrying={hourlyQuery.isFetching} onRetry={hourlyQuery.refetch} />
      </section>
    )
  }

  const isHourlyLoading = hourlyQuery.isLoading && !data

  const errorNode = hourlyQuery.isError && data && !isAccessRevocationError(hourlyQuery.error) ? (
    <div className="mb-3 flex items-center justify-between rounded-xl border border-amber-200/80 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-700 dark:border-amber-800/80 dark:bg-amber-500/20 dark:text-amber-300">
      <span>{_('stats.revalidateFailed') || '数据刷新失败，正在显示缓存数据'}</span>
      <button
        type="button"
        onClick={() => hourlyQuery.refetch()}
        disabled={hourlyQuery.isFetching}
        className="cursor-pointer font-medium underline hover:no-underline"
      >
        {_('common.retry') || '重试'}
      </button>
    </div>
  ) : undefined

  return (
    <HourDistributionView
      bars={bars}
      prefix={getPeriodLabel(period, Boolean(date))}
      isLoading={isHourlyLoading}
      errorNode={errorNode}
    />
  )
}
