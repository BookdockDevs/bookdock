import { useMutation, useQuery, useInfiniteQuery, useQueryClient, type QueryClient, type QueryObserverResult } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import {
  extractVersionNameFromFileName,
  type AppendContentPreviewRes,
  type BookDetailRes,
  type BookFormat,
  type BookListItem,
  type BookListRes,
  type BookMetadata,
  type CatalogBook,
  type CatalogBookUpdateReq,
  type CatalogListRes,
  type CatalogVersion,
  type CatalogVersionUpdateReq,
  type CollectBookRes,
  type CoverPaletteId,
  type Category,
  type CategoryScope,
  type ForkLocalRes,
  type LibraryCreateReq,
  type LibraryListItem,
  type LibraryMembersRes,
  type LibraryRelation,
  type LibraryTag,
  type LibraryUpdateReq,
  type MembershipRole,
  type PublishPrivateBookRes,
  type ReadStatus,
  type SettingsRes,
  type ShelfListItem,
  type TagListItem,
  type TocRulePattern,
} from '@bookdock/shared'

import { apiDelete, apiGet, apiPatch, apiPost, apiPut, apiUpload, BASE_URL } from '@/api/client'
import { tocBasePath, invalidateCityVersionQueries, type TocTarget } from '@/api/hooks/useTocRules'
import { withReveal } from '@/lib/reveal-hidden'
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
  /** Private-vault reveal; omitted = hidden rows excluded. */
  showHidden?: boolean
}

function buildBooksPath({ page, pageSize, search, sortBy, sortOrder, shelfId, tagId, author, series, format, readStatus, trash, showHidden }: UseBooksParams): string {
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
  if (showHidden) params.set('showHidden', '1')
  return `/books?${params.toString()}`
}

export function useBooks(params: UseBooksParams, options?: { enabled?: boolean }): QueryObserverResult<BookListRes> {
  return useQuery({
    queryKey: ['books', params],
    queryFn: () => apiGet<BookListRes>(buildBooksPath(params)),
    enabled: options?.enabled ?? true,
    // Never show another domain's rows: trash and active lists are different
    // queries even when the key has not caught up yet. Same for the vault
    // reveal flag: a still-cached hidden-filtered page must not stand in.
    placeholderData: (prev, prevQuery) => {
      const prevParams = (prevQuery?.queryKey as unknown[])?.[1] as UseBooksParams | undefined
      return prevParams && prevParams.trash === params.trash && prevParams.showHidden === params.showHidden ? prev : undefined
    },
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
  /** Private-vault reveal; omitted = hidden rows excluded. */
  showHidden?: boolean
}

function infiniteBooksFn(page: number, pageSize: number, search: string, sortBy: string, sortOrder: string, shelfId: string | null, tagId: string | null, author: string | null | undefined, series: string | null | undefined, format: BookFormat | null, readStatus: ReadStatus | null, trash: boolean, showHidden?: boolean) {
  return apiGet<BookListRes>(buildBooksPath({ page, pageSize, search, sortBy, sortOrder, shelfId, tagId, author, series, format, readStatus, trash, showHidden }))
}

export function useInfiniteBooks(params: UseInfiniteBooksParams, options?: { enabled?: boolean }) {
  return useInfiniteQuery({
    queryKey: ['books', 'infinite', params],
    enabled: options?.enabled ?? true,
    queryFn: ({ pageParam }) =>
      infiniteBooksFn(pageParam, params.pageSize, params.search, params.sortBy, params.sortOrder, params.shelfId, params.tagId, params.author, params.series, params.format, params.readStatus, params.trash, params.showHidden),
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
      infiniteBooksFn(pageParam as number, params.pageSize, params.search, params.sortBy, params.sortOrder, params.shelfId, params.tagId, params.author, params.series, params.format, params.readStatus, params.trash, params.showHidden),
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
  /** Edition label for a catalog upload into an existing work (P3). */
  versionName?: string
  /** i18n key resolved client-side; raw server messages are never displayed */
  messageKey?: string
  /** Set once the server answers; the id the reader opens. */
  bookVersionId?: string
}

export interface UploadAssignment {
  shelfId?: string
  tagIds?: string[]
}

/**
 * Where a queued file goes. The upload queue - concurrency pool, per-file
 * progress, duplicate detection, retry, the summary toast - is one machine, and
 * a shared library's catalog is the same kind of destination as the private
 * library, just a different endpoint. Naming the destination here is what keeps
 * one window and one queue serving both instead of a second, thinner one.
 */
export interface UploadTarget {
  url: string
  /** Form fields sent with every file, beyond the file itself. */
  fields?: (item: UploadItem) => Record<string, string>
  /** Query keys to refresh once the queue settles. */
  invalidateKeys: readonly (readonly unknown[])[]
  /**
   * Whether a duplicate kept the shelf it was asked for. Private only: a
   * duplicate that lands elsewhere is worth telling the reader about.
   */
  reportsAppliedShelf?: boolean
  /**
   * Where this endpoint keeps the uploaded book in its response. A private
   * upload answers a flat book, a catalog upload answers a work whose first
   * version is the reader target. Absent means the destination cannot name one.
   */
  pickBookId?: (body: unknown) => string | undefined
}

/**
 * Every mutation that moves a book between the grid and the taxonomy has to
 * refresh all three: books for the list, shelves and tags for the counts the
 * sidebar prints. Both taxonomy endpoints count with `isNull(deletedAt)`, so
 * trashing a book drops it out of those numbers. Queries are configured
 * `staleTime: Infinity` with window-focus refetch off, so a key left out here
 * stays wrong until a full page reload.
 */
const BOOK_MEMBERSHIP_KEYS = [['books'], ['shelves'], ['tags']] as const

const PRIVATE_UPLOAD_TARGET: UploadTarget = {
  url: '/books',
  fields: (item) => ({
    ...(item.shelfId ? { shelfId: item.shelfId } : {}),
    ...(item.tagIds?.length ? { tagIds: JSON.stringify(item.tagIds) } : {}),
  }),
  invalidateKeys: [...BOOK_MEMBERSHIP_KEYS],
  reportsAppliedShelf: true,
  pickBookId: (body) => (body as { data?: { id?: string } } | null)?.data?.id,
}

/** Instance-level upload limit (read-only, injected by GET /settings). */
export function useUploadSettings() {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  })
  return {
    maxBytes: data?.data.uploadMaxBytes,
    normalizeTitle: data?.data.library?.normalizeTitle !== false,
  }
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

/**
 * Libraries visible to the caller: own private library first, then shared. Each
 * row carries the caller's relation to it, so the sidebar can offer "join" or
 * "manage" per row without a request per library.
 */
export function useLibraries(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['libraries'],
    queryFn: () => apiGet<{ data: LibraryListItem[] }>('/libraries'),
    enabled: options?.enabled ?? true,
  })
}

/** The caller's relation to one library; drives badges and available actions. */
export function useLibraryRelation(libraryId: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['libraries', libraryId, 'relation'],
    queryFn: () => apiGet<{ data: { relation: LibraryRelation } }>(`/libraries/${libraryId}/relation`),
    enabled: (options?.enabled ?? true) && !!libraryId,
  })
}

