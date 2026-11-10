import { useEffect, useMemo, useRef, useState } from 'react'

import { infiniteQueryOptions, queryOptions, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  ReadingLedgerOverview,
  ReadingLedgerSessionPage,
  ReadingLedgerSession,
  ReadingLedgerStatsRes,
  ReadingRange,
  ReadingRecordBookDetailRes,
  ClientReadingBookView,
  ReadingRecordCategoryItem,
  ReadingRecordCreateReq,
  ReadingRecordDailyItem,
  ReadingRecordHourlyItem,
  ReadingRecordSummaryRes,
  ReadingRecordTagItem,
  ReadingSessionUpdateReq,
} from '@bookdock/shared'

import { clientScopeKey } from '@bookdock/shared'

import { apiDelete, apiGet, apiPost, apiPut } from '@/api/client'
import { useLocalReader, type LocalReaderSession } from '@/features/reading-data/reader-source-context'
import { withReveal } from '@/lib/reveal-hidden'
import { useLocalCatalog } from '@/features/reading-data/catalog-source-context'
import { useVaultCapable } from '@/features/reading-data/vault-availability'
import { deviceCatalogOperations } from '@/features/local-library/catalog'
import { mergeByBook, mergeByCategory, mergeDaily, mergeHourly, mergeReadingSummaries, mergeByTag } from '@/features/reading-data/reading-merge'
import { projectLocalVaultReading } from '@/features/local-library/vault-reading-projection'
import { getAuthSessionRevision, useAuthStore } from '@/stores/auth.store'

export const READING_RECORDS_KEY = ['reading-records']
export const readingRecordBookKey = (kind: string, bookId: string, namespace?: string) => [...READING_RECORDS_KEY, ...(namespace ? [namespace] : []), kind, bookId]

