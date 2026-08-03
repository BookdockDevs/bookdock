import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('i18next', () => ({ default: { language: 'zh-CN' } }))

import { formatFullDateTime, formatRelativeTime } from '../features/reader/components/format-relative-time'

const templates: Record<string, string> = {
  'annotation.timeJustNow': '刚刚',
  'annotation.timeMinutesAgo': '{{n}} 分钟前',
  'annotation.timeHoursAgo': '{{n}} 小时前',
  'annotation.timeDaysAgo': '{{n}} 天前',
  'annotation.timeDateThisYear': '{{month}}{{day}}日',
  'annotation.timeDatePastYear': '{{year}}年{{month}}{{day}}日',
  'annotation.timeFull': '{{year}}年{{month}}{{day}}日 {{time}}',
}

// Minimal stand-in for the useTranslation translator: zh-CN templates with {{var}} interpolation
function _(key: string, opts?: Record<string, string | number>): string {
  let s = templates[key] ?? key
  for (const [k, v] of Object.entries(opts ?? {})) s = s.replace(`{{${k}}}`, String(v))
  return s
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 2, 17, 0)) // 2026-08-02 17:00 local
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps relative labels within a week', () => {
    const now = Date.now()
    expect(formatRelativeTime(_, now - 30_000)).toBe('刚刚')
    expect(formatRelativeTime(_, now - 30 * MINUTE)).toBe('30 分钟前')
    expect(formatRelativeTime(_, now - 5 * HOUR)).toBe('5 小时前')
    expect(formatRelativeTime(_, now - 6 * DAY)).toBe('6 天前')
  })

  it('switches to an absolute same-year date at exactly 7 days', () => {
    expect(formatRelativeTime(_, Date.now() - 7 * DAY)).toBe('7月26日')
  })

  it('includes the year for dates from a previous year', () => {
    expect(formatRelativeTime(_, new Date(2025, 2, 14, 10, 0).getTime())).toBe('2025年3月14日')
  })
})

describe('formatFullDateTime', () => {
  it('formats the full absolute date and time', () => {
    expect(formatFullDateTime(_, new Date(2026, 2, 14, 15, 32).getTime())).toBe('2026年3月14日 15:32')
  })
})