/** Shared-library taxonomy for browsing; keyed per library so switching never leaks rows. */
export function useLibraryCategories(libraryId: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['libraries', libraryId, 'categories'],
    queryFn: () => apiGet<{ data: Category[] }>(`/libraries/${libraryId}/categories`),
    enabled: (options?.enabled ?? true) && !!libraryId,
  })
}

export function useLibraryTags(libraryId: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['libraries', libraryId, 'tags'],
    queryFn: () => apiGet<{ data: LibraryTag[] }>(`/libraries/${libraryId}/tags`),
    enabled: (options?.enabled ?? true) && !!libraryId,
  })
}

export function useJoinLibrary() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, accessPassword }: { libraryId: string; accessPassword?: string }) =>
      apiPost<{ data: { membership: unknown; relation: LibraryRelation } }>(`/libraries/${libraryId}/join`, accessPassword ? { accessPassword } : {}),
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['libraries'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'relation'] })
    },
  })
}

/**
 * Library management (0.4.0). Every mutation refreshes the library list and the
 * affected library's own queries, because a renamed library, a new member or a
 * new visibility all change what the panel may show.
 */
function useLibraryMutation<TVars extends { libraryId?: string } | Record<string, never>>(
  build: (vars: TVars) => { url: string; method: 'post' | 'patch' | 'delete'; body?: unknown },
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: TVars) => {
      const { url, method, body } = build(vars)
      if (method === 'delete') return apiDelete<{ data: unknown }>(url)
      if (method === 'patch') return apiPatch<{ data: unknown }>(url, body)
      return apiPost<{ data: unknown }>(url, body)
    },
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['libraries'] })
      if (vars.libraryId) {
        void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId] })
      }
    },
  })
}

export function useCreateLibrary() {
  // No libraryId yet: this is the one mutation that creates the row the others
  // then address.
  return useLibraryMutation<{ body: LibraryCreateReq } & { libraryId?: undefined }>(({ body }) => ({
    url: '/libraries', method: 'post', body,
  }))
}

export function useUpdateLibrary() {
  return useLibraryMutation<{ libraryId: string; patch: LibraryUpdateReq }>(({ libraryId, patch }) => ({
    url: `/libraries/${libraryId}`, method: 'patch', body: patch,
  }))
}

export function useDeleteLibrary() {
  return useLibraryMutation<{ libraryId: string }>(({ libraryId }) => ({
    url: `/libraries/${libraryId}`, method: 'delete',
  }))
}

export function useTransferLibrary() {
  return useLibraryMutation<{ libraryId: string; userId: string }>(({ libraryId, userId }) => ({
    url: `/libraries/${libraryId}/transfer`, method: 'post', body: { userId },
  }))
}

/** Owner/admin only; members can still leave on their own. */
export function useLibraryMembers(libraryId: string | null) {  return useQuery({
    queryKey: ['libraries', libraryId, 'members'],
    queryFn: () => apiGet<{ data: LibraryMembersRes }>(`/libraries/${libraryId}/members`),
    enabled: !!libraryId,
    retry: false,
  })
}

export function useAddLibraryMember() {
  return useLibraryMutation<{ libraryId: string; username: string; role: MembershipRole }>(({ libraryId, username, role }) => ({
    url: `/libraries/${libraryId}/members`, method: 'post', body: { username, role },
  }))
}

export function useSetLibraryMemberRole() {
  return useLibraryMutation<{ libraryId: string; userId: string; role: MembershipRole }>(({ libraryId, userId, role }) => ({
    url: `/libraries/${libraryId}/members/${userId}`, method: 'patch', body: { role },
  }))
}

export function useRemoveLibraryMember() {
  return useLibraryMutation<{ libraryId: string; userId: string }>(({ libraryId, userId }) => ({
    url: `/libraries/${libraryId}/members/${userId}`, method: 'delete',
  }))
}

/**
 * Library taxonomy (11.5). Mutating a category or tag also changes what a
 * catalog card shows, so the catalog query is invalidated with the taxonomy.
 */
function useTaxonomyMutation<TVars extends { libraryId: string }, TData = unknown>(
  build: (vars: TVars) => { url: string; method: 'post' | 'patch' | 'delete'; body?: unknown; successKey?: string },
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: TVars) => {
      const { url, method, body } = build(vars)
      if (method === 'delete') return apiDelete<{ data: TData }>(url)
      if (method === 'patch') return apiPatch<{ data: TData }>(url, body)
      return apiPost<{ data: TData }>(url, body)
    },
    onSuccess: (_res, vars) => {
      const key = build(vars).successKey
      if (key) notify.success({ key })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'tags'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book'] })
      void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
    },
    onError: (error) => notify.error(getUserErrorNotification(error)),
  })
}

export function useCreateLibraryCategory() {
  return useTaxonomyMutation<{ libraryId: string; name: string; parentId?: string }, Category>(({ libraryId, name, parentId }) => ({
    url: `/libraries/${libraryId}/categories`, method: 'post', body: { name, parentId }, successKey: 'toast.categoryCreated',
  }))
}

