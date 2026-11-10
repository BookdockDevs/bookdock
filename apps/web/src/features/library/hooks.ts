import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryObserverResult } from '@tanstack/react-query'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import {
  extractVersionNameFromFileName,
  type AppendContentPreviewRes,
  type BookDetailRes,
  type BookListItem,
  type BookListRes,
  type BookUploadRes,
  type ClientBookRef,
  type ClientCategoryView,
  type ClientCatalogAttributes,
  type ClientLibraryBookView,
  type ClientLibraryDetailView,
  type ClientLibraryListView,
  type ClientTaxonomyView,
  PAGINATION,
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
  type UndoReceipt,
} from '@bookdock/shared'

import { apiDelete, apiGet, apiPatch, apiPost, apiPut, apiUpload, BASE_URL } from '@/api/client'
import { READING_RECORDS_KEY } from '@/api/hooks/reading-records'
import { tocBasePath, invalidateCityVersionQueries, type TocTarget } from '@/api/hooks/useTocRules'
import { invalidateActivityQueries } from '@/features/activity/hooks'
import { useAuthStore } from '@/stores/auth.store'
import { getAuthSessionRevision } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'
import { interactionRequestId } from '@/lib/interaction-request'
import { withReveal } from '@/lib/reveal-hidden'
import i18n from '@/i18n/i18n'
import { useLocalCatalog, type LocalCatalogSource } from '@/features/reading-data/catalog-source-context'
import { isDeviceBook, partitionByStore } from '@/features/reading-data/book-source'
import { useDataAuthority } from '@/features/reading-data/data-authority'
import { useCatalogRevealHidden } from '@/features/reading-data/useCatalogRevealHidden'
import { useVaultCapable } from '@/features/reading-data/vault-availability'
import { clientScopeKey } from '@bookdock/shared'
import { catalogQueryKey } from '../reading-data/catalog'
import { DEVICE_VAULT_SCOPE, localCatalogOperations } from '../local-library/catalog'
import { deviceMembershipCounts, localCatalogBookView, localCatalogDetailView, localTaxonomyViews } from '../local-library/catalog-view'
import { guardedRemoteCatalogRead } from '../reading-data/remote-catalog'
import type { BookRow } from './book-row'
import { mergeUnifiedRows } from '../reading-data/unified-catalog'
import { localRecordId } from '../local-library/id'
import { publishUndoOpportunity } from '@/lib/undo'
import { getErrorKeyByCode, getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { fetchSettings, readStoredSettings, writeStoredSettings } from '@/lib/settings-cache'
import { saveLibrariesSnapshot, saveLibraryCategoriesSnapshot, saveLibraryTagsSnapshot, saveShelvesSnapshot, saveTagsSnapshot } from '@/lib/library-name-cache'

export { buildBooksPath, booksQueryParts, type UseBooksParams } from './catalog-query'
import { booksQueryParts, buildBooksPath, type UseBooksParams } from './catalog-query'

const DEVICE_VAULT_PAGE_SIZE = PAGINATION.MAX_PAGE_SIZE
const DEVICE_VAULT_PAGE_CAP = 20

/**
 * The one place a component asks for the device vault. A reader or editor
 * surface pinned to a single device book supplies its own operations through
 * the source context; every other surface binds the device vault directly.
 * Callers never branch on which one answered.
 */
export function useVaultOperations() {
  const local = useLocalCatalog()
  const contextOperations = local?.operations
  return useMemo(() => contextOperations ?? localCatalogOperations(DEVICE_VAULT_SCOPE), [contextOperations])
}

function useVaultScope() {
  const local = useLocalCatalog()
  return local?.scope ?? DEVICE_VAULT_SCOPE
}

async function seedLocalCoverQueries(
  queryClient: QueryClient | undefined,
  rows: readonly ClientLibraryBookView[],
  readCovers: (refs: readonly ClientBookRef[]) => Promise<Map<string, Blob | null>> = (refs) => localCatalogOperations(DEVICE_VAULT_SCOPE).getCovers(refs),
) {
  if (!queryClient || rows.length === 0) return
  const missing: ClientLibraryBookView[] = []
  for (const row of rows) {
    if (!row.ref || !isDeviceBook(row.ref)) continue
    const key = catalogQueryKey(row.ref.scope, 'cover', [row.ref.bookId, row.clientVersion])
    if (queryClient.getQueryData(key) === undefined) missing.push(row)
  }
  if (missing.length === 0) return
  try {
    const covers = await readCovers(missing.map((row) => row.ref!))
    for (const row of missing) {
      const ref = row.ref!
      if (!covers.has(ref.bookId)) continue
      queryClient.setQueryData(catalogQueryKey(ref.scope, 'cover', [ref.bookId, row.clientVersion]), covers.get(ref.bookId) ?? null)
    }
  } catch {
    // Cover pre-seeding is best-effort; SourceBookCover falls back to per-card fetch.
  }
}

async function fetchVaultRows(params: UseBooksParams, signal?: AbortSignal): Promise<{ rows: ClientLibraryBookView[]; total: number; totalSize: number | null }> {
  const vault = localCatalogOperations(DEVICE_VAULT_SCOPE)
  const rows: ClientLibraryBookView[] = []
  let total = 0
  let totalSize: number | null = 0
  for (let p = 1; p <= DEVICE_VAULT_PAGE_CAP; p++) {
    const page = await vault.list({ ...params, page: p, pageSize: DEVICE_VAULT_PAGE_SIZE }, signal)
    if (!page.organization) throw new Error("Local catalog organization is unavailable")
    rows.push(...page.entries.map((entry) => localCatalogBookView(entry.book, entry.state, page.organization!)))
    total = page.total
    totalSize = page.totalSize
    if (rows.length >= total) break
  }
  return { rows, total, totalSize }
}

/**
 * The one merged read: device rows first, then the server pages the requested
 * page needs. `tolerateRemoteFailure` is the difference between rendering (the
 * shelf keeps the vault rows when the server cannot be read) and validating (a
 * search submit must fail loudly when the server rejects the expression).
 */
async function fetchUnifiedList(
  params: UseBooksParams,
  signedIn: boolean,
  signal?: AbortSignal,
  options?: { tolerateRemoteFailure?: boolean; queryClient?: QueryClient },
): Promise<ClientLibraryListView> {
  const includeLocal = params.source !== 'server'
  const includeServer = signedIn && params.source !== 'local'
  const vaultRows = includeLocal
    ? await fetchVaultRows(params, signal)
    : { rows: [] as ClientLibraryBookView[], total: 0, totalSize: 0 }
  // No device book in this view (or filtered to server-only) means the shelf IS the server shelf:
  // one request, the server's own collation and paging, and the server's own failure.
  if (vaultRows.total === 0 && includeServer) {
    return guardedRemoteCatalogRead<BookListRes>(buildBooksPath(params), signal)
  }
  let remoteRows: ClientLibraryBookView[] = []
  let remoteTotal = 0
  let remoteTotalSize: number | null = 0
  let remoteFailed = false
  if (includeServer) {
    for (let p = 1; p <= params.page; p++) {
      try {
        const res = await guardedRemoteCatalogRead<BookListRes>(buildBooksPath({ ...params, page: p }), signal)
        remoteRows.push(...res.data)
        remoteTotal = res.total
        remoteTotalSize = res.totalSize ?? 0
        if (res.data.length === 0) break
      } catch (error) {
        if (signal?.aborted || options?.tolerateRemoteFailure === false) throw error
        remoteFailed = true
        break
      }
    }
  }
  const rows = mergeUnifiedRows([...remoteRows, ...vaultRows.rows] as BookRow[], params.sortBy, params.sortOrder as 'asc' | 'desc') as ClientLibraryBookView[]
  const start = (params.page - 1) * params.pageSize
  const pageRows = rows.slice(start, start + params.pageSize)
  await seedLocalCoverQueries(options?.queryClient, pageRows)
  return {
    data: pageRows,
    total: vaultRows.total + (remoteFailed ? remoteRows.length : remoteTotal),
    totalSize: (vaultRows.totalSize ?? 0) + (remoteFailed ? 0 : remoteTotalSize),
    page: params.page,
    pageSize: params.pageSize,
  }
}

/**
 * Validates a search expression against the list the shelf will actually show,
 * and hands the result to the same cache entry `useUnifiedBooks` reads so an
 * accepted expression never costs a second request. A device-only reader (guest
 * included) searches the vault, not a server it cannot reach.
 */
export async function loadUnifiedSearchPage(queryClient: QueryClient, params: UseBooksParams, signedIn: boolean, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false
  const queryKey = [...booksQueryParts(params).queryKey, 'unified']
  const cached = queryClient.getQueryState(queryKey)
  if (cached?.status === 'success' && !cached.isInvalidated) return true
  const page = await fetchUnifiedList(params, signedIn, signal, { tolerateRemoteFailure: false, queryClient })
  if (signal.aborted) return false
  queryClient.setQueryData(queryKey, page)
  return true
}
export async function loadSearchPage(queryClient: QueryClient, request: { queryKey: readonly unknown[]; path: string }, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false
  const cached = queryClient.getQueryState(request.queryKey)
  if (cached?.status === 'success' && !cached.isInvalidated) return true
  let result: unknown
  try {
    result = await guardedRemoteCatalogRead(request.path, signal)
  } catch (error) {
    if (signal.aborted) return false
    throw error
  }
  if (signal.aborted) return false
  queryClient.setQueryData(request.queryKey, result)
  return true
}

export function useBooks(params: UseBooksParams, options?: { enabled?: boolean }): QueryObserverResult<ClientLibraryListView> {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const local = useLocalCatalog()
  const vault = useVaultOperations()
  const vaultScope = useVaultScope()
  const { queryKey, path } = booksQueryParts(params)
  return useQuery({
    networkMode: local ? 'always' : 'online',
    queryKey: local ? catalogQueryKey(vaultScope, 'list', params) : queryKey,
    queryFn: async ({ signal }) => {
      if (local) {
        const page = await vault.list(params, signal)
        if (!page.organization) throw new Error("Local catalog organization is unavailable")
        const data = page.entries.map((entry) => localCatalogBookView(entry.book, entry.state, page.organization!))
        await seedLocalCoverQueries(queryClient, data, (refs) => vault.getCovers(refs))
        return { data, total: page.total, totalSize: page.totalSize, page: params.page, pageSize: params.pageSize }
      }
      return guardedRemoteCatalogRead<BookListRes>(path, signal)
    },
    enabled: Boolean(local || user) && (options?.enabled ?? true),
    // Never show another domain's rows: trash and active lists are different
    // queries even when the key has not caught up yet. Same for the vault
    // reveal flag: a still-cached hidden-filtered page must not stand in.
    placeholderData: (prev, prevQuery) => {
      if (local) return undefined
      const prevParams = prevQuery?.queryKey[1] as UseBooksParams | undefined
      return prevParams && prevParams.source === params.source && prevParams.trash === params.trash && prevParams.showHidden === params.showHidden ? prev : undefined
    },
  })
}

/**
 * Warms the entry the shelf reads. There is one shelf, so there is one prefetch:
 * a row hovered in the sidebar never asks for a list the shelf will not show.
 */
export function prefetchBooks(queryClient: QueryClient, params: UseBooksParams) {
  return queryClient.prefetchQuery({
    networkMode: 'always',
    queryKey: [...booksQueryParts(params).queryKey, 'unified'],
    queryFn: ({ signal }) => fetchUnifiedList(params, Boolean(useAuthStore.getState().user), signal, { queryClient }),
  })
}

/**
 * The shelf. One list over the server catalog and the device vault: a book's
 * storage location is an attribute of the row, never a filter or a second
 * shelf, so this hook has no source parameter. Server pages are read up to the
 * current page and merged client-side with an id tiebreak; when the server
 * cannot be read the vault rows still render.
 */
export function useUnifiedBooks(params: UseBooksParams, options?: { enabled?: boolean }): QueryObserverResult<ClientLibraryListView> {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const { queryKey } = booksQueryParts(params)
  const mergedQuery = useQuery<ClientLibraryListView>({
    networkMode: 'always',
    queryKey: [...queryKey, 'unified'],
    queryFn: ({ signal }) => fetchUnifiedList(params, Boolean(user), signal, { queryClient }),
    enabled: options?.enabled ?? true,
    placeholderData: (prev, prevQuery) => {
      const prevParams = prevQuery?.queryKey[1] as UseBooksParams | undefined
      return prevParams && prevParams.source === params.source && prevParams.trash === params.trash && prevParams.showHidden === params.showHidden ? prev : undefined
    },
  })
  return mergedQuery
}

export type UploadItemStatus = 'pending' | 'queued' | 'uploading' | 'processing' | 'success' | 'duplicate' | 'corresponding' | 'error'

export interface UploadItem {
  id: string
  operationId?: string
  name: string
  file: File
  status: UploadItemStatus
  /** Upload progress 0-100; stays 100 while the server parses the book */
  progress: number
  shelfId?: string
  categoryId?: string
  tagIds?: string[]
  /** The unified shelf queues both destinations in one batch; the row decides. */
  destination?: 'local' | 'server'
  bookRef?: ClientBookRef
  /** Edition label for a catalog upload into an existing work (P3). */
  versionName?: string
  /** i18n key resolved client-side; raw server messages are never displayed */
  messageKey?: string
  /** Set once the server answers; the id the reader opens. */
  bookVersionId?: string
  corresponding?: BookUploadRes['corresponding']
  allowCorresponding?: boolean
}

export interface UploadAssignment {
  shelfId?: string
  categoryId?: string
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
  /** Shared-library activity scope affected by successful uploads. */
  activityLibraryId?: string
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

/**
 * A device mutation changes more than the vault caches. The shelf, the shelves
 * and tags lists and the library category tree all print counts derived from
 * device books by id, so they refresh together. The category tree is a server
 * read, so it is only touched when there is a session to answer it.
 */
export function invalidateDeviceMembershipQueries(queryClient: QueryClient) {
  // Refresh the merged shelf (`unified`), guest-mode vault taxonomies (`device`),
  // and the reactive `membership-counts` overlay consumed by the sidebar and
  // taxonomy directory. Server-owned taxonomy caches stay pure so competing
  // observers never overwrite overlaid counts and local moves avoid extra HTTP.
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const [root, sub] = query.queryKey
      if (root === 'books') return query.queryKey[query.queryKey.length - 1] === 'unified'
      if (root === 'shelves' || root === 'tags') return sub === 'device'
      if (root === 'client-catalog') {
        const parts = query.queryKey
        return parts[parts.length - 1] === 'membership-counts'
      }
      return false
    },
  })
}

