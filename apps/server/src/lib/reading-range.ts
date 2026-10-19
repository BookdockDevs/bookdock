import type { ReadingRange } from '@bookdock/shared'

export function readingTimestampBounds(range: ReadingRange): { from?: number; until?: number } {
  if (!range.from && !range.to) return {}
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: range.timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const dateAt = (timestamp: number) => {
    const parts = formatter.formatToParts(timestamp)
    return `${parts.find((part) => part.type === 'year')!.value}-${parts.find((part) => part.type === 'month')!.value}-${parts.find((part) => part.type === 'day')!.value}`
  }
  const midnight = (date: string) => {
    const center = Date.parse(`${date}T00:00:00Z`)
    let low = center - 48 * 3600_000
    let high = center + 48 * 3600_000
    // Calendar dates cover midnight transitions without assuming 24-hour days.
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (dateAt(middle) < date) low = middle + 1
      else high = middle
    }
    return low
  }
  const nextDate = range.to ? new Date(Date.parse(`${range.to}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10) : undefined
  return { from: range.from ? midnight(range.from) : undefined, until: nextDate ? midnight(nextDate) : undefined }
}

export function isReadingTimestampInBounds(timestamp: number, bounds: ReturnType<typeof readingTimestampBounds>): boolean {
  return (bounds.from === undefined || timestamp >= bounds.from) && (bounds.until === undefined || timestamp < bounds.until)
}