export function useUpdateLibraryCategory() {
  return useTaxonomyMutation<{ libraryId: string; categoryId: string; patch: { name?: string; parentId?: string | null; pinned?: boolean; hidden?: boolean } }, Category>(
    ({ libraryId, categoryId, patch }) => ({
      url: `/libraries/${libraryId}/categories/${categoryId}`, method: 'patch', body: patch,
      successKey: patch.name !== undefined || patch.parentId !== undefined ? 'toast.categoryUpdated' : undefined,
    }),
  )
}

export function useDeleteLibraryCategory() {
  return useTaxonomyMutation<{ libraryId: string; categoryId: string }>(({ libraryId, categoryId }) => ({
    url: `/libraries/${libraryId}/categories/${categoryId}`, method: 'delete', successKey: 'toast.categoryDeleted',
  }))
}

export function useCreateLibraryTag() {
  return useTaxonomyMutation<{ libraryId: string; name: string }, LibraryTag>(({ libraryId, name }) => ({
    url: `/libraries/${libraryId}/tags`, method: 'post', body: { name }, successKey: 'toast.tagCreated',
  }))
}

export function useUpdateLibraryTag() {
  return useTaxonomyMutation<{ libraryId: string; tagId: string; patch: { name?: string; pinned?: boolean; hidden?: boolean } }>(
    ({ libraryId, tagId, patch }) => ({
      url: `/libraries/${libraryId}/tags/${tagId}`, method: 'patch', body: patch,
      successKey: patch.name !== undefined ? 'toast.tagRenamed' : undefined,
    }),
  )
}

export function useDeleteLibraryTag() {
  return useTaxonomyMutation<{ libraryId: string; tagId: string }>(({ libraryId, tagId }) => ({
    url: `/libraries/${libraryId}/tags/${tagId}`, method: 'delete', successKey: 'toast.tagDeleted',
  }))
}

/**
 * Reorder is the same gesture as a private shelf's: the sidebar writes the full
 * id list and the server rewrites every sortOrder by index, so a drag can never
 * leave two rows claiming the same slot. Rejects optimistically and restores the
 * previous list so a manager who cannot reorder (a member) is not left looking
 * at a local order the server never accepted.
 */
export function useReorderLibraryCategories() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, categoryIds }: { libraryId: string; categoryIds: string[] }) =>
      apiPut<{ data: null }>(`/libraries/${libraryId}/categories/order`, { categoryIds }),
    onMutate: ({ libraryId, categoryIds }) => {
      const key = ['libraries', libraryId, 'categories']
      const prev = queryClient.getQueryData<{ data: Category[] }>(key)
      if (prev) {
        const byId = new Map(prev.data.map((category) => [category.id, category]))
        queryClient.setQueryData(key, {
          data: categoryIds.map((id) => byId.get(id)).filter((c): c is Category => Boolean(c)),
        })
      }
      return { key, prev }
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev)
      notify.error(getUserErrorNotification(error, 'toast.reorderShelvesFailed'))
    },
  })
}

export function useReorderLibraryTags() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, tagIds }: { libraryId: string; tagIds: string[] }) =>
      apiPut<{ data: null }>(`/libraries/${libraryId}/tags/order`, { tagIds }),
    onMutate: ({ libraryId, tagIds }) => {
      const key = ['libraries', libraryId, 'tags']
      const prev = queryClient.getQueryData<{ data: LibraryTag[] }>(key)
      if (prev) {
        const byId = new Map(prev.data.map((tag) => [tag.id, tag]))
        queryClient.setQueryData(key, {
          data: tagIds.map((id) => byId.get(id)).filter((t): t is LibraryTag => Boolean(t)),
        })
      }
      return { key, prev }
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(ctx.key, ctx.prev)
      notify.error(getUserErrorNotification(error, 'toast.reorderTagsFailed'))
    },
  })
}

/**
 * Catalog page (5.7). Works with their versions already resolved, so the UI
 * never has to recompute inheritance. The query vocabulary is the one
 * `GET /books` already speaks (q, sortBy, sortOrder, categoryId/shelfId, tagId,
 * format, page, pageSize), so a shared library and a private one are browsed
 * through one list component instead of two that drift apart. Keyed per library
 * and per filter so switching libraries or paging can never show another
 * library's rows.
 */
export interface CatalogListParams {
  page?: number
  pageSize?: number
  q?: string
  sortBy?: string
  sortOrder?: string
  categoryId?: string
  categoryScope?: CategoryScope
  tagId?: string
  format?: string
  author?: string
  series?: string
  /** Owner-only shared-library trash; server rejects non-owners. */
  trash?: boolean
}

/**
 * One place that turns catalog filters into both a cache key and a request, so
 * the sidebar's hover-prefetch and the list's own fetch can never disagree about
 * what "the same page" means (see prefetchBooks for the same shape).
 */
function catalogQueryParts(libraryId: string, params: CatalogListParams) {
  const key = {
    page: params.page ?? 1,
    pageSize: params.pageSize,
    q: params.q ?? '',
    sortBy: params.sortBy ?? '',
    sortOrder: params.sortOrder ?? '',
    categoryId: params.categoryId ?? '',
    categoryScope: params.categoryScope ?? 'direct',
    tagId: params.tagId ?? '',
    format: params.format ?? '',
    author: params.author ?? '',
    series: params.series ?? '',
    trash: params.trash ?? false,
  }
  const search = new URLSearchParams({ page: String(key.page) })
  if (key.pageSize) search.set('pageSize', String(key.pageSize))
  if (key.q) search.set('q', key.q)
  if (key.sortBy) search.set('sortBy', key.sortBy)
  if (key.sortOrder) search.set('sortOrder', key.sortOrder)
  if (key.categoryId) search.set('categoryId', key.categoryId)
  if (key.categoryScope !== 'direct') search.set('categoryScope', key.categoryScope)
  if (key.tagId) search.set('tagId', key.tagId)
  if (key.format) search.set('format', key.format)
  if (key.author) search.set('author', key.author)
  if (key.series) search.set('series', key.series)
  if (key.trash) search.set('trash', '1')
  return { key, path: `/libraries/${libraryId}/books?${search.toString()}` }
}