/**
 * The device half of every sidebar number: totals for the aggregate rows and
 * per-node counts for the shelf, category and tag trees. Read from the books,
 * never from a device-owned tree, because a device book files itself into
 * whichever tree the reader is looking at.
 */
export function useDeviceMembershipCounts(options: { enabled?: boolean } = {}) {
  const vault = useVaultOperations()
  const scope = useVaultScope()
  const { data } = useQuery({
    networkMode: 'always',
    queryKey: catalogQueryKey(scope, 'membership-counts'),
    queryFn: async () => deviceMembershipCounts(await vault.readCatalog()),
    enabled: options.enabled ?? true,
    staleTime: Infinity,
  })
  return data
}


export function invalidatePermanentlyDeletedBookQueries(queryClient: QueryClient) {
  return Promise.all([
    ...BOOK_MEMBERSHIP_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    queryClient.invalidateQueries({ queryKey: ['book'] }),
    queryClient.invalidateQueries({ queryKey: ['archive'] }),
    queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY }),
    queryClient.invalidateQueries({ queryKey: ['progress'] }),
    queryClient.invalidateQueries({ queryKey: ['annotations'] }),
    queryClient.invalidateQueries({ queryKey: ['note-archive'] }),
    queryClient.invalidateQueries({ queryKey: ['notifications'] }),
    queryClient.invalidateQueries({ queryKey: ['reviews'] }),
  ])
}

const PRIVATE_UPLOAD_TARGET: UploadTarget = {
  url: '/books',
  fields: (item) => ({
    ...(item.allowCorresponding ? { allowCorresponding: 'true' } : {}),
    ...(item.shelfId ? { shelfId: item.shelfId } : {}),
    ...(item.categoryId ? { categoryId: item.categoryId } : {}),
    ...(item.tagIds?.length ? { tagIds: JSON.stringify(item.tagIds) } : {}),
  }),
  invalidateKeys: [...BOOK_MEMBERSHIP_KEYS, ['libraries']],
  reportsAppliedShelf: true,
  pickBookId: (body) => (body as { data?: { id?: string } } | null)?.data?.id,
}

/** Instance-level upload limit (read-only, injected by GET /settings). */
export function useUploadSettings() {
  const local = useLocalCatalog()
  const user = useAuthStore((state) => state.user)
  const deviceNormalizeTitle = useUiStore((state) => state.deviceNormalizeTitle)
  const { data } = useQuery({
    networkMode: local ? 'always' : 'online',
    enabled: !local && Boolean(user),
    queryKey: ['settings'],
    queryFn: fetchSettings,
  })
  return {
    maxBytes: local ? undefined : data?.data.uploadMaxBytes,
    normalizeTitle: user ? data?.data.library?.normalizeTitle !== false : deviceNormalizeTitle,
  }
}

/**
 * The side that owns the trash policy. One policy, one owner: the account when
 * there is an account, the device vault for a guest. A surface pinned to the
 * vault (reader, content editor) answers from that same vault, because
 * data-authority already resolves it that way.
 *
 * fallbackAnonymous only decides whether a surface with no pinned context may
 * read the vault at all; it is not a second opinion about ownership.
 */
function useTrashPolicyDevice(fallbackAnonymous: boolean) {
  const context = useLocalCatalog()
  const authority = useDataAuthority()
  const user = useAuthStore((state) => state.user)
  // A pinned context names its own side and is always read. Without one, a
  // guest reads the vault only when the caller opts in with fallbackAnonymous.
  return authority && (Boolean(context) || Boolean(user) || fallbackAnonymous) ? authority : null
}

/** Trash feature switch; respects user settings, cached settings, and stays disabled while loading without cache. */
export function useTrashEnabled(options: { enabled?: boolean; fallbackAnonymous?: boolean } = {}): boolean {
  const user = useAuthStore((state) => state.user)
  const device = useTrashPolicyDevice(options.fallbackAnonymous === true)
  const isEnabled = options.enabled !== false
  const { data } = useQuery({
    networkMode: 'always',
    // The presence of `device` is part of the cache key: switching owners must
    // not serve the previous owner's policy from the other key.
    queryKey: device ? catalogQueryKey(device.scope, 'trash-settings') : ['settings'],
    queryFn: async () => device
      ? device.operations.getTrashSettings().then((trash) => ({ data: { trash } }))
      : fetchSettings(),
    enabled: isEnabled && (Boolean(device) || Boolean(user)),
  })
  if (!isEnabled) return false
  if (!data?.data) return Boolean(device)
  return data.data.trash?.enabled !== false
}

/** Trash size cap in bytes; undefined when unlimited (0 or unset) or when disabled. */
export function useTrashCapBytes(options: { enabled?: boolean; fallbackAnonymous?: boolean } = {}): number | undefined {
  const user = useAuthStore((state) => state.user)
  const device = useTrashPolicyDevice(options.fallbackAnonymous === true)
  const isEnabled = options.enabled !== false
  const { data } = useQuery({
    networkMode: 'always',
    queryKey: device ? catalogQueryKey(device.scope, 'trash-settings') : ['settings'],
    queryFn: async () => device
      ? device.operations.getTrashSettings().then((trash) => ({ data: { trash } }))
      : fetchSettings(),
    enabled: isEnabled && (Boolean(device) || Boolean(user)),
  })
  if (!isEnabled) return undefined
  const cap = data?.data.trash?.maxTrashBytes
  return cap && cap > 0 ? cap : undefined
}

/**
 * Retention window for the trash. The window is one setting, not one per book:
 * the account holds it when there is an account (which is where every trashed
 * row is judged, device rows included), and the device vault holds it for a
 * guest. Reading it per row would quietly reintroduce a second policy.
 *
 * A guest must never probe /settings — it answers 401, the unauthorized handler
 * bounces the page to /login, and the device trash would be unreachable.
 */
export function useTrashAutoCleanDays(enabled = true): number | undefined {
  const device = useTrashPolicyDevice(true)
  const { data } = useQuery({
    networkMode: 'always',
    queryKey: device ? catalogQueryKey(device.scope, 'trash-settings') : ['settings'],
    queryFn: async () => device
      ? device.operations.getTrashSettings().then((trash) => ({ data: { trash } }))
      : fetchSettings(),
    enabled,
  })
  return data?.data.trash?.autoCleanDays
}

/**
 * Libraries visible to the caller: own private library first, then shared. Each
 * row carries the caller's relation to it, so the sidebar can offer "join" or
 * "manage" per row without a request per library.
 */
