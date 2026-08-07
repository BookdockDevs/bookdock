import { useEffect } from 'react'

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  ReadingDetailItem,
  ReadingRecordBookDetailRes,
  ReadingRecordBookItem,
  ReadingRecordCreateReq,
  ReadingRecordDailyItem,
  ReadingRecordHourlyItem,
  ReadingRecordSummaryRes,
  ReadingRecordTagItem,
  ReadingSessionItem,
  ReadingSessionUpdateReq,
} from '@bookdock/shared'

import { apiDelete, apiGet, apiPost, apiPut } from '@/api/client'

export const READING_RECORDS_KEY = ['reading-records']

/** Local calendar day as 'YYYY-MM-DD' — the attribution unit for reading time */
export function localDateString(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useReadingSummary() {
  const today = localDateString()
  return useQuery({
    queryKey: [...READING_RECORDS_KEY, 'summary', today],
    queryFn: () => apiGet<{ data: ReadingRecordSummaryRes }>(`/reading-records/summary?today=${today}`),
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
    queryFn: () => apiGet<{ data: ReadingRecordDailyItem[] }>(`/reading-records/daily${rangeQuery(from, to)}`),
  })
}

export function useReadingByBook(from?: string, to?: string) {
  return useQuery({
    queryKey: [...READING_RECORDS_KEY, 'by-book', from, to],
    queryFn: () => apiGet<{ data: ReadingRecordBookItem[] }>(`/reading-records/by-book${rangeQuery(from, to)}`),
  })
}

export function useReadingByTag(from?: string, to?: string) {
  return useQuery({
    queryKey: [...READING_RECORDS_KEY, 'by-tag', from, to],
    queryFn: () => apiGet<{ data: ReadingRecordTagItem[] }>(`/reading-records/by-tag${rangeQuery(from, to)}`),
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
    queryFn: () => apiGet<{ data: ReadingRecordHourlyItem[] }>(`/reading-records/hourly?${params}`),
  })
}

export function useBookReadingRecords(bookId: string | undefined) {
  return useQuery({
    queryKey: [...READING_RECORDS_KEY, 'book', bookId],
    queryFn: () => apiGet<{ data: ReadingRecordBookDetailRes }>(`/reading-records/book/${bookId}`),
    enabled: !!bookId,
  })
}

export function useAddReadingTime() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ReadingRecordCreateReq) => apiPost('/reading-records', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY }),
  })
}

/** Retroactive entry from the reader sidebar; also refreshes progress because start/end fractions merge into read intervals */
export function useAddReadingRecord(bookId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ReadingRecordCreateReq) => apiPost('/reading-records', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
      queryClient.invalidateQueries({ queryKey: READING_SESSIONS_KEY })
      queryClient.invalidateQueries({ queryKey: ['progress', bookId] })
    },
  })
}

const DETAIL_PAGE_SIZE = 50

/** Mixed per-book detail feed (manual sessions + auto day rows), newest first */
export function useReadingDetailInfinite(bookId: string | undefined) {
  return useInfiniteQuery({
    queryKey: [...READING_RECORDS_KEY, 'detail', bookId],
    queryFn: ({ pageParam }) =>
      apiGet<{ data: ReadingDetailItem[] }>(`/reading-records/book/${bookId}/detail?limit=${DETAIL_PAGE_SIZE}&offset=${pageParam as number}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.data.length === DETAIL_PAGE_SIZE ? allPages.length * DETAIL_PAGE_SIZE : undefined,
    enabled: !!bookId,
  })
}

export const READING_SESSIONS_KEY = ['reading-sessions']

/**
 * Warm the per-book stats queries at reader mount so the sidebar stats tab
 * renders instantly on first open (book + progress are already fetched by the
 * reader itself). Pass undefined to skip (timer mode off hides the tab anyway).
 */
export function usePrefetchBookReadingStats(bookId: string | undefined) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!bookId) return
    void queryClient.prefetchQuery({
      queryKey: [...READING_RECORDS_KEY, 'book', bookId],
      queryFn: () => apiGet<{ data: ReadingRecordBookDetailRes }>(`/reading-records/book/${bookId}`),
    })
    void queryClient.prefetchInfiniteQuery({
      queryKey: [...READING_RECORDS_KEY, 'detail', bookId],
      queryFn: ({ pageParam }) =>
        apiGet<{ data: ReadingDetailItem[] }>(`/reading-records/book/${bookId}/detail?limit=${DETAIL_PAGE_SIZE}&offset=${pageParam as number}`),
      initialPageParam: 0,
    })
  }, [bookId, queryClient])
}

export function useReadingSessionsInfinite(bookId: string | undefined) {
  const params = (offset: number) => {
    const p = new URLSearchParams()
    if (bookId) p.set('bookId', bookId)
    p.set('limit', String(SESSION_PAGE_SIZE))
    if (offset > 0) p.set('offset', String(offset))
    return p.toString()
  }
  return useInfiniteQuery({
    queryKey: [...READING_SESSIONS_KEY, 'infinite', bookId],
    queryFn: ({ pageParam }) =>
      apiGet<{ data: ReadingSessionItem[] }>(`/reading-records/sessions?${params(pageParam as number)}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.data.length === SESSION_PAGE_SIZE ? allPages.length * SESSION_PAGE_SIZE : undefined,
    enabled: !!bookId,
  })
}

const SESSION_PAGE_SIZE = 50

export function useUpdateSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReadingSessionUpdateReq }) =>
      apiPut(`/reading-records/sessions/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: READING_SESSIONS_KEY })
      queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
    },
  })
}

export function useDeleteSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/reading-records/sessions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: READING_SESSIONS_KEY })
      queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
    },
  })
}