export function useLibraryCatalog(libraryId: string | null, params: CatalogListParams = {}) {
  const { key, path } = catalogQueryParts(libraryId ?? '', params)
  return useQuery({
    queryKey: ['libraries', libraryId, 'catalog', key],
    queryFn: () => apiGet<{ data: CatalogListRes }>(path),
    enabled: !!libraryId,
    // Keep the previous page while the same library reloads, but never show
    // another library's cards under the new library's actions: the key carries
    // the library id, yet the data belongs to the query that fetched it.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === libraryId ? prev : undefined),
  })
}

export function prefetchLibraryCatalog(queryClient: QueryClient, libraryId: string, params: CatalogListParams) {
  const { key, path } = catalogQueryParts(libraryId, params)
  return queryClient.prefetchQuery({
    queryKey: ['libraries', libraryId, 'catalog', key],
    queryFn: () => apiGet<{ data: CatalogListRes }>(path),
  })
}

/** Grouping candidates for an upload (5.2): a hint, never an automatic grouping. */
export function useCatalogSimilar(libraryId: string | null, params: { title: string; enabled: boolean }) {
  return useQuery({
    queryKey: ['libraries', libraryId, 'catalog', 'similar', { title: params.title }],
    queryFn: () => apiGet<{ data: CatalogBook[] }>(
      `/libraries/${libraryId}/books/similar?title=${encodeURIComponent(params.title)}`,
    ),
    enabled: !!libraryId && params.enabled && params.title.trim().length > 0,
  })
}

export interface CatalogUploadVars {
  libraryId: string
  file: File
  libraryBookId?: string
  categoryId?: string
  name?: string
  title?: string
  author?: string
}

export function useUploadCatalogBook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, file, ...fields }: CatalogUploadVars) => {
      const form = new FormData()
      form.set('file', file)
      for (const [key, value] of Object.entries(fields)) {
        if (value) form.set(key, value)
      }
      return apiUpload<{ data: CatalogBook; duplicated: boolean }>(`/libraries/${libraryId}/books`, form)
    },
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
      // The upload lands in a category and under tags, so both counters moved.
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'tags'] })
    },
  })
}

/**
 * File a work under a category (or take it out of one by passing null). This is
 * the shared library's counterpart of moving a private book to a shelf, and it
 * is what a card dropped on a category row and a batch classify both call.
 */
export function useSetWorkCategory() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, libraryBookId, categoryId }: { libraryId: string; libraryBookId: string; categoryId: string | null }) =>
      apiPatch(`/libraries/${libraryId}/books/${libraryBookId}`, { categoryId }),
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book'] })
      void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'categories'] })

    },
  })
}

/**
 * Edit a work's own metadata (5.3): title, author, description, category and
 * the whole tag set. Version overrides are a separate PATCH on the version.
 */
export function useCatalogBookDetail(libraryId: string | null, libraryBookId: string | null) {
  return useQuery({
    queryKey: ['libraries', libraryId, 'catalog', 'detail', libraryBookId],
    queryFn: () => apiGet<{ data: CatalogBook }>(`/libraries/${libraryId}/books/${libraryBookId}`),
    enabled: Boolean(libraryId && libraryBookId),
    staleTime: 0,
  })
}

export function useUpdateCatalogBook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, libraryBookId, patch }: { libraryId: string; libraryBookId: string; patch: CatalogBookUpdateReq }) =>
      apiPatch<{ data: CatalogBook }>(`/libraries/${libraryId}/books/${libraryBookId}`, patch),
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'tags'] })
      void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book'] })
    },
  })
}

export function useUploadCatalogBookCover() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, libraryBookId, file }: { libraryId: string; libraryBookId: string; file: File }) =>
      apiUpload<{ data: CatalogBook }>(`/libraries/${libraryId}/books/${libraryBookId}/cover`, file, 'PUT'),
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
    },
  })
}

export function useRemoveCatalogBookCover() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, libraryBookId }: { libraryId: string; libraryBookId: string }) =>
      apiDelete<{ data: CatalogBook }>(`/libraries/${libraryId}/books/${libraryBookId}/cover`),
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
    },
  })
}

function useCatalogVersionMutation<TVars extends { libraryId: string; libraryBookId: string }>(
  build: (vars: TVars) => { url: string; method: 'patch' | 'delete'; body?: unknown },
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (vars: TVars) => {
      const { url, method, body } = build(vars)
      return method === 'delete'
        ? apiDelete<{ data: unknown }>(url)
        : apiPatch<{ data: unknown }>(url, body)
    },
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
      // Removing the last version of a work removes the work, and with it the
      // category row and the tag links the sidebar counts.
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'tags'] })
    },
  })
}

/** Version overrides and publish state (5.3/5.4). */
export function useUpdateCatalogVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, libraryBookId, versionLinkId, patch }: { libraryId: string; libraryBookId: string; versionLinkId: string; patch: CatalogVersionUpdateReq }) =>
      apiPatch<{ data: CatalogVersion }>(`/libraries/${libraryId}/books/${libraryBookId}/versions/${versionLinkId}`, patch),
    onSuccess: async (_res, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'categories'] }),
        queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'tags'] }),
        queryClient.invalidateQueries({ queryKey: ['books'] }),
        queryClient.invalidateQueries({ queryKey: ['book'] }),
      ])
    },
  })
}

/** Re-group a misfiled version under another work (5.5). */
export function useMoveCatalogVersion() {
  return useCatalogVersionMutation<{
    libraryId: string
    libraryBookId: string
    versionLinkId: string
    targetLibraryBookId: string
  }>(({ libraryId, libraryBookId, versionLinkId, targetLibraryBookId }) => ({
    url: `/libraries/${libraryId}/books/${libraryBookId}/versions/${versionLinkId}/move`,
    method: 'patch',
    body: { libraryBookId: targetLibraryBookId },
  }))
}

/** Deleting the last version of a work deletes the work with it (5.6). */
export function useDeleteCatalogVersion() {
  return useCatalogVersionMutation<{
    libraryId: string
    libraryBookId: string
    versionLinkId: string
  }>(({ libraryId, libraryBookId, versionLinkId }) => ({
    url: `/libraries/${libraryId}/books/${libraryBookId}/versions/${versionLinkId}`,
    method: 'delete',
  }))
}