export function useLibraries(options?: { enabled?: boolean }) {
  const local = useLocalCatalog()
  const user = useAuthStore((state) => state.user)
  return useQuery({
    networkMode: local ? 'always' : 'online',
    queryKey: local ? catalogQueryKey(local.scope, 'remote-libraries') : ['libraries'],
    queryFn: async ({ signal }) => {
      const userId = user?.id
      const sessionRevision = getAuthSessionRevision()
      const result = await apiGet<{ data: LibraryListItem[] }>('/libraries', signal)
      if (!signal.aborted && userId && useAuthStore.getState().user?.id === userId && getAuthSessionRevision() === sessionRevision) {
        saveLibrariesSnapshot(userId, result.data)
      }
      return result
    },
    enabled: !local && (options?.enabled ?? true),
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
  const local = useDataAuthority()
  const { revealHidden: showHidden } = useCatalogRevealHidden()
  const user = useAuthStore((state) => state.user)
  const vault = useVaultOperations()
  return useQuery<{ data: ClientCategoryView[] }>({
    networkMode: local ? 'always' : 'online',
    queryKey: local ? catalogQueryKey(local.scope, 'categories', showHidden) : ['libraries', libraryId, 'categories'],
    queryFn: async ({ signal }) => {
      if (local) {
        const snapshot = await local.operations.readCatalog()
        signal.throwIfAborted()
        return { data: localTaxonomyViews(snapshot, showHidden).categories }
      }
      const userId = user?.id
      const sessionRevision = getAuthSessionRevision()
      const result = await apiGet<{ data: Category[] }>(`/libraries/${libraryId}/categories`, signal)
      if (!signal.aborted && userId && libraryId && useAuthStore.getState().user?.id === userId && getAuthSessionRevision() === sessionRevision) {
        saveLibraryCategoriesSnapshot(userId, libraryId, result.data)
      }
      void vault.mirrorOrganization(result.data.map((item) => ({ id: item.id, kind: 'category' as const, name: item.name, parentId: item.parentId, pinned: item.pinned, hidden: item.hidden, sortOrder: item.sortOrder, createdAt: item.createdAt, updatedAt: item.updatedAt }))).catch(() => {})
      return result
    },
    enabled: (options?.enabled ?? true) && Boolean(local || libraryId),
  })
}

export function useLibraryTags(libraryId: string | null, options?: { enabled?: boolean }) {
  const user = useAuthStore((state) => state.user)
  return useQuery({
    queryKey: ['libraries', libraryId, 'tags'],
    queryFn: async ({ signal }) => {
      const userId = user?.id
      const sessionRevision = getAuthSessionRevision()
      const result = await apiGet<{ data: LibraryTag[] }>(`/libraries/${libraryId}/tags`, signal)
      if (!signal.aborted && userId && libraryId && useAuthStore.getState().user?.id === userId && getAuthSessionRevision() === sessionRevision) {
        saveLibraryTagsSnapshot(userId, libraryId, result.data)
      }
      return result
    },
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
      void invalidateActivityQueries(queryClient, vars.libraryId)
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
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
        void queryClient.invalidateQueries({ queryKey: ['reviews'] })
        void queryClient.invalidateQueries({ queryKey: ['archive'] })
        void invalidateActivityQueries(queryClient, vars.libraryId)
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
function useTaxonomyMutation<TVars extends { libraryId: string | null }, TData = unknown>(
  build: (vars: TVars) => { url: string; method: 'post' | 'patch' | 'delete'; body?: unknown; successKey?: string },
  localMutation?: (source: LocalCatalogSource, vars: TVars) => Promise<{ data: TData }>,
) {
  const queryClient = useQueryClient()
  const local = useDataAuthority()
  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: (vars: TVars) => {
      if (local) {
        if (!localMutation) throw new Error('This operation requires a remote library')
        return localMutation(local, vars)
      }
      if (!vars.libraryId) throw new Error('A remote library identity is required')
      const { url, method, body } = build(vars)
      if (method === 'delete') return apiDelete<{ data: TData }>(url)
      if (method === 'patch') return apiPatch<{ data: TData }>(url, body)
      return apiPost<{ data: TData }>(url, body)
    },
    onSuccess: (_res, vars) => {
      const key = build(vars).successKey
      if (key) notify.success({ key })
      if (local) {
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.scope)] })
        invalidateDeviceMembershipQueries(queryClient)
        return
      }
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'tags'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book'] })
      void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
      void queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
    },
    onError: (error) => notify.error(getUserErrorNotification(error)),
  })
}

export function useCreateLibraryCategory() {
  return useTaxonomyMutation<{ libraryId: string | null; name: string; parentId?: string }, ClientCategoryView>(({ libraryId, name, parentId }) => ({
    url: `/libraries/${libraryId}/categories`, method: 'post', body: { name, parentId }, successKey: 'toast.categoryCreated',
  }), async (source, { name, parentId }) => ({ data: { ...await source.operations.createOrganization('category', name, parentId ?? null), bookCount: 0, subtreeBookCount: 0 } }))
}

export function useUpdateLibraryCategory() {
  return useTaxonomyMutation<{ libraryId: string | null; categoryId: string; patch: { name?: string; parentId?: string | null; pinned?: boolean; hidden?: boolean } }, ClientCategoryView>(
    ({ libraryId, categoryId, patch }) => ({
      url: `/libraries/${libraryId}/categories/${categoryId}`, method: 'patch', body: patch,
      successKey: patch.name !== undefined || patch.parentId !== undefined ? 'toast.categoryUpdated' : undefined,
    }),
    async (source, { categoryId, patch }) => {
      await source.operations.updateOrganization('category', categoryId, patch)
      const data = localTaxonomyViews(await source.operations.readCatalog(), true).categories.find((item) => item.id === categoryId)
      if (!data) throw new Error('Category no longer exists')
      return { data }
    },
  )
}

export function useDeleteLibraryCategory() {
  return useTaxonomyMutation<{ libraryId: string | null; categoryId: string }>(({ libraryId, categoryId }) => ({
    url: `/libraries/${libraryId}/categories/${categoryId}`, method: 'delete', successKey: 'toast.categoryDeleted',
  }), async (source, { categoryId }) => { await source.operations.deleteOrganization('category', categoryId); return { data: null } })
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
  const local = useDataAuthority()
  const queryClient = useQueryClient()
  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: async ({ libraryId, categoryIds }: { libraryId: string | null; categoryIds: string[] }) => {
      if (local) { await local.operations.reorderOrganization('category', categoryIds); return { data: null } }
      if (!libraryId) throw new Error('A remote library identity is required')
      return apiPut<{ data: null }>(`/libraries/${libraryId}/categories/order`, { categoryIds })
    },
    onMutate: ({ libraryId, categoryIds }) => {
      if (local) return undefined
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
    onSettled: (_data, _error, vars) => {
      if (local) { void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.scope)] }); invalidateDeviceMembershipQueries(queryClient); return }
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'categories'] })
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
    onSettled: (_data, _error, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'tags'] })
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
  expression?: string
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
export function catalogQueryParts(libraryId: string, params: CatalogListParams) {
  const key = {
    page: params.page ?? 1,
    pageSize: params.pageSize,
    expression: params.expression ?? '',
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
  if (key.expression) search.set('expression', key.expression)
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
  return { key, queryKey: ['libraries', libraryId, 'catalog', key] as const, path: `/libraries/${libraryId}/books?${search.toString()}` }
}

export function useLibraryCatalog(libraryId: string | null, params: CatalogListParams = {}, options?: { enabled?: boolean }) {
  const { queryKey, path } = catalogQueryParts(libraryId ?? '', params)
  return useQuery({
    queryKey,
    queryFn: ({ signal }) => apiGet<{ data: CatalogListRes }>(path, signal),
    enabled: !!libraryId && (options?.enabled ?? true),
    // Keep the previous page while the same library reloads, but never show
    // another library's cards under the new library's actions: the key carries
    // the library id, yet the data belongs to the query that fetched it.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === libraryId ? prev : undefined),
  })
}

export function prefetchLibraryCatalog(queryClient: QueryClient, libraryId: string, params: CatalogListParams) {
  const { queryKey, path } = catalogQueryParts(libraryId, params)
  return queryClient.prefetchQuery({
    queryKey,
    queryFn: () => apiGet<{ data: CatalogListRes }>(path),
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
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.moveBooksFailed'))
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
        ? apiDelete<{ data: unknown; undo?: UndoReceipt }>(url)
        : apiPatch<{ data: unknown; undo?: UndoReceipt }>(url, body)
    },
    onSuccess: (_res, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'catalog'] })
      // Removing the last version of a work removes the work, and with it the
      // category row and the tag links the sidebar counts.
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'categories'] })
      void queryClient.invalidateQueries({ queryKey: ['libraries', vars.libraryId, 'tags'] })
      if (build(vars).method === 'delete' && (_res as { data?: { trashed?: boolean } }).data?.trashed !== true) {
        void invalidatePermanentlyDeletedBookQueries(queryClient)
      }
      if (build(vars).method === 'delete') void invalidateActivityQueries(queryClient, vars.libraryId)
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
        invalidateActivityQueries(queryClient, vars.libraryId),
      ])
    },
  })
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
      void invalidateActivityQueries(queryClient, vars.libraryId)
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
      void invalidatePermanentlyDeletedBookQueries(queryClient)
      void invalidateActivityQueries(queryClient, vars.libraryId)
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
      if (result.data.count > 0) void invalidatePermanentlyDeletedBookQueries(queryClient)
      if (result.data.count > 0) void invalidateActivityQueries(queryClient, vars.libraryId)
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
      void queryClient.invalidateQueries({ queryKey: ['libraries'] })
      void queryClient.invalidateQueries({ queryKey: ['shelves'] })
      void queryClient.invalidateQueries({ queryKey: ['tags'] })
      void queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
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
      if (!res.data.alreadyUpToDate) void invalidateActivityQueries(queryClient, vars.libraryId)
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
      void invalidateActivityQueries(queryClient, vars.libraryId)
    },
  })
}

export interface LibraryPrefsState {
  prefs: SettingsRes['library']
  isReady: boolean
  isLoading: boolean
  isError: boolean
  isFetching: boolean
  refetch: () => Promise<unknown>
}

/**
 * Per-user library preferences with readiness state.
 * For guests, returns isReady: true with undefined prefs.
 * For authenticated users, isReady is true only when matching cached
 * or freshly fetched settings exist.
 */
export function useLibraryPrefsState(): LibraryPrefsState {
  const user = useAuthStore((state) => state.user)
  const local = useLocalCatalog()
  const vault = useVaultOperations()
  const vaultScope = useVaultScope()
  const isGuest = !user && !local
  const query = useQuery<{ data: SettingsRes }>({
    networkMode: local || !user ? 'always' : 'online',
    queryKey: local ? catalogQueryKey(local.scope, 'preferences') : !local && !user ? catalogQueryKey(vaultScope, 'preferences') : ['settings'],
    queryFn: async () => local
      ? local.operations.getCatalogPreferences().then((library) => ({ data: { library } }))
      : !local && !user
        ? vault.getCatalogPreferences().then((library) => ({ data: { library } }))
        : fetchSettings(),
    enabled: true,
  })

  // Anonymous unified shelf: vault catalog preferences are the prefs. A vault
  // read that failed must not hold the shelf on a skeleton forever — the
  // defaults are the same thing an empty vault would give.
  if (isGuest && !local) {
    return {
      prefs: query.data?.data.library,
      isReady: query.data !== undefined || query.isError,
      isLoading: query.isLoading,
      isError: query.isError,
      isFetching: query.isFetching,
      refetch: query.refetch,
    }
  }

  return {
    prefs: query.data?.data.library,
    isReady: query.data !== undefined,
    isLoading: query.isLoading,
    isError: query.isError,
    isFetching: query.isFetching,
    refetch: query.refetch,
  }
}

