import { useMemo } from 'react'

import { localDateString, useReadingHourly } from '@/api/hooks/reading-records'
import { useTranslation } from '@/hooks/useTranslation'
import { formatDuration } from '@/lib/format-duration'

interface HourlyChartProps {
  bookId: string
  from: string
  width: number
}

const CHART_HEIGHT = 96
const CHART_TOP_PAD = 12
const BAR_GAP = 2
const MAX_SLOT_WIDTH = 48
const TICK_HOURS = [0, 6, 12, 18, 23]

export default function HourlyChart({ bookId, from, width }: HourlyChartProps) {
  const _ = useTranslation()
  const { data } = useReadingHourly(from, localDateString(), bookId)

  const bars = useMemo(() => {
    const byHour = new Map((data?.data ?? []).map((i) => [i.hour, i.durationSeconds]))
    return Array.from({ length: 24 }, (_, hour) => ({ hour, seconds: byHour.get(hour) ?? 0 }))
  }, [data])

  const max = Math.max(0, ...bars.map((b) => b.seconds))
  const slot = width > 0 ? Math.min(width / bars.length, MAX_SLOT_WIDTH) : 0
  const groupWidth = slot * bars.length
  const offsetX = (width - groupWidth) / 2

  return (
    <div>
      <p className="mb-2 text-xs text-[var(--bd-read-sub)]">{_('reader.statsHourly')}</p>
      {slot > 0 && (
        <>
          <svg width={width} height={CHART_HEIGHT} viewBox={`0 0 ${width} ${CHART_HEIGHT}`}>
            {bars.map((b, i) => {
              const h = b.seconds > 0 && max > 0 ? Math.max(4, (b.seconds / max) * (CHART_HEIGHT - CHART_TOP_PAD - 1)) : 2
              return (
                <rect
                  key={b.hour}
                  x={offsetX + i * slot + BAR_GAP / 2}
                  y={CHART_HEIGHT - 1 - h}
                  width={Math.max(1, slot - BAR_GAP)}
                  height={h}
                  rx={2}
                  fill="var(--bd-read-sub)"
                >
                  <title>{`${b.hour}:00: ${formatDuration(b.seconds, _)}`}</title>
                </rect>
              )
            })}
            <line
              x1={0}
              x2={width}
              y1={CHART_HEIGHT - 0.5}
              y2={CHART_HEIGHT - 0.5}
              stroke="var(--bd-read-accent)"
              strokeWidth={1}
            />
          </svg>
          <div className="mt-1 flex" style={{ marginLeft: offsetX, width: groupWidth }}>
            {bars.map((b) => (
              <span
                key={b.hour}
                className="min-w-0 flex-1 truncate text-center text-[10px] tabular-nums text-[var(--bd-read-sub)]"
              >
                {TICK_HOURS.includes(b.hour) ? b.hour : ''}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
