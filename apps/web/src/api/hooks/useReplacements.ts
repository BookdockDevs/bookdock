import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import type { TextReplacementRes, ReplacementCreateReq, ReplacementOverrideReq, ReplacementUpdateReq } from '@bookdock/shared'

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

/** All replacements owned by the current user */
export function useReplacements() {
  return useQuery({
    queryKey: REPLACEMENTS_KEY,
    queryFn: () => apiGet<ReplacementsCache>('/replacements'),
  })
}

/** All pattern rules (with per-book override applied) + the book's point patches */
export function useBookReplacements(bookId: string | undefined) {
  return useQuery({
    queryKey: [...REPLACEMENTS_KEY, 'book', bookId],
    queryFn: () => apiGet<ReplacementsCache>(`/replacements?bookId=${bookId}`),
    enabled: !!bookId,
  })
}

export function useCreateReplacement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ReplacementCreateReq) => apiPost<{ data: TextReplacementRes }>('/replacements', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REPLACEMENTS_KEY })
    },
  })
}

export function useUpdateReplacement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReplacementUpdateReq }) =>
      apiPut<{ data: TextReplacementRes }>(`/replacements/${id}`, body),
    onMutate: async ({ id, body }) => {
      // Only the enabled flip is optimistic; edits go through the refetch
      if (body.enabled === undefined) return undefined
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
      void queryClient.invalidateQueries({ queryKey: REPLACEMENTS_KEY })
    },
  })
}

export function useDeleteReplacement() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/replacements/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REPLACEMENTS_KEY })
    },
  })
}

/** Per-book override for a pattern rule: boolean sets it, null restores global inheritance */
export function useSetReplacementOverride() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ replacementId, body }: { replacementId: string; body: ReplacementOverrideReq }) =>
      apiPut<{ data: TextReplacementRes }>(`/replacements/${replacementId}/override`, body),
    onMutate: async ({ replacementId, body }) => {
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
      void queryClient.invalidateQueries({ queryKey: REPLACEMENTS_KEY })
    },
  })
}
