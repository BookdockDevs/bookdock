import { useMutation, useQuery, useInfiniteQuery, useQueryClient, type QueryClient, type QueryObserverResult } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { AppendContentPreviewRes, BookDetailRes, BookFormat, BookListItem, BookMetadata, PaginatedResponse, ReadStatus, ShelfListItem, TagListItem } from '@bookdock/shared'

import { apiDelete, apiGet, apiPatch, apiPost, apiPut, apiUpload, BASE_URL } from '@/api/client'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

export interface UseBooksParams {
  page: number
  pageSize: number
  search: string
  sortBy: string
  sortOrder: string
  shelfId: string | null
  tagId: string | null
  author?: string | null
  series?: string | null
  format: BookFormat | null
  readStatus: ReadStatus | null
  trash: boolean
}

function buildBooksPath({ page, pageSize, search, sortBy, sortOrder, shelfId, tagId, author, series, format, readStatus, trash }: UseBooksParams): string {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    sortBy,
    sortOrder,
  })
  if (search) params.set('search', search)
  if (shelfId) params.set('shelfId', shelfId)
  if (tagId) params.set('tagId', tagId)
  if (author) params.set('author', author)
  if (series) params.set('series', series)
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
  author?: string | null
  series?: string | null
  format: BookFormat | null
  readStatus: ReadStatus | null
  trash: boolean
}

function infiniteBooksFn(page: number, pageSize: number, search: string, sortBy: string, sortOrder: string, shelfId: string | null, tagId: string | null, author: string | null | undefined, series: string | null | undefined, format: BookFormat | null, readStatus: ReadStatus | null, trash: boolean) {
  return apiGet<PaginatedResponse<BookListItem>>(buildBooksPath({ page, pageSize, search, sortBy, sortOrder, shelfId, tagId, author, series, format, readStatus, trash }))
}

export function useInfiniteBooks(params: UseInfiniteBooksParams) {
  return useInfiniteQuery({
    queryKey: ['books', 'infinite', params],
    queryFn: ({ pageParam }) =>
      infiniteBooksFn(pageParam, params.pageSize, params.search, params.sortBy, params.sortOrder, params.shelfId, params.tagId, params.author, params.series, params.format, params.readStatus, params.trash),
    initialPageParam: 1,
    placeholderData: (previousData, previousQuery) => {
      const prevParams = previousQuery?.queryKey[2] as UseInfiniteBooksParams | undefined
      // Never retain regular books when switching into Trash, or vice versa
      if (prevParams && prevParams.trash !== params.trash) {
        return undefined
      }
      return previousData
    },
    getNextPageParam: (last) => {
      const totalPages = Math.ceil(last.total / last.pageSize)
      return last.page < totalPages ? last.page + 1 : undefined
    },
  })
}

export function prefetchInfiniteBooks(queryClient: QueryClient, params: UseInfiniteBooksParams) {
  return queryClient.prefetchInfiniteQuery({
    queryKey: ['books', 'infinite', params],
    queryFn: ({ pageParam }) =>
      infiniteBooksFn(pageParam as number, params.pageSize, params.search, params.sortBy, params.sortOrder, params.shelfId, params.tagId, params.author, params.series, params.format, params.readStatus, params.trash),
    initialPageParam: 1,
    getNextPageParam: (last: PaginatedResponse<BookListItem>) => {
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
  shelfId?: string
  tagIds?: string[]
  message?: string
}

export interface UploadAssignment {
  shelfId?: string
  tagIds?: string[]
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
      if (item.shelfId) formData.append('shelfId', item.shelfId)
      if (item.tagIds?.length) formData.append('tagIds', JSON.stringify(item.tagIds))
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

  // Settlement: once nothing is pending, queued, uploading, or processing,
  // invalidate once and surface a summary toast.
  useEffect(() => {
    if (items.length === 0) {
      settledRef.current = false
      return
    }
    const active = items.some((it) => it.status === 'pending' || it.status === 'queued' || it.status === 'uploading' || it.status === 'processing')
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
    // Shelf rows carry their own aggregated bookCount, so refreshing book
    // lists alone leaves the sidebar count stale after an upload.
    queryClient.invalidateQueries({ queryKey: ['shelves'] })
    if (failed > 0) {
      notify.error({ key: 'library.uploadSummary', params: { succeeded, duplicated, failed } })
    } else {
      notify.success({ key: 'library.uploadSuccess' })
    }
  }, [items, queryClient])

  const addFiles = useCallback(
    (files: FileList | File[], opts?: { autoStart?: boolean } & UploadAssignment) => {
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
          shelfId: opts?.shelfId,
          tagIds: opts?.tagIds,
        })),
      ])
      if (rejected > 0) notify.info({ key: 'library.uploadIgnored', params: { count: rejected } })
    },
    [],
  )

  const startUpload = useCallback((assignment?: UploadAssignment) => {
    setItems((prev) => prev.map((it) => {
      if (it.status !== 'pending') return it
      if (!assignment) return { ...it, status: 'queued' as const }
      return {
        ...it,
        status: 'queued' as const,
        shelfId: assignment.shelfId,
        tagIds: assignment.tagIds,
      }
    }))
  }, [])

  const isUploading = items.some((it) => it.status === 'queued' || it.status === 'uploading' || it.status === 'processing')

  const clearQueue = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status === 'queued' || it.status === 'uploading' || it.status === 'processing'))
  }, [])

  return { items, addFiles, startUpload, isUploading, clearQueue }
}

