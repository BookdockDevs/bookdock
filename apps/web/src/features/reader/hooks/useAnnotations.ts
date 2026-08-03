import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import type { AnnotationRes, AnnotationCreateReq, AnnotationUpdateReq } from '@bookdock/shared'

import { apiGet, apiPost, apiPut, apiDelete } from '@/api/client'

import { cfiRangesOverlap, loadCfiModule } from '../lib/cfi-overlap'

type AnnotationsCache = { data: AnnotationRes[] }

export function useAnnotations(bookId: string) {
  return useQuery({
    queryKey: ['annotations', bookId],
    queryFn: () => apiGet<AnnotationsCache>(`/annotations/book/${bookId}`),
    enabled: !!bookId,
  })
}

export function useCreateAnnotation(bookId: string) {
  const queryClient = useQueryClient()
  const key = ['annotations', bookId] as const
  return useMutation({
    mutationFn: (body: AnnotationCreateReq) =>
      apiPost<{ data: AnnotationRes }>(`/annotations/book/${bookId}`, body),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<AnnotationsCache>(key)
      const now = Date.now()
      const optimistic: AnnotationRes = {
        id: `temp-${now}-${Math.random().toString(36).slice(2, 8)}`,
        bookId,
        cfiRange: body.cfiRange,
        cfiAnchor: body.cfiAnchor ?? null,
        type: body.type,
        color: body.color ?? 'yellow',
        style: body.style ?? 'underline',
        text: body.text ?? '',
        note: body.note ?? null,
        chapter: body.chapter ?? null,
        createdAt: now,
        updatedAt: now,
      }
      // A new highlight replaces any overlapping highlight (strategy A):
      // drop them from the cache now, soft-delete them on the server before
      // the POST goes out (awaiting avoids a same-range restore being
      // re-deleted by a late DELETE). Notes/bookmarks never participate.
      let replacedIds: string[] = []
      if (body.type === 'highlight' && previous?.data?.length) {
        try {
          const cfi = await loadCfiModule()
          replacedIds = previous.data
            .filter((a) => a.type === 'highlight' && cfiRangesOverlap(cfi, a.cfiRange, body.cfiRange))
            .map((a) => a.id)
        } catch { /* CFI module unavailable — skip replacement */ }
        if (replacedIds.length) {
          await Promise.all(replacedIds.map((id) => apiDelete(`/annotations/${id}`).catch(() => {})))
        }
      }
      const replaced = new Set(replacedIds)
      queryClient.setQueryData<AnnotationsCache>(key, (old) => ({
        data: [...(old?.data ?? []).filter((a) => !replaced.has(a.id)), optimistic],
      }))
      return { previous, optimisticId: optimistic.id }
    },
    onError: (_err, _body, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSuccess: (res, _body, context) => {
      queryClient.setQueryData<AnnotationsCache>(key, (old) =>
        old ? { data: old.data.map((a) => (a.id === context?.optimisticId ? res.data : a)) } : old,
      )
    },
    // Not awaited on purpose: mutateAsync resolves as soon as the POST does,
    // the refetch resyncs the cache (including overlap deletes) in the background
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
}

export function useUpdateAnnotation(bookId: string) {
  const queryClient = useQueryClient()
  const key = ['annotations', bookId] as const
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AnnotationUpdateReq }) =>
      apiPut<{ data: AnnotationRes }>(`/annotations/${id}`, body),
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<AnnotationsCache>(key)
      queryClient.setQueryData<AnnotationsCache>(key, (old) =>
        old
          ? { data: old.data.map((a) => (a.id === id ? { ...a, ...body, updatedAt: Date.now() } : a)) }
          : old,
      )
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    // Not awaited on purpose: the refetch resyncs the cache in the background
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
}

export function useDeleteAnnotation(bookId: string) {
  const queryClient = useQueryClient()
  const key = ['annotations', bookId] as const
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/annotations/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<AnnotationsCache>(key)
      queryClient.setQueryData<AnnotationsCache>(key, (old) =>
        old ? { data: old.data.filter((a) => a.id !== id) } : old,
      )
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
}
