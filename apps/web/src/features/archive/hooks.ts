import { useMemo } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import type { ClientArchiveBookView, ClientArchiveBookDetailView, ArchiveBooksQuery, ArchiveBookItem, ArchiveOverview, ArchivePage, ReadingRange } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { useLocalReader } from '@/features/reading-data/reader-source-context'
import { useVaultCapable } from '@/features/reading-data/vault-availability'
import { deviceCatalogOperations } from '@/features/local-library/catalog'
import { useAuthStore } from '@/stores/auth.store'
import { archiveRangeParams } from './archive-scope'
import { mergeArchiveOverviews, mergeArchivePage } from './archive-merge'

/**
 * `device` — a vault but no session: device rows only.
 * `merged` — a vault and a session: device rows and server rows together.
 * `server` — no vault available, so only the server half exists.
 *
 * Which half a *row* belongs to is a property of the row, so this describes the
 * session, not the route: there is one archive.
 */
type ArchiveMode = 'device' | 'merged' | 'server'

function useArchiveMode() {
  const vaultCapable = useVaultCapable()
  const user = useAuthStore((state) => state.user)
  const device = useMemo(() => (vaultCapable ? deviceCatalogOperations() : null), [vaultCapable])
  // Without a session the server half is unreachable by policy, so it is not
  // probed at all: an anonymous visitor's archive stays device-only.
  const mode: ArchiveMode = !device ? 'server' : user ? 'merged' : 'device'
  return { mode, device }
}

async function remoteOverview(range: ReadingRange | undefined, params: string) {
  return (await apiGet<{ data: ArchiveOverview }>(`/archive/overview${params ? `?${params}` : ''}`)).data
}

function useOverviewQuery(kind: 'overview' | 'previous-overview', range: ReadingRange | undefined, enabled: boolean) {
  const { mode, device } = useArchiveMode()
  const bounded = range?.from || range?.to ? range : undefined
  const params = archiveRangeParams(bounded).toString()
  return useQuery({
    queryKey: ['archive', mode, kind, params],
    networkMode: mode === 'server' ? 'online' : 'always',
    queryFn: async () => {
      if (mode === 'server') return { data: await remoteOverview(range, params) }
      // The device half never fails, so a failed server call degrades to device
      // rows instead of blanking the archive.
      const deviceOverview = await device!.getArchiveOverview(range)
      if (mode === 'device') return { data: deviceOverview }
      // An empty device half means this archive is the server's: ask it alone so
      // the numbers, and its failures, behave exactly as they did before the
      // vault existed.
      if (deviceOverview.totalBooks === 0 && deviceOverview.counts.total === 0) {
        return { data: await remoteOverview(range, params) }
      }
      try {
        return { data: mergeArchiveOverviews(await remoteOverview(range, params), deviceOverview) }
      } catch {
        return { data: deviceOverview }
      }
    },
    enabled,
    staleTime: 30_000,
  })
}

export function useArchiveOverview(range?: ReadingRange, enabled = true) {
  return useOverviewQuery('overview', range, enabled)
}

export function usePreviousArchiveOverview(range?: ReadingRange, enabled = true) {
  return useOverviewQuery('previous-overview', range, Boolean(enabled && (range?.from || range?.to)))
}

export function useArchiveBookDetail(bookVersionId: string | null, enabled = true, range?: ReadingRange) {
  const local = useLocalReader()
  const params = archiveRangeParams(range).toString()
  return useQuery({
    queryKey: ['archive', ...(local ? [local.namespace] : []), 'book', bookVersionId, params],
    networkMode: local ? 'always' : 'online',
    queryFn: () => local ? local.getArchiveNotes(range) : apiGet<{ data: ClientArchiveBookDetailView }>(`/archive/books/${encodeURIComponent(bookVersionId!)}${params ? `?${params}` : ''}`),
    enabled: Boolean(bookVersionId) && enabled,
    staleTime: 30_000,
  })
}

