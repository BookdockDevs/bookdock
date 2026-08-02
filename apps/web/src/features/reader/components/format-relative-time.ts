import type { useTranslation } from '@/hooks/useTranslation'

export function formatRelativeTime(_: ReturnType<typeof useTranslation>, ms: number): string {
  const minutes = Math.floor((Date.now() - ms) / 60000)
  if (minutes < 1) return _('annotation.timeJustNow')
  if (minutes < 60) return _('annotation.timeMinutesAgo', { n: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return _('annotation.timeHoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  if (days < 30) return _('annotation.timeDaysAgo', { n: days })
  const months = Math.floor(days / 30)
  if (months < 12) return _('annotation.timeMonthsAgo', { n: months })
  return _('annotation.timeYearsAgo', { n: Math.floor(months / 12) })
}