/** Per-user library preferences (N-06 default sort modes, view, title normalization). */
export function useLibraryPrefs(): SettingsRes['library'] {
  return useLibraryPrefsState().prefs
}

export interface ProfileSettingsState {
  profile: NonNullable<SettingsRes['profile']> | undefined
  isReady: boolean
  isLoading: boolean
  isError: boolean
  isFetching: boolean
  refetch: () => Promise<unknown>
}

/** Per-user profile settings with readiness state. */
export function useProfileSettingsState(): ProfileSettingsState {
  const user = useAuthStore((state) => state.user)
  const isGuest = !user
  const query = useQuery<{ data: SettingsRes }>({
    enabled: Boolean(user),
    queryKey: ['settings'],
    queryFn: fetchSettings,
  })

  if (isGuest) {
    return {
      profile: undefined,
      isReady: true,
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: async () => {},
    }
  }

  const stored = user ? readStoredSettings(user.id) : null
  const profile = query.data?.data.profile ?? stored?.profile

  return {
    profile,
    isReady: profile !== undefined || query.data !== undefined,
    isLoading: query.isLoading && profile === undefined,
    isError: query.isError && profile === undefined,
    isFetching: query.isFetching,
    refetch: query.refetch,
  }
}

/** Per-user profile settings used by the account settings dialog. */
export function useProfileSettings(): NonNullable<SettingsRes['profile']> {
  return useProfileSettingsState().profile ?? {}
}

/** Partial update of the profile blob, with field-level optimistic merge and
 *  rollback. Serialized through a promise queue with refetchQueries on settlement
 *  to guarantee localStorage and cache converge with server state. */
export function useUpdateProfileSettings() {
  const queryClient = useQueryClient()
  const userId = useAuthStore((state) => state.user?.id)
  const profileWriteQueueRef = useRef(Promise.resolve())
  const activeWritesCountRef = useRef(0)

  return useMutation({
    mutationFn: (patch: NonNullable<SettingsRes['profile']>) => {
      const request = profileWriteQueueRef.current.then(() => apiPut('/settings', { profile: patch }))
      profileWriteQueueRef.current = request.then(() => undefined, () => undefined)
      return request
    },
    onMutate: async (patch) => {
      activeWritesCountRef.current += 1
      await queryClient.cancelQueries({ queryKey: ['settings'] })
      const prev = queryClient.getQueryData<{ data: SettingsRes }>(['settings'])
      const patchFields = Object.keys(patch) as Array<keyof NonNullable<SettingsRes['profile']>>
      const prevFieldValues: Partial<NonNullable<SettingsRes['profile']>> = {}
      if (prev?.data?.profile) {
        for (const field of patchFields) {
          prevFieldValues[field] = prev.data.profile[field]
        }
      }
      if (prev) {
        const next = { ...prev.data, profile: { ...prev.data.profile, ...patch } }
        queryClient.setQueryData(['settings'], { data: next })
        writeStoredSettings(next)
      }
      return { patch, prevFieldValues }
    },
    onError: (error, _patch, ctx) => {
      if (ctx) {
        const currentData = queryClient.getQueryData<{ data: SettingsRes }>(['settings'])
        if (currentData?.data?.profile) {
          const restoredProfile = { ...currentData.data.profile }
          let changed = false
          for (const key of Object.keys(ctx.patch) as Array<keyof NonNullable<SettingsRes['profile']>>) {
            // Only roll back if the field still holds the optimistic value written by this patch
            if (restoredProfile[key] === ctx.patch[key]) {
              restoredProfile[key] = ctx.prevFieldValues[key] as never
              changed = true
            }
          }
          if (changed) {
            const next = { ...currentData.data, profile: restoredProfile }
            queryClient.setQueryData(['settings'], { data: next })
            writeStoredSettings(next)
          }
        }
      }
      notify.error(getUserErrorNotification(error, 'settings.profilePrefsUpdateFailed'))
    },
    onSettled: (_data, _error, patch) => {
      activeWritesCountRef.current = Math.max(0, activeWritesCountRef.current - 1)
      if (activeWritesCountRef.current === 0) {
        // Force refetchQueries to guarantee sync even when no active query observer exists
        void queryClient.refetchQueries({ queryKey: ['settings'] })
        if (userId) void queryClient.invalidateQueries({ queryKey: ['reviews', 'author', userId] })
      }
      if ('showPublicActivity' in patch || 'isPublic' in patch) void invalidateActivityQueries(queryClient)
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
  const local = useLocalCatalog()
  const vault = useVaultOperations()
  const vaultScope = useVaultScope()
  const user = useAuthStore((state) => state.user)
  const isLocal = Boolean(local || !user)
  const preferenceKey = catalogQueryKey(vaultScope, 'preferences')
  const libraryWriteQueueRef = useRef(Promise.resolve())
  const activeWritesCountRef = useRef(0)

  return useMutation({
    networkMode: isLocal ? 'always' : 'online',
    mutationFn: (patch: NonNullable<SettingsRes['library']>) => {
      // Sort mode, display density, grid fields and hidden libraries all land
      // here, and several of them fire twice within one gesture (a drag
      // reorders and also switches the sort to manual). Serialize so a late
      // failure cannot land on top of a newer successful write.
      const request = libraryWriteQueueRef.current.then(() => isLocal ? vault.patchCatalogPreferences(patch) : apiPut('/settings', { library: patch }))
      libraryWriteQueueRef.current = request.then(() => undefined, () => undefined)
      return request
    },
    onMutate: async (patch) => {
      if (isLocal) return undefined
      activeWritesCountRef.current += 1
      await queryClient.cancelQueries({ queryKey: ['settings'] })
      const prev = queryClient.getQueryData<{ data: SettingsRes }>(['settings'])
      const patchFields = Object.keys(patch) as Array<keyof NonNullable<SettingsRes['library']>>
      // Record rather than Partial<LibrarySettings>: the blob mixes booleans,
      // string arrays and nested sort objects, and indexing Partial with a union
      // key collapses the assignment target to undefined.
      const prevFieldValues: Record<string, unknown> = {}
      if (prev?.data?.library) {
        const currentLibrary: Record<string, unknown> = { ...prev.data.library }
        for (const field of patchFields) {
          prevFieldValues[field] = currentLibrary[field]
        }
      }
      if (prev) {
        const next = { ...prev.data, library: { ...prev.data.library, ...patch } }
        queryClient.setQueryData(['settings'], {
          data: next,
        })
        writeStoredSettings(next)
      }
      return { patch, prevFieldValues }
    },
    onError: (error, _patch, ctx) => {
      // Field-level rollback: restore only the fields this patch wrote, and only
      // while they still hold this patch's optimistic value. Restoring the whole
      // settings snapshot would erase a newer successful write from another field.
      if (ctx) {
        const currentData = queryClient.getQueryData<{ data: SettingsRes }>(['settings'])
        if (currentData?.data?.library) {
          // The library blob mixes booleans, string arrays and nested sort
          // objects, so the per-field write is routed through a record and cast
          // back once, rather than narrowing every field of the union.
          const restoredLibrary: Record<string, unknown> = { ...currentData.data.library }
          let changed = false
          for (const key of Object.keys(ctx.patch) as Array<keyof NonNullable<SettingsRes['library']>>) {
            if (restoredLibrary[key] === ctx.patch[key]) {
              restoredLibrary[key] = ctx.prevFieldValues[key]
              changed = true
            }
          }
          if (changed) {
            const next = {
              ...currentData.data,
              library: restoredLibrary as NonNullable<SettingsRes['library']>,
            }
            queryClient.setQueryData(['settings'], { data: next })
            writeStoredSettings(next)
          }
        }
      }
      notify.error(getUserErrorNotification(error, 'settings.libraryPrefsUpdateFailed'))
    },
    onSettled: () => {
      if (isLocal) {
        void queryClient.invalidateQueries({ queryKey: preferenceKey })
        return
      }
      activeWritesCountRef.current = Math.max(0, activeWritesCountRef.current - 1)
      if (activeWritesCountRef.current === 0) {
        // refetchQueries, not invalidateQueries: correctness here depends on
        // reconciling localStorage with the server, and invalidate alone does
        // nothing when no ['settings'] observer is mounted.
        void queryClient.refetchQueries({ queryKey: ['settings'] })
      }
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
  const { prefs, isReady } = useLibraryPrefsState()
  const hidden = prefs?.hiddenLibraryIds
  const update = useUpdateLibraryPrefs()

  return {
    hiddenIds: hidden,
    isReady,
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
  const local = useLocalCatalog()
  const vault = useVaultOperations()
  const vaultScope = useVaultScope()
  const queryClient = useQueryClient()
  const notificationKey = useId()
  const [items, setItems] = useState<UploadItem[]>([])
  const runningRef = useRef(0)
  const settledRef = useRef(false)
  // The requests themselves, so a cancel can reach them. Kept as a set because
  // the pool holds several at once and each loadend drops its own.
  const inflightRef = useRef(new Set<XMLHttpRequest>())
  const localInflightRef = useRef(new Set<AbortController>())
  const localIngestionRef = useRef(new Map<string, { bookId: string; contentId: string; createdAt: number }>())
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
      const destination = item.destination ?? (local ? 'local' : 'server')
      if (destination === 'local') {
        const controller = new AbortController()
        localInflightRef.current.add(controller)
        const identity = localIngestionRef.current.get(item.id) ?? { bookId: localRecordId(), contentId: localRecordId(), createdAt: Date.now() }
        localIngestionRef.current.set(item.id, identity)
        patchItem(item.id, { status: 'processing', progress: 100 })
        void (async () => {
          try {
            let existing: Awaited<ReturnType<typeof vault.detail>> | null = null
            try { existing = await vault.detail({ scope: vaultScope, bookId: identity.bookId }) } catch (error) {
              if (!(error instanceof Error) || !('category' in error) || error.category !== 'unavailable-content') throw error
            }
            if (!existing) {
              const duplicate = await vault.findDuplicate?.(item.file, controller.signal)
              if (duplicate) {
                patchItem(item.id, { status: 'duplicate', progress: 100, bookRef: duplicate.ref })
                return
              }
            }
            const signedIn = Boolean(useAuthStore.getState().user)
            const normalizeTitle = signedIn
              ? (queryClient.getQueryData<{ data: SettingsRes }>(['settings'])?.data ?? readStoredSettings())?.library?.normalizeTitle !== false
              : useUiStore.getState().deviceNormalizeTitle
            const book = existing ? await vault.acknowledgeIngestion(existing.book.ref, item.file) : await vault.addFile(item.file, { ...identity, normalizeTitle, signal: controller.signal, catalog: { shelfId: item.shelfId ?? null, categoryId: item.categoryId ?? null, tagIds: item.tagIds ?? [] } })
            patchItem(item.id, { status: 'success', progress: 100, bookRef: book.ref })
          } catch {
            patchItem(item.id, { status: 'error', messageKey: controller.signal.aborted ? 'library.uploadCancelled' : 'library.uploadFailed' })
          } finally {
            localInflightRef.current.delete(controller)
            runningRef.current -= 1
          }
        })()
        return
      }
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
          let corresponding: BookUploadRes['corresponding']
          try {
            const body = JSON.parse(xhr.responseText) as Partial<BookUploadRes>
            duplicated = body.duplicated === true
            corresponding = body.corresponding
            shelfId = body.data?.shelfId
            bookVersionId = target.pickBookId?.(body)
          } catch {
            // keep false
          }
          if (corresponding) {
            patchItem(item.id, { status: 'corresponding', progress: 100, corresponding, bookVersionId: undefined })
          } else if (duplicated) {
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
    [patchItem, target, local, vault, vaultScope, queryClient],
  )

  // Scheduler: each item state change starts at most one more queued upload
  // while the concurrency pool has room; runningRef keeps the pool capped.
  useEffect(() => {
    if (runningRef.current >= UPLOAD_CONCURRENCY) return
    const localRunning = localInflightRef.current.size
    const next = items.find((it) => {
      if (it.status !== 'queued') return false
      // Device ingestion stays serialized; server uploads keep the pool.
      return (it.destination ?? (local ? 'local' : 'server')) === 'local' ? localRunning === 0 : true
    })
    if (!next) return
    uploadOne(next)
  }, [items, uploadOne, local])

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
    const hasLocal = items.some((it) => (it.destination ?? (local ? 'local' : 'server')) === 'local')
    const hasServer = items.some((it) => (it.destination ?? (local ? 'local' : 'server')) !== 'local')
    if (hasLocal) {
      void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(DEVICE_VAULT_SCOPE)] })
      if (!local) invalidateDeviceMembershipQueries(queryClient)
    }
    if (hasServer) {
      for (const key of target.invalidateKeys) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
      if (succeeded > 0 && target.activityLibraryId) void invalidateActivityQueries(queryClient, target.activityLibraryId)
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
    } else if (succeeded > 0) {
      notify.success({ key: 'library.uploadImported', params: { count: succeeded } }, { dedupeKey: `upload:${notificationKey}` })
    }
  }, [items, notificationKey, queryClient, target, local])

  const addFiles = useCallback(
    (files: FileList | File[], opts?: { autoStart?: boolean; maxBytes?: number; versionNameMode?: boolean; destination?: 'local' | 'server' } & UploadAssignment) => {
      const operationId = `upload-${Date.now()}-${interactionRequestId()}`
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
          operationId,
          name: file.name,
          file,
          status,
          progress: 0,
          shelfId: opts?.shelfId,
          categoryId: opts?.categoryId,
          tagIds: opts?.tagIds,
          destination: opts?.destination ?? (local ? 'local' : 'server'),
          ...(opts?.versionNameMode ? { versionName: extractVersionNameFromFileName(file.name) } : {}),
        })),
        ]
      })
      if (inRange.length > 0) stoppingRef.current = false
      if (rejected > 0) notify.info({ key: 'library.uploadIgnored', params: { count: rejected } })
      if (oversized.length > 0) notify.info({ key: 'library.uploadOversized', params: { count: oversized.length } })
    },
    [local],
  )

  const startUpload = useCallback((assignment?: UploadAssignment, destination?: 'server' | 'local') => {
    stoppingRef.current = false
    setItems((prev) => prev.map((it) => {
      if (it.status !== 'pending') return it
      if (!assignment && !destination) return { ...it, status: 'queued' as const }
      return {
        ...it,
        status: 'queued' as const,
        ...(destination ? { destination } : {}),
        ...(assignment ? {
          shelfId: assignment.shelfId,
          categoryId: assignment.categoryId,
          tagIds: assignment.tagIds,
        } : {}),
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

  const continueUpload = useCallback((id: string) => {
    stoppingRef.current = false
    setItems((prev) => prev.map((item) => item.id === id && item.status === 'corresponding'
      ? { ...item, status: 'queued' as const, progress: 0, corresponding: undefined, allowCorresponding: true }
      : item))
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
    for (const controller of localInflightRef.current) controller.abort()
    inflightRef.current.clear()
  }, [])

  const isUploading = items.some((it) => it.status === 'queued' || it.status === 'uploading' || it.status === 'processing')

  const clearQueue = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status === 'queued' || it.status === 'uploading' || it.status === 'processing'))
  }, [])

  // Reopening the sheet must not resurrect finished rows from a background
  // upload that settled after the sheet was closed.
  const pruneSettled = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status !== 'success' && it.status !== 'duplicate' && it.status !== 'corresponding' && it.status !== 'error'))
  }, [])

  return { items, addFiles, startUpload, retry, retryAll, continueUpload, abortAll, pruneSettled, isUploading, clearQueue, patchItem }
}

