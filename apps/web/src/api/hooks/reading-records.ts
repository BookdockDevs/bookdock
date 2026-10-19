import { useEffect } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  ReadingLedgerRes,
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

export function useReadingSummary(from?: string, to?: string, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const params = new URLSearchParams({ today, timezone })
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  return useQuery({
    queryKey: [...READING_RECORDS_KEY, 'summary', today, from, to, timezone],
    queryFn: () => apiGet<{ data: ReadingRecordSummaryRes }>(withReveal(`/reading-records/summary?${params}`)),
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
      queryFn: () => apiGet<{ data: ReadingLedgerRes }>(withReveal(`/reading-records/book/${bookId}/ledger`)),
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

export function useReadingLedger(bookId: string) {
  return useQuery({
    queryKey: [...READING_RECORDS_KEY, 'ledger', bookId],
    queryFn: () => apiGet<{ data: ReadingLedgerRes }>(withReveal(`/reading-records/book/${bookId}/ledger`)),
    enabled: !!bookId,
  })
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