/** Local calendar day as 'YYYY-MM-DD' — the attribution unit for reading time */
export function localDateString(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

type ProjectionSource = ReturnType<typeof useProjectionSource>

/**
 * One rule for every reading projection: a view that *is* the device library
 * reads the vault alone, a unified view reads the vault plus the server half,
 * and the server half is only probed for a signed-in session — an anonymous
 * visitor must never generate server traffic just by opening stats.
 */
function useProjectionSource() {
  const local = useLocalCatalog()
  const vaultCapable = useVaultCapable()
  const user = useAuthStore((state) => state.user)
  const device = useMemo(() => (vaultCapable && !local ? deviceCatalogOperations() : null), [vaultCapable, local])
  return { local, device, signedIn: Boolean(user) }
}

function useProjectionQuery<T>(
  kind: string,
  args: Array<string | number | boolean | undefined>,
  source: ProjectionSource,
  readDevice: (() => Promise<T>) | null,
  merge: (remote: T, device: T) => T,
  readServer: () => Promise<{ data: T }>,
  enabled = true,
  isEmpty: (value: T) => boolean = () => false,
) {
  const { local, device } = source
  const namespace = local ? `local:${JSON.stringify(local.scope)}` : device ? 'merged' : null
  return useQuery({
    queryKey: [...READING_RECORDS_KEY, ...(namespace ? [namespace] : []), kind, ...args],
    networkMode: local || device ? 'always' : 'online',
    queryFn: async (): Promise<{ data: T }> => {
      const serverOnly = (): Promise<{ data: T }> => readServer()
      if (!readDevice) return serverOnly()
      const deviceValue = await readDevice()
      // A merged view without a session has no server half, and a half that
      // fails must not blank the numbers the device already knows.
      if (!device || !source.signedIn) return { data: deviceValue }
      try {
        const remote = await serverOnly()
        return { data: merge(remote.data, deviceValue) }
      } catch (error) {
        // An empty device half means these numbers are the server's: a failed
        // read has to say so instead of passing a blank projection off as the
        // answer. Only a view that already holds device data degrades quietly.
        if (isEmpty(deviceValue)) throw error
        return { data: deviceValue }
      }
    },
    enabled,
  })
}

/** A device projection with nothing recorded yet; used to decide whether a
 * failed server read may degrade to the device half or must surface. */
function isEmptySummary(value: ReadingRecordSummaryRes): boolean {
  return (value.totalSeconds ?? 0) === 0 && (value.totalBooks ?? 0) === 0 && (value.totalDays ?? 0) === 0
}

function isEmptyList(value: readonly unknown[]): boolean {
  return value.length === 0
}

export function useReadingSummary(
  from?: string,
  to?: string,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  options: { enabled?: boolean } = {},
) {
  const source = useProjectionSource()
  const shared = source.device ?? source.local?.operations ?? null
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const params = new URLSearchParams({ today, timezone })
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  return useProjectionQuery<ReadingRecordSummaryRes>(
    'summary',
    [today, from, to, timezone],
    source,
    shared ? async () => (await shared.getReadingProjection({ from, to, timezone }, today)).summary : null,
    (remote, deviceValue) => mergeReadingSummaries(remote, deviceValue)!,
    () => apiGet<{ data: ReadingRecordSummaryRes }>(withReveal(`/reading-records/summary?${params}`)),
    options.enabled !== false,
    isEmptySummary,
  )
}

export function usePreviousReadingSummary(from?: string, to?: string, timezone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const source = useProjectionSource()
  const shared = source.device ?? source.local?.operations ?? null
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const params = new URLSearchParams({ today, timezone })
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  return useProjectionQuery<ReadingRecordSummaryRes>(
    'summary-prev',
    [today, from, to, timezone],
    source,
    shared ? async () => (await shared.getReadingProjection({ from, to, timezone }, today)).summary : null,
    (remote, deviceValue) => mergeReadingSummaries(remote, deviceValue)!,
    () => apiGet<{ data: ReadingRecordSummaryRes }>(withReveal(`/reading-records/summary?${params}`)),
    Boolean(from && to),
    isEmptySummary,
  )
}

function rangeQuery(from?: string, to?: string): string {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export function useReadingDaily(from?: string, to?: string) {
  const source = useProjectionSource()
  const shared = source.device ?? source.local?.operations ?? null
  return useProjectionQuery<ReadingRecordDailyItem[]>(
    'daily',
    [from, to],
    source,
    shared ? async () => (await shared.getReadingProjection({ from, to })).daily : null,
    mergeDaily,
    () => apiGet<{ data: ReadingRecordDailyItem[] }>(withReveal(`/reading-records/daily${rangeQuery(from, to)}`)),
    true,
    isEmptyList,
  )
}

export function useReadingByBook(from?: string, to?: string) {
  const source = useProjectionSource()
  const shared = source.device ?? source.local?.operations ?? null
  return useProjectionQuery<ClientReadingBookView[]>(
    'by-book',
    [from, to],
    source,
    shared ? async () => (await shared.getReadingProjection({ from, to })).byBook : null,
    mergeByBook,
    () => apiGet<{ data: ClientReadingBookView[] }>(withReveal(`/reading-records/by-book${rangeQuery(from, to)}`)),
    true,
    isEmptyList,
  )
}

export function useReadingByCategory(from?: string, to?: string) {
  const source = useProjectionSource()
  const shared = source.device ?? source.local?.operations ?? null
  return useProjectionQuery<ReadingRecordCategoryItem[]>(
    'by-category',
    [from, to],
    source,
    shared ? async () => (await shared.getReadingProjection({ from, to })).byCategory : null,
    mergeByCategory,
    () => apiGet<{ data: ReadingRecordCategoryItem[] }>(withReveal(`/reading-records/by-category${rangeQuery(from, to)}`)),
    true,
    isEmptyList,
  )
}

export function useReadingByTag(from?: string, to?: string) {
  const source = useProjectionSource()
  const shared = source.device ?? source.local?.operations ?? null
  return useProjectionQuery<ReadingRecordTagItem[]>(
    'by-tag',
    [from, to],
    source,
    shared ? async () => (await shared.getReadingProjection({ from, to })).byTag : null,
    mergeByTag,
    () => apiGet<{ data: ReadingRecordTagItem[] }>(withReveal(`/reading-records/by-tag${rangeQuery(from, to)}`)),
    true,
    isEmptyList,
  )
}

export function useReadingHourly(from?: string, to?: string, bookId?: string) {
  const source = useProjectionSource()
  const shared = source.device ?? source.local?.operations ?? null
  const tzOffset = new Date().getTimezoneOffset()
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  if (bookId) params.set('bookId', bookId)
  params.set('tzOffset', String(tzOffset))
  const readDevice = shared ? async () => {
    const snapshot = await shared.readReadingSnapshot()
    if (bookId) snapshot.books = snapshot.books.filter((book) => book.book.ref.bookId === bookId)
    return projectLocalVaultReading(snapshot, { from, to }).hourly
  } : null
  return useProjectionQuery<ReadingRecordHourlyItem[]>(
    'hourly',
    [from, to, bookId, tzOffset],
    source,
    readDevice,
    mergeHourly,
    () => apiGet<{ data: ReadingRecordHourlyItem[] }>(withReveal(`/reading-records/hourly?${params}`)),
    true,
    isEmptyList,
  )
}

export function useBookReadingRecords(bookId: string | undefined, options: { enabled?: boolean; range?: ReadingRange } = {}) {
  const local = useLocalReader()
  const params = new URLSearchParams()
  if (options.range?.from) params.set('from', options.range.from)
  if (options.range?.to) params.set('to', options.range.to)
  if (options.range?.timezone) params.set('timezone', options.range.timezone)
  const query = params.toString()
  return useQuery({
    queryKey: [...readingRecordBookKey('book', bookId ?? '', local?.namespace), ...(query ? [query] : [])],
    networkMode: local ? 'always' : 'online',
    queryFn: () => local ? local.getReadingRecords(options.range) : apiGet<{ data: ReadingRecordBookDetailRes }>(withReveal(`/reading-records/book/${bookId}${query ? `?${query}` : ''}`)),
    enabled: !!bookId && options.enabled !== false,
  })
}

function readingLedgerStatsOptions(bookId: string, range?: ReadingRange, dataVersion?: number, local?: LocalReaderSession | null) {
  const params = new URLSearchParams()
  if (range?.from) params.set('from', range.from)
  if (range?.to) params.set('to', range.to)
  const query = params.toString()
  return queryOptions({
    queryKey: [...readingRecordBookKey('ledger-stats', bookId, local?.namespace), range?.from, range?.to, dataVersion],
    networkMode: local ? 'always' : 'online',
    queryFn: () => local ? local.getReadingStats(range) : apiGet<{ data: ReadingLedgerStatsRes }>(withReveal(`/reading-records/book/${bookId}/stats${query ? `?${query}` : ''}`)),
    enabled: !!bookId,
  })
}

export function useBookReadingLedgerStats(bookId: string, range?: ReadingRange, dataVersion?: number) {
  return useQuery(readingLedgerStatsOptions(bookId, range, dataVersion, useLocalReader()))
}

function readingSessionsOptions(bookId: string, range?: ReadingRange, dataVersion?: number, local?: LocalReaderSession | null) {
  return infiniteQueryOptions({
    queryKey: [...readingRecordBookKey('ledger-sessions', bookId, local?.namespace), range?.from, range?.to, dataVersion],
    networkMode: local ? 'always' : 'online',
    queryFn: ({ pageParam }) => {
      if (local) return local.getReadingSessions(range, pageParam)
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
  return useInfiniteQuery(readingSessionsOptions(bookId, range, dataVersion, useLocalReader()))
}

export function useReadingLedgerRecovery(bookId: string, mismatch: boolean, range?: ReadingRange) {
  const local = useLocalReader()
  const queryClient = useQueryClient()
  const from = range?.from
  const to = range?.to
  const timezone = range?.timezone
  const scope = JSON.stringify([local?.namespace ?? null, bookId, from, to, timezone])
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
          const ledger = await queryClient.fetchQuery({ ...readingLedgerOptions(bookId, local), staleTime: 0, retry: false })
          if (run.cancelled) return
          const version = ledger.data.dataVersion
          const sessionsOptions = readingSessionsOptions(bookId, recoveryRange, version, local)
          // A one-page refetch replaces the previous infinite result atomically.
          await queryClient.cancelQueries({ queryKey: sessionsOptions.queryKey, exact: true })
          if (run.cancelled) return
          const [stats, sessions] = await Promise.all([
            queryClient.fetchQuery({ ...readingLedgerStatsOptions(bookId, recoveryRange, version, local), staleTime: 0, retry: false }),
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
  }, [bookId, failed, from, local, mismatch, queryClient, retry, scope, timezone, to])

  return { failed, retry: () => { setResult(null); setRetry((value) => value + 1) } }
}

/** Refresh coverage-derived views after a retroactive entry without moving the reader position. */
export function useAddReadingRecord(bookId: string) {
  const queryClient = useQueryClient()
  const local = useLocalReader()
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const revision = getAuthSessionRevision()
  return useMutation({
    mutationKey: ['add-reading-record', local?.namespace ?? 'remote', ...(local ? [] : [userId, revision]), bookId],
    networkMode: local ? 'always' : 'online',
    mutationFn: (body: ReadingRecordCreateReq) => {
      if (local) return local.addReadingRecord(body)
      if (getAuthSessionRevision() !== revision || (useAuthStore.getState().user?.id ?? null) !== userId) return Promise.reject(new DOMException('Reading account changed', 'AbortError'))
      return apiPost(withReveal('/reading-records'), body)
    },
    onSuccess: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: [...READING_RECORDS_KEY, local.namespace] })
        void queryClient.invalidateQueries({ queryKey: [...READING_RECORDS_KEY, 'merged'] })
        void queryClient.invalidateQueries({ queryKey: ['archive', 'merged'] })
        void queryClient.invalidateQueries({ queryKey: ['archive', 'device'] })
        void queryClient.invalidateQueries({ queryKey: ['book', local.namespace] })
        void queryClient.invalidateQueries({ queryKey: ['progress', local.namespace] })
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.ref.scope)] })
        return
      }
      if (getAuthSessionRevision() !== revision || (useAuthStore.getState().user?.id ?? null) !== userId) return
      void queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
      void queryClient.invalidateQueries({ queryKey: ['progress', bookId] })
      void queryClient.invalidateQueries({ queryKey: ['archive'] })
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
  const local = useLocalReader()
  useEffect(() => {
    if (!bookId) return
    void queryClient.prefetchQuery({
      queryKey: readingRecordBookKey('book', bookId, local?.namespace),
      networkMode: local ? 'always' : 'online',
      queryFn: () => local ? local.getReadingRecords() : apiGet<{ data: ReadingRecordBookDetailRes }>(withReveal(`/reading-records/book/${bookId}`)),
    })
    void queryClient.prefetchQuery(readingLedgerOptions(bookId, local))
  }, [bookId, local, queryClient])
}