/** Owner-only: restore one trashed shared work. */
export function useRestoreLibraryBook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, libraryBookId }: { libraryId: string; libraryBookId: string; title: string }) =>
      apiPost<{ data: { id: string } }>(`/libraries/${libraryId}/books/${libraryBookId}/restore`, {}),
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'tags'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries'] })
      notify.success({ key: 'library.bookRestored', params: { title: vars.title } })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.restoreFailed'))
    },
  })
}

/** Owner-only: permanently delete one trashed shared work. */
export function usePermanentDeleteLibraryBook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, libraryBookId }: { libraryId: string; libraryBookId: string; title: string }) =>
      apiDelete<{ data: { id: string } }>(`/libraries/${libraryId}/books/${libraryBookId}/permanent`),
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'tags'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries'] })
      notify.success({ key: 'library.bookPermanentlyDeleted', params: { title: vars.title } })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.permanentDeleteFailed'))
    },
  })
}

/** Owner-only: empty a shared library trash. */
export function useEmptyLibraryTrash() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId }: { libraryId: string }) =>
      apiDelete<{ data: { count: number } }>(`/libraries/${libraryId}/trash`),
    onSuccess: (result, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'tags'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries'] })
      if (result.data.count === 0) notify.info({ key: 'library.trashAlreadyEmpty' })
      else notify.success({ key: 'library.trashEmptied', params: { count: result.data.count } })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.emptyTrashFailed'))
    },
  })
}

export function useUploadCatalogVersionCover() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, libraryBookId, versionLinkId, file }: { libraryId: string; libraryBookId: string; versionLinkId: string; file: File }) =>
      apiUpload<{ data: CatalogVersion }>(`/libraries/${libraryId}/books/${libraryBookId}/versions/${versionLinkId}/cover`, file, 'PUT'),
    onSuccess: async (_res, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['books'] }),
        queryClient.invalidateQueries({ queryKey: ['book'] }),
      ])
    },
  })
}

export function useRemoveCatalogVersionCover() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, libraryBookId, versionLinkId }: { libraryId: string; libraryBookId: string; versionLinkId: string }) =>
      apiDelete<{ data: CatalogVersion }>(`/libraries/${libraryId}/books/${libraryBookId}/versions/${versionLinkId}/cover`),
    onSuccess: async (_res, vars) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['books'] }),
        queryClient.invalidateQueries({ queryKey: ['book'] }),
      ])
    },
  })
}

export function useResetCatalogVersionMetadata() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, libraryBookId, versionLinkId }: { libraryId: string; libraryBookId: string; versionLinkId: string }) =>
      apiPost<{ data: CatalogBook }>(`/libraries/${libraryId}/books/${libraryBookId}/versions/${versionLinkId}/reset-metadata`),
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
    },
  })
}

/**
 * Add to my library (7.1). One server action does the whole collect; the button
 * only reports the outcome, including "already collected" (7.5), which is a
 * success state rather than an error.
 */
export function useCollectBook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, versionLinkId, categoryId }: { libraryId: string; versionLinkId: string; categoryId?: string }) =>
      apiPost<{ data: CollectBookRes }>(
        `/libraries/${libraryId}/versions/${versionLinkId}/collect`,
        categoryId ? { categoryId } : {},
      ),
    onSuccess: (_res, vars) => {
      // The collected card shows up in the private library, and the catalog
      // must stop offering the same version again.
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['books'] })
    },
  })
}

/**
 * Fork a collected B into a local C (B rescue). The same card swaps to a new
 * independent version; the caller navigates by the returned version id.
 */
export function useForkBook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ bookId }: { bookId: string }) =>
      apiPost<{ data: ForkLocalRes }>(`/books/${bookId}/fork`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['books'] })
    },
  })
}

/**
 * TOC baseline of one city version for the rule picker: pinned rule state
 * plus chapter summaries, without touching list payloads.
 */
export interface VersionTocState {
  tocRuleId: string | null
  tocRuleAuto: boolean
  customPatterns: TocRulePattern[]
  /** Display-only name of the rule the stored patterns came from. */
  tocRuleLabel: string | null
  excludedChapterIds: string[]
  chapters: Array<{ id: string; title: string; level: number; wordCount: number }>
}

export function useVersionTocState(
  libraryId: string | null,
  libraryBookId: string | null,
  versionLinkId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ['libraries', libraryId, 'toc-state', libraryBookId, versionLinkId],
    queryFn: () => apiGet<{ data: VersionTocState }>(
      `/libraries/${libraryId}/books/${libraryBookId}/versions/${versionLinkId}/toc-state`,
    ),
    enabled: Boolean(libraryId && libraryBookId && versionLinkId) && enabled,
  })
}

/**
 * Push a linked private draft to its published city version. Managers only;
 * appends a revision, never rewrites one. Identical bytes are a no-op.
 */
export function usePushVersion() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, libraryBookId, versionLinkId }: { libraryId: string; libraryBookId: string; versionLinkId: string }) =>
      apiPost<{ data: { revisionNo: number; alreadyUpToDate: boolean; diverged: boolean } & { book?: CatalogBook } }>(
        `/libraries/${libraryId}/books/${libraryBookId}/versions/${versionLinkId}/push`,
        {},
      ),
    onSuccess: (res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      invalidateCityVersionQueries(queryClient, res.data.book, vars.versionLinkId)
    },
  })
}

export function usePublishPrivateBook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ libraryId, bookId, categoryId, tagIds }: {
      libraryId: string
      bookId: string
      categoryId?: string
      tagIds?: string[]
    }) => apiPost<{ data: PublishPrivateBookRes }>(
      `/libraries/${libraryId}/books/from-private`,
      { bookId, ...(categoryId ? { categoryId } : {}), ...(tagIds && tagIds.length > 0 ? { tagIds } : {}) },
    ),
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'tags'] })
    },
  })
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
 * Per-user preferences for the owner's own profile page. Display-only: the
 * server enforces no profile visibility, so these decide what the owner sees,
 * not who can see them.
 */
