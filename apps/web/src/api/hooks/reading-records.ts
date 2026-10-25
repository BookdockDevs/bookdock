import { useEffect, useRef, useState } from 'react'

import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  ReadingLedgerOverview,
  ReadingLedgerSessionPage,
  ReadingLedgerStatsRes,
  ReadingRange,
  ReadingRecordBookDetailRes,
  ReadingRecordBookItem,
  ReadingRecordCreateReq,
  ReadingRecordDailyItem,
  ReadingRecordHourlyItem,
  ReadingRecordSummaryRes,
  ReadingRecordTagItem,
  ReadingSessionUpdateReq,
} from '@bookdock/shared'

import { apiDelete, apiGet, apiPost, apiPut } from '@/api/client'
import { withReveal } from '@/lib/reveal-hidden'

export const READING_RECORDS_KEY = ['reading-records']

/** Local calendar day as 'YYYY-MM-DD' — the attribution unit for reading time */
export function localDateString(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useReadingSummary(
  from?: string,
  to?: string,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  options: { enabled?: boolean } = {},
) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const params = new URLSearchParams({ today, timezone })
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  return useQuery({
    queryKey: [...READING_RECORDS_KEY, 'summary', today, from, to, timezone],
    queryFn: () => apiGet<{ data: ReadingRecordSummaryRes }>(withReveal(`/reading-records/summary?${params}`)),
    enabled: options.enabled !== false,
  })
}

export function usePreviousReadingSummary(from?: string, to?: string, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const params = new URLSearchParams({ today, timezone })
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const enabled = Boolean(from && to)
  return useQuery({
    queryKey: [...READING_RECORDS_KEY, 'summary-prev', today, from, to, timezone],
    queryFn: () => apiGet<{ data: ReadingRecordSummaryRes }>(withReveal(`/reading-records/summary?${params}`)),
    enabled,
  })
}

function rangeQuery(from?: string, to?: string): string {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function useReadingDaily(from?: string, to?: string) {
  return useQuery({
    queryKey: [...READING_RECORDS_KEY, 'daily', from, to],
    queryFn: () => apiGet<{ data: ReadingRecordDailyItem[] }>(withReveal(`/reading-records/daily${rangeQuery(from, to)}`)),
  })
}

export function useReadingByBook(from?: string, to?: string) {
  return useQuery({
    queryKey: [...READING_RECORDS_KEY, 'by-book', from, to],
    queryFn: () => apiGet<{ data: ReadingRecordBookItem[] }>(withReveal(`/reading-records/by-book${rangeQuery(from, to)}`)),
  })
}

export function useReadingByTag(from?: string, to?: string) {
  return useQuery({
    queryKey: [...READING_RECORDS_KEY, 'by-tag', from, to],
    queryFn: () => apiGet<{ data: ReadingRecordTagItem[] }>(withReveal(`/reading-records/by-tag${rangeQuery(from, to)}`)),
  })
}

export function useReadingHourly(from?: string, to?: string, bookId?: string) {
  const tzOffset = new Date().getTimezoneOffset()
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (bookId) params.set('bookId', bookId)
  params.set('tzOffset', String(tzOffset))
  return useQuery({
    queryKey: [...READING_RECORDS_KEY, 'hourly', from, to, bookId, tzOffset],
    queryFn: () => apiGet<{ data: ReadingRecordHourlyItem[] }>(withReveal(`/reading-records/hourly?${params}`)),
  })
}

export function useBookReadingRecords(bookId: string | undefined, options: { enabled?: boolean; range?: ReadingRange } = {}) {
  const params = new URLSearchParams()
  if (options.range?.from) params.set('from', options.range.from)
  if (options.range?.to) params.set('to', options.range.to)
  if (options.range?.timezone) params.set('timezone', options.range.timezone)
  const query = params.toString()
  return useQuery({
    queryKey: [...READING_RECORDS_KEY, 'book', bookId, ...(query ? [query] : [])],
    queryFn: () => apiGet<{ data: ReadingRecordBookDetailRes }>(withReveal(`/reading-records/book/${bookId}${query ? `?${query}` : ''}`)),
    enabled: !!bookId && options.enabled !== false,
  })
}

function readingLedgerStatsOptions(bookId: string, range?: ReadingRange, dataVersion?: number) {
  const params = new URLSearchParams()
  if (range?.from) params.set('from', range.from)
  if (range?.to) params.set('to', range.to)
  const query = params.toString()
  return queryOptions({
    queryKey: [...READING_RECORDS_KEY, 'ledger-stats', bookId, range?.from, range?.to, dataVersion],
    queryFn: () => apiGet<{ data: ReadingLedgerStatsRes }>(withReveal(`/reading-records/book/${bookId}/stats${query ? `?${query}` : ''}`)),
    enabled: !!bookId,
  })
}

export function useBookReadingLedgerStats(bookId: string, range?: ReadingRange, dataVersion?: number) {
  return useQuery(readingLedgerStatsOptions(bookId, range, dataVersion))
}

function readingSessionsOptions(bookId: string, range?: ReadingRange, dataVersion?: number) {
  return infiniteQueryOptions({
    queryKey: [...READING_RECORDS_KEY, 'ledger-sessions', bookId, range?.from, range?.to, dataVersion],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (range?.from) params.set('from', range.from)
      if (range?.to) params.set('to', range.to)
      if (pageParam) params.set('cursor', pageParam)
      params.set('limit', '50')
      return apiGet<{ data: ReadingLedgerSessionPage }>(withReveal(`/reading-records/book/${bookId}/sessions?${params}`))
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.data.nextCursor ?? undefined,
    enabled: !!bookId,
  })
}

export function useBookReadingSessions(bookId: string, range?: ReadingRange, dataVersion?: number) {
  return useInfiniteQuery(readingSessionsOptions(bookId, range, dataVersion))
}

export function useReadingLedgerRecovery(bookId: string, mismatch: boolean, range?: ReadingRange) {
  const queryClient = useQueryClient()
  const from = range?.from
  const to = range?.to
  const timezone = range?.timezone
  const scope = JSON.stringify([bookId, from, to, timezone])
  const active = useRef<{ cancelled: boolean } | null>(null)
  const [result, setResult] = useState<{ scope: string; failed: boolean } | null>(null)
  const [retry, setRetry] = useState(0)
  const failed = result?.scope === scope && result.failed

  useEffect(() => () => {
    if (active.current) active.current.cancelled = true
    active.current = null
  }, [scope])

  useEffect(() => {
    if (!mismatch || failed || active.current) return
    const run = { cancelled: false }
    active.current = run
    void (async () => {
      const recoveryRange = { from, to, timezone }
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const ledger = await queryClient.fetchQuery({ ...readingLedgerOptions(bookId), staleTime: 0, retry: false })
          if (run.cancelled) return
          const version = ledger.data.dataVersion
          const sessionsOptions = readingSessionsOptions(bookId, recoveryRange, version)
          // A one-page refetch replaces the previous infinite result atomically.
          await queryClient.cancelQueries({ queryKey: sessionsOptions.queryKey, exact: true })
          if (run.cancelled) return
          const [stats, sessions] = await Promise.all([
            queryClient.fetchQuery({ ...readingLedgerStatsOptions(bookId, recoveryRange, version), staleTime: 0, retry: false }),
            queryClient.fetchInfiniteQuery({ ...sessionsOptions, pages: 1, staleTime: 0, retry: false }),
          ])
          if (run.cancelled) return
          if (stats.data.dataVersion === version && sessions.pages.length === 1
            && sessions.pages[0].data.dataVersion === version) {
            setResult({ scope, failed: false })
            return
          }
        } catch {
          if (run.cancelled) return
        }
      }
      if (!run.cancelled) setResult({ scope, failed: true })
    })().finally(() => {
      if (active.current === run) active.current = null
    })
  }, [bookId, failed, from, mismatch, queryClient, retry, scope, timezone, to])

  return { failed, retry: () => { setResult(null); setRetry((value) => value + 1) } }
}