export function useUpdateSession() {
  const queryClient = useQueryClient()
  const local = useLocalReader()
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const revision = getAuthSessionRevision()
  return useMutation({
    mutationKey: ['update-reading-session', local?.namespace ?? 'remote', ...(local ? [] : [userId, revision])],
    networkMode: local ? 'always' : 'online',
    mutationFn: ({ id, body, clientMembers }: { id: string; body: ReadingSessionUpdateReq; clientMembers?: ReadingLedgerSession['clientMembers'] }) => {
      if (local) {
        if (!clientMembers) return Promise.reject(new Error('Displayed local reading versions are required'))
        return local.updateReadingSession(id, clientMembers, body)
      }
      if (getAuthSessionRevision() !== revision || (useAuthStore.getState().user?.id ?? null) !== userId) return Promise.reject(new DOMException('Reading account changed', 'AbortError'))
      return apiPut(`/reading-records/sessions/${id}`, body)
    },
    onSuccess: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: [...READING_RECORDS_KEY, local.namespace] })
        void queryClient.invalidateQueries({ queryKey: [...READING_RECORDS_KEY, 'merged'] })
        void queryClient.invalidateQueries({ queryKey: ['archive', 'merged'] })
        void queryClient.invalidateQueries({ queryKey: ['archive', 'device'] })
        void queryClient.invalidateQueries({ queryKey: ['book', local.namespace] })
        void queryClient.invalidateQueries({ queryKey: ['progress', local.namespace] })
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.ref.scope)] })
        return
      }
      if (getAuthSessionRevision() !== revision || (useAuthStore.getState().user?.id ?? null) !== userId) return
      void queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
      void queryClient.invalidateQueries({ queryKey: ['archive'] })
      void queryClient.invalidateQueries({ queryKey: ['progress'] })
    },
  })
}

