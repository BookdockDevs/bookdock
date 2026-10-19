import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import type { ArchiveBookDetail, ArchiveBooksQuery, ArchiveBookItem, ArchiveOverview, ArchivePage, ReadingRange } from '@bookdock/shared'

import { apiGet } from '@/api/client'
import { archiveRangeParams } from './archive-scope'

export function useArchiveOverview(range?: ReadingRange, enabled = true) {
  const bounded = range?.from || range?.to ? range : undefined
  const params = archiveRangeParams(bounded).toString()
  return useQuery({
    queryKey: ['archive', 'overview', params],
    queryFn: () => apiGet<{ data: ArchiveOverview }>(`/archive/overview${params ? `?${params}` : ''}`),
    enabled,
    staleTime: 30_000,
  })
}

export function usePreviousArchiveOverview(range?: ReadingRange, enabled = true) {
  const bounded = range?.from || range?.to ? range : undefined
  const params = archiveRangeParams(bounded).toString()
  return useQuery({
    queryKey: ['archive', 'previous-overview', params],
    queryFn: () => apiGet<{ data: ArchiveOverview }>(`/archive/overview${params ? `?${params}` : ''}`),
    enabled: Boolean(enabled && (range?.from || range?.to)),
    staleTime: 30_000,
  })
}

export function useArchiveBookDetail(bookVersionId: string | null, enabled = true, range?: ReadingRange) {
  const params = archiveRangeParams(range).toString()
  return useQuery({
    queryKey: ['archive', 'book', bookVersionId, params],
    queryFn: () => apiGet<{ data: ArchiveBookDetail }>(`/archive/books/${encodeURIComponent(bookVersionId!)}${params ? `?${params}` : ''}`),
    enabled: Boolean(bookVersionId) && enabled,
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
  const pageSize = query.pageSize ?? 20
  const rangeParams = archiveRangeParams(query.range).toString()
  return useInfiniteQuery({
    queryKey: ['archive', 'books-infinite', query.search?.trim(), query.type, query.sort, query.readStatus, query.tag?.trim(), pageSize, rangeParams],
    queryFn: ({ pageParam = 1 }) => {
      const params = archiveRangeParams(query.range)
      if (query.search?.trim()) params.set('search', query.search.trim())
      if (query.type) params.set('type', query.type)
      if (query.readStatus) params.set('readStatus', query.readStatus)
      if (query.tag?.trim()) params.set('tag', query.tag.trim())
      params.set('sort', query.sort)
      params.set('page', String(pageParam))
      params.set('pageSize', String(pageSize))
      const key = params.toString()
      return apiGet<{ data: ArchivePage<ArchiveBookItem> }>(`/archive/books?${key}`)
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (!lastPage.data.hasMore) return undefined
      return lastPage.data.page + 1
    },
    staleTime: 30_000,
  })
}