export function useDeleteBook() {
  const vault = useVaultOperations()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, deleteUserData, ref }: { id: string; title: string; isCollected?: boolean; deleteUserData?: boolean; ref?: ClientBookRef }) => {
      if (isDeviceBook(ref)) { const receipt = await vault.trash(ref, deleteUserData === true); return { data: null, undo: undefined, localBook: ref, localRestore: receipt ? { id, version: receipt.version } : null } }
      const query = deleteUserData ? '?deleteUserData=true' : ''
      return { ...await apiDelete<{ data: null; undo?: UndoReceipt }>(`/books/${id}${query}`), localBook: null, localRestore: null }
    },
    onSuccess: (result, { title, isCollected, deleteUserData }) => {
      const isLocalBook = result.localBook !== null
      if (isLocalBook && result.localRestore !== null) {
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(result.localBook!.scope)] })
        invalidateDeviceMembershipQueries(queryClient)
        const restore = result.localRestore
        const undoToken = localRecordId()
        publishUndoOpportunity({
          token: undoToken,
          expiresAt: Date.now() + 10_000,
          queryKeys: [['client-catalog', ...clientScopeKey(result.localBook!.scope)]],
          execute: async () => {
            await vault.restore(result.localBook!, restore.version)
            void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(result.localBook!.scope)] })
            invalidateDeviceMembershipQueries(queryClient)
            notify.success({ key: 'library.bookRestored', params: { title } })
          },
        })
        notify.success({ key: 'library.bookMovedToTrash', params: { title } }, { undo: { token: undoToken, label: 'library.bookMovedToTrash' } })
        return
      }
      if (isLocalBook) {
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(result.localBook!.scope)] })
        invalidateDeviceMembershipQueries(queryClient)
        notify.success({ key: 'library.bookPermanentlyDeleted', params: { title } })
        return
      }
      for (const queryKey of BOOK_MEMBERSHIP_KEYS) queryClient.invalidateQueries({ queryKey })
      // Removing a collected card also changes the source library's catalog.
      queryClient.invalidateQueries({ queryKey: ['libraries'] })
      if (isCollected) {
        if (deleteUserData) void invalidatePermanentlyDeletedBookQueries(queryClient)
        notify.success({
          key: 'library.bookRemovedFromLibrary',
          params: { title },
        }, { undo: result.undo })
        return
      }
      // The server deletes permanently when trash is off; match the toast.
      const settings = queryClient.getQueryData<{ data: SettingsRes }>(['settings'])
      const trashOn = settings?.data.trash?.enabled !== false
      if (!trashOn || deleteUserData) void invalidatePermanentlyDeletedBookQueries(queryClient)
      notify.success({
        key: trashOn ? 'library.bookMovedToTrash' : 'library.bookPermanentlyDeleted',
        params: { title },
      }, { undo: result.undo })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.deleteBookFailed'))
    },
  })
}

export function useRestoreBook() {
  const vault = useVaultOperations()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, expectedVersion, ref }: { id: string; title: string; expectedVersion?: number; ref?: ClientBookRef }) => {
      return isDeviceBook(ref)
        ? vault.restore(ref, expectedVersion)
        : apiPost<{ data: null }>(`/books/${id}/restore`)
    },
    onSuccess: (_, { title, ref }) => {
      const isLocalBook = isDeviceBook(ref)
      // The shelf is one key space now: `['books', <params>, 'unified']`. The
      // vault predicate alone would leave the visible grid stale because it no
      // longer keys on `client-catalog`.
      if (isLocalBook) {
        void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'client-catalog' || query.queryKey[0] === 'books' || query.queryKey.some((part) => typeof part === 'string' && part.startsWith('local:')) })
        invalidateDeviceMembershipQueries(queryClient)
      }
      for (const queryKey of isLocalBook ? [] : BOOK_MEMBERSHIP_KEYS) queryClient.invalidateQueries({ queryKey })
      if (!isLocalBook) void invalidatePermanentlyDeletedBookQueries(queryClient)
      notify.success({ key: 'library.bookRestored', params: { title } })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.restoreBookFailed'))
    },
  })
}

export function usePermanentDeleteBook() {
  const vault = useVaultOperations()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, expectedVersion, ref }: { id: string; title: string; expectedVersion?: number; ref?: ClientBookRef }) => {
      return isDeviceBook(ref)
        ? vault.purge(ref, expectedVersion)
        : apiDelete<{ data: null }>(`/books/${id}/permanent`)
    },
    onSuccess: (_, { title, ref }) => {
      const isLocalBook = isDeviceBook(ref)
      // The shelf is one key space now: `['books', <params>, 'unified']`. The
      // vault predicate alone would leave the visible grid stale because it no
      // longer keys on `client-catalog`.
      if (isLocalBook) {
        void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'client-catalog' || query.queryKey[0] === 'books' || query.queryKey.some((part) => typeof part === 'string' && part.startsWith('local:')) })
        invalidateDeviceMembershipQueries(queryClient)
      }
      if (!isLocalBook) void invalidatePermanentlyDeletedBookQueries(queryClient)
      notify.success({ key: 'library.bookPermanentlyDeleted', params: { title } })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.permanentDeleteBookFailed'))
    },
  })
}

/**
 * Empty the trash the reader is looking at. The trash view is the same shelf
 * with `trash=true`, so it holds both kinds of book and one tap has to clear
 * both stores; reporting only the server count would leave device rows behind
 * while telling the reader the bin is empty.
 *
 * Each half is asked only where it exists: a session answers for the server,
 * a reachable vault for the device. An anonymous reader on a guest instance
 * must never call `DELETE /books/trash`, which answers 401 and bounces the
 * page to the login screen.
 */
