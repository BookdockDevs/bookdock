import { localDateString, useReadingSummary } from '@/api/hooks/reading-records'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'

import { formatPeriodLabel, type DayRange, type StatsPeriod } from '../date-utils'

interface ScopedReadingSummaryProps { range: DayRange; period: StatsPeriod; date: string | null }

export default function ScopedReadingSummary({ range, period, date }: ScopedReadingSummaryProps) {
  const _ = useTranslation()
  const from = date ?? localDateString(range.from)
  const to = date ?? localDateString(range.to)
  const summary = useReadingSummary(period === 'all' && !date ? undefined : from, period === 'all' && !date ? undefined : to)
  if (summary.isError) return <QueryErrorState isRetrying={summary.isFetching} onRetry={() => void summary.refetch()} />
  const scope = summary.data?.data.scope
  const cards = [
    [_('readingData.duration'), formatDuration(scope?.totalSeconds ?? 0, _)],
    [_('readingData.booksRead'), String(scope?.totalBooks ?? 0)],
    [_('readingData.days'), String(scope?.totalDays ?? 0)],
    [_('readingData.finishedBooks'), String(scope?.finishedBooks ?? 0)],
    [_('readingData.finishedRounds'), String(scope?.finishedRounds ?? 0)],
    [_('readingData.words'), Math.round(scope?.totalWordsRead ?? 0).toLocaleString()],
  ]
  return <section><h2 className="mb-3 text-sm font-semibold">{_('readingData.periodSummary')} · {date ?? (period === 'all' ? _('readingData.all') : formatPeriodLabel(period, range))}</h2><div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{cards.map(([label, value]) => <div key={label} className="rounded-xl border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900"><p className="text-xs text-stone-500">{label}</p><p className="mt-2 text-lg font-semibold tabular-nums">{summary.isPending ? '—' : value}</p></div>)}</div>{scope?.wordsPartial && <p className="mt-2 text-xs text-stone-500">{_('readingData.wordsPartial')}</p>}</section>
}
