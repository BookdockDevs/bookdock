import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  ReadingRecordBookDetailRes,
  ReadingRecordBookItem,
  ReadingRecordCreateReq,
  ReadingRecordDailyItem,
  ReadingRecordHourlyItem,
  ReadingRecordSummaryRes,
} from '@bookdock/shared'

import { apiGet, apiPost } from '@/api/client'

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
