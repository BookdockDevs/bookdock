import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import type { BookDetailRes, ReTocReq, TocPreviewReq, TocPreviewRes, TocRuleCreateReq, TocRuleRes, TocRuleUpdateReq } from '@bookdock/shared'

import { apiDelete, apiGet, apiPost, apiPut } from '../client'

const TOC_RULES_KEY = ['toc-rules'] as const

type TocRulesCache = { data: TocRuleRes[] }

function snapshotTocRules(queryClient: QueryClient) {
  return queryClient.getQueryData<TocRulesCache>(TOC_RULES_KEY)
}

export function useTocRules() {
  return useQuery({
    queryKey: TOC_RULES_KEY,
    queryFn: () => apiGet<{ data: TocRuleRes[] }>('/toc-rules'),
  })
}

export function useCreateTocRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: TocRuleCreateReq) => apiPost<{ data: TocRuleRes }>('/toc-rules', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TOC_RULES_KEY })
    },
  })
}

export function useUpdateTocRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TocRuleUpdateReq }) =>
      apiPut<{ data: TocRuleRes }>(`/toc-rules/${id}`, body),
    onMutate: async ({ id, body }) => {
      const previous = snapshotTocRules(queryClient)
      const applyOptimisticPatch = () => queryClient.setQueryData<TocRulesCache>(TOC_RULES_KEY, (old) =>
        old ? { data: old.data.map((rule) => rule.id === id ? { ...rule, ...body } : rule) } : old,
      )
      applyOptimisticPatch()
      await queryClient.cancelQueries({ queryKey: TOC_RULES_KEY })
      applyOptimisticPatch()
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(TOC_RULES_KEY, context.previous)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TOC_RULES_KEY })
    },
  })
}

export function useDeleteTocRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/toc-rules/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TOC_RULES_KEY })
    },
  })
}

export function useReorderTocRules() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tocRuleIds: string[]) => apiPut<{ data: TocRuleRes[] }>('/toc-rules/reorder', { tocRuleIds }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TOC_RULES_KEY })
    },
  })
}

export function useSeedTocRules() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => apiPost<{ data: TocRuleRes[] }>('/toc-rules/seed'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TOC_RULES_KEY })
    },
  })
}

/** Pin + re-split a book (POST /books/:id/re-toc). Returns the refreshed book. */
export function useReToc(bookId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ReTocReq) =>
      apiPost<{ data: BookDetailRes }>(`/books/${bookId}/re-toc`, body),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      queryClient.setQueryData(['books', 'detail', bookId], response)
      queryClient.setQueryData(['book', bookId], response)
      void queryClient.invalidateQueries({ queryKey: ['book', bookId] })
      void queryClient.invalidateQueries({ queryKey: ['chapters', bookId] })
      void queryClient.invalidateQueries({ queryKey: ['progress', bookId] })
      queryClient.removeQueries({ queryKey: ['chapters', bookId], type: 'inactive' })
      queryClient.removeQueries({ queryKey: ['progress', bookId], type: 'inactive' })
    },
  })
}

export function useTocPreview(
  bookId: string | undefined,
  req: TocPreviewReq,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['books', bookId, 'toc-preview', req],
    queryFn: () => apiPost<{ data: TocPreviewRes }>(`/books/${bookId}/toc-preview`, req),
    enabled: options?.enabled !== false && Boolean(bookId),
    staleTime: 60 * 1000,
  })
}
