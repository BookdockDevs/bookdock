import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import type { ClientBookRef, ClientDataScope, RuleBatchDeleteReq, TextReplacementRes, ReplacementCreateReq, ReplacementImportReq, ReplacementOverrideReq, ReplacementUpdateReq } from '@bookdock/shared'

import { useLocalReader } from '@/features/reading-data/reader-source-context'
import { useLocalCatalog } from '@/features/reading-data/catalog-source-context'
import { deviceScope, isDeviceBook } from '@/features/reading-data/book-source'
import { DEVICE_VAULT_SCOPE } from '@/features/local-library/catalog'
import { localLibraryRepository as repository } from '@/features/local-library/repository'
import { localRecordId } from '@/features/local-library/id'
import { getAuthSessionRevision, useAuthStore } from '@/stores/auth.store'

import { apiDelete, apiGet, apiPost, apiPut } from '../client'

const REPLACEMENTS_KEY = ['replacements'] as const

type ReplacementsCache = { data: TextReplacementRes[] }

// Optimistic row patch shared by the toggle mutations: both the plain list and
// the per-book queries live under ['replacements'], so a prefix setQueriesData
// keeps every open view in sync until the refetch lands.
function patchReplacementRows(queryClient: QueryClient, id: string, patch: (row: TextReplacementRes) => TextReplacementRes) {
  queryClient.setQueriesData<ReplacementsCache>({ queryKey: REPLACEMENTS_KEY }, (old) =>
    old ? { data: old.data.map((r) => (r.id === id ? patch(r) : r)) } : old,
  )
}

function snapshotReplacements(queryClient: QueryClient) {
  return queryClient.getQueriesData<ReplacementsCache>({ queryKey: REPLACEMENTS_KEY })
}

function rollbackReplacements(queryClient: QueryClient, previous: ReturnType<typeof snapshotReplacements>) {
  for (const [key, data] of previous) queryClient.setQueryData(key, data)
}

type RuleScope = Extract<ClientDataScope, { kind: 'local' }>

/**
 * Where a replacement rule is stored is decided by what the rule applies to,
 * never by the session:
 *
 * - a global rule is one set - the account's when signed in (the device copy is
 *   a cache), the device's for a guest;
 * - a rule bound to a book belongs to that book, so it lives wherever the book
 *   lives.
 *
 * That split is why a signed-in reader of a device book still reads the
 * account's global rules, while this book's own rules stay on this device. The
 * server has never seen a device book id - it answers BOOK_NOT_FOUND - so
 * asking it for the book's rules was leaving the reader with none.
 */
function useReplacementSource() {
  const contextLocal = useLocalCatalog()
  const reader = useLocalReader()
  const user = useAuthStore((state) => state.user)
  const signedIn = Boolean(user)

  const bookScope = reader && isDeviceBook(reader.ref) ? reader.ref.scope : null
  const globalDevice: RuleScope | null = contextLocal?.scope ?? (signedIn ? null : DEVICE_VAULT_SCOPE)
  // Whether a write from this surface can land in the vault; it drives the
  // offline networkMode only. Which store answers for a *book* is a property of
  // that book and is decided by `deviceFor`.
  const surfaceDevice: RuleScope | null = reader ? bookScope : globalDevice

  const deviceFor = (bookId: string | null | undefined, ref?: ClientBookRef | null): RuleScope | null => {
    // A global rule is one set and follows the global owner.
    if (bookId == null) return globalDevice
    // A book rule follows its book. The reader knows its own book; a caller
    // outside the reader must hand in the book's ref, otherwise the rule has no
    // device home and the account answers.
    return bookScope ?? deviceScope(ref)
  }

  const queryClient = useQueryClient()
  const epoch = getAuthSessionRevision()
  const local = surfaceDevice ? { scope: surfaceDevice } : null
  const globalLocal = globalDevice ? { scope: globalDevice } : null

  const findRule = (id: string) => [...queryClient.getQueriesData<ReplacementsCache>({ queryKey: REPLACEMENTS_KEY }), ...queryClient.getQueriesData<ReplacementsCache>({ queryKey: ['client-replacements'] })]
    .flatMap(([, data]) => data?.data ?? [])
    .find((row) => row.id === id)

  return { local, globalLocal, reader, signedIn, deviceFor, findRule,
    assertCurrent() { if (getAuthSessionRevision() !== epoch) throw new DOMException('Replacement account changed', 'AbortError') },
    version(id: string) {
      const row = findRule(id)
      if (row?.clientVersion === undefined) throw new Error('Replacement version is unavailable')
      return row.clientVersion
    },
    async saved() {
      // A device book also reads the account's global rules, so both prefixes
      // have to be refreshed for the merged view to stay honest.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: REPLACEMENTS_KEY }),
        queryClient.invalidateQueries({ queryKey: ['client-replacements'] }),
      ])
    },
  }
}