export function useEmptyTrash() {
  const user = useAuthStore((state) => state.user)
  const vaultCapable = useVaultCapable()
  const vault = useVaultOperations()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: 'always',
    mutationFn: async () => {
      const device = vaultCapable ? await vault.emptyTrash() : 0
      const server = user ? (await apiDelete<{ data: { count: number } }>('/books/trash')).data.count : 0
      return { count: device + server, device, server }
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['client-catalog'] })
      // The taxonomy numbers and the selection snapshot are refreshed whether
      // or not the server answered: the local cache is cheap to invalidate and
      // a half that was skipped cannot have changed them.
      for (const queryKey of BOOK_MEMBERSHIP_KEYS) queryClient.invalidateQueries({ queryKey })
      void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
      if (result.device > 0) invalidateDeviceMembershipQueries(queryClient)
      if (result.server > 0) void invalidatePermanentlyDeletedBookQueries(queryClient)
      if (result.count === 0) notify.info({ key: 'library.trashAlreadyEmpty' })
      else notify.success({ key: 'library.trashEmptied', params: { count: result.count } })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.emptyTrashFailed'))
    },
  })
}

export function useShelves(options?: { enabled?: boolean; fallbackAnonymous?: boolean }): QueryObserverResult<{ data: ClientTaxonomyView[] }> {
  const local = useLocalCatalog()
  const user = useAuthStore((state) => state.user)
  const vault = useVaultOperations()
  const { revealHidden: showHidden } = useCatalogRevealHidden()
  const usesVault = Boolean(local || (!user && options?.fallbackAnonymous))
  return useQuery({
    networkMode: usesVault ? 'always' : 'online',
    enabled: Boolean(local || user || (options?.fallbackAnonymous && !user)) && (options?.enabled ?? true),
    queryKey: local ? catalogQueryKey(local.scope, 'shelves', showHidden) : ['shelves', options?.fallbackAnonymous && !user ? 'device' : 'account', showHidden],
    queryFn: async ({ signal }) => {
      if (usesVault) {
        const snapshot = await vault.readCatalog()
        signal.throwIfAborted()
        return { data: localTaxonomyViews(snapshot, showHidden).shelves }
      }
      const userId = user?.id
      const sessionRevision = getAuthSessionRevision()
      const result = await apiGet<{ data: ShelfListItem[] }>(withReveal('/shelves'), signal)
      if (!signal.aborted && userId && useAuthStore.getState().user?.id === userId && getAuthSessionRevision() === sessionRevision) saveShelvesSnapshot(userId, result.data)
      // The shelf tree the user sees is the tree a device book may point at.
      void vault.mirrorOrganization(result.data.map((item) => ({ id: item.id, kind: 'shelf' as const, name: item.name, parentId: null, pinned: item.pinned, hidden: item.hidden, sortOrder: item.sortOrder, createdAt: item.createdAt, updatedAt: item.updatedAt }))).catch(() => {})
      return result
    },
  })
}

export function useTags(options?: { enabled?: boolean; fallbackAnonymous?: boolean }): QueryObserverResult<{ data: ClientTaxonomyView[] }> {
  const local = useLocalCatalog()
  const user = useAuthStore((state) => state.user)
  const vault = useVaultOperations()
  const { revealHidden: showHidden } = useCatalogRevealHidden()
  const usesVault = Boolean(local || (!user && options?.fallbackAnonymous))
  return useQuery({
    networkMode: usesVault ? 'always' : 'online',
    enabled: Boolean(local || user || (options?.fallbackAnonymous && !user)) && (options?.enabled ?? true),
    queryKey: local ? catalogQueryKey(local.scope, 'tags', showHidden) : ['tags', options?.fallbackAnonymous && !user ? 'device' : 'account', showHidden],
    queryFn: async ({ signal }) => {
      if (usesVault) {
        const snapshot = await vault.readCatalog()
        signal.throwIfAborted()
        return { data: localTaxonomyViews(snapshot, showHidden).tags }
      }
      const userId = user?.id
      const sessionRevision = getAuthSessionRevision()
      const result = await apiGet<{ data: TagListItem[] }>(withReveal('/tags'), signal)
      if (!signal.aborted && userId && useAuthStore.getState().user?.id === userId && getAuthSessionRevision() === sessionRevision) saveTagsSnapshot(userId, result.data)
      void vault.mirrorOrganization(result.data.map((item) => ({ id: item.id, kind: 'tag' as const, name: item.name, parentId: null, pinned: item.pinned, hidden: item.hidden, sortOrder: item.sortOrder, createdAt: item.createdAt, updatedAt: item.updatedAt }))).catch(() => {})
      return result
    },
  })
}

export function useCreateShelf() {
  const local = useDataAuthority()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: async (name: string) => local ? { data: { ...await local.operations.createOrganization('shelf', name), bookCount: 0 } } : apiPost<{ data: ShelfListItem }>('/shelves', { name }),
    onSuccess: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.scope)] })
        invalidateDeviceMembershipQueries(queryClient)
        notify.success({ key: 'toast.shelfCreated' })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      notify.success({ key: 'toast.shelfCreated' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.createShelfFailed'))
    },
  })
}

export function useRenameShelf() {
  const local = useDataAuthority()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: async ({ id, name }: { id: string; name: string }) => local ? { data: await local.operations.updateOrganization('shelf', id, { name }) } : apiPut<{ data: ShelfListItem }>(`/shelves/${id}`, { name }),
    onSuccess: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.scope)] })
        invalidateDeviceMembershipQueries(queryClient)
        notify.success({ key: 'toast.shelfRenamed' })
        return
      }
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
  const local = useDataAuthority()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => local ? local.operations.updateOrganization('shelf', id, { pinned }) : apiPut(`/shelves/${id}`, { pinned }),
    onSuccess: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.scope)] })
        invalidateDeviceMembershipQueries(queryClient)

        return
      }
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.pinShelfFailed'))
    },
  })
}

export function useToggleShelfHidden() {
  const local = useDataAuthority()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) => local ? local.operations.updateOrganization('shelf', id, { hidden }) : apiPut(`/shelves/${id}`, { hidden }),
    onSuccess: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.scope)] })
        invalidateDeviceMembershipQueries(queryClient)

        return
      }
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book'] })
      void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
    },
    onError: (error) => notify.error(getUserErrorNotification(error, 'library.taxonomyVisibilityFailed')),
  })
}

export function useDeleteShelf() {
  const local = useDataAuthority()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: async (id: string) => {
      if (local) { await local.operations.deleteOrganization('shelf', id); return { data: null } }
      return apiDelete<{ data: null }>(`/shelves/${id}`)
    },
    onSuccess: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.scope)] })
        invalidateDeviceMembershipQueries(queryClient)
        notify.success({ key: 'toast.shelfDeleted' })
        return
      }
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['book'] })
      void queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
      queryClient.invalidateQueries({ queryKey: ['shelves'] })
      void queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY })
      notify.success({ key: 'toast.shelfDeleted' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.deleteShelfFailed'))
    },
  })
}

export function useReorderShelves() {
  const local = useDataAuthority()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: async (shelfIds: string[]) => {
      if (local) { await local.operations.reorderOrganization('shelf', shelfIds); return { data: null } }
      const all = await apiGet<{ data: ShelfListItem[] }>('/shelves?showHidden=1')
      const visible = new Set(shelfIds)
      let position = 0
      const complete = all.data.map((row) => visible.has(row.id) ? shelfIds[position++]! : row.id)
      return apiPut<{ data: null }>('/shelves/order', { shelfIds: complete })
    },
    onMutate: (shelfIds) => {
      if (local) return undefined
      // The tree hangs under ['shelves', 'account' | 'device', showHidden], so a
      // root-level patch has to reach every variant: keying on the bare prefix
      // would write to a cache entry nothing reads.
      const previous = queryClient.getQueriesData<{ data: ShelfListItem[] }>({ queryKey: ['shelves'] })
      for (const [key, prev] of previous) {
        if (!prev) continue
        const byId = new Map(prev.data.map((s) => [s.id, s]))
        const visible = new Set(shelfIds)
        let position = 0
        const next = prev.data
          .map((row) => (visible.has(row.id) ? byId.get(shelfIds[position++]!) : row))
          .filter((s): s is ShelfListItem => Boolean(s))
        queryClient.setQueryData(key, { data: next })
      }
      return { previous }
    },
    onError: (error, _shelfIds, ctx) => {
      for (const [key, prev] of ctx?.previous ?? []) queryClient.setQueryData(key, prev)
      notify.error(getUserErrorNotification(error, 'toast.reorderShelvesFailed'))
    },
    onSettled: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.scope)] })
        invalidateDeviceMembershipQueries(queryClient)
        return
      }
      void queryClient.invalidateQueries({ queryKey: ['shelves'] })
    },
  })
}

export function useReorderTags() {
  const local = useDataAuthority()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: async (tagIds: string[]) => {
      if (local) { await local.operations.reorderOrganization('tag', tagIds); return { data: null } }
      const all = await apiGet<{ data: TagListItem[] }>('/tags?showHidden=1')
      const visible = new Set(tagIds)
      let position = 0
      const complete = all.data.map((row) => visible.has(row.id) ? tagIds[position++]! : row.id)
      return apiPut<{ data: null }>('/tags/order', { tagIds: complete })
    },
    onMutate: (tagIds) => {
      if (local) return undefined
      // Same prefix-wide patch as the shelf reorder: one root key, several
      // account/device/visibility variants below it.
      const previous = queryClient.getQueriesData<{ data: TagListItem[] }>({ queryKey: ['tags'] })
      for (const [key, prev] of previous) {
        if (!prev) continue
        const byId = new Map(prev.data.map((tag) => [tag.id, tag]))
        const visible = new Set(tagIds)
        let position = 0
        const next = prev.data
          .map((row) => (visible.has(row.id) ? byId.get(tagIds[position++]!) : row))
          .filter((tag): tag is TagListItem => Boolean(tag))
        queryClient.setQueryData(key, { data: next })
      }
      return { previous }
    },
    onError: (error, _tagIds, ctx) => {
      for (const [key, prev] of ctx?.previous ?? []) queryClient.setQueryData(key, prev)
      notify.error(getUserErrorNotification(error, 'toast.reorderTagsFailed'))
    },
    onSettled: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.scope)] })
        invalidateDeviceMembershipQueries(queryClient)
        return
      }
      void queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
  })
}

