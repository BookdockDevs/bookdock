import { keepPreviousData, useMutation, useQuery, useInfiniteQuery, useQueryClient, type QueryObserverResult } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { BookDetailRes, BookFormat, BookListItem, BookMetadata, PaginatedResponse, ReadStatus, ShelfListItem, TagListItem } from '@bookdock/shared'

import { apiDelete, apiGet, apiPatch, apiPost, apiPut, apiUpload, BASE_URL } from '@/api/client'
import { useTranslation } from '@/hooks/useTranslation'
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
  readStatus: ReadStatus | null
  trash: boolean
}

function buildBooksPath({ page, pageSize, search, sortBy, sortOrder, shelfId, tagId, format, readStatus, trash }: UseBooksParams): string {
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
  if (readStatus) params.set('readStatus', readStatus)
  if (trash) params.set('trash', '1')
  return `/books?${params.toString()}`
}

export function useBooks(params: UseBooksParams): QueryObserverResult<PaginatedResponse<BookListItem>> {
  return useQuery({
    queryKey: ['books', params],
    queryFn: () => apiGet<PaginatedResponse<BookListItem>>(buildBooksPath(params)),
  })
}

export interface UseInfiniteBooksParams {
  pageSize: number
  search: string
  sortBy: string
  sortOrder: string
  shelfId: string | null
  tagId: string | null
  format: BookFormat | null
  readStatus: ReadStatus | null
  trash: boolean
}

function infiniteBooksFn(page: number, pageSize: number, search: string, sortBy: string, sortOrder: string, shelfId: string | null, tagId: string | null, format: BookFormat | null, readStatus: ReadStatus | null, trash: boolean) {
  return apiGet<PaginatedResponse<BookListItem>>(buildBooksPath({ page, pageSize, search, sortBy, sortOrder, shelfId, tagId, format, readStatus, trash }))
}

export function useInfiniteBooks(params: UseInfiniteBooksParams) {
  return useInfiniteQuery({
    queryKey: ['books', 'infinite', params],
    queryFn: ({ pageParam }) =>
      infiniteBooksFn(pageParam, params.pageSize, params.search, params.sortBy, params.sortOrder, params.shelfId, params.tagId, params.format, params.readStatus, params.trash),
    initialPageParam: 1,
    placeholderData: keepPreviousData,
    getNextPageParam: (last) => {
      const totalPages = Math.ceil(last.total / last.pageSize)
      return last.page < totalPages ? last.page + 1 : undefined
    },
  })
}

export type UploadItemStatus = 'pending' | 'queued' | 'uploading' | 'processing' | 'success' | 'duplicate' | 'error'

export interface UploadItem {
  id: string
  name: string
  file: File
  status: UploadItemStatus
  /** Upload progress 0-100; stays 100 while the server parses the book */
  progress: number
  message?: string
}

export const UPLOAD_ACCEPTED_EXTENSIONS = ['.epub', '.txt']

export function isAcceptedUploadFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return UPLOAD_ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))
}

const UPLOAD_CONCURRENCY = 3

/**
 * Multi-file upload with a small concurrency pool and per-file queue status.
 * A single invalidate + summary toast fires when the whole queue settles.
 */
