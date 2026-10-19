import type { ReadingLedgerRes, ReadingLedgerSession, ReadingRange } from '@bookdock/shared'

const timeFormatters = new Map<string, Intl.DateTimeFormat>()

export function ledgerProgressBounds(session: Pick<ReadingLedgerSession, 'startFraction' | 'endFraction' | 'progressScale'>) {
  const scale = session.progressScale === undefined ? 1 : session.progressScale
  return {
    scale,
    start: scale === null || session.startFraction === null ? null : session.startFraction * scale,
    end: scale === null || session.endFraction === null ? null : session.endFraction * scale,
  }
}

export function ledgerInitialFraction(ledger?: Pick<ReadingLedgerRes, 'rounds' | 'currentRoundId' | 'sessions'> | null): number | undefined {
  if (!ledger) return undefined
  const currentRound = ledger.rounds.find((r) => r.id === ledger.currentRoundId) ?? ledger.rounds.at(-1)
  return ledger.sessions
    .filter((s) => s.roundId === currentRound?.id)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startedAt ?? 0) - (b.startedAt ?? 0))
    .map((s) => ledgerProgressBounds(s).end)
    .filter((value): value is number => value !== null)
    .at(-1)
}

export function ledgerDateInRange(date: string, range?: ReadingRange) {
  return (!range?.from || date >= range.from) && (!range?.to || date <= range.to)
}

export function ledgerTimeDistribution(sessions: ReadingLedgerSession[], range?: ReadingRange) {
  const days = new Map<string, number>()
  const hours = Array.from({ length: 24 }, () => 0)
  const hourDays = Array.from({ length: 24 }, () => new Set<string>())
  for (const session of sessions) {
    if (!session.fragments.length || !session.timezone) {
      if (ledgerDateInRange(session.date, range)) days.set(session.date, (days.get(session.date) ?? 0) + session.durationSeconds)
      continue
    }
    let formatter = timeFormatters.get(session.timezone)
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: session.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
      })
      timeFormatters.set(session.timezone, formatter)
    }
    const label = (at: number) => {
      const parts = formatter.formatToParts(at)
      const part = (type: string) => parts.find((p) => p.type === type)!.value
      return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}`
    }
    for (const fragment of session.fragments) {
      let at = fragment.startedAt
      while (at < fragment.endedAt) {
        const bucket = label(at)
        // Probe absolute time so DST folds and fractional-hour zones keep
        // their actual duration without constructing ambiguous local dates.
        let end = Math.min(fragment.endedAt, at + 15 * 60_000)
        if (label(end - 1) !== bucket) {
          let low = at + 1
          let high = end
          while (low < high) {
            const middle = Math.floor((low + high) / 2)
            if (label(middle) === bucket) low = middle + 1
            else high = middle
          }
          end = low
        }
        const date = bucket.slice(0, 10)
        const seconds = (end - at) / 1000
        if (ledgerDateInRange(date, range)) {
          days.set(date, (days.get(date) ?? 0) + seconds)
          const hour = Number(bucket.slice(11))
          hours[hour] += seconds
          hourDays[hour].add(date)
        }
        at = end
      }
    }
  }
  return { days, hours, hourDays }
}

export function ledgerScopedWords(sessions: ReadingLedgerSession[], range?: ReadingRange) {
  let words = 0
  let sampleSeconds = 0
  let partial = false
  for (const session of sessions) {
    const fullSeconds = [...ledgerTimeDistribution([session]).days.values()].reduce((sum, seconds) => sum + seconds, 0)
    const seconds = [...ledgerTimeDistribution([session], range).days.values()].reduce((sum, duration) => sum + duration, 0)
    if (seconds <= 0) continue
    if (session.wordCount === null) { partial = true; continue }
    const amount = session.coverage.reduce((sum, [start, end]) => sum + Math.abs(end - start), 0) * session.wordCount * (fullSeconds > 0 ? seconds / fullSeconds : 0)
    if (amount > 0) { words += amount; sampleSeconds += seconds }
  }
  return { words, partial, wordsPerMinute: sampleSeconds > 0 ? words / sampleSeconds * 60 : null }
}

export function ledgerEstimates(sessions: ReadingLedgerSession[], coverage: number, contentWordCount?: number | null) {
  let words = 0
  let seconds = 0
  let fullWords: number | null = contentWordCount ?? null
  for (const session of [...sessions].sort((a, b) => a.date.localeCompare(b.date) || (a.startedAt ?? 0) - (b.startedAt ?? 0))) {
    if (session.wordCount === null) continue
    if (contentWordCount == null) fullWords = session.wordCount
    const amount = session.coverage.reduce((sum, [start, end]) => sum + Math.abs(end - start), 0) * session.wordCount
    if (amount > 0 && session.durationSeconds > 0) {
      words += amount
      seconds += session.durationSeconds
    }
  }
  const remainingSeconds = words > 0 && fullWords !== null ? Math.max(0, (1 - coverage) * fullWords) * seconds / words : null
  return { words, remainingSeconds, wordsPerMinute: seconds > 0 ? words / seconds * 60 : null }
}

export function ledgerCoverageByDate(sessions: ReadingLedgerSession[], baseline: Array<[number, number]> = []) {
  const values = new Map<string, number>()
  const intervals = [...baseline]
  for (const session of [...sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    intervals.push(...(session.projectedCoverage ?? session.coverage))
    const merged: Array<[number, number]> = []
    for (const [start, end] of intervals.map(([a, b]): [number, number] => [Math.min(a, b), Math.max(a, b)]).sort(([a], [b]) => a - b)) {
      const last = merged.at(-1)
      if (last && start <= last[1]) last[1] = Math.max(last[1], end)
      else merged.push([start, end])
    }
    values.set(session.date, merged.reduce((sum, [start, end]) => sum + end - start, 0))
  }
  return values
}
