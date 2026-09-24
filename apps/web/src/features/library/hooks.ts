import { useMutation, useQuery, useInfiniteQuery, useQueryClient, type QueryClient, type QueryObserverResult } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { AppendContentPreviewRes, BookDetailRes, BookFormat, BookListItem, BookListRes, BookMetadata, ReadStatus, SettingsRes, ShelfListItem, TagListItem } from '@bookdock/shared'

import { apiDelete, apiGet, apiPatch, apiPost, apiPut, apiUpload, BASE_URL } from '@/api/client'
import i18n from '@/i18n/i18n'
import { getErrorKeyByCode, getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { fetchSettings, writeStoredSettings } from '@/lib/settings-cache'

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

export function useBooks(params: UseBooksParams, options?: { enabled?: boolean }): QueryObserverResult<BookListRes> {
  return useQuery({
    queryKey: ['books', params],
    queryFn: () => apiGet<BookListRes>(buildBooksPath(params)),
    enabled: options?.enabled ?? true,
  })
}

export function prefetchBooks(queryClient: QueryClient, params: UseBooksParams) {
  return queryClient.prefetchQuery({
    queryKey: ['books', params],
    queryFn: () => apiGet<BookListRes>(buildBooksPath(params)),
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
  return apiGet<BookListRes>(buildBooksPath({ page, pageSize, search, sortBy, sortOrder, shelfId, tagId, author, series, format, readStatus, trash }))
}

export function useInfiniteBooks(params: UseInfiniteBooksParams, options?: { enabled?: boolean }) {
  return useInfiniteQuery({
    queryKey: ['books', 'infinite', params],
    enabled: options?.enabled ?? true,
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
    getNextPageParam: (last: BookListRes) => {
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
  /** i18n key resolved client-side; raw server messages are never displayed */
  messageKey?: string
}

export interface UploadAssignment {
  shelfId?: string
  tagIds?: string[]
}

/** Instance-level upload limit (read-only, injected by GET /settings). */
export function useUploadSettings() {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  })
  return { maxBytes: data?.data.uploadMaxBytes }
}

/** Trash feature switch; respects user settings, cached settings, and stays disabled while loading without cache. */
export function useTrashEnabled(options: { enabled?: boolean } = {}): boolean {
  const isEnabled = options.enabled !== false
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    enabled: isEnabled,
  })
  if (!isEnabled || !data?.data) return false
  return data.data.trash?.enabled !== false
}

/** Trash size cap in bytes; undefined when unlimited (0 or unset) or when disabled. */
export function useTrashCapBytes(options: { enabled?: boolean } = {}): number | undefined {
  const isEnabled = options.enabled !== false
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    enabled: isEnabled,
  })
  if (!isEnabled) return undefined
  const cap = data?.data.trash?.maxTrashBytes
  return cap && cap > 0 ? cap : undefined
}

/** Per-user library preferences (N-06 default sort modes, view, title normalization). */
export function useLibraryPrefs(): SettingsRes['library'] {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  })
  return data?.data.library
}

/**
 * Partial update of the library settings blob with an optimistic cache merge,
 * so sort-mode flips (including the drag-to-manual switch) take effect in the
 * same frame as the reorder mutation instead of waiting for a refetch.
 */
