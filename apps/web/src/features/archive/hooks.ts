import { useInfiniteQuery, useQuery } from '@tanstack/react-query'

import type { ArchiveBookDetail, ArchiveBooksQuery, ArchiveBookItem, ArchiveOverview, ArchivePage } from '@bookdock/shared'

import { apiGet } from '@/api/client'

export function useArchiveOverview(enabled = true) {
  return useQuery({
    queryKey: ['archive', 'overview'],
    queryFn: () => apiGet<{ data: ArchiveOverview }>('/archive/overview'),
    enabled,
    staleTime: 30_000,
  })
}

export function useArchiveBooks(query: ArchiveBooksQuery) {
  const params = new URLSearchParams()
  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.type) params.set('type', query.type)
  params.set('sort', query.sort)
  params.set('page', String(query.page))
  params.set('pageSize', String(query.pageSize))
  const key = params.toString()
  return useQuery({
    queryKey: ['archive', 'books', key],
    queryFn: () => apiGet<{ data: ArchivePage<ArchiveBookItem> }>(`/archive/books?${key}`),
    staleTime: 30_000,
  })
}

export function useArchiveBookDetail(bookVersionId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['archive', 'book', bookVersionId],
    queryFn: () => apiGet<{ data: ArchiveBookDetail }>(`/archive/books/${encodeURIComponent(bookVersionId!)}`),
    enabled: Boolean(bookVersionId) && enabled,
    staleTime: 30_000,
  })
}

export function useArchiveBooksInfinite(query: { search?: string; type?: ArchiveBooksQuery['type']; sort: ArchiveBooksQuery['sort']; pageSize?: number }) {
  const pageSize = query.pageSize ?? 20
  return useInfiniteQuery({
    queryKey: ['archive', 'books-infinite', query.search?.trim(), query.type, query.sort, pageSize],
    queryFn: ({ pageParam = 1 }) => {
      const params = new URLSearchParams()
      if (query.search?.trim()) params.set('search', query.search.trim())
      if (query.type) params.set('type', query.type)
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
