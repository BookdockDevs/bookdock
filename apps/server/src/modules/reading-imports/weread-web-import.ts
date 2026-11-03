import type { ImportDurationFact, ImportProposal } from './reading-imports.service'

import { fetchBookReadInfo, fetchWereadWebApi, type WereadWebCredential } from './weread-web'
import { fetchWereadBookListUsing, fetchWereadProposalUsing, type WereadRequester } from './weread-import'
import { AppError } from '../../middleware/error'

const DURATION_CONCURRENCY = 4

type OnCredentialRefresh = (next: WereadWebCredential) => void

export function wereadWebDatasetKey(vid: string): string {
  return `vid:${vid}`
}

function requester(credential: WereadWebCredential, onCredentialRefresh?: OnCredentialRefresh): WereadRequester {
  return (params) => fetchWereadWebApi(credential, params, onCredentialRefresh)
}

function bookDayFacts(bookId: string, days: Array<{ date: string; seconds: number }>): ImportDurationFact[] {
  return days.map((day) => ({
    sourceBookId: bookId,
    sourceRecordKey: `web-day:${bookId}:${day.date}`,
    granularity: 'book_day',
    date: day.date,
    seconds: day.seconds,
    aggregationRole: 'additive',
  }))
}

export async function fetchWereadWebBookList(
  credential: WereadWebCredential,
  scope: 'all' | 'time' | 'notes',
  onCredentialRefresh?: OnCredentialRefresh,
): Promise<ImportProposal> {
  return fetchWereadBookListUsing(scope === 'notes' ? 'notes' : 'all', requester(credential, onCredentialRefresh))
}

export async function fetchWereadWebProposal(
  credential: WereadWebCredential,
  scope: 'all' | 'time' | 'notes',
  bookKeys?: string[] | null,
  onCredentialRefresh?: OnCredentialRefresh,
): Promise<ImportProposal> {
  const api = requester(credential, onCredentialRefresh)
  if (scope === 'notes') return fetchWereadProposalUsing('notes', bookKeys, api)

  // Absent means "everything the scope lists"; an explicit empty array is a
  // real choice and fetches nothing.
  const keys = bookKeys === undefined || bookKeys === null ? null : new Set(bookKeys)
  const base = scope === 'all'
    ? await fetchWereadProposalUsing('all', bookKeys, api, true)
    : await fetchWereadBookListUsing('all', api)
  const books = base.books.filter((book) => keys === null || keys.has(book.sourceBookId))
  const durations: ImportDurationFact[] = []
  const failures = [...base.unprocessable]

  for (let offset = 0; offset < books.length; offset += DURATION_CONCURRENCY) {
    const batch = books.slice(offset, offset + DURATION_CONCURRENCY)
    const settled = await Promise.all(batch.map(async (book) => {
      try {
        return { book, info: await fetchBookReadInfo(credential, book.sourceBookId, onCredentialRefresh) }
      } catch (error) {
        return { book, error }
      }
    }))
    for (const item of settled) {
      if ('error' in item) {
        const expired = item.error instanceof AppError && item.error.code === 'WEREAD_WEB_AUTH_EXPIRED'
        if (expired) throw item.error
        failures.push({ reason: 'web-readinfo-failed', count: 1 })
        continue
      }
      item.book.finished = item.info.finished
      item.book.meta = {
        ...item.book.meta,
        finished: item.info.finished,
        ...(item.info.finishedDate ? { finishedDate: item.info.finishedDate } : {}),
      }
      durations.push(...bookDayFacts(item.book.sourceBookId, item.info.days))
    }
  }

  return {
    ...base,
    // The book-list shape must not leak into an applicable proposal: listCounts
    // makes scopeProposal keep every listed book, so books without a single
    // fetched day of time would still be selectable and create empty archives
    // and bindings. Selectability now derives from the actual facts below.
    listCounts: undefined,
    books,
    durationFacts: scope === 'all' ? [...base.durationFacts, ...durations] : durations,
    unprocessable: failures,
  }
}
