import { useQuery } from '@tanstack/react-query'

import type { ArchiveBookDetail, ArchiveBooksQuery, ArchiveBookItem, ArchiveOverview, ArchivePage } from '@bookdock/shared'

import { apiGet } from '@/api/client'

export function useArchiveOverview(enabled = true) {
  return useQuery({
    queryKey: ['archive', 'overview'],
    queryFn: () => apiGet<{ data: ArchiveOverview }>('/archive/overview'),
    enabled,
    staleTime: 0,
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
    staleTime: 0,
  })
}

export function useArchiveBookDetail(bookVersionId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['archive', 'book', bookVersionId],
    queryFn: () => apiGet<{ data: ArchiveBookDetail }>(`/archive/books/${encodeURIComponent(bookVersionId!)}`),
    enabled: Boolean(bookVersionId) && enabled,
    staleTime: 0,
  })
}