/** Refresh coverage-derived views after a retroactive entry without moving the reader position. */
export function useAddReadingRecord(bookId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ReadingRecordCreateReq) => apiPost(withReveal('/reading-records'), body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
      queryClient.invalidateQueries({ queryKey: ['progress', bookId] })
      queryClient.invalidateQueries({ queryKey: ['archive'] })
    },
  })
}

/**
 * Warm the per-book stats queries at reader mount so the sidebar stats tab
 * renders from the same cache as its ledger and total-duration consumers.
 * Pass undefined for guest readers.
 */
export function usePrefetchBookReadingStats(bookId: string | undefined) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!bookId) return
    void queryClient.prefetchQuery({
      queryKey: [...READING_RECORDS_KEY, 'book', bookId],
      queryFn: () => apiGet<{ data: ReadingRecordBookDetailRes }>(withReveal(`/reading-records/book/${bookId}`)),
    })
    void queryClient.prefetchQuery({
      queryKey: [...READING_RECORDS_KEY, 'ledger', bookId],
      queryFn: () => apiGet<{ data: ReadingLedgerOverview }>(withReveal(`/reading-records/book/${bookId}/ledger`)),
    })
  }, [bookId, queryClient])
}

export function useUpdateSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReadingSessionUpdateReq }) =>
      apiPut(`/reading-records/sessions/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
      queryClient.invalidateQueries({ queryKey: ['archive'] })
      queryClient.invalidateQueries({ queryKey: ['progress'] })
    },
  })
}

export function useDeleteSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/reading-records/sessions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
      queryClient.invalidateQueries({ queryKey: ['archive'] })
      queryClient.invalidateQueries({ queryKey: ['progress'] })
    },
  })
}

function readingLedgerOptions(bookId: string) {
  return queryOptions({
    queryKey: [...READING_RECORDS_KEY, 'ledger', bookId],
    queryFn: () => apiGet<{ data: ReadingLedgerOverview }>(withReveal(`/reading-records/book/${bookId}/ledger`)),
    enabled: !!bookId,
  })
}

export function useReadingLedger(bookId: string, options: { enabled?: boolean } = {}) {
  return useQuery({ ...readingLedgerOptions(bookId), enabled: !!bookId && options.enabled !== false })
}

export function useReadingRound(bookId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (action: 'reread' | 'continue' | 'finish' | 'abandon') => apiPost(`/reading-records/book/${bookId}/round`, { action }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book', bookId] })
      void queryClient.invalidateQueries({ queryKey: ['progress', bookId] })
      void queryClient.invalidateQueries({ queryKey: ['archive'] })
    },
  })
}
