import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import type { BookDetailRes, CatalogBook, ReTocReq, TocPreviewReq, TocPreviewRes, TocRuleCreateReq, TocRuleRes, TocRuleUpdateReq } from '@bookdock/shared'

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

/** Content target for TOC/append operations: a private book, or a city version. */
export type TocTarget =
  | { bookId: string }
  | { libraryId: string; libraryBookId: string; versionLinkId: string }

export function tocBasePath(target: TocTarget): string {
  return 'bookId' in target
    ? `/books/${target.bookId}`
    : `/libraries/${target.libraryId}/books/${target.libraryBookId}/versions/${target.versionLinkId}`
}

/** Reads the version's own rule by id; used to page a preview past its first window. */
export function tocPreviewPost(target: TocTarget, req: TocPreviewReq): Promise<unknown> {
  return apiPost(`${tocBasePath(target)}/toc-preview`, req)
}

/** Pin + re-split (POST re-toc). Private books refresh their own caches; city targets invalidate the catalog. */
export function useReToc(target: TocTarget | undefined) {
  const queryClient = useQueryClient()
  const bookId = target && 'bookId' in target ? target.bookId : undefined
  return useMutation({
    mutationFn: (body: ReTocReq) => {
      if (!target) throw new Error('re-toc requires a target')
      return apiPost<{ data: BookDetailRes & { book?: CatalogBook } }>(`${tocBasePath(target)}/re-toc`, body)
    },
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      if (!target || 'bookId' in target) {
        queryClient.setQueryData(['books', 'detail', bookId], response)
        queryClient.setQueryData(['book', bookId], response)
        void queryClient.invalidateQueries({ queryKey: ['book', bookId] })
        void queryClient.invalidateQueries({ queryKey: ['chapters', bookId] })
        void queryClient.invalidateQueries({ queryKey: ['progress', bookId] })
      } else {
        void queryClient.invalidateQueries({ queryKey: ['libraries', target.libraryId, 'catalog'] })
        invalidateCityVersionQueries(queryClient, response.data.book, target.versionLinkId)
      }
    },
  })
}

/**
 * Shared-library content writes answer the catalog work, not the private detail: resolve
 * its version id to retire the same version-scoped caches private writes do.
 * Without this the reader keeps painting the pre-write chapters (staleTime is
 * Infinity) until its renderer re-parses the new bytes — a stale-TOC flash on
 * every entry.
 */
export function invalidateCityVersionQueries(
  queryClient: QueryClient,
  book: CatalogBook | undefined,
  versionLinkId: string,
) {
  const versionId = book?.versions.find((version) => version.id === versionLinkId)?.bookVersionId
  if (!versionId) return
  void queryClient.invalidateQueries({ queryKey: ['book', versionId] })
  void queryClient.invalidateQueries({ queryKey: ['books', 'detail', versionId] })
  void queryClient.invalidateQueries({ queryKey: ['chapters', versionId] })
  void queryClient.invalidateQueries({ queryKey: ['progress', versionId] })
}

export function useTocPreview(
  target: TocTarget | undefined,
  req: TocPreviewReq,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['toc-preview', target, req],
    queryFn: () => {
      if (!target) throw new Error('toc preview requires a target')
      return apiPost<{ data: TocPreviewRes }>(`${tocBasePath(target)}/toc-preview`, req)
    },
    enabled: options?.enabled !== false && Boolean(target),
    staleTime: 60 * 1000,
  })
}