export function useDeleteSession() {
  const queryClient = useQueryClient()
  const local = useLocalReader()
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const revision = getAuthSessionRevision()
  return useMutation({
    mutationKey: ['delete-reading-session', local?.namespace ?? 'remote', ...(local ? [] : [userId, revision])],
    networkMode: local ? 'always' : 'online',
    mutationFn: (value: string | Pick<ReadingLedgerSession, 'id' | 'clientMembers'>) => {
      const id = typeof value === 'string' ? value : value.id
      if (local) {
        if (typeof value === 'string' || !value.clientMembers) return Promise.reject(new Error('Displayed local reading versions are required'))
        return local.deleteReadingSession(id, value.clientMembers)
      }
      if (getAuthSessionRevision() !== revision || (useAuthStore.getState().user?.id ?? null) !== userId) return Promise.reject(new DOMException('Reading account changed', 'AbortError'))
      return apiDelete(`/reading-records/sessions/${id}`)
    },
    onSuccess: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: [...READING_RECORDS_KEY, local.namespace] })
        void queryClient.invalidateQueries({ queryKey: [...READING_RECORDS_KEY, 'merged'] })
        void queryClient.invalidateQueries({ queryKey: ['archive', 'merged'] })
        void queryClient.invalidateQueries({ queryKey: ['archive', 'device'] })
        void queryClient.invalidateQueries({ queryKey: ['book', local.namespace] })
        void queryClient.invalidateQueries({ queryKey: ['progress', local.namespace] })
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.ref.scope)] })
        return
      }
      if (getAuthSessionRevision() !== revision || (useAuthStore.getState().user?.id ?? null) !== userId) return
      void queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
      void queryClient.invalidateQueries({ queryKey: ['archive'] })
      void queryClient.invalidateQueries({ queryKey: ['progress'] })
    },
  })
}

