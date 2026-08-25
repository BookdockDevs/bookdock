import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import type { TextTransformRes, TransformCreateReq, TransformOverrideReq, TransformUpdateReq } from '@bookdock/shared'

import { apiDelete, apiGet, apiPost, apiPut } from '../client'

const TRANSFORMS_KEY = ['transforms'] as const

type TransformsCache = { data: TextTransformRes[] }

// Optimistic row patch shared by the toggle mutations: both the plain list and
// the per-book queries live under ['transforms'], so a prefix setQueriesData
// keeps every open view in sync until the refetch lands.
function patchTransformRows(queryClient: QueryClient, id: string, patch: (row: TextTransformRes) => TextTransformRes) {
  queryClient.setQueriesData<TransformsCache>({ queryKey: TRANSFORMS_KEY }, (old) =>
    old ? { data: old.data.map((r) => (r.id === id ? patch(r) : r)) } : old,
  )
}

function snapshotTransforms(queryClient: QueryClient) {
  return queryClient.getQueriesData<TransformsCache>({ queryKey: TRANSFORMS_KEY })
}

function rollbackTransforms(queryClient: QueryClient, previous: ReturnType<typeof snapshotTransforms>) {
  for (const [key, data] of previous) queryClient.setQueryData(key, data)
}

/** All transforms owned by the current user */
export function useTransforms() {
  return useQuery({
    queryKey: TRANSFORMS_KEY,
    queryFn: () => apiGet<TransformsCache>('/transforms'),
  })
}

/** All pattern rules (with per-book override applied) + the book's point patches */
export function useBookTransforms(bookId: string | undefined) {
  return useQuery({
    queryKey: [...TRANSFORMS_KEY, 'book', bookId],
    queryFn: () => apiGet<TransformsCache>(`/transforms?bookId=${bookId}`),
    enabled: !!bookId,
  })
}

export function useCreateTransform() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: TransformCreateReq) => apiPost<{ data: TextTransformRes }>('/transforms', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TRANSFORMS_KEY })
    },
  })
}

export function useUpdateTransform() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TransformUpdateReq }) =>
      apiPut<{ data: TextTransformRes }>(`/transforms/${id}`, body),
    onMutate: async ({ id, body }) => {
      // Only the enabled flip is optimistic; edits go through the refetch
      if (body.enabled === undefined) return undefined
      await queryClient.cancelQueries({ queryKey: TRANSFORMS_KEY })
      const previous = snapshotTransforms(queryClient)
      patchTransformRows(queryClient, id, (r) => {
        const next = { ...r, enabled: body.enabled! }
        // Book-scoped rows show the effective value: a per-book override still
        // wins; without one the global flip is the effective flip
        if (r.effectiveEnabled !== undefined) {
          next.effectiveEnabled = r.hasOverride ? r.effectiveEnabled : body.enabled!
        }
        return next
      })
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) rollbackTransforms(queryClient, ctx.previous)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TRANSFORMS_KEY })
    },
  })
}

export function useDeleteTransform() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/transforms/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TRANSFORMS_KEY })
    },
  })
}

/** Per-book override for a pattern rule: boolean sets it, null restores global inheritance */
export function useSetTransformOverride() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ transformId, body }: { transformId: string; body: TransformOverrideReq }) =>
      apiPut<{ data: TextTransformRes }>(`/transforms/${transformId}/override`, body),
    onMutate: async ({ transformId, body }) => {
      await queryClient.cancelQueries({ queryKey: TRANSFORMS_KEY })
      const previous = snapshotTransforms(queryClient)
      patchTransformRows(queryClient, transformId, (r) =>
        body.enabled === null
          ? { ...r, hasOverride: false, effectiveEnabled: r.enabled }
          : { ...r, hasOverride: true, effectiveEnabled: body.enabled },
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) rollbackTransforms(queryClient, ctx.previous)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TRANSFORMS_KEY })
    },
  })
}