export function useProfileSettings(): NonNullable<SettingsRes['profile']> {
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  })
  return data?.data.profile ?? {}
}

/** Partial update of the profile blob, with the same optimistic merge the
 *  library preferences use so a toggle lands in the same frame as the click. */
export function useUpdateProfileSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (patch: NonNullable<SettingsRes['profile']>) => apiPut('/settings', { profile: patch }),
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: ['settings'] })
      const prev = queryClient.getQueryData<{ data: SettingsRes }>(['settings'])
      if (prev) {
        const next = { ...prev.data, profile: { ...prev.data.profile, ...patch } }
        queryClient.setQueryData(['settings'], { data: next })
        writeStoredSettings(next)
      }
      return { prev }
    },
    onError: (error, _patch, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(['settings'], ctx.prev)
        writeStoredSettings(ctx.prev.data)
      }
      notify.error(getUserErrorNotification(error, 'settings.profilePrefsUpdateFailed'))
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })
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

/**
 * Which libraries this user has removed from their own sidebar. Reads through
 * the same settings query as the sort preferences, so the optimistic merge above
 * makes a hide/unhide land in the same frame as the click. The library itself
 * is untouched — this only decides whether the sidebar offers it.
 */
export function useHiddenLibraries() {
  const hidden = useLibraryPrefs()?.hiddenLibraryIds
  const update = useUpdateLibraryPrefs()

  return {
    hiddenIds: hidden,
    isHidden: (libraryId: string) => hidden?.includes(libraryId) ?? false,
    setHidden: (libraryId: string, next: boolean) => {
      const current = hidden ?? []
      if (current.includes(libraryId) === next) return
      update.mutate({
        hiddenLibraryIds: next ? [...current, libraryId] : current.filter((id) => id !== libraryId),
      })
    },
  }
}

export const UPLOAD_ACCEPTED_EXTENSIONS = ['.epub', '.txt']

export function isAcceptedUploadFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return UPLOAD_ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext))
}

export { extractVersionNameFromFileName } from '@bookdock/shared'

const UPLOAD_CONCURRENCY = 3

/**
 * Multi-file upload with a small concurrency pool and per-file queue status.
 * A single invalidate + summary toast fires when the whole queue settles.
 */