/**
 * Which half a selected archive row lives in. The archive dispatches per book
 * instead of per route, so it has to ask the vault before opening the reader.
 */
export function useLocalArchiveBook(bookId: string | null) {
  const { device } = useArchiveMode()
  return useQuery({
    queryKey: ['archive', 'device-book', bookId],
    networkMode: 'always',
    queryFn: () => device!.hasBook(bookId!),
    enabled: Boolean(bookId) && Boolean(device),
    staleTime: 30_000,
  })
}

export function useArchiveBooksInfinite(query: {
  search?: string
  type?: ArchiveBooksQuery['type']
  sort: ArchiveBooksQuery['sort']
  readStatus?: ArchiveBooksQuery['readStatus']
  tag?: string
  pageSize?: number
  range?: ReadingRange
}) {
  const { mode, device } = useArchiveMode()
  const pageSize = query.pageSize ?? 20
  const rangeParams = archiveRangeParams(query.range).toString()
  const pageQuery = (page: number) => {
    const params = archiveRangeParams(query.range)
    if (query.search?.trim()) params.set('search', query.search.trim())
    if (query.type) params.set('type', query.type)
    if (query.readStatus) params.set('readStatus', query.readStatus)
    if (query.tag?.trim()) params.set('tag', query.tag.trim())
    params.set('sort', query.sort)
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    return params.toString()
  }
  const remotePage = async (page: number) => {
    const result = await apiGet<{ data: ArchivePage<ArchiveBookItem> }>(`/archive/books?${pageQuery(page)}`)
    return {
      entries: result.data.entries.map(({ bookVersionId, ...book }): ClientArchiveBookView => ({ ...book, id: bookVersionId })),
      hasMore: result.data.hasMore,
    }
  }
  return useInfiniteQuery({
    queryKey: ['archive', mode, 'books-infinite', query.search?.trim(), query.type, query.sort, query.readStatus, query.tag?.trim(), pageSize, rangeParams],
    networkMode: mode === 'server' ? 'online' : 'always',
    queryFn: async ({ pageParam = 1 }): Promise<{ data: ArchivePage<ClientArchiveBookView> }> => {
      if (mode === 'server') {
        const { entries, hasMore } = await remotePage(pageParam)
        return { data: { entries, page: pageParam, hasMore } }
      }
      const deviceEntries = await device!.getArchiveBookEntries({ ...query.range, search: query.search, type: query.type, sort: query.sort, readStatus: query.readStatus, tag: query.tag, page: 1, pageSize: 50 })
      if (mode === 'device') return { data: mergeArchivePage([], deviceEntries, { sort: query.sort, type: query.type, page: pageParam, pageSize }) }
      // Nothing on this device matches the current filter, so the page is the
      // server's own page - same order, same `hasMore`, one request.
      if (deviceEntries.length === 0) {
        const { entries, hasMore } = await remotePage(pageParam)
        return { data: { entries, page: pageParam, hasMore } }
      }
      // Merged V1: order the device rows against server pages 1..n, then slice.
      // Same trade-off as the unified shelf — revisiting page n re-reads the
      // server pages before it; revisit when a personal archive outgrows this.
      try {
        const pages = await Promise.all(Array.from({ length: pageParam }, (_, index) => remotePage(index + 1)))
        const remoteEntries = pages.flatMap((page) => page.entries)
        const merged = mergeArchivePage(remoteEntries, deviceEntries, { sort: query.sort, type: query.type, page: pageParam, pageSize })
        return { data: { ...merged, hasMore: merged.hasMore || pages[pages.length - 1]!.hasMore } }
      } catch {
        return { data: mergeArchivePage([], deviceEntries, { sort: query.sort, type: query.type, page: pageParam, pageSize }) }
      }
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (!lastPage.data.hasMore) return undefined
      return lastPage.data.page + 1
    },
    staleTime: 30_000,
  })
}