export function useUploadBooks() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const _ = useTranslation()
  const [items, setItems] = useState<UploadItem[]>([])
  const runningRef = useRef(0)
  const settledRef = useRef(false)
  const nextIdRef = useRef(0)

  const patchItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }, [])

  const uploadOne = useCallback(
    (item: UploadItem) => {
      runningRef.current += 1
      patchItem(item.id, { status: 'uploading', progress: 0 })
      const xhr = new XMLHttpRequest()
      const formData = new FormData()
      formData.append('file', item.file)
      xhr.open('POST', `${BASE_URL}/books`)
      xhr.upload.addEventListener('progress', (e) => {
        if (!e.lengthComputable) return
        const pct = Math.round((e.loaded / e.total) * 100)
        // progress 100 means the bytes reached the server; the server may still
        // be parsing/converting, which the UI shows as "processing"
        patchItem(item.id, pct >= 100 ? { progress: 100, status: 'processing' } : { progress: pct })
      })
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          let duplicated = false
          try {
            const body = JSON.parse(xhr.responseText) as { duplicated?: boolean }
            duplicated = body.duplicated === true
          } catch {
            // keep false
          }
          patchItem(item.id, { status: duplicated ? 'duplicate' : 'success', progress: 100 })
        } else {
          let message = xhr.statusText
          try {
            const body = JSON.parse(xhr.responseText)
            message = body?.error?.message ?? message
          } catch {
            // ignore
          }
          patchItem(item.id, { status: 'error', progress: 100, message })
        }
      })
      xhr.addEventListener('error', () => {
        patchItem(item.id, { status: 'error', progress: 100, message: _('library.uploadFailed') })
      })
      xhr.addEventListener('abort', () => {
        patchItem(item.id, { status: 'error', progress: 100, message: 'Aborted' })
      })
      xhr.addEventListener('loadend', () => {
        runningRef.current -= 1
      })
      xhr.send(formData)
    },
    [patchItem, _],
  )

  // Scheduler: each item state change starts at most one more queued upload
  // while the concurrency pool has room; runningRef keeps the pool capped.
  useEffect(() => {
    if (runningRef.current >= UPLOAD_CONCURRENCY) return
    const next = items.find((it) => it.status === 'queued')
    if (!next) return
    uploadOne(next)
  }, [items, uploadOne])

  // Settlement: once nothing is queued/uploading/processing, invalidate once
  // and surface a summary toast.
  useEffect(() => {
    if (items.length === 0) {
      settledRef.current = false
      return
    }
    const active = items.some((it) => it.status === 'queued' || it.status === 'uploading' || it.status === 'processing')
    if (active) {
      settledRef.current = false
      return
    }
    if (settledRef.current) return
    settledRef.current = true
    const succeeded = items.filter((it) => it.status === 'success').length
    const duplicated = items.filter((it) => it.status === 'duplicate').length
    const failed = items.filter((it) => it.status === 'error').length
    queryClient.invalidateQueries({ queryKey: ['books'] })
    if (failed > 0) {
      addToast(_('library.uploadSummary', { succeeded, duplicated, failed }), 'error')
    } else {
      addToast(_('library.uploadSuccess'), 'success')
    }
  }, [items, queryClient, addToast, _])

  const addFiles = useCallback(
    (files: FileList | File[], opts?: { autoStart?: boolean }) => {
      const list = Array.from(files)
      const accepted = list.filter(isAcceptedUploadFile)
      const rejected = list.length - accepted.length
      // Drag-dropped files start immediately; picker-selected files wait for
      // an explicit "upload" click (pending -> queued via startUpload)
      const status = opts?.autoStart ? ('queued' as const) : ('pending' as const)
      setItems((prev) => [
        ...prev,
        ...accepted.map((file) => ({
          id: `up-${Date.now()}-${nextIdRef.current++}`,
          name: file.name,
          file,
          status,
          progress: 0,
        })),
      ])
      if (rejected > 0) addToast(_('library.uploadIgnored', { count: rejected }), 'info')
    },
    [addToast, _],
  )

  const startUpload = useCallback(() => {
    setItems((prev) => prev.map((it) => (it.status === 'pending' ? { ...it, status: 'queued' as const } : it)))
  }, [])

  const isUploading = items.some((it) => it.status === 'queued' || it.status === 'uploading' || it.status === 'processing')

  const clearQueue = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status === 'queued' || it.status === 'uploading' || it.status === 'processing'))
  }, [])

  return { items, addFiles, startUpload, isUploading, clearQueue }
}

