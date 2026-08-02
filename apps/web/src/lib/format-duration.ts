type Translate = (key: string, options?: Record<string, string | number>) => string

/** Human-readable reading duration: "Xh Ym" > "Ym" > "Zs", localized via `_`. */
export function formatDuration(seconds: number, _: Translate): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  if (h > 0) return _('stats.durationHours', { h, m })
  if (m > 0) return _('stats.durationMinutes', { m })
  return _('stats.durationSeconds', { s: total })
}