export function useUploadBooks(target: UploadTarget = PRIVATE_UPLOAD_TARGET) {
  const queryClient = useQueryClient()
  const notificationKey = useId()
  const [items, setItems] = useState<UploadItem[]>([])
  const runningRef = useRef(0)
  const settledRef = useRef(false)
  // The requests themselves, so a cancel can reach them. Kept as a set because
  // the pool holds several at once and each loadend drops its own.
  const inflightRef = useRef(new Set<XMLHttpRequest>())
  // Set by a cancel, cleared whenever a new batch starts. A cancelled batch is
  // the reader's own decision and must not be summarised as a failure.
  const stoppingRef = useRef(false)
  const nextIdRef = useRef(0)

  const patchItem = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }, [])

  const uploadOne = useCallback(
    (item: UploadItem) => {
      runningRef.current += 1
      patchItem(item.id, { status: 'uploading', progress: 0 })
      const xhr = new XMLHttpRequest()
      inflightRef.current.add(xhr)
      const formData = new FormData()
      formData.append('file', item.file)
      for (const [key, value] of Object.entries(target.fields?.(item) ?? {})) {
        formData.append(key, value)
      }
      xhr.open('POST', `${BASE_URL}${target.url}`)
      xhr.upload.addEventListener('progress', (e) => {
        if (!e.lengthComputable) return
        const pct = Math.round((e.loaded / e.total) * 100)
        // progress 100 means the bytes reached the server; the server may still
        // be parsing/converting, which the UI shows as "processing"
        patchItem(item.id, pct >= 100 ? { progress: 100, status: 'processing' } : { progress: pct })
      })
      xhr.addEventListener('load', () => {
        inflightRef.current.delete(xhr)
        if (xhr.status >= 200 && xhr.status < 300) {
          let duplicated = false
          let shelfId: string | null | undefined
          let bookVersionId: string | undefined
          try {
            const body = JSON.parse(xhr.responseText) as { duplicated?: boolean; data?: { shelfId?: string | null } }
            duplicated = body.duplicated === true
            shelfId = body.data?.shelfId
            bookVersionId = target.pickBookId?.(body)
          } catch {
            // keep false
          }
          if (duplicated) {
            // A duplicate keeps its own shelf: tell the user when the requested
            // shelf was not applied instead of a bare "already exists".
            const notMoved = target.reportsAppliedShelf === true
              && Boolean(item.shelfId) && shelfId !== item.shelfId
            patchItem(item.id, {
              status: 'duplicate',
              progress: 100,
              messageKey: notMoved ? 'library.uploadDuplicateNotMoved' : undefined,
              bookVersionId,
            })
          } else {
            patchItem(item.id, { status: 'success', progress: 100, bookVersionId })
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
        inflightRef.current.delete(xhr)
        // progress is left as-is: how far the file got is the useful fact, and
        // error rows do not render a bar anyway.
        patchItem(item.id, {
          status: 'error',
          messageKey: stoppingRef.current ? 'library.uploadCancelled' : 'library.uploadFailed',
        })
      })
      xhr.addEventListener('loadend', () => {
        inflightRef.current.delete(xhr)
        runningRef.current -= 1
      })
      xhr.send(formData)
    },
    [patchItem, target],
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
    // Whatever the destination lists are, they are what the reader will look at
    // next: the private library's book list and its shelf counts, or a shared
    // library's catalog and its taxonomy counts.
    for (const key of target.invalidateKeys) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
    // Rows already say "cancelled", and files that finished before the cancel
    // still landed, so the lists above are refreshed either way. What must not
    // happen is a red "N failed" toast for a batch the reader stopped on purpose.
    if (stoppingRef.current) return
    if (failed > 0 || (succeeded > 0 && duplicated > 0)) {
      const showSummary = failed > 0
        ? (succeeded + duplicated > 0 ? notify.warning : notify.error)
        : notify.info
      const summary = [
        succeeded > 0 && i18n.t('library.uploadSummarySucceeded', { count: succeeded }),
        duplicated > 0 && i18n.t('library.uploadSummaryDuplicated', { count: duplicated }),
        failed > 0 && i18n.t('library.uploadSummaryFailed', { count: failed }),
      ].filter(Boolean).join(i18n.t('library.uploadSummarySeparator'))
      showSummary(summary, { dedupeKey: `upload:${notificationKey}` })
    } else if (duplicated > 0) {
      notify.info({ key: 'library.uploadDuplicateOnly', params: { count: duplicated } }, { dedupeKey: `upload:${notificationKey}` })
    } else {
      notify.success({ key: 'library.uploadImported', params: { count: succeeded } }, { dedupeKey: `upload:${notificationKey}` })
    }
  }, [items, notificationKey, queryClient, target])

  const addFiles = useCallback(
    (files: FileList | File[], opts?: { autoStart?: boolean; maxBytes?: number; versionNameMode?: boolean } & UploadAssignment) => {
      const list = Array.from(files)
      const accepted = list.filter(isAcceptedUploadFile)
      const oversized = opts?.maxBytes ? accepted.filter((f) => f.size > opts.maxBytes!) : []
      const inRange = accepted.filter((f) => !opts?.maxBytes || f.size <= opts.maxBytes!)
      const rejected = list.length - inRange.length - oversized.length
      // Picking files stages them for an explicit "upload" click, so a file
      // chosen by mistake is never sent; several picks stage as one batch and
      // are confirmed together. A drop means "send these", and a pick made
      // while the batch is already running means "add to it", so both go
      // straight out. Staging therefore only ever happens while nothing is
      // running, which is what keeps a staged row from coexisting with an
      // upload in flight - a combination that would need two different footer
      // buttons for one state.
      setItems((prev) => {
        const autoStart = opts?.autoStart === true
        const running = prev.some((it) => it.status === 'queued' || it.status === 'uploading' || it.status === 'processing')
        const status = autoStart || running ? ('queued' as const) : ('pending' as const)
        return [
        // A drop also releases whatever was staged; otherwise the staged row
        // would sit behind a running upload until the reader clicked again.
        ...prev.map((it) => (autoStart && it.status === 'pending' ? { ...it, status } : it)),
        ...inRange.map((file) => ({
          id: `up-${Date.now()}-${nextIdRef.current++}`,
          name: file.name,
          file,
          status,
          progress: 0,
          shelfId: opts?.shelfId,
          tagIds: opts?.tagIds,
          ...(opts?.versionNameMode ? { versionName: extractVersionNameFromFileName(file.name) } : {}),
        })),
        ]
      })
      if (inRange.length > 0) stoppingRef.current = false
      if (rejected > 0) notify.info({ key: 'library.uploadIgnored', params: { count: rejected } })
      if (oversized.length > 0) notify.info({ key: 'library.uploadOversized', params: { count: oversized.length } })
    },
    [],
  )

  const startUpload = useCallback((assignment?: UploadAssignment) => {
    stoppingRef.current = false
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
    stoppingRef.current = false
    setItems((prev) =>
      prev.map((it) =>
        it.id === id && it.status === 'error'
          ? { ...it, status: 'queued' as const, progress: 0, messageKey: undefined }
          : it,
      ),
    )
  }, [])

  const retryAll = useCallback(() => {
    stoppingRef.current = false
    setItems((prev) => prev.map((it) =>
      it.status === 'error'
        ? { ...it, status: 'queued' as const, progress: 0, messageKey: undefined }
        : it,
    ))
  }, [])

  /**
   * Stop the batch. Parking the not-yet-sent rows first matters: the scheduler
   * restarts anything still `queued`, so aborting the open requests alone would
   * simply roll into the next file.
   */
  const abortAll = useCallback(() => {
    stoppingRef.current = true
    setItems((prev) => prev.map((it) =>
      it.status === 'queued' || it.status === 'pending'
        ? { ...it, status: 'error' as const, messageKey: 'library.uploadCancelled' }
        : it,
    ))
    for (const xhr of inflightRef.current) xhr.abort()
    inflightRef.current.clear()
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

  return { items, addFiles, startUpload, retry, retryAll, abortAll, pruneSettled, isUploading, clearQueue, patchItem }
}

export function useDeleteBook() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, deleteUserData }: { id: string; title: string; isCollected?: boolean; deleteUserData?: boolean }) => {
      const query = deleteUserData ? '?deleteUserData=true' : ''
      return apiDelete<{ data: null }>(`/books/${id}${query}`)
    },
    onSuccess: (_, { title, isCollected }) => {
      for (const queryKey of BOOK_MEMBERSHIP_KEYS) queryClient.invalidateQueries({ queryKey })
      // Removing a collected card also changes the source library's catalog.
      queryClient.invalidateQueries({ queryKey: ['libraries'] })
      if (isCollected) {
        notify.success({
          key: 'library.bookRemovedFromLibrary',
          params: { title },
        })
        return
      }
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
      for (const queryKey of BOOK_MEMBERSHIP_KEYS) queryClient.invalidateQueries({ queryKey })
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
      for (const queryKey of BOOK_MEMBERSHIP_KEYS) queryClient.invalidateQueries({ queryKey })
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
      for (const queryKey of BOOK_MEMBERSHIP_KEYS) queryClient.invalidateQueries({ queryKey })
      if (result.data.count === 0) notify.info({ key: 'library.trashAlreadyEmpty' })
      else notify.success({ key: 'library.trashEmptied', params: { count: result.data.count } })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.emptyTrashFailed'))
    },
  })
}

export function useShelves(): QueryObserverResult<{ data: ShelfListItem[] }> {
  return useQuery({
    queryKey: ['shelves'],
    queryFn: () => apiGet<{ data: ShelfListItem[] }>(withReveal('/shelves')),
  })
}