export function useUpdateBook() {
  const queryClient = useQueryClient()
  const vault = useVaultOperations()

  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ bookId, expectedVersion, ref, ...data }: { bookId: string; expectedVersion?: number; ref?: ClientBookRef } & Partial<{ readStatus: ReadStatus; progress: number; pinned: boolean; title: string; author: string; authors: string[]; hidden: boolean; bookmeta: BookMetadata; coverPaletteId: CoverPaletteId | null }>): Promise<{ data: ClientLibraryBookView; undo?: UndoReceipt }> => {
      if (!isDeviceBook(ref)) return apiPatch<{ data: BookListItem; undo?: UndoReceipt }>(`/books/${bookId}`, data)
      if (data.progress !== undefined) throw new Error("Local positions require an exact content locator")
      const bookRef = ref
      const catalog: Partial<ClientCatalogAttributes> = {
        ...(data.pinned === undefined ? {} : { pinnedAt: data.pinned ? Date.now() : null }),
        ...(data.hidden === undefined ? {} : { hidden: data.hidden }),
        ...(data.bookmeta === undefined ? {} : { metadata: data.bookmeta }),
        ...(data.coverPaletteId === undefined ? {} : { coverPaletteId: data.coverPaletteId }),
      }
      const authors = data.authors ?? (data.author === undefined ? undefined : data.author ? [data.author] : [])
      if (data.title !== undefined || authors !== undefined || Object.keys(catalog).length) {
        if (expectedVersion === undefined) throw new Error("The displayed local book version is required")
        await vault.update(bookRef, { ...(data.title === undefined ? {} : { title: data.title }), ...(authors === undefined ? {} : { authors }), ...(Object.keys(catalog).length ? { catalog } : {}) }, expectedVersion)
      }
      if (data.readStatus !== undefined) await vault.setReadStatus(bookRef, data.readStatus)
      const entry = await vault.detail(bookRef)
      return { data: localCatalogBookView(entry.book, entry.state, entry.organization) }
    },
    onSuccess: async (result, { bookId, ref }) => {
      if (isDeviceBook(ref)) {
        await queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(ref.scope)] })
        invalidateDeviceMembershipQueries(queryClient)
        notify.success({ key: 'toast.bookUpdated' })
        return
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['books'] }),
        queryClient.invalidateQueries({ queryKey: ['books', 'detail', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['book', bookId] }),
      ])
      notify.success({ key: 'toast.bookUpdated' }, { undo: result.undo })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.updateBookFailed'))
    },
  })
}

export function useBook(bookId: string | null, ref?: ClientBookRef | null) {
  const local = useLocalCatalog()
  const vault = useVaultOperations()
  const vaultScope = useVaultScope()
  // A ref-less caller is a surface already pinned to one device book (the
  // reader and the content editor), so the context answers for it.
  const isLocalBook = isDeviceBook(ref) || (Boolean(local) && !ref)
  const bookRef = ref ?? { scope: vaultScope, bookId: bookId! }
  return useQuery<{ data: ClientLibraryDetailView }>({
    networkMode: isLocalBook ? 'always' : 'online',
    queryKey: isLocalBook ? catalogQueryKey(bookRef.scope, 'detail', bookRef.bookId) : ['books', 'detail', bookId],
    queryFn: async ({ signal }) => {
      if (isLocalBook) {
        const entry = await vault.detail(bookRef, signal)
        const settings = await vault.getBookPreferences(bookRef)
        signal.throwIfAborted()
        return { data: localCatalogDetailView(entry.book, entry.state, entry.organization, settings) }
      }
      return guardedRemoteCatalogRead<{ data: BookDetailRes }>(withReveal(`/books/${bookId}`), signal)
    },
    enabled: Boolean(bookId),
    staleTime: 0,
    refetchOnMount: 'always',
  })
}

export function useRemoteBook(bookId: string | null) {
  return useQuery({
    queryKey: ['books', 'detail', bookId],
    queryFn: ({ signal }) => guardedRemoteCatalogRead<{ data: BookDetailRes }>(withReveal(`/books/${bookId}`), signal),
    enabled: Boolean(bookId), staleTime: 0, refetchOnMount: 'always',
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
        void invalidateActivityQueries(queryClient, input.target.libraryId)
        invalidateCityVersionQueries(queryClient, result.data.book, input.target.versionLinkId)
      }
    },
  })
}

export function useUploadCover() {
  const queryClient = useQueryClient()
  const local = useLocalCatalog()
  const vault = useVaultOperations()
  const vaultScope = useVaultScope()

  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ bookId, file, expectedVersion, ref }: { bookId: string; file: File; expectedVersion?: number; ref?: ClientBookRef }) => {
      const isLocalBook = isDeviceBook(ref) || (Boolean(local) && !ref)
      if (!isLocalBook) return apiUpload<{ data: BookListItem }>(`/books/${bookId}/cover`, file, 'PUT')
      if (expectedVersion === undefined) throw new Error('The displayed local book version is required')
      const bookRef = ref ?? { scope: vaultScope, bookId }
      await vault.update(bookRef, {}, expectedVersion, file)
      const entry = await vault.detail(bookRef)
      return { data: localCatalogBookView(entry.book, entry.state, entry.organization) }
    },
    onSuccess: async (_result, { bookId, ref }) => {
      if (isDeviceBook(ref) || (Boolean(local) && !ref)) {
        await queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(ref?.scope ?? vaultScope)] })
        if (!local) invalidateDeviceMembershipQueries(queryClient)
        notify.success({ key: 'toast.bookCoverUpdated' })
        return
      }
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
  const local = useLocalCatalog()
  const vault = useVaultOperations()
  const vaultScope = useVaultScope()

  return useMutation({
    networkMode: 'always',
    mutationFn: async (input: string | { bookId: string; expectedVersion?: number; ref?: ClientBookRef }) => {
      const bookId = typeof input === 'string' ? input : input.bookId
      const ref = typeof input === 'string' ? undefined : input.ref
      const isLocalBook = isDeviceBook(ref) || (Boolean(local) && !ref)
      if (!isLocalBook) return apiDelete<{ data: BookListItem }>(`/books/${bookId}/cover`)
      const version = typeof input === 'string' ? undefined : input.expectedVersion
      if (version === undefined) throw new Error('The displayed local book version is required')
      const bookRef = ref ?? { scope: vaultScope, bookId }
      await vault.update(bookRef, {}, version, null)
      const entry = await vault.detail(bookRef)
      return { data: localCatalogBookView(entry.book, entry.state, entry.organization) }
    },
    onSuccess: async (_result, input) => {
      const ref = typeof input === 'string' ? undefined : input.ref
      if (isDeviceBook(ref) || (Boolean(local) && !ref)) {
        await queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(ref?.scope ?? vaultScope)] })
        if (!local) invalidateDeviceMembershipQueries(queryClient)
        notify.success({ key: 'toast.bookCoverRemoved' })
        return
      }
      const bookId = typeof input === 'string' ? input : input.bookId
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

export function useBookMetadataSource(bookId: string | null, enabled = true, ref?: ClientBookRef | null) {
  const local = useLocalCatalog()
  const vault = useVaultOperations()
  // On the unified shelf no catalog context marks a device book, so the ref
  // decides; a device book resolves its metadata source from the vault.
  const isLocalBook = isDeviceBook(ref)
  return useQuery({
    networkMode: local || isLocalBook ? 'always' : 'online',
    queryKey: local
      ? catalogQueryKey(local.scope, 'metadata-source', bookId)
      : isLocalBook
        ? catalogQueryKey(DEVICE_VAULT_SCOPE, 'metadata-source', bookId)
        : ['books', bookId, 'metadata-source'],
    queryFn: async ({ signal }) => {
      if (local) return { data: await local.operations.getMetadataSource({ scope: local.scope, bookId: bookId! }, signal) }
      if (isLocalBook) return { data: await vault.getMetadataSource({ scope: DEVICE_VAULT_SCOPE, bookId: bookId! }, signal) }
      return apiGet<{ data: import('@bookdock/shared').BookMetadataSourceRes }>(`/books/${bookId}/metadata-source`)
    },
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
  const local = useDataAuthority()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: async (name: string) => local ? { data: { ...await local.operations.createOrganization('tag', name), bookCount: 0 } } : apiPost<{ data: TagListItem }>('/tags', { name }),
    onSuccess: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.scope)] })
        invalidateDeviceMembershipQueries(queryClient)
        notify.success({ key: 'toast.tagCreated' })
        return
      }
      queryClient.invalidateQueries({ queryKey: ['tags'] })
      notify.success({ key: 'toast.tagCreated' })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.createTagFailed'))
    },
  })
}

export function useRenameTag() {
  const local = useDataAuthority()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: async ({ id, name }: { id: string; name: string }) => local ? { data: await local.operations.updateOrganization('tag', id, { name }) } : apiPut<{ data: TagListItem }>(`/tags/${id}`, { name }),
    onSuccess: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.scope)] })
        invalidateDeviceMembershipQueries(queryClient)
        notify.success({ key: 'toast.tagRenamed' })
        return
      }
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
  const local = useDataAuthority()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => local ? local.operations.updateOrganization('tag', id, { pinned }) : apiPut(`/tags/${id}`, { pinned }),
    onSuccess: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.scope)] })
        invalidateDeviceMembershipQueries(queryClient)

        return
      }
      queryClient.invalidateQueries({ queryKey: ['tags'] })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.pinTagFailed'))
    },
  })
}

export function useToggleTagHidden() {
  const local = useDataAuthority()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) => local ? local.operations.updateOrganization('tag', id, { hidden }) : apiPut(`/tags/${id}`, { hidden }),
    onSuccess: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.scope)] })
        invalidateDeviceMembershipQueries(queryClient)

        return
      }
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
  const local = useDataAuthority()
  const queryClient = useQueryClient()

  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: async (id: string) => {
      if (local) { await local.operations.deleteOrganization('tag', id); return { data: null } }
      return apiDelete<{ data: null }>(`/tags/${id}`)
    },
    onSuccess: () => {
      if (local) {
        void queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(local.scope)] })
        invalidateDeviceMembershipQueries(queryClient)
        notify.success({ key: 'toast.tagDeleted' })
        return
      }
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
  const vault = useVaultOperations()

  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ bookId, ref, shelfId, categoryId, categoryTemplateKey, tagIds }: { bookId: string; ref?: ClientBookRef; shelfId?: string | null; categoryId?: string | null; categoryTemplateKey?: string; tagIds?: string[] }) => {
      if (isDeviceBook(ref)) {
        const entry = await vault.detail(ref)
        if (entry.book.version === null) throw new Error('Local book version is unavailable')
        await vault.update(ref, { ...(categoryTemplateKey ? { categoryTemplateKey } : {}), catalog: {
          ...(shelfId === undefined ? {} : { shelfId }), ...(categoryId === undefined ? {} : { categoryId }), ...(tagIds === undefined ? {} : { tagIds }),
        } }, entry.book.version)
        return { data: null, undo: undefined }
      }
      return apiPut<{ data: null; undo?: UndoReceipt }>(`/books/${bookId}/organization`, {
        ...(shelfId !== undefined ? { shelfId } : {}),
        ...(categoryId !== undefined ? { categoryId } : {}),
        ...(categoryTemplateKey !== undefined ? { categoryTemplateKey } : {}),
        ...(tagIds !== undefined ? { tagIds } : {}),
      })
    },
    onSuccess: async (result, { bookId, ref }) => {
      if (isDeviceBook(ref)) {
        await queryClient.invalidateQueries({ queryKey: ['client-catalog', ...clientScopeKey(ref.scope)] })
        invalidateDeviceMembershipQueries(queryClient)
        notify.success({ key: 'toast.membershipUpdated' })
        return
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['books'] }),
        queryClient.invalidateQueries({ queryKey: ['book', bookId] }),
        queryClient.invalidateQueries({ queryKey: ['shelves'] }),
        queryClient.invalidateQueries({ queryKey: ['tags'] }),
        queryClient.invalidateQueries({ queryKey: ['batch-selection'] }),
        queryClient.invalidateQueries({ queryKey: ['libraries'] }),
        queryClient.invalidateQueries({ queryKey: READING_RECORDS_KEY }),
      ])
      notify.success({ key: 'toast.membershipUpdated' }, { undo: result.undo })
    },
    onError: (error) => {
      notify.error(getUserErrorNotification(error, 'toast.updateMembershipFailed'))
    },
  })
}

