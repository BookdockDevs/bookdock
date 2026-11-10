import type {
  ClientReadingBookView,
  ReadingRecordCategoryItem,
  ReadingRecordDailyItem,
  ReadingRecordHourlyItem,
  ReadingRecordSummaryRes,
  ReadingRecordTagItem,
} from '@bookdock/shared'

/**
 * Totals add up across the device and server halves; counters that describe
 * *distinct* things cannot. A day read in both halves would be counted twice,
 * and the projections carry no date list to union, so day and streak counters
 * take the larger half. Recorded as the same known V1 limit as the merged
 * archive.
 */
export function mergeReadingSummaries(
  remote: ReadingRecordSummaryRes | undefined,
  device: ReadingRecordSummaryRes | undefined,
): ReadingRecordSummaryRes | undefined {
  if (!remote) return device
  if (!device) return remote
  const sum = (pick: (value: ReadingRecordSummaryRes) => number | undefined) => (pick(remote) ?? 0) + (pick(device) ?? 0)
  const max = (pick: (value: ReadingRecordSummaryRes) => number | undefined) => Math.max(pick(remote) ?? 0, pick(device) ?? 0)
  const earlier = [remote.firstRecordedDate, device.firstRecordedDate].filter((date): date is string => Boolean(date)).sort()[0]
  const merged: ReadingRecordSummaryRes = {
    ...remote,
    wordState: remote.wordState ?? device.wordState,
    firstRecordedDate: earlier,
    totalSeconds: sum((s) => s.totalSeconds),
    undatedDurationSeconds: sum((s) => s.undatedDurationSeconds),
    referenceDurationSeconds: sum((s) => s.referenceDurationSeconds),
    totalBooks: sum((s) => s.totalBooks),
    totalDays: max((s) => s.totalDays),
    todaySeconds: sum((s) => s.todaySeconds),
    currentStreak: max((s) => s.currentStreak),
    longestStreak: max((s) => s.longestStreak),
    weekSeconds: sum((s) => s.weekSeconds),
    prevWeekSeconds: sum((s) => s.prevWeekSeconds),
    monthSeconds: sum((s) => s.monthSeconds),
    prevMonthSeconds: sum((s) => s.prevMonthSeconds),
    totalWordsRead: sum((s) => s.totalWordsRead),
  }
  if (remote.scope && device.scope) {
    const r = remote.scope
    const d = device.scope
    merged.scope = {
      ...r,
      longestStreak: Math.max(r.longestStreak, d.longestStreak),
      totalSeconds: r.totalSeconds + d.totalSeconds,
      undatedDurationSeconds: r.undatedDurationSeconds + d.undatedDurationSeconds,
      referenceDurationSeconds: r.referenceDurationSeconds + d.referenceDurationSeconds,
      totalBooks: r.totalBooks + d.totalBooks,
      totalDays: Math.max(r.totalDays, d.totalDays),
      finishedBooks: r.finishedBooks + d.finishedBooks,
      finishedRounds: r.finishedRounds + d.finishedRounds,
      totalWordsRead: r.totalWordsRead + d.totalWordsRead,
      wordsPartial: r.wordsPartial ?? d.wordsPartial,
      wordState: r.wordState ?? d.wordState,
    }
  } else {
    merged.scope = remote.scope ?? device.scope
  }
  return merged
}

/** Duration sums per calendar day. Both halves share the same date axis. */
export function mergeDaily(remote: ReadingRecordDailyItem[], device: ReadingRecordDailyItem[]): ReadingRecordDailyItem[] {
  const byDate = new Map<string, number>()
  for (const item of [...remote, ...device]) byDate.set(item.date, (byDate.get(item.date) ?? 0) + item.durationSeconds)
  return [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, durationSeconds]) => ({ date, durationSeconds }))
}

/**
 * Durations add per hour; `days` is a distinct-day count and takes the larger
 * half for the same reason the streak counters do.
 */
export function mergeHourly(remote: ReadingRecordHourlyItem[], device: ReadingRecordHourlyItem[]): ReadingRecordHourlyItem[] {
  const byHour = new Map<number, ReadingRecordHourlyItem>()
  for (const item of [...remote, ...device]) {
    const current = byHour.get(item.hour)
    if (!current) { byHour.set(item.hour, { ...item }); continue }
    current.durationSeconds += item.durationSeconds
    current.days = Math.max(current.days ?? 0, item.days ?? 0)
  }
  return [...byHour.values()].sort((a, b) => a.hour - b.hour)
}

/** One row per book; a same-ID device copy and server book are the same row. */
export function mergeByBook(remote: ClientReadingBookView[], device: ClientReadingBookView[]): ClientReadingBookView[] {
  const byId = new Map<string, ClientReadingBookView>()
  for (const item of remote) byId.set(item.bookId, item)
  for (const item of device) {
    const current = byId.get(item.bookId)
    byId.set(item.bookId, current
      ? {
          ...current,
          durationSeconds: current.durationSeconds + item.durationSeconds,
          referenceDurationSeconds: (current.referenceDurationSeconds ?? 0) + (item.referenceDurationSeconds ?? 0),
          days: (current.days ?? 0) + (item.days ?? 0),
          progress: current.progress ?? item.progress,
          readStatus: current.readStatus ?? item.readStatus,
        }
      : item)
  }
  return [...byId.values()].sort((a, b) => b.durationSeconds - a.durationSeconds || a.bookId.localeCompare(b.bookId))
}

export function mergeByTag(remote: ReadingRecordTagItem[], device: ReadingRecordTagItem[]): ReadingRecordTagItem[] {
  const byId = new Map<string, ReadingRecordTagItem>()
  for (const item of remote) byId.set(item.tagId, item)
  for (const item of device) {
    const current = byId.get(item.tagId)
    byId.set(item.tagId, current
      ? { ...current, durationSeconds: current.durationSeconds + item.durationSeconds, bookCount: Math.max(current.bookCount ?? 0, item.bookCount ?? 0) }
      : item)
  }
  return [...byId.values()].sort((a, b) => b.durationSeconds - a.durationSeconds || a.name.localeCompare(b.name))
}

export function mergeByCategory(remote: ReadingRecordCategoryItem[], device: ReadingRecordCategoryItem[]): ReadingRecordCategoryItem[] {
  const key = (item: ReadingRecordCategoryItem) => item.categoryId ?? ''
  const byId = new Map<string, ReadingRecordCategoryItem>()
  for (const item of remote) byId.set(key(item), item)
  for (const item of device) {
    const current = byId.get(key(item))
    if (!current) { byId.set(key(item), item); continue }
    byId.set(key(item), {
      ...current,
      durationSeconds: current.durationSeconds + item.durationSeconds,
      bookCount: Math.max(current.bookCount ?? 0, item.bookCount ?? 0),
    })
  }
  return [...byId.values()].sort((a, b) => b.durationSeconds - a.durationSeconds || (a.name ?? '').localeCompare(b.name ?? ''))
}
