import { readingRangeSchema, splitReadingTime } from '@bookdock/shared'
import type { ClientVaultReadingSnapshot, ClientReadingBookView, ReadingRange, ReadingRecordCategoryItem, ReadingRecordDailyItem, ReadingRecordHourlyItem, ReadingRecordSummaryRes, ReadingRecordTagItem } from '@bookdock/shared'

import { projectLocalReadingBook } from './reading-projection'

const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)

function streak(dates: string[]): number {
  let longest = 0
  let current = 0
  let previous: string | undefined
  for (const date of dates) {
    current = previous && shiftDate(previous, 1) === date ? current + 1 : 1
    longest = Math.max(longest, current)
    previous = date
  }
  return longest
}

export function projectLocalVaultReading(snapshot: ClientVaultReadingSnapshot, input: ReadingRange = {}, today?: string) {
  const range = readingRangeSchema.parse(input)
  const timezone = range.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const formatDate = (clock: number) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(clock)
  const currentDate = today ?? formatDate(Date.now())
  const inRange = (date: string) => (!range.from || date >= range.from) && (!range.to || date <= range.to)
  const books = snapshot.books.map((book) => ({ snapshot: book, all: projectLocalReadingBook(book), scoped: projectLocalReadingBook(book, range) }))
  const allDaily = new Map<string, number>()
  const daily = new Map<string, number>()
  const hourly = Array.from({ length: 24 }, (_, hour): ReadingRecordHourlyItem => ({ hour, durationSeconds: 0, days: 0 }))
  const hourDates = Array.from({ length: 24 }, () => new Set<string>())
  for (const book of books) {
    for (const day of book.all.stats.daily) allDaily.set(day.date, (allDaily.get(day.date) ?? 0) + day.durationSeconds)
    for (const day of book.scoped.stats.daily) daily.set(day.date, (daily.get(day.date) ?? 0) + day.durationSeconds)
    // Distinct dates must be unioned across books; per-book day counts cannot be summed.
    for (const session of book.scoped.sessions) {
      if (!session.timezone) continue
      for (const slice of splitReadingTime(session.fragments ?? [], session.timezone)) {
        if (inRange(slice.date)) hourDates[slice.hour]!.add(slice.date)
      }
    }
    for (const hour of book.scoped.stats.hourly) hourly[hour.hour]!.durationSeconds += hour.durationSeconds
  }
  for (const hour of hourly) hour.days = hourDates[hour.hour]!.size
  const allDays = [...allDaily].filter(([, seconds]) => seconds >= 60).map(([date]) => date).sort()
  const scopedDays = [...daily].filter(([, seconds]) => seconds >= 60).map(([date]) => date).sort()
  const sumDates = (from: string, to: string) => [...allDaily].reduce((sum, [date, seconds]) => sum + (date >= from && date <= to ? seconds : 0), 0)
  const endCurrent = allDays.includes(currentDate) ? currentDate : shiftDate(currentDate, -1)
  let currentStreak = 0
  for (let date = endCurrent; allDaily.get(date) !== undefined && allDaily.get(date)! >= 60; date = shiftDate(date, -1)) currentStreak++
  const weekday = new Date(`${currentDate}T00:00:00Z`).getUTCDay()
  const weekStart = shiftDate(currentDate, -(weekday === 0 ? 6 : weekday - 1))
  const monthStart = `${currentDate.slice(0, 7)}-01`
  const previousMonthEnd = shiftDate(monthStart, -1)
  const previousMonthStart = `${previousMonthEnd.slice(0, 7)}-01`
  const finished = books.flatMap((book) => book.snapshot.rounds.rounds.filter((round) => round.status === 'finished' && ((!range.from && !range.to) || round.endedAt !== null && inRange(formatDate(round.endedAt)))).map((round) => ({ book: book.snapshot.book.ref.bookId, round })))
  const wordState = (states: string[]) => states.every((state) => state === 'known') ? 'known' as const : states.every((state) => state === 'unknown') ? 'unknown' as const : 'partial' as const
  const summary: ReadingRecordSummaryRes = {
    wordState: wordState(books.filter((book) => book.all.overview.totalSeconds > 0).map((book) => book.all.overview.wordState)),
    firstRecordedDate: [...allDaily.keys()].sort()[0],
    totalSeconds: [...allDaily.values()].reduce((sum, seconds) => sum + seconds, 0),
    undatedDurationSeconds: 0, referenceDurationSeconds: 0,
    totalBooks: books.filter((book) => book.all.overview.totalSeconds > 0).length,
    totalDays: allDays.length, todaySeconds: allDaily.get(currentDate) ?? 0,
    currentStreak, longestStreak: streak(allDays),
    weekSeconds: sumDates(weekStart, currentDate), prevWeekSeconds: sumDates(shiftDate(weekStart, -7), shiftDate(weekStart, -1)),
    monthSeconds: sumDates(monthStart, currentDate), prevMonthSeconds: sumDates(previousMonthStart, previousMonthEnd),
    totalWordsRead: books.reduce((sum, book) => sum + (book.all.overview.totalWordsRead ?? 0), 0),
    scope: {
      longestStreak: streak(scopedDays), totalSeconds: [...daily.values()].reduce((sum, seconds) => sum + seconds, 0),
      undatedDurationSeconds: 0, referenceDurationSeconds: 0,
      totalBooks: books.filter((book) => book.scoped.stats.totalSeconds > 0).length,
      totalDays: scopedDays.length, finishedBooks: new Set(finished.map((item) => item.book)).size, finishedRounds: finished.length,
      totalWordsRead: books.reduce((sum, book) => sum + (book.scoped.stats.totalWordsRead ?? 0), 0),
      wordState: wordState(books.filter((book) => book.scoped.stats.totalSeconds > 0).map((book) => book.scoped.stats.wordState)),
      wordsPartial: books.some((book) => book.scoped.stats.wordState === 'unknown' || book.scoped.stats.wordState === 'partial'),
    },
  }
  const byBook: ClientReadingBookView[] = books.filter((book) => book.scoped.stats.totalSeconds > 0).map(({ snapshot: book, scoped }) => ({
    ref: book.book.ref, bookId: book.book.ref.bookId, title: book.book.title, author: book.book.authors.join(', '), coverKey: null,
    progress: book.state?.fraction === undefined || book.state.fraction === null ? null : book.state.fraction * 100,
    durationSeconds: scoped.stats.totalSeconds, referenceDurationSeconds: 0,
    days: scoped.stats.daily.filter((day) => day.durationSeconds >= 60).length, readStatus: book.state?.readStatus ?? null,
  }))
  const byTag: ReadingRecordTagItem[] = []
  const byCategory: ReadingRecordCategoryItem[] = []
  for (const item of snapshot.organization.items) {
    const matches = books.filter((book) => book.scoped.stats.totalSeconds > 0 && (item.kind === 'tag' ? book.snapshot.book.catalog?.tagIds?.includes(item.id) : item.kind === 'category' && book.snapshot.book.catalog?.categoryId === item.id))
    if (!matches.length) continue
    const durationSeconds = matches.reduce((sum, book) => sum + book.scoped.stats.totalSeconds, 0)
    if (item.kind === 'tag') byTag.push({ tagId: item.id, name: item.name, durationSeconds, bookCount: matches.length })
    if (item.kind === 'category') byCategory.push({ categoryId: item.id, name: item.name, parentId: item.parentId, parentName: snapshot.organization.items.find((parent) => parent.kind === 'category' && parent.id === item.parentId)?.name ?? null, durationSeconds, bookCount: matches.length })
  }
  const uncategorized = books.filter((book) => book.scoped.stats.totalSeconds > 0 && !book.snapshot.book.catalog?.categoryId)
  if (uncategorized.length) byCategory.push({ categoryId: null, name: null, parentId: null, parentName: null, durationSeconds: uncategorized.reduce((sum, book) => sum + book.scoped.stats.totalSeconds, 0), bookCount: uncategorized.length })
  return { summary, daily: [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, durationSeconds]): ReadingRecordDailyItem => ({ date, durationSeconds })), hourly, byBook, byTag, byCategory }
}