export function useBookMembership(bookId: string | null, options: { shelves?: boolean; tags?: boolean; ref?: ClientBookRef | null } = {}) {
  const local = useLocalCatalog()
  const vault = useVaultOperations()
  const vaultScope = useVaultScope()
  // A ref-less caller is a surface already pinned to one device book (the
  // reader's own panels), so the context answers for it.
  const isLocalBook = isDeviceBook(options.ref) || (Boolean(local) && !options.ref)
  const bookRef = options.ref ?? { scope: vaultScope, bookId: bookId! }
  const checkShelves = options.shelves ?? false
  const checkTags = options.tags ?? true
  return {
    shelves: useQuery({
      networkMode: isLocalBook ? 'always' : 'online',
      queryKey: isLocalBook ? catalogQueryKey(bookRef.scope, 'book-shelves', bookRef.bookId) : ['books', bookId, 'shelves'],
      queryFn: async ({ signal }) => isLocalBook
        ? { data: (await vault.detail(bookRef, signal)).book.catalog?.shelfId ?? null }
        : guardedRemoteCatalogRead<{ data: string | null }>(`/books/${bookId}/shelves`, signal),
      enabled: Boolean(bookId && checkShelves),
    }),
    tags: useQuery({
      networkMode: isLocalBook ? 'always' : 'online',
      queryKey: isLocalBook ? catalogQueryKey(bookRef.scope, 'book-tags', bookRef.bookId) : ['books', bookId, 'tags'],
      queryFn: async ({ signal }) => isLocalBook
        ? { data: (await vault.detail(bookRef, signal)).book.catalog?.tagIds ?? [] }
        : guardedRemoteCatalogRead<{ data: string[] }>(`/books/${bookId}/tags`, signal),
      enabled: Boolean(bookId && checkTags),
    }),
  }
}

/** One book to move. A caller hands over rows, not a pre-split by store. */
export interface MoveTarget {
  id: string
  ref?: ClientBookRef
}

export interface MoveOutcome {
  succeeded: number
  failed: number
  failedIds: string[]
  undo?: UndoReceipt
}

/**
 * File books into a shelf. The selection can hold both kinds of book, so the
 * hook partitions it first and asks each authority for its own half; callers
 * never decide the route themselves.
 */
export function useMoveBooksToShelf() {
  const queryClient = useQueryClient()
  const vault = useVaultOperations()

  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ books, shelfId }: { books: MoveTarget[]; shelfId: string | null }): Promise<MoveOutcome> => {
      const { device, server } = partitionByStore(books, (book) => book.ref)
      let succeeded = 0
      let failed = 0
      const failedIds: string[] = []
      let undo: UndoReceipt | undefined
      if (device.length) {
        const items = await vault.selection(device.map((book) => book.id))
        if (items.length !== device.length) throw new Error('The selected local books changed')
        await vault.updateSelection(items, { shelfId })
        succeeded += items.length
      }
      if (server.length) {
        const result = await apiPatch<{ data: { succeeded: number; failed: number; failedIds: string[] }; undo?: UndoReceipt }>('/books/batch/move-shelf', { ids: server.map((book) => book.id), shelfId })
        succeeded += result.data.succeeded
        failed += result.data.failed
        failedIds.push(...result.data.failedIds.map((id) => `server:${id}`))
        undo = result.undo
      }
      return { succeeded, failed, failedIds, undo }
    },
    onSuccess: (result, variables) => {
      const { device, server } = partitionByStore(variables.books, (book) => book.ref)
      if (device.length) invalidateDeviceMembershipQueries(queryClient)
      if (server.length) {
        queryClient.invalidateQueries({ queryKey: ['books'] })
        queryClient.invalidateQueries({ queryKey: ['shelves'] })
        queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
      }
      if (result.failed > 0) {
        const showResult = result.succeeded > 0 ? notify.warning : notify.error
        showResult({ key: result.succeeded > 0 ? 'library.moveBooksPartial' : 'library.moveBooksFailed', params: { succeeded: result.succeeded, failed: result.failed } }, { undo: result.undo })
        return
      }
      // The shelf tree lives under a prefixed key, so the name has to be read
      // across variants - a bare-key lookup would silently fall through to the
      // "moved out of a shelf" wording.
      const name = queryClient.getQueriesData<{ data: ShelfListItem[] }>({ queryKey: ['shelves'] })
        .flatMap(([, page]) => page?.data ?? [])
        .find((s) => s.id === variables.shelfId)?.name
      // The device half has no undo receipt, the server half does. Offering one
      // for a mixed move would revert only the server rows, so the mixed case
      // reports the move without it.
      const undo = device.length ? undefined : result.undo
      notify.success(name
        ? { key: 'toast.movedToShelf', params: { name, count: result.succeeded } }
        : { key: 'toast.movedOutOfShelf', params: { count: result.succeeded } }, { undo })
    },
    onError: (_error, { books }) => notify.error({ key: 'library.moveBooksFailed', params: { succeeded: 0, failed: books.length } }),
  })
}

/** File books into a category. Same partition as the shelf move. */
export function useMoveBooksToCategory() {
  const queryClient = useQueryClient()
  const vault = useVaultOperations()

  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ libraryId, books, categoryId }: { libraryId?: string | null; books: MoveTarget[]; categoryId: string | null }): Promise<MoveOutcome> => {
      const { device, server } = partitionByStore(books, (book) => book.ref)
      let succeeded = 0
      let failed = 0
      const failedIds: string[] = []
      let undo: UndoReceipt | undefined
      if (device.length) {
        const items = await vault.selection(device.map((book) => book.id))
        if (items.length !== device.length) throw new Error('The selected local books changed')
        await vault.updateSelection(items, { categoryId })
        succeeded += items.length
      }
      if (server.length) {
        const result = await apiPatch<{ data?: { count: number; failed?: number; failedIds?: string[] }; undo?: UndoReceipt }>(
          libraryId ? `/libraries/${libraryId}/books/batch/organize` : '/books/batch/organize',
          { ids: server.map((book) => book.id), categoryId },
        )
        succeeded += result.data?.count ?? server.length
        failed += result.data?.failed ?? 0
        failedIds.push(...(result.data?.failedIds ?? []).map((id) => `server:${id}`))
        undo = result.undo
      }
      return { succeeded, failed, failedIds, undo }
    },
    onSuccess: (result, variables) => {
      const { device, server } = partitionByStore(variables.books, (book) => book.ref)
      if (device.length) invalidateDeviceMembershipQueries(queryClient)
      if (server.length) {
        queryClient.invalidateQueries({ queryKey: ['books'] })
        queryClient.invalidateQueries({ queryKey: ['book'] })
        queryClient.invalidateQueries({ queryKey: ['batch-selection'] })
        queryClient.invalidateQueries({ queryKey: ['shelves'] })
        if (variables.libraryId) {
          queryClient.invalidateQueries({ queryKey: ['libraries', variables.libraryId, 'catalog'] })
          queryClient.invalidateQueries({ queryKey: ['libraries', variables.libraryId, 'categories'] })
          queryClient.invalidateQueries({ queryKey: ['libraries', variables.libraryId, 'tags'] })
        } else {
          queryClient.invalidateQueries({ queryKey: ['libraries'] })
        }
      }
      notify.success(
        result.succeeded > 1
          ? { key: 'library.batchClassifySucceeded', params: { count: result.succeeded } }
          : { key: 'toast.membershipUpdated' },
        // Same split as the shelf move: half an undo is worse than none.
        { undo: device.length ? undefined : result.undo },
      )
    },
    onError: (error) => notify.error(getUserErrorNotification(error, 'toast.updateMembershipFailed')),
  })
}

export function useLibrarySearchAuthors(libraryId: string | null, trash: boolean, showHidden: boolean, options?: { enabled?: boolean }) {
  const local = useLocalCatalog()
  const vault = useVaultOperations()
  const vaultCapable = useVaultCapable()
  const user = useAuthStore((state) => state.user)
  const includeVault = !libraryId && (Boolean(local) || vaultCapable)
  return useQuery({
    networkMode: local || (!user && includeVault) ? 'always' : 'online',
    enabled: Boolean(local || user || includeVault) && (options?.enabled ?? true),
    queryKey: local
      ? catalogQueryKey(local.scope, 'authors', [trash, showHidden])
      : ['library-search-authors', libraryId, trash, showHidden, includeVault, Boolean(user)],
    queryFn: async ({ signal }) => {
      const readVaultAuthors = async (source: ReturnType<typeof useVaultOperations>) => {
        const snapshot = await source.readCatalog()
        signal.throwIfAborted()
        const visible = snapshot.books.filter(({ book, state }) => (book.deletedAt != null) === trash && (trash || !book.catalogRemoved) && (showHidden || !localCatalogBookView(book, state, snapshot.organization).effectiveHidden))
        return visible.flatMap(({ book }) => book.authors)
      }
      if (local) {
        return { data: [...new Set(await readVaultAuthors(local.operations))].sort((a, b) => a.localeCompare(b)) }
      }
      if (libraryId) {
        return apiGet<{ data: string[] }>(`/libraries/${libraryId}/search-authors?trash=${trash ? '1' : '0'}&showHidden=${showHidden ? '1' : '0'}`, signal)
      }
      const deviceAuthors = includeVault ? await readVaultAuthors(vault).catch(() => [] as string[]) : []
      if (!user) {
        return { data: [...new Set(deviceAuthors)].sort((a, b) => a.localeCompare(b)) }
      }
      let remoteAuthors: string[] = []
      try {
        remoteAuthors = (await apiGet<{ data: string[] }>(`/books/search-authors?trash=${trash ? '1' : '0'}&showHidden=${showHidden ? '1' : '0'}`, signal)).data
      } catch (error) {
        if (signal.aborted || deviceAuthors.length === 0) throw error
      }
      return { data: [...new Set([...remoteAuthors, ...deviceAuthors])].sort((a, b) => a.localeCompare(b)) }
    },
    staleTime: 0,
  })
}