export function useUpdateLibraryPrefs() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (patch: NonNullable<SettingsRes['library']>) => apiPut('/settings', { library: patch }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] })
      const prev = queryClient.getQueryData<{ data: SettingsRes }>(['settings'])
      if (prev) {
        const next = { ...prev.data, library: { ...prev.data.library, ...patch } }
        queryClient.setQueryData(['settings'], {
          data: next,
        })
        writeStoredSettings(next)
      }
      return { prev }
    },
    onError: (error, _patch, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(['settings'], ctx.prev)
        writeStoredSettings(ctx.prev.data)
      }
      notify.error(getUserErrorNotification(error, 'settings.libraryPrefsUpdateFailed'))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })
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
          let shelfId: string | null | undefined
          try {
            const body = JSON.parse(xhr.responseText) as { duplicated?: boolean; data?: { shelfId?: string | null } }
            duplicated = body.duplicated === true
            shelfId = body.data?.shelfId
          } catch {
            // keep false
          }
          if (duplicated) {
            // A duplicate keeps its own shelf: tell the user when the requested
            // shelf was not applied instead of a bare "already exists".
            const notMoved = Boolean(item.shelfId) && shelfId !== item.shelfId
            patchItem(item.id, {
              status: 'duplicate',
              progress: 100,
              messageKey: notMoved ? 'library.uploadDuplicateNotMoved' : undefined,
            })
          } else {
            patchItem(item.id, { status: 'success', progress: 100 })
          }
        } else {
          let code: string | null = null
          try {
            const body = JSON.parse(xhr.responseText)
            code = body?.error?.code ?? null
          } catch {
            // ignore
          }
          patchItem(item.id, {
            status: 'error',
            progress: 100,
            messageKey: getErrorKeyByCode(code) ?? 'library.uploadFailed',
          })
        }
      })
      xhr.addEventListener('error', () => {
        patchItem(item.id, { status: 'error', progress: 100, messageKey: 'library.uploadFailed' })
      })
      xhr.addEventListener('abort', () => {
        patchItem(item.id, { status: 'error', progress: 100, messageKey: 'library.uploadFailed' })
      })
      xhr.addEventListener('loadend', () => {
        runningRef.current -= 1
      })
      xhr.send(formData)
    },
    [patchItem],
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
    if (failed > 0 || (succeeded > 0 && duplicated > 0)) {
      const showSummary = failed > 0 ? notify.error : notify.warning
      const summary = [
        succeeded > 0 && i18n.t('library.uploadSummarySucceeded', { count: succeeded }),
        duplicated > 0 && i18n.t('library.uploadSummaryDuplicated', { count: duplicated }),
        failed > 0 && i18n.t('library.uploadSummaryFailed', { count: failed }),
      ].filter(Boolean).join(i18n.t('library.uploadSummarySeparator'))
      showSummary(summary)
    } else if (duplicated > 0) {
      notify.warning({ key: 'library.uploadDuplicateOnly', params: { count: duplicated } })
    } else {
      notify.success({ key: 'library.uploadImported', params: { count: succeeded } })
    }
  }, [items, queryClient])

  const addFiles = useCallback(
    (files: FileList | File[], opts?: { autoStart?: boolean; maxBytes?: number } & UploadAssignment) => {
      const list = Array.from(files)
      const accepted = list.filter(isAcceptedUploadFile)
      const oversized = opts?.maxBytes ? accepted.filter((f) => f.size > opts.maxBytes!) : []
      const inRange = accepted.filter((f) => !opts?.maxBytes || f.size <= opts.maxBytes!)
      const rejected = list.length - inRange.length - oversized.length
      // Drag-dropped files start immediately; picker-selected files wait for
      // an explicit "upload" click (pending -> queued via startUpload)
      const status = opts?.autoStart ? ('queued' as const) : ('pending' as const)
      setItems((prev) => [
        ...prev,
        ...inRange.map((file) => ({
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
      if (oversized.length > 0) notify.info({ key: 'library.uploadOversized', params: { count: oversized.length } })
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

  const retry = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === id && it.status === 'error'
          ? { ...it, status: 'queued' as const, progress: 0, messageKey: undefined }
          : it,
      ),
    )
  }, [])

  const isUploading = items.some((it) => it.status === 'queued' || it.status === 'uploading' || it.status === 'processing')

  const clearQueue = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status === 'queued' || it.status === 'uploading' || it.status === 'processing'))
  }, [])

  // Reopening the sheet must not resurrect finished rows from a background
  // upload that settled after the sheet was closed.
  const pruneSettled = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status !== 'success' && it.status !== 'duplicate' && it.status !== 'error'))
  }, [])

  return { items, addFiles, startUpload, retry, pruneSettled, isUploading, clearQueue }
}

