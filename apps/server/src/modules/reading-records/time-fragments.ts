import type { ReadingTimeFragment } from '@bookdock/shared'

export function mergeTimeFragments(fragments: readonly ReadingTimeFragment[]): ReadingTimeFragment[] {
  const sorted = fragments.map((fragment) => {
    if (!Number.isSafeInteger(fragment.startedAt) || !Number.isSafeInteger(fragment.endedAt) || fragment.endedAt < fragment.startedAt) {
      throw new RangeError('Invalid reading time fragment')
    }
    return { ...fragment }
  }).filter((fragment) => fragment.endedAt > fragment.startedAt).sort((a, b) => a.startedAt - b.startedAt)
  const merged: ReadingTimeFragment[] = []
  for (const fragment of sorted) {
    const previous = merged.at(-1)
    if (previous && fragment.startedAt <= previous.endedAt) previous.endedAt = Math.max(previous.endedAt, fragment.endedAt)
    else merged.push(fragment)
  }
  return merged
}

export function subtractTimeFragments(fragments: readonly ReadingTimeFragment[], excluded: readonly ReadingTimeFragment[]): ReadingTimeFragment[] {
  const blockers = mergeTimeFragments(excluded)
  return mergeTimeFragments(fragments).flatMap((fragment) => {
    const remaining: ReadingTimeFragment[] = []
    let cursor = fragment.startedAt
    for (const blocker of blockers) {
      if (blocker.endedAt <= cursor) continue
      if (blocker.startedAt >= fragment.endedAt) break
      if (blocker.startedAt > cursor) remaining.push({ startedAt: cursor, endedAt: blocker.startedAt })
      cursor = Math.max(cursor, blocker.endedAt)
      if (cursor >= fragment.endedAt) break
    }
    if (cursor < fragment.endedAt) remaining.push({ startedAt: cursor, endedAt: fragment.endedAt })
    return remaining
  })
}

/** Bucket known active time in its recorded zone, including daylight-saving folds. */
export function splitReadingTime(fragments: readonly ReadingTimeFragment[], timezone: string): Array<{ date: string; hour: number; durationSeconds: number }> {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  })
  const label = (timestamp: number) => {
    const parts = formatter.formatToParts(timestamp)
    const part = (type: string) => parts.find((value) => value.type === type)!.value
    return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}`
  }
  const milliseconds = new Map<string, number>()
  for (const fragment of mergeTimeFragments(fragments)) {
    let cursor = fragment.startedAt
    while (cursor < fragment.endedAt) {
      const key = label(cursor)
      // Absolute-time probes avoid constructing ambiguous timestamps in a DST fold
      // and also handle zones whose transitions are not whole-hour changes.
      let end = Math.min(fragment.endedAt, cursor + 15 * 60_000)
      if (label(end - 1) !== key) {
        let low = cursor + 1
        let high = end
        while (low < high) {
          const middle = Math.floor((low + high) / 2)
          if (label(middle) === key) low = middle + 1
          else high = middle
        }
        end = low
      }
      milliseconds.set(key, (milliseconds.get(key) ?? 0) + end - cursor)
      cursor = end
    }
  }
  return [...milliseconds].sort(([a], [b]) => a.localeCompare(b)).map(([key, duration]) => ({
    date: key.slice(0, 10), hour: Number(key.slice(11)), durationSeconds: duration / 1000,
  }))
}