/** All replacements owned by the current user */
export function useReplacements() {
  const source = useReplacementSource()
  // This list is the global rule set, so it follows the global owner even when
  // it is opened beside a device book.
  const local = source.globalLocal
  return useQuery({
    queryKey: local ? ['client-replacements', local.scope.vaultId] : REPLACEMENTS_KEY,
    networkMode: local ? 'always' : 'online',
    queryFn: async () => {
      if (local) return repository.readReplacements(local.scope.vaultId)
      source.assertCurrent(); const result = await apiGet<ReplacementsCache>('/replacements'); source.assertCurrent(); return result
    },
  })
}

/** All pattern rules (with per-book override applied) + the book's point patches */
export function useBookReplacements(bookId: string | undefined, ref?: ClientBookRef | null) {
  const source = useReplacementSource()
  // The book decides, not the surface it is shown on: a device book reads the
  // vault even when the reader is not the current context, and a server book
  // reads the account even for a guest.
  const scope = source.deviceFor(bookId, ref)
  const local = scope ? { scope } : null
  const key = scope ? ['client-replacements', scope.vaultId] : REPLACEMENTS_KEY
  return useQuery({
    queryKey: [...key, 'book', bookId], networkMode: local ? 'always' : 'online',
    queryFn: async ({ signal }) => {
      if (!local) {
        source.assertCurrent(); const result = await apiGet<ReplacementsCache>(`/replacements?bookId=${bookId}`); source.assertCurrent(); return result
      }
      if (!bookId) return { data: [] }
      // This book's own rules live with the book; the global set is the one the
      // account owns. Reading both keeps a signed-in reader of a device book on
      // exactly the rules the settings page manages.
      const vaultRows = await repository.readReplacements(local.scope.vaultId, bookId)
      if (!source.signedIn) return vaultRows
      source.assertCurrent()
      // Offline is a normal state for a device book: when the account cannot be
      // reached, this device's own copy is still the right answer.
      const account = await apiGet<ReplacementsCache>('/replacements').catch((error: unknown) => {
        if (signal.aborted) throw error
        return null
      })
      if (!account) return vaultRows
      source.assertCurrent()
      const overrides = await repository.readReplacementOverrides(local.scope.vaultId, bookId)
      const globals = account.data
        .filter((row) => row.bookId === null)
        .map((row) => (overrides[row.id] === undefined
          ? { ...row, hasOverride: false, effectiveEnabled: row.enabled }
          : { ...row, hasOverride: true, effectiveEnabled: overrides[row.id] }))
      return { data: [...globals, ...vaultRows.data.filter((row) => row.bookId !== null)] }
    },
    enabled: !!bookId,
  })
}

export function useCreateReplacement() {
  const source = useReplacementSource()
  return useMutation({
    networkMode: source.local ? 'always' : 'online',
    mutationFn: async (body: ReplacementCreateReq) => {
      const scope = source.deviceFor(body.bookId)
      if (scope) { const id = localRecordId(); await repository.mutateReplacement(scope.vaultId, id, { create: body, expectedContentId: source.reader?.content?.contentId }); return { data: (await repository.readReplacements(scope.vaultId, body.bookId ?? undefined)).data.find((row) => row.id === id)! } }
      source.assertCurrent(); const result = await apiPost<{ data: TextReplacementRes }>('/replacements', body); source.assertCurrent(); return result
    },
    onSuccess: () => {
      void source.saved()
    },
  })
}