export function useDeleteBook() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiDelete<{ data: null }>(`/books/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      notify.success({ key: 'library.movedToTrash' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'errors.deleteFailed'))
    },
  })
}

export function useRestoreBook() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiPost<{ data: null }>(`/books/${id}/restore`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      notify.success({ key: 'library.restored' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'errors.restoreFailed'))
    },
  })
}

export function usePermanentDeleteBook() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiDelete<{ data: null }>(`/books/${id}/permanent`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      notify.success({ key: 'reader.deleted' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'errors.permanentDeleteFailed'))
    },
  })
}

export function useEmptyTrash() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => apiDelete<{ data: { count: number } }>('/books/trash'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      notify.success({ key: 'reader.deleted' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'errors.permanentDeleteFailed'))
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

  return useMutation({
    mutationFn: (name: string) => apiPost<{ data: ShelfListItem }>('/shelves', { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      notify.success({ key: 'toast.shelfCreated' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'errors.createFailed'))
    },
  })
}

export function useRenameShelf() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => apiPut<{ data: ShelfListItem }>(`/shelves/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      notify.success({ key: 'toast.shelfRenamed' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'errors.renameFailed'))
    },
  })
}

export function useDeleteShelf() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiDelete<{ data: null }>(`/shelves/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      notify.success({ key: 'toast.shelfDeleted' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'errors.deleteFailed'))
    },
  })
}

export function useReorderShelves() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (shelfIds: string[]) => apiPut<{ data: null }>('/shelves/order', { shelfIds }),
    onMutate: (shelfIds) => {
      const prev = queryClient.getQueryData<{ data: ShelfListItem[] }>(['shelves'])
      if (prev) {
        const byId = new Map(prev.data.map((s) => [s.id, s]))
        const next = shelfIds
          .map((id) => byId.get(id))
          .filter((s): s is ShelfListItem => Boolean(s))
        queryClient.setQueryData(['shelves'], { data: next })
      }
      return { prev }
    },
    onError: (error, _shelfIds, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['shelves'], ctx.prev)
      notify.error(getUserErrorNotification(error, 'errors.reorderFailed'))
    },
  })
}

export function useReorderTags() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (tagIds: string[]) => apiPut<{ data: null }>('/tags/order', { tagIds }),
    onMutate: (tagIds) => {
      const prev = queryClient.getQueryData<{ data: TagListItem[] }>(['tags'])
      if (prev) {
        const byId = new Map(prev.data.map((tag) => [tag.id, tag]))
        const next = tagIds
          .map((id) => byId.get(id))
          .filter((tag): tag is TagListItem => Boolean(tag))
        queryClient.setQueryData(['tags'], { data: next })
      }
      return { prev }
    },
    onError: (error, _tagIds, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['tags'], ctx.prev)
      notify.error(getUserErrorNotification(error, 'errors.reorderFailed'))
    },
  })
}

export function useUpdateBook() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ bookId, ...data }: { bookId: string } & Partial<{ readStatus: string; progress: number; pinned: boolean; title: string; author: string; bookmeta: BookMetadata }>) =>
      apiPatch<{ data: BookListItem }>(`/books/${bookId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      notify.success({ key: 'toast.bookUpdated' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'errors.updateFailed'))
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

export interface AppendContentInput {
  bookId: string
  file?: File
  text?: string
  startOffset?: number
}

function appendContentRequest<T>(path: string, { bookId, file, text, startOffset }: AppendContentInput): Promise<T> {
  if (file) {
    const formData = new FormData()
    formData.append('file', file)
    if (startOffset !== undefined) formData.append('startOffset', String(startOffset))
    return apiUpload<T>(`/books/${bookId}/${path}`, formData)
  }
  return apiPost<T>(`/books/${bookId}/${path}`, {
    text: text ?? '',
    ...(startOffset !== undefined ? { startOffset } : {}),
  })
}

export function useAppendBookContentPreview() {
  return useMutation({
    mutationFn: (input: AppendContentInput) => appendContentRequest<{ data: AppendContentPreviewRes }>('append-preview', input),
  })
}

export function useAppendBookContent() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: AppendContentInput) => appendContentRequest<{ data: BookDetailRes }>('append', input),
    onSuccess: (result, input) => {
      queryClient.setQueryData(['book', input.bookId], result)
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['books', 'detail', input.bookId] })
      queryClient.invalidateQueries({ queryKey: ['book', input.bookId] })
      queryClient.invalidateQueries({ queryKey: ['chapters', input.bookId] })
      queryClient.invalidateQueries({ queryKey: ['progress', input.bookId] })
    },
  })
}

