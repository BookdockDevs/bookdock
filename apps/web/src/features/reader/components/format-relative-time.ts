import i18n from 'i18next'

import type { useTranslation } from '@/hooks/useTranslation'

type Translate = ReturnType<typeof useTranslation>

/** Localized short month: "3月" (zh-CN) / "Mar" (en) */
function shortMonth(d: Date): string {
  return new Intl.DateTimeFormat(i18n.language, { month: 'short' }).format(d)
}

/** Absolute date without time: same year "3月14日"/"Mar 14", otherwise with year */
export function formatAbsoluteDate(_: Translate, ms: number): string {
  const d = new Date(ms)
  const month = shortMonth(d)
  return d.getFullYear() === new Date().getFullYear()
    ? _('annotation.timeDateThisYear', { month, day: d.getDate() })
    : _('annotation.timeDatePastYear', { year: d.getFullYear(), month, day: d.getDate() })
}

/** Full timestamp for detail views and hover titles: "2026年3月14日 15:32" */
export function formatFullDateTime(_: Translate, ms: number): string {
  const d = new Date(ms)
  const time = new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit' }).format(d)
  return _('annotation.timeFull', {
    year: d.getFullYear(),
    month: shortMonth(d),
    day: d.getDate(),
    time,
  })
}

/** Relative within a week ("3 天前"), absolute date beyond it */
export function formatRelativeTime(_: Translate, ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60000)
  if (minutes < 1) return _('annotation.timeJustNow')
  if (minutes < 60) return _('annotation.timeMinutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return _('annotation.timeHoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 7) return _('annotation.timeDaysAgo', { n: days })
  return formatAbsoluteDate(_, ms)
}