export function useUpdateReplacement() {
  const source = useReplacementSource()
  const queryClient = useQueryClient()
  // An edit follows the rule it touches: promoting a rule to global hands it to
  // the global owner, a book-scoped edit stays with the book.
  const scopeOf = (id: string, body?: ReplacementUpdateReq) => {
    if (body?.bookId !== undefined) return source.deviceFor(body.bookId)
    const row = source.findRule(id)
    return row ? source.deviceFor(row.bookId) : source.local?.scope ?? null
  }
  return useMutation({
    networkMode: source.local ? 'always' : 'online',
    mutationFn: async ({ id, body, expectedVersion }: { id: string; body: ReplacementUpdateReq; expectedVersion?: number }) => {
      const scope = scopeOf(id, body)
      if (scope) { await repository.mutateReplacement(scope.vaultId, id, { update: body, expectedVersion: expectedVersion ?? source.version(id) }); return }
      source.assertCurrent(); const result = await apiPut<{ data: TextReplacementRes }>(`/replacements/${id}`, body); source.assertCurrent(); return result
    },
    onMutate: async ({ id, body }) => {
      // Only the enabled flip is optimistic; edits go through the refetch
      if (scopeOf(id, body) || body.enabled === undefined) return undefined
      const previous = snapshotReplacements(queryClient)
      const applyOptimisticPatch = () => patchReplacementRows(queryClient, id, (r) => {
        const next = { ...r, enabled: body.enabled! }
        // Book-scoped rows show the effective value: a per-book override still
        // wins; without one the global flip is the effective flip
        if (r.effectiveEnabled !== undefined) {
          next.effectiveEnabled = r.hasOverride ? r.effectiveEnabled : body.enabled!
        }
        return next
      })
      // Apply before awaiting cancellation so a slow in-flight query cannot
      // delay the switch feedback; reapply after cancellation to prevent it
      // from overwriting the optimistic value.
      applyOptimisticPatch()
      await queryClient.cancelQueries({ queryKey: REPLACEMENTS_KEY })
      applyOptimisticPatch()
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) rollbackReplacements(queryClient, ctx.previous)
    },
    onSuccess: () => {
      void source.saved()
    },
  })
}

export function useDeleteReplacement() {
  const source = useReplacementSource()
  return useMutation({
    networkMode: source.local ? 'always' : 'online',
    mutationFn: async (target: string | { id: string; expectedVersion?: number }) => {
      const id = typeof target === 'string' ? target : target.id
      const row = source.findRule(id)
      const scope = row ? source.deviceFor(row.bookId) : source.local?.scope ?? null
      if (scope) return repository.mutateReplacement(scope.vaultId, id, { delete: true, expectedVersion: typeof target === 'string' ? source.version(id) : target.expectedVersion ?? source.version(id) })
      source.assertCurrent(); const result = await apiDelete(`/replacements/${id}`); source.assertCurrent(); return result
    },
    onSuccess: () => {
      void source.saved()
    },
  })
}

export function useImportReplacements() {
  const source = useReplacementSource()
  return useMutation({
    mutationFn: (body: ReplacementImportReq) => { if (source.deviceFor(null)) throw new Error('Rule transfer is not part of local library delivery'); source.assertCurrent(); return apiPost<{ data: TextReplacementRes[] }>('/replacements/import', body) },
    onSuccess: () => {
      void source.saved()
    },
  })
}

/** Per-book override for a pattern rule: boolean sets it, null restores global inheritance */
export function useSetReplacementOverride() {
  const source = useReplacementSource()
  const queryClient = useQueryClient()
  return useMutation({
    networkMode: source.local ? 'always' : 'online',
    mutationFn: async ({ replacementId, body }: { replacementId: string; body: ReplacementOverrideReq }) => {
      // An override is per-book state, so it lives with the book.
      const scope = source.deviceFor(body.bookId)
      if (scope) return repository.overrideReplacement(scope.vaultId, replacementId, body.bookId, body.enabled, source.version(replacementId))
      source.assertCurrent(); const result = await apiPut<{ data: TextReplacementRes }>(`/replacements/${replacementId}/override`, body); source.assertCurrent(); return result
    },
    onMutate: async ({ replacementId, body }) => {
      if (source.deviceFor(body.bookId)) return undefined
      const previous = snapshotReplacements(queryClient)
      const applyOptimisticPatch = () => patchReplacementRows(queryClient, replacementId, (r) =>
        body.enabled === null
          ? { ...r, hasOverride: false, effectiveEnabled: r.enabled }
          : { ...r, hasOverride: true, effectiveEnabled: body.enabled },
      )
      applyOptimisticPatch()
      await queryClient.cancelQueries({ queryKey: REPLACEMENTS_KEY })
      applyOptimisticPatch()
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) rollbackReplacements(queryClient, ctx.previous)
    },
    onSuccess: () => {
      void source.saved()
    },
  })
}

export function useDeleteGlobalReplacements() {
  const source = useReplacementSource()
  return useMutation({
    networkMode: source.local ? 'always' : 'online',
    mutationFn: async (body: RuleBatchDeleteReq & { expectedVersions?: Record<string, number> }) => {
      // Batch delete is offered for the global set, so it follows the global owner.
      const scope = source.deviceFor(null)
      if (scope) { await repository.deleteReplacements(scope.vaultId, body.ruleIds.map((id) => ({ id, version: body.expectedVersions?.[id] ?? source.version(id) }))); return { data: null } }
      source.assertCurrent(); const result = await apiPost<{ data: null }>('/replacements/batch-delete', { ruleIds: body.ruleIds }); source.assertCurrent(); return result
    },
    onSuccess: () => {
      return source.saved()
    },
  })
}