export function useDeleteBook() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const _ = useTranslation()

  return useMutation({
    mutationFn: (id: string) => apiDelete<{ data: null }>(`/books/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      addToast(_('library.movedToTrash'), 'success')
    },
    onError: () => {
      addToast(_('reader.deleteFailed'), 'error')
    },
  })
}

export function useRestoreBook() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const _ = useTranslation()

  return useMutation({
    mutationFn: (id: string) => apiPost<{ data: null }>(`/books/${id}/restore`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      addToast(_('library.restored'), 'success')
    },
    onError: () => {
      addToast(_('reader.deleteFailed'), 'error')
    },
  })
}

export function usePermanentDeleteBook() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const _ = useTranslation()

  return useMutation({
    mutationFn: (id: string) => apiDelete<{ data: null }>(`/books/${id}/permanent`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      addToast(_('reader.deleted'), 'success')
    },
    onError: () => {
      addToast(_('reader.deleteFailed'), 'error')
    },
  })
}

export function useEmptyTrash() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const _ = useTranslation()

  return useMutation({
    mutationFn: () => apiDelete<{ data: { count: number } }>('/books/trash'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      addToast(_('reader.deleted'), 'success')
    },
    onError: () => {
      addToast(_('reader.deleteFailed'), 'error')
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
  const _ = useTranslation()

  return useMutation({
    mutationFn: (name: string) => apiPost<{ data: ShelfListItem }>('/shelves', { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      addToast(_('toast.shelfCreated'), 'success')
    },
    onError: () => {
      addToast(_('toast.createShelfFailed'), 'error')
    },
  })
}

export function useRenameShelf() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const _ = useTranslation()

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => apiPut<{ data: ShelfListItem }>(`/shelves/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      addToast(_('toast.shelfRenamed'), 'success')
    },
    onError: () => {
      addToast(_('toast.renameShelfFailed'), 'error')
    },
  })
}

export function useDeleteShelf() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const _ = useTranslation()

  return useMutation({
    mutationFn: (id: string) => apiDelete<{ data: null }>(`/shelves/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      addToast(_('toast.shelfDeleted'), 'success')
    },
    onError: () => {
      addToast(_('toast.deleteShelfFailed'), 'error')
    },
  })
}

export function useUpdateBook() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const _ = useTranslation()

  return useMutation({
    mutationFn: ({ bookId, ...data }: { bookId: string } & Partial<{ readStatus: string; progress: number; pinned: boolean; title: string; author: string; bookmeta: BookMetadata }>) =>
      apiPatch<{ data: BookListItem }>(`/books/${bookId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      addToast(_('toast.bookUpdated'), 'success')
    },
    onError: () => {
      addToast(_('toast.updateBookFailed'), 'error')
    },
  })
}

export function useBook(bookId: string | null) {
  return useQuery({
    queryKey: ['books', 'detail', bookId],
    queryFn: () => apiGet<{ data: BookDetailRes }>(`/books/${bookId}`),
    enabled: Boolean(bookId),
  })
}

export function useUploadCover() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const _ = useTranslation()

  return useMutation({
    mutationFn: ({ bookId, file }: { bookId: string; file: File }) =>
      apiUpload<{ data: BookListItem }>(`/books/${bookId}/cover`, file, 'PUT'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      addToast(_('toast.bookUpdated'), 'success')
    },
    onError: () => {
      addToast(_('toast.updateBookFailed'), 'error')
    },
  })
}

export function useRemoveCover() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const _ = useTranslation()

  return useMutation({
    mutationFn: (bookId: string) => apiDelete<{ data: BookListItem }>(`/books/${bookId}/cover`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      addToast(_('toast.bookUpdated'), 'success')
    },
    onError: () => {
      addToast(_('toast.updateBookFailed'), 'error')
    },
  })
}

export function useResetMetadata() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const _ = useTranslation()

  return useMutation({
    mutationFn: (bookId: string) => apiPost<{ data: BookListItem }>(`/books/${bookId}/reset-metadata`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      addToast(_('toast.metadataReset'), 'success')
    },
    onError: () => {
      addToast(_('toast.updateBookFailed'), 'error')
    },
  })
}

export function useCreateTag() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const _ = useTranslation()

  return useMutation({
    mutationFn: (name: string) => apiPost<{ data: TagListItem }>('/tags', { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      addToast(_('toast.tagCreated'), 'success')
    },
    onError: () => {
      addToast(_('toast.createTagFailed'), 'error')
    },
  })
}

export function useUpdateBookMembership() {
  const queryClient = useQueryClient()
  const addToast = useToastStore((s) => s.addToast)
  const _ = useTranslation()

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
      addToast(_('toast.membershipUpdated'), 'success')
    },
    onError: () => {
      addToast(_('toast.updateMembershipFailed'), 'error')
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