import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import type { BookDetailRes, ReadingProgressRes } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { useBookReadingRecords } from '@/api/hooks/reading-records'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'

import { buildBookChartBars, summarizeBookRecords } from '../stats/book-stats'

import HourlyChart from './HourlyChart'

interface StatsPanelProps {
  bookId: string
}

const CHART_HEIGHT = 96
const CHART_TOP_PAD = 12
const BAR_GAP = 2
const MAX_SLOT_WIDTH = 48

function formatWordCount(n: number): string {
  return n >= 10000 ? `${(n / 10000).toFixed(1)}万字` : `${Math.round(n)}字`
}

export default function StatsPanel({ bookId }: StatsPanelProps) {
  const _ = useTranslation()
  const { data } = useBookReadingRecords(bookId)
  const detail = data?.data
  const records = useMemo(() => detail?.records ?? [], [detail])
  const summary = useMemo(
    () => (detail ? summarizeBookRecords(records, detail.totalSeconds) : null),
    [detail, records],
  )

  // Same query keys/fns as Reader so the existing cache entries are reused
  const bookQuery = useQuery({
    queryKey: ['book', bookId],
    queryFn: () => apiGet<{ data: BookDetailRes }>(`/books/${bookId}`),
  })
  const progressQuery = useQuery({
    queryKey: ['progress', bookId],
    queryFn: () => apiGet<{ data: ReadingProgressRes | null }>(`/progress/${bookId}`),
  })
  const totalWords = bookQuery.data?.data.meta?.wordCount
  const readFraction = progressQuery.data?.data?.readFraction
  const wordsRead = totalWords != null && readFraction != null
    ? Math.round(readFraction * totalWords)
    : null

  const chartRef = useRef<HTMLDivElement>(null)
  const [chartWidth, setChartWidth] = useState(0)
  useEffect(() => {
    const el = chartRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      setChartWidth(entries[0].contentRect.width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [detail])

  const chart = useMemo(() => buildBookChartBars(records, chartWidth), [records, chartWidth])

  if (!detail || !summary) return null
  if (records.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-[var(--bd-read-sub)]">
        {_('reader.statsEmpty')}
      </p>
    )
  }

  const cards: { label: string; value: string; sub?: string }[] = [
    { label: _('reader.statsTotalTime'), value: formatDuration(summary.totalSeconds, _) },
    { label: _('reader.statsReadingDays'), value: `${summary.days} ${_('stats.days')}` },
    { label: _('reader.statsStartDate'), value: summary.startDate ?? '-' },
    { label: _('reader.statsDailyAvg'), value: formatDuration(summary.avgSecondsPerDay, _) },
    {
      label: _('reader.statsWordsRead'),
      value: wordsRead != null ? formatWordCount(wordsRead) : '-',
      sub: totalWords != null ? _('reader.statsWordsTotal', { n: formatWordCount(totalWords) }) : undefined,
    },
  ]

  const bars = chart.bars
  const max = Math.max(0, ...bars.map((b) => b.seconds))
  const slot = chartWidth > 0 && bars.length > 0 ? Math.min(chartWidth / bars.length, MAX_SLOT_WIDTH) : 0
  const groupWidth = slot * bars.length
  const offsetX = (chartWidth - groupWidth) / 2

  return (
    <div className="space-y-6 px-1">
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c) => (
          <section key={c.label} className="rounded-lg border border-[var(--bd-read-accent)] p-3">
            <p className="text-xs text-[var(--bd-read-sub)]">{c.label}</p>
            <p className="mt-1 truncate whitespace-nowrap text-base font-semibold tabular-nums">
              {c.value.replace(/\s+/g, '')}
            </p>
            {c.sub && (
              <p className="mt-0.5 truncate whitespace-nowrap text-xs text-[var(--bd-read-sub)]">{c.sub}</p>
            )}
          </section>
        ))}
      </div>
      <div ref={chartRef}>
        {slot > 0 && (
          <>
            <svg width={chartWidth} height={CHART_HEIGHT} viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}>
              {bars.map((b, i) => {
                const h = b.seconds > 0 && max > 0 ? Math.max(4, (b.seconds / max) * (CHART_HEIGHT - CHART_TOP_PAD - 1)) : 2
                return (
                  <rect
                    key={b.key}
                    x={offsetX + i * slot + BAR_GAP / 2}
                    y={CHART_HEIGHT - 1 - h}
                    width={Math.max(1, slot - BAR_GAP)}
                    height={h}
                    rx={2}
                    fill="var(--bd-read-sub)"
                  >
                    <title>{`${b.rangeLabel}: ${formatDuration(b.seconds, _)}`}</title>
                  </rect>
                )
              })}
              <line
                x1={0}
                x2={chartWidth}
                y1={CHART_HEIGHT - 0.5}
                y2={CHART_HEIGHT - 0.5}
                stroke="var(--bd-read-accent)"
                strokeWidth={1}
              />
            </svg>
            <div className="mt-1 flex" style={{ marginLeft: offsetX, width: groupWidth }}>
              {bars.map((b) => (
                <span
                  key={b.key}
                  className="min-w-0 flex-1 truncate text-center text-[10px] tabular-nums text-[var(--bd-read-sub)]"
                >
                  {b.tick}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      {summary.startDate && <HourlyChart bookId={bookId} from={summary.startDate} width={chartWidth} />}
    </div>
  )
}