export function useUploadCover() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ bookId, file }: { bookId: string; file: File }) =>
      apiUpload<{ data: BookListItem }>(`/books/${bookId}/cover`, file, 'PUT'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      notify.success({ key: 'toast.bookUpdated' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'errors.updateFailed'))
    },
  })
}

export function useRemoveCover() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (bookId: string) => apiDelete<{ data: BookListItem }>(`/books/${bookId}/cover`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      notify.success({ key: 'toast.bookUpdated' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'errors.updateFailed'))
    },
  })
}

export function useResetMetadata() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (bookId: string) => apiPost<{ data: BookListItem }>(`/books/${bookId}/reset-metadata`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      notify.success({ key: 'toast.metadataReset' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'errors.resetFailed'))
    },
  })
}

export function useCreateTag() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (name: string) => apiPost<{ data: TagListItem }>('/tags', { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      notify.success({ key: 'toast.tagCreated' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'errors.createFailed'))
    },
  })
}

export function useRenameTag() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => apiPut<{ data: TagListItem }>(`/tags/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      notify.success({ key: 'toast.tagRenamed' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'errors.renameFailed'))
    },
  })
}

export function useDeleteTag() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiDelete<{ data: null }>(`/tags/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      queryClient.invalidateQueries({ queryKey: ['books'] })
      notify.success({ key: 'toast.tagDeleted' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'errors.deleteFailed'))
    },
  })
}

export function useUpdateBookMembership() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ bookId, shelfId, tagIds }: { bookId: string; shelfId?: string | null; tagIds?: string[] }) => {
      await Promise.all([
        shelfId !== undefined ? apiPut<{ data: null }>(`/books/${bookId}/shelves`, { shelfId }) : Promise.resolve(),
        apiPut<{ data: null }>(`/books/${bookId}/tags`, { tagIds: tagIds ?? [] }),
      ])
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      notify.success({ key: 'toast.membershipUpdated' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'errors.membershipUpdateFailed'))
    },
  })
}

export function useBookMembership(bookId: string | null) {
  return {
    shelves: useQuery({
      queryKey: ['books', bookId, 'shelves'],
      queryFn: () => apiGet<{ data: string | null }>(`/books/${bookId}/shelves`),
      enabled: Boolean(bookId),
    }),
    tags: useQuery({
      queryKey: ['books', bookId, 'tags'],
      queryFn: () => apiGet<{ data: string[] }>(`/books/${bookId}/tags`),
      enabled: Boolean(bookId),
    }),
  }
}

export function useMoveBooksToShelf() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ bookIds, shelfId }: { bookIds: string[]; shelfId: string | null }) =>
      Promise.allSettled(
        bookIds.map((bookId) => apiPut<{ data: null }>(`/books/${bookId}/shelves`, { shelfId })),
      ),
    onSuccess: (results, variables) => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      const failed = results.filter((r) => r.status === 'rejected').length
      if (failed > 0) {
        notify.error({ key: 'errors.membershipUpdateFailed' })
        return
      }
      const shelves = queryClient.getQueryData<{ data: ShelfListItem[] }>(['shelves'])
      const name = shelves?.data.find((s) => s.id === variables.shelfId)?.name
      notify.success(name
        ? { key: 'toast.movedToShelf', params: { name } }
        : { key: 'toast.movedOutOfShelf' })
    },
  })
}
