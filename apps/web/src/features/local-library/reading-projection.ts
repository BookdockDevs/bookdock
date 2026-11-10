import { mergeTimeFragments, readingRangeSchema, splitReadingTime, type ClientReadingBookSnapshot, type ClientReadingSession, type ReadingLedgerOverview, type ReadingLedgerSession, type ReadingLedgerStatsRes, type ReadingRange, type ReadingWordState } from '@bookdock/shared'

function union(intervals: Array<[number, number]>): Array<[number, number]> {
  const result: Array<[number, number]> = []
  for (const [start, end] of intervals.map(([a, b]): [number, number] => [Math.min(a, b), Math.max(a, b)]).sort(([a], [b]) => a - b)) {
    const previous = result.at(-1)
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end)
    else if (start < end) result.push([start, end])
  }
  return result
}
const length = (intervals: Array<[number, number]>) => union(intervals).reduce((sum, [start, end]) => sum + end - start, 0)
const wordState = (known: boolean, unknown: boolean): ReadingWordState => unknown ? known ? 'partial' : 'unknown' : 'known'

export function projectLocalReadingBook(snapshot: ClientReadingBookSnapshot, input: ReadingRange = {}) {
  const range = readingRangeSchema.parse(input)
  const inRange = (date: string) => (!range.from || date >= range.from) && (!range.to || date <= range.to)
  const revision = snapshot.book.content?.contentId
  const currentRoundId = snapshot.rounds.rounds.at(-1)?.id ?? null
  const groups = new Map<string, ClientReadingSession[]>()
  for (const row of snapshot.ledger.sessions) {
    const id = row.groupId ?? row.id
    const members = groups.get(id) ?? []
    members.push(row)
    groups.set(id, members)
  }
  const logical = [...groups].map(([id, rows]) => {
    rows.sort((a, b) => (a.capture.startedAt ?? 0) - (b.capture.startedAt ?? 0) || a.id.localeCompare(b.id))
    const first = rows[0]!
    const capture = first.capture
    const roundId = first.roundId ?? snapshot.rounds.rounds[0]?.id ?? null
    if (rows.some((row) => (row.roundId ?? snapshot.rounds.rounds[0]?.id ?? null) !== roundId || row.capture.source !== capture.source || row.capture.revisionId !== capture.revisionId || row.capture.timezone !== capture.timezone)) throw new Error('Logical reading group has inconsistent ownership or basis')
    const coverage = union(rows.flatMap((row) => row.capture.coverage ?? (row.capture.source === 'retroactive' && row.capture.startFraction !== undefined && row.capture.endFraction !== undefined ? [[row.capture.startFraction, row.capture.endFraction]] : [])))
    const aligned = capture.revisionId !== undefined && capture.revisionId === revision
    const knownWordCounts = new Set(rows.map((row) => row.capture.wordCount))
    const count = knownWordCounts.size === 1 ? capture.wordCount ?? null : null
    const coverageKnown = rows.every((row) => row.capture.coverage !== undefined || row.capture.source === 'retroactive' && row.capture.startFraction !== undefined && row.capture.endFraction !== undefined)
    const fragments = mergeTimeFragments(rows.flatMap((row) => row.acceptedFragments))
    const starts = rows.flatMap((row) => row.capture.startedAt === null ? [] : [row.capture.startedAt])
    const ends = rows.flatMap((row) => row.capture.endedAt === undefined ? [] : [row.capture.endedAt])
    const durationSeconds = rows.reduce((sum, row) => sum + row.durationSeconds, 0)
    const slices = fragments.length && capture.timezone ? splitReadingTime(fragments, capture.timezone) : [{ date: capture.date, hour: null, durationSeconds }]
    const session: ReadingLedgerSession = {
      id, roundId, clientMembers: rows.map((row) => ({ id: row.id, version: row.version })), source: capture.source,
      date: slices[0]?.date ?? capture.date, startedAt: starts.length ? Math.min(...starts) : null, endedAt: ends.length ? Math.max(...ends) : null,
      durationSeconds, startFraction: capture.startFraction ?? null, endFraction: rows.at(-1)!.capture.endFraction ?? null,
      progressScale: aligned ? 1 : null, revisionId: capture.revisionId ?? null,
      startCfi: capture.startCfi ?? null, endCfi: rows.at(-1)!.capture.endCfi ?? null,
      startChapterIndex: capture.startChapterIndex ?? null, endChapterIndex: rows.at(-1)!.capture.endChapterIndex ?? null,
      coverage, projectedCoverage: aligned ? coverage : [], unalignedCoverage: coverage.length > 0 && !aligned,
      fragments, timezone: capture.timezone ?? '', wordCount: count, contributionDates: [...new Set(slices.map((slice) => slice.date))],
    }
    return { session, slices, words: count === null || !coverageKnown ? null : length(coverage) * count }
  })
  logical.sort((a, b) => b.session.date.localeCompare(a.session.date) || (b.session.startedAt ?? 0) - (a.session.startedAt ?? 0) || a.session.id.localeCompare(b.session.id))

  const daily = new Map<string, { seconds: number; words: number; known: boolean; unknown: boolean; progress: number }>()
  const hours = Array.from({ length: 24 }, () => ({ seconds: 0, dates: new Set<string>() }))
  let scopedKnown = false
  let scopedUnknown = false
  let scopedWords = 0
  let estimateWords = 0
  let estimateSeconds = 0
  for (const item of logical) {
    const totalSliceSeconds = item.slices.reduce((sum, slice) => sum + slice.durationSeconds, 0)
    if (item.words !== null && item.words > 0 && item.session.progressScale === 1) { estimateWords += item.words; estimateSeconds += item.session.durationSeconds }
    for (const slice of item.slices) {
      if (!inRange(slice.date)) continue
      const day = daily.get(slice.date) ?? { seconds: 0, words: 0, known: false, unknown: false, progress: 0 }
      const ratio = totalSliceSeconds > 0 ? slice.durationSeconds / totalSliceSeconds : 0
      day.seconds += slice.durationSeconds
      if (item.words === null) { day.unknown = true; scopedUnknown = true }
      else { day.known = true; scopedKnown = true; day.words += item.words * ratio; scopedWords += item.words * ratio }
      if (item.session.progressScale === 1) {
        day.progress += length(item.session.coverage) * ratio
      }
      daily.set(slice.date, day)
      if (slice.hour !== null) { hours[slice.hour]!.seconds += slice.durationSeconds; hours[slice.hour]!.dates.add(slice.date) }
    }
  }
  const currentRows = logical.filter((item) => item.session.roundId === currentRoundId)
  const currentCoverage = snapshot.state?.coverage && snapshot.state.coverage.content.contentId === revision ? snapshot.coverageIntervals : []
  const coverageIntervals = union([...currentCoverage, ...currentRows.flatMap((item) => item.session.projectedCoverage ?? [])])
  const coverage = length(coverageIntervals)
  const currentCounts = new Set(logical.filter((item) => item.session.progressScale === 1 && item.session.wordCount !== null).map((item) => item.session.wordCount!))
  const contentWordCount = snapshot.book.textSource ? snapshot.book.textSource.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0) : currentCounts.size === 1 ? [...currentCounts][0]! : null
  const dates = [...daily.keys()].sort()
  const stats: ReadingLedgerStatsRes = {
    dataVersion: snapshot.ledger.version, ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}),
    totalSeconds: [...daily.values()].reduce((sum, day) => sum + day.seconds, 0), undatedDurationSeconds: 0, referenceDurationSeconds: 0,
    totalWordsRead: scopedUnknown && !scopedKnown ? null : scopedWords, wordState: wordState(scopedKnown, scopedUnknown),
    readingDays: [...daily.values()].filter((day) => day.seconds >= 60).length,
    daily: dates.map((date) => {
      const day = daily.get(date)!
      return { date, durationSeconds: day.seconds, totalWordsRead: day.unknown && !day.known ? null : day.words, wordState: wordState(day.known, day.unknown), cumulativeCoverage: null, progressDelta: day.progress }
    }),
    hourly: hours.map((hour, index) => ({ hour: index, durationSeconds: hour.seconds, days: hour.dates.size })), legacyDaily: [],
    remainingSeconds: contentWordCount !== null && estimateWords > 0 ? (1 - coverage) * contentWordCount * estimateSeconds / estimateWords : null,
  }
  const allDates = new Map<string, number>()
  for (const item of logical) for (const slice of item.slices) allDates.set(slice.date, (allDates.get(slice.date) ?? 0) + slice.durationSeconds)
  const allKnown = logical.some((item) => item.words !== null)
  const allUnknown = logical.some((item) => item.words === null)
  const overview: ReadingLedgerOverview = {
    bookId: snapshot.book.ref.bookId, title: snapshot.book.title, author: snapshot.book.authors.join(', '), format: snapshot.book.format,
    sourceAvailable: snapshot.book.availability === 'available', currentRoundId, legacyCoverage: false,
    rounds: [...snapshot.rounds.rounds].reverse().map((round) => {
      const entries = logical.filter((item) => item.session.roundId === round.id)
      const wordCounts = new Set(entries.map((item) => item.session.wordCount))
      const roundWordCount = wordCounts.size === 1 ? [...wordCounts][0]! : round.coverage?.content.contentId === revision ? contentWordCount : null
      const recordedCoverage = round.coverage && round.coverage.content.contentId === revision ? round.coverage.intervals : []
      return { id: round.id, ordinal: round.ordinal, status: round.status, startedAt: round.startedAt, endedAt: round.endedAt,
        coverage: length([...recordedCoverage, ...entries.flatMap((item) => item.session.projectedCoverage ?? [])]),
        totalSeconds: entries.reduce((sum, item) => sum + item.session.durationSeconds, 0), wordCount: roundWordCount, legacyCoverage: false,
        unalignedCoverage: Boolean(round.coverage && round.coverage.content.contentId !== revision) || Boolean(round.coverageHistory?.some((basis) => basis.content.contentId !== revision)) || entries.some((item) => item.session.unalignedCoverage),
      }
    }),
    coverage, coverageIntervals, totalSeconds: logical.reduce((sum, item) => sum + item.session.durationSeconds, 0), undatedDurationSeconds: 0, referenceDurationSeconds: 0,
    totalWordsRead: allUnknown && !allKnown ? null : logical.reduce((sum, item) => sum + (item.words ?? 0), 0), wordState: wordState(allKnown, allUnknown),
    readingDays: [...allDates.values()].filter((seconds) => seconds >= 60).length, earliestDate: [...allDates.keys()].sort()[0] ?? null,
    legacyIntervals: [], legacyWordCount: null, dataVersion: snapshot.ledger.version,
    unalignedCoverage: logical.some((item) => item.session.unalignedCoverage) || snapshot.rounds.rounds.some((round) => Boolean(round.coverage && round.coverage.content.contentId !== revision) || Boolean(round.coverageHistory?.some((basis) => basis.content.contentId !== revision))) || Boolean(snapshot.state?.coverage && snapshot.state.coverage.content.contentId !== revision),
  }
  return { overview, stats, sessions: logical.filter((item) => item.slices.some((slice) => inRange(slice.date))).map((item) => item.session) }
}