export function useDeleteBook() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id }: { id: string; title: string }) => apiDelete<{ data: null }>(`/books/${id}`),
    onSuccess: (_, { title }) => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      // The server deletes permanently when trash is off; match the toast.
      const settings = queryClient.getQueryData<{ data: SettingsRes }>(['settings'])
      const trashOn = settings?.data.trash?.enabled !== false
      notify.success({
        key: trashOn ? 'library.bookMovedToTrash' : 'library.bookPermanentlyDeleted',
        params: { title },
      })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.deleteBookFailed'))
    },
  })
}

export function useRestoreBook() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id }: { id: string; title: string }) => apiPost<{ data: null }>(`/books/${id}/restore`),
    onSuccess: (_, { title }) => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      notify.success({ key: 'library.bookRestored', params: { title } })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.restoreBookFailed'))
    },
  })
}

export function usePermanentDeleteBook() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id }: { id: string; title: string }) => apiDelete<{ data: null }>(`/books/${id}/permanent`),
    onSuccess: (_, { title }) => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      notify.success({ key: 'library.bookPermanentlyDeleted', params: { title } })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.permanentDeleteBookFailed'))
    },
  })
}

export function useEmptyTrash() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => apiDelete<{ data: { count: number } }>('/books/trash'),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      notify.success({ key: 'library.trashEmptied', params: { count: result.data.count } })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.emptyTrashFailed'))
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
      notify.error(getUserErrorNotification(error, 'toast.createShelfFailed'))
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
      notify.error(getUserErrorNotification(error, 'toast.renameShelfFailed'))
    },
  })
}

/** Pin toggle has no success toast — the list reordering is the feedback. */
export function useToggleShelfPin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => apiPut(`/shelves/${id}`, { pinned }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.pinShelfFailed'))
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
      notify.error(getUserErrorNotification(error, 'toast.deleteShelfFailed'))
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
      notify.error(getUserErrorNotification(error, 'toast.reorderShelvesFailed'))
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
      notify.error(getUserErrorNotification(error, 'toast.reorderTagsFailed'))
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
      notify.error(getUserErrorNotification(error, 'toast.updateBookFailed'))
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
      notify.success({ key: 'toast.bookCoverUpdated' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.updateBookCoverFailed'))
    },
  })
}

export function useRemoveCover() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (bookId: string) => apiDelete<{ data: BookListItem }>(`/books/${bookId}/cover`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] })
      notify.success({ key: 'toast.bookCoverRemoved' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.removeBookCoverFailed'))
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
      notify.error(getUserErrorNotification(error, 'toast.resetMetadataFailed'))
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
      notify.error(getUserErrorNotification(error, 'toast.createTagFailed'))
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
      notify.error(getUserErrorNotification(error, 'toast.renameTagFailed'))
    },
  })
}

export function useToggleTagPin() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => apiPut(`/tags/${id}`, { pinned }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.pinTagFailed'))
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
      notify.error(getUserErrorNotification(error, 'toast.deleteTagFailed'))
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
      notify.error(getUserErrorNotification(error, 'toast.updateMembershipFailed'))
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
        notify.warning({
          key: 'library.moveBooksPartial',
          params: { succeeded: results.length - failed, failed },
        })
        return
      }
      const shelves = queryClient.getQueryData<{ data: ShelfListItem[] }>(['shelves'])
      const name = shelves?.data.find((s) => s.id === variables.shelfId)?.name
      notify.success(name
        ? { key: 'toast.movedToShelf', params: { name, count: variables.bookIds.length } }
        : { key: 'toast.movedOutOfShelf', params: { count: variables.bookIds.length } })
    },
  })
}