export function useTags(): QueryObserverResult<{ data: TagListItem[] }> {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => apiGet<{ data: TagListItem[] }>(withReveal('/tags')),
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
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book'] })
      void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
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

export function useToggleShelfHidden() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) => apiPut(`/shelves/${id}`, { hidden }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book'] })
      void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      queryClient.invalidateQueries({ queryKey: ['books'] })
    },
    onError: (error) => notify.error(getUserErrorNotification(error, 'library.taxonomyVisibilityFailed')),
  })
}

export function useDeleteShelf() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiDelete<{ data: null }>(`/shelves/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book'] })
      void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
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
    mutationFn: async (shelfIds: string[]) => {
      const all = await apiGet<{ data: ShelfListItem[] }>('/shelves?showHidden=1')
      const visible = new Set(shelfIds)
      let position = 0
      const complete = all.data.map((row) => visible.has(row.id) ? shelfIds[position++]! : row.id)
      return apiPut<{ data: null }>('/shelves/order', { shelfIds: complete })
    },
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
    mutationFn: async (tagIds: string[]) => {
      const all = await apiGet<{ data: TagListItem[] }>('/tags?showHidden=1')
      const visible = new Set(tagIds)
      let position = 0
      const complete = all.data.map((row) => visible.has(row.id) ? tagIds[position++]! : row.id)
      return apiPut<{ data: null }>('/tags/order', { tagIds: complete })
    },
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
    mutationFn: ({ bookId, ...data }: { bookId: string } & Partial<{ readStatus: ReadStatus; progress: number; pinned: boolean; title: string; author: string; authors: string[]; hidden: boolean; bookmeta: BookMetadata; coverPaletteId: CoverPaletteId | null }>) =>
      apiPatch<{ data: BookListItem }>(`/books/${bookId}`, data),
    onSuccess: async (_result, { bookId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['books'] }),
        queryClient.invalidateQueries({ queryKey: ['book', bookId] }),
      ])
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
    queryFn: () => apiGet<{ data: BookDetailRes }>(withReveal(`/books/${bookId}`)),
    enabled: Boolean(bookId),
    staleTime: 0,
    refetchOnMount: 'always',
  })
}

export interface AppendContentInput {
  target: TocTarget
  file?: File
  text?: string
  startOffset?: number
}

function appendContentRequest<T>(path: string, { target, file, text, startOffset }: AppendContentInput): Promise<T> {
  const base = tocBasePath(target)
  if (file) {
    const formData = new FormData()
    formData.append('file', file)
    if (startOffset !== undefined) formData.append('startOffset', String(startOffset))
    return apiUpload<T>(`${base}/${path}`, formData)
  }
  return apiPost<T>(`${base}/${path}`, {
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
    mutationFn: (input: AppendContentInput) =>
      appendContentRequest<{ data: BookDetailRes & { book?: CatalogBook } }>('append', input),
    onSuccess: (result, input) => {
      if ('bookId' in input.target) {
        queryClient.setQueryData(['book', input.target.bookId], result)
        queryClient.invalidateQueries({ queryKey: ['books'] })
        queryClient.invalidateQueries({ queryKey: ['books', 'detail', input.target.bookId] })
        queryClient.invalidateQueries({ queryKey: ['book', input.target.bookId] })
        queryClient.invalidateQueries({ queryKey: ['chapters', input.target.bookId] })
        queryClient.invalidateQueries({ queryKey: ['progress', input.target.bookId] })
      } else {
        void queryClient.invalidateQueries({ queryKey: ['libraries', input.target.libraryId, 'catalog'] })
        void queryClient.invalidateQueries({ queryKey: ['books'] })
        invalidateCityVersionQueries(queryClient, result.data.book, input.target.versionLinkId)
      }
    },
  })
}

export function useUploadCover() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ bookId, file }: { bookId: string; file: File }) =>
      apiUpload<{ data: BookListItem }>(`/books/${bookId}/cover`, file, 'PUT'),
    onSuccess: async (_result, { bookId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['books'] }),
        queryClient.invalidateQueries({ queryKey: ['book', bookId] }),
      ])
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
    onSuccess: async (_result, bookId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['books'] }),
        queryClient.invalidateQueries({ queryKey: ['book', bookId] }),
      ])
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

export function useBookMetadataSource(bookId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['books', bookId, 'metadata-source'],
    queryFn: () => apiGet<{ data: import('@bookdock/shared').BookMetadataSourceRes }>(`/books/${bookId}/metadata-source`),
    enabled: Boolean(bookId) && enabled,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
}

export function useCatalogVersionMetadataSource(
  libraryId: string | null,
  libraryBookId: string | null,
  versionLinkId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ['libraries', libraryId, 'catalog', libraryBookId, versionLinkId, 'metadata-source'],
    queryFn: () => apiGet<{ data: import('@bookdock/shared').CatalogVersionMetadataSourceRes }>(
      `/libraries/${libraryId}/books/${libraryBookId}/versions/${versionLinkId}/metadata-source`,
    ),
    enabled: Boolean(libraryId && libraryBookId && versionLinkId) && enabled,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
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
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book'] })
      void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
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

export function useToggleTagHidden() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) => apiPut(`/tags/${id}`, { hidden }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book'] })
      void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      queryClient.invalidateQueries({ queryKey: ['books'] })
    },
    onError: (error) => notify.error(getUserErrorNotification(error, 'library.taxonomyVisibilityFailed')),
  })
}

export function useDeleteTag() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => apiDelete<{ data: null }>(`/tags/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book'] })
      void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
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
        tagIds !== undefined ? apiPut<{ data: null }>(`/books/${bookId}/tags`, { tagIds }) : Promise.resolve(),
      ])
    },
    onSuccess: async (_result, { bookId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['books'] }),
        queryClient.invalidateQueries({ queryKey: ['book', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['shelves'] }),
        queryClient.invalidateQueries({ queryKey: ['tags'] }),
        queryClient.invalidateQueries({ queryKey: ['batch-selection'] }),
      ])
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
      queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
      const failed = results.filter((r) => r.status === 'rejected').length
      if (failed > 0) {
        const succeeded = results.length - failed
        const showResult = succeeded > 0 ? notify.warning : notify.error
        showResult({
          key: succeeded > 0 ? 'library.moveBooksPartial' : 'library.moveBooksFailed',
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