function readingLedgerOptions(bookId: string, local?: LocalReaderSession | null) {
  return queryOptions({
    queryKey: readingRecordBookKey('ledger', bookId, local?.namespace),
    networkMode: local ? 'always' : 'online',
    queryFn: () => local ? local.getReadingLedger() : apiGet<{ data: ReadingLedgerOverview }>(withReveal(`/reading-records/book/${bookId}/ledger`)),
    enabled: !!bookId,
  })
}

export function useReadingLedger(bookId: string, options: { enabled?: boolean } = {}) {
  return useQuery({ ...readingLedgerOptions(bookId, useLocalReader()), enabled: !!bookId && options.enabled !== false })
}

export function useReadingRound(bookId: string) {
  const queryClient = useQueryClient()
  const local = useLocalReader()
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const revision = getAuthSessionRevision()
  return useMutation({
    mutationKey: ['reading-round', local?.namespace ?? 'remote', ...(local ? [] : [userId, revision]), bookId],
    networkMode: local ? 'always' : 'online',
    mutationFn: (action: 'reread' | 'continue' | 'finish' | 'abandon') => {
      if (local) {
        if (local.bookId !== bookId) return Promise.reject(new Error('Reading book changed'))
        return local.changeReadingRound(action)
      }
      if (getAuthSessionRevision() !== revision || (useAuthStore.getState().user?.id ?? null) !== userId) return Promise.reject(new DOMException('Reading account changed', 'AbortError'))
      return apiPost(`/reading-records/book/${bookId}/round`, { action })
    },
    onSuccess: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: [...READING_RECORDS_KEY, local.namespace] })
        void queryClient.invalidateQueries({ queryKey: [...READING_RECORDS_KEY, 'merged'] })
        void queryClient.invalidateQueries({ queryKey: ['archive', 'merged'] })
        void queryClient.invalidateQueries({ queryKey: ['archive', 'device'] })
        void queryClient.invalidateQueries({ queryKey: ['book', local.namespace] })
        void queryClient.invalidateQueries({ queryKey: ['progress', local.namespace] })
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.ref.scope)] })
        return
      }
      if (getAuthSessionRevision() !== revision || (useAuthStore.getState().user?.id ?? null) !== userId) return
      void queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book', bookId] })
      void queryClient.invalidateQueries({ queryKey: ['progress', bookId] })
      void queryClient.invalidateQueries({ queryKey: ['archive'] })
    },
  })
}
