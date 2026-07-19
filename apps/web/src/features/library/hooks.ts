import { useMutation, useQuery, useQueryClient, type QueryObserverResult } from '@tanstack/react-query'
import { useState } from 'react'

import type { BookFormat, BookListItem, PaginatedResponse, ShelfListItem, TagListItem } from '@bookdock/shared'

import { apiDelete, apiGet, apiPost, apiPut, BASE_URL } from '@/api/client'
import { t } from '@/i18n'
import { useToastStore } from '@/stores/toast.store'

export interface UseBooksParams {
  page: number
  pageSize: number
  search: string
  sortBy: string
  sortOrder: string
  shelfId: string | null
  tagId: string | null
  format: BookFormat | null
  trash: boolean
}

function buildBooksPath({ page, pageSize, search, sortBy, sortOrder, shelfId, tagId, format, trash }: UseBooksParams): string {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    sortBy,
    sortOrder,
  })
  if (search) params.set('search', search)
  if (shelfId) params.set('shelfId', shelfId)
  if (tagId) params.set('tagId', tagId)
  if (format) params.set('format', format)
  if (trash) params.set('trash', '1')
  return `/books?${params.toString()}`
}

export function useBooks(params: UseBooksParams): QueryObserverResult<PaginatedResponse<BookListItem>> {
  return useQuery({
    queryKey: ['books', params],
    queryFn: () => apiGet<PaginatedResponse<BookListItem>>(buildBooksPath(params)),
  })
}

export function useUploadBook() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const [progress, setProgress] = useState(0)

  const mutation = useMutation({
    mutationFn: (file: File) =>
      new Promise<{ data: BookListItem }>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        const formData = new FormData()
        formData.append('file', file)
        const token = typeof window !== 'undefined' ? localStorage.getItem('bd-token') : null
        xhr.open('POST', `${BASE_URL}/books`)
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100))
          }
        })
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText) as { data: BookListItem })
            } catch {
              reject(new Error('Invalid response'))
            }
          } else {
            let message = xhr.statusText
            try {
              const body = JSON.parse(xhr.responseText)
              message = body?.error?.message ?? message
            } catch {
              // ignore
            }
            reject(new Error(message))
          }
        })
        xhr.addEventListener('error', () => reject(new Error('Upload failed')))
        xhr.addEventListener('abort', () => reject(new Error('Upload aborted')))
        xhr.send(formData)
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      addToast(t().library.uploadSuccess, 'success')
      setProgress(0)
    },
    onError: () => {
      addToast(t().library.uploadFailed, 'error')
      setProgress(0)
    },
  })

  return { ...mutation, progress }
}

export function useDeleteBook() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (id: string) => apiDelete<{ data: null }>(`/books/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      addToast(t().library.movedToTrash, 'success')
    },
    onError: () => {
      addToast(t().reader.deleteFailed, 'error')
    },
  })
}

export function useRestoreBook() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (id: string) => apiPost<{ data: null }>(`/books/${id}/restore`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      addToast(t().library.restored, 'success')
    },
    onError: () => {
      addToast(t().reader.deleteFailed, 'error')
    },
  })
}

export function usePermanentDeleteBook() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (id: string) => apiDelete<{ data: null }>(`/books/${id}/permanent`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      addToast(t().reader.deleted, 'success')
    },
    onError: () => {
      addToast(t().reader.deleteFailed, 'error')
    },
  })
}

export function useEmptyTrash() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: () => apiDelete<{ data: { count: number } }>('/books/trash'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      addToast(t().reader.deleted, 'success')
    },
    onError: () => {
      addToast(t().reader.deleteFailed, 'error')
    },
  })
}

export function useShelves(): QueryObserverResult<{ data: ShelfListItem[] }> {
  return useQuery({
    queryKey: ['shelves'],
    queryFn: () => apiGet<{ data: ShelfListItem[] }>('/shelves'),
  })
}

export function useTags(): QueryObserverResult<{ data: TagListItem[] }> {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => apiGet<{ data: TagListItem[] }>('/tags'),
  })
}

export function useCreateShelf() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (name: string) => apiPost<{ data: ShelfListItem }>('/shelves', { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      addToast('书架已创建', 'success')
    },
    onError: () => {
      addToast('创建书架失败', 'error')
    },
  })
}

export function useRenameShelf() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => apiPut<{ data: ShelfListItem }>(`/shelves/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      queryClient.invalidateQueries({ queryKey: ['books'] })
      addToast('书架已重命名', 'success')
    },
    onError: () => {
      addToast('重命名书架失败', 'error')
    },
  })
}

export function useDeleteShelf() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (id: string) => apiDelete<{ data: null }>(`/shelves/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      queryClient.invalidateQueries({ queryKey: ['books'] })
      addToast('书架已删除', 'success')
    },
    onError: () => {
      addToast('删除书架失败', 'error')
    },
  })
}

export function useCreateTag() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: (name: string) => apiPost<{ data: TagListItem }>('/tags', { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      addToast('标签已创建', 'success')
    },
    onError: () => {
      addToast('创建标签失败', 'error')
    },
  })
}

export function useUpdateBookMembership() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)

  return useMutation({
    mutationFn: async ({ bookId, shelfIds, tagIds }: { bookId: string; shelfIds?: string[]; tagIds?: string[] }) => {
      await Promise.all([
        apiPut<{ data: null }>(`/books/${bookId}/shelves`, { shelfIds: shelfIds ?? [] }),
        apiPut<{ data: null }>(`/books/${bookId}/tags`, { tagIds: tagIds ?? [] }),
      ])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      addToast('归类已更新', 'success')
    },
    onError: () => {
      addToast('更新归类失败', 'error')
    },
  })
}

export function useBookMembership(bookId: string | null) {
  return {
    shelves: useQuery({
      queryKey: ['books', bookId, 'shelves'],
      queryFn: () => apiGet<{ data: string[] }>(`/books/${bookId}/shelves`),
      enabled: Boolean(bookId),
    }),
    tags: useQuery({
      queryKey: ['books', bookId, 'tags'],
      queryFn: () => apiGet<{ data: string[] }>(`/books/${bookId}/tags`),
      enabled: Boolean(bookId),
    }),
  }
}