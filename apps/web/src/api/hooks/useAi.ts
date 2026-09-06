import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { AiConfigRes, AiConfigTestReq, AiConnectionTestRes, AiIndexReq, AiIndexRes, AiModelDiscoveryReq, AiModelRes, AiConfigUpdateReq, AiProfileCreateReq, AiProfileRes, AiProfileUpdateReq, AiProviderRes, AiThreadCreateReq, AiThreadDetailRes, AiThreadRes, AiThreadUpdateReq } from '@bookdock/shared'

import { apiDelete, apiGet, apiPatch, apiPost } from '../client'

export const AI_CONFIG_KEY = ['ai', 'config'] as const
export const AI_PROVIDERS_KEY = ['ai', 'providers'] as const
export const AI_THREADS_KEY = ['ai', 'threads'] as const
export const AI_RETRIEVAL_KEY = ['ai', 'retrieval'] as const

export function useAiProviders(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: AI_PROVIDERS_KEY,
    queryFn: () => apiGet<{ data: AiProviderRes[] }>('/ai/providers'),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  })
}

export function useAiConfig(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: AI_CONFIG_KEY,
    queryFn: () => apiGet<{ data: AiConfigRes }>('/ai/config'),
    enabled: options?.enabled ?? true,
    retry: false,
  })
}

export function useAiThreads(bookId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...AI_THREADS_KEY, bookId],
    queryFn: () => apiGet<{ data: AiThreadRes[] }>(`/ai/threads?bookId=${encodeURIComponent(bookId)}`),
    enabled: options?.enabled ?? Boolean(bookId),
    staleTime: 30 * 1000,
  })
}

export function useAiThread(threadId: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...AI_THREADS_KEY, 'detail', threadId],
    queryFn: () => apiGet<{ data: AiThreadDetailRes }>(`/ai/threads/${threadId}`),
    enabled: (options?.enabled ?? true) && Boolean(threadId),
  })
}

export function useAiIndexStatus(bookId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...AI_RETRIEVAL_KEY, 'status', bookId],
    queryFn: () => apiGet<{ data: AiIndexRes }>(`/ai/retrieval/status?bookId=${encodeURIComponent(bookId)}`),
    enabled: (options?.enabled ?? true) && Boolean(bookId),
    staleTime: 30 * 1000,
    refetchInterval: (query) => query.state.data?.data.status === 'indexing' ? 750 : false,
  })
}

export function useIndexAiBook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: AiIndexReq & { signal?: AbortSignal }) => {
      const { signal, ...body } = input
      return signal
        ? apiPost<{ data: AiIndexRes }>('/ai/retrieval/index', body, signal)
        : apiPost<{ data: AiIndexRes }>('/ai/retrieval/index', body)
    },
    onMutate: ({ bookId }) => {
      const key = [...AI_RETRIEVAL_KEY, 'status', bookId]
      const current = queryClient.getQueryData<{ data: AiIndexRes }>(key)
      queryClient.setQueryData(key, {
        data: {
          bookId,
          status: 'indexing',
          embeddingStatus: 'not_indexed',
          progress: 0,
          chunkCount: current?.data.chunkCount ?? 0,
          updatedAt: current?.data.updatedAt ?? null,
        } satisfies AiIndexRes,
      })
    },
    onSuccess: (response) => {
      queryClient.setQueryData([...AI_RETRIEVAL_KEY, 'status', response.data.bookId], response)
    },
    onSettled: (_response, _error, input) => {
      void queryClient.invalidateQueries({ queryKey: [...AI_RETRIEVAL_KEY, 'status', input.bookId] })
    },
  })
}

export function useCancelAiBookIndex() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: AiIndexReq) => apiPost<{ data: AiIndexRes }>('/ai/retrieval/index/cancel', body),
    onSuccess: (response) => {
      queryClient.setQueryData([...AI_RETRIEVAL_KEY, 'status', response.data.bookId], response)
    },
  })
}

export function useClearAiBookIndex() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (bookId: string) => apiDelete<{ data: null }>(`/ai/retrieval/index?bookId=${encodeURIComponent(bookId)}`),
    onSuccess: (_response, bookId) => {
      queryClient.setQueryData<{ data: AiIndexRes }>([...AI_RETRIEVAL_KEY, 'status', bookId], { data: { bookId, status: 'not_indexed', embeddingStatus: 'not_indexed', progress: 0, chunkCount: 0, updatedAt: null } })
    },
  })
}

export function useUpdateAiConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: AiConfigUpdateReq) => apiPatch<{ data: AiConfigRes }>('/ai/config', body),
    onSuccess: (response) => {
      queryClient.setQueryData(AI_CONFIG_KEY, response)
      void queryClient.invalidateQueries({ queryKey: ['ai-status'] })
    },
  })
}

export function useCreateAiProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: AiProfileCreateReq) => apiPost<{ data: AiProfileRes }>('/ai/profiles', body),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: AI_CONFIG_KEY }); void queryClient.invalidateQueries({ queryKey: ['ai-status'] }) },
  })
}

export function useUpdateAiProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AiProfileUpdateReq }) => apiPatch<{ data: AiProfileRes }>(`/ai/profiles/${id}`, body),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: AI_CONFIG_KEY }); void queryClient.invalidateQueries({ queryKey: ['ai-status'] }) },
  })
}

export function useDeleteAiProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete<{ data: null }>(`/ai/profiles/${id}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: AI_CONFIG_KEY }); void queryClient.invalidateQueries({ queryKey: ['ai-status'] }) },
  })
}

export function useActivateAiProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (activeProfileId: string) => apiPatch<{ data: AiConfigRes }>('/ai/config', { activeProfileId }),
    onSuccess: (response) => { queryClient.setQueryData(AI_CONFIG_KEY, response); void queryClient.invalidateQueries({ queryKey: ['ai-status'] }) },
  })
}

export function useFetchAiModels() {
  return useMutation({
    mutationFn: (body: AiModelDiscoveryReq) => apiPost<{ data: AiModelRes[] }>('/ai/models', body),
  })
}

export function useTestAiConfigDraft() {
  return useMutation({
    mutationFn: (body: AiConfigTestReq) => apiPost<{ data: AiConnectionTestRes }>('/ai/test', body),
  })
}

export function useTestAiConfig() {
  return useMutation({
    mutationFn: () => apiPost<{ data: AiConnectionTestRes }>('/ai/config/test'),
  })
}

export function useCreateAiThread() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: AiThreadCreateReq) => apiPost<{ data: AiThreadRes }>('/ai/threads', body),
    onSuccess: (response) => { void queryClient.invalidateQueries({ queryKey: [...AI_THREADS_KEY, response.data.bookId] }) },
  })
}

export function useUpdateAiThread() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AiThreadUpdateReq }) => apiPatch<{ data: AiThreadRes }>(`/ai/threads/${id}`, body),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: [...AI_THREADS_KEY, response.data.bookId] })
      void queryClient.invalidateQueries({ queryKey: [...AI_THREADS_KEY, 'detail', response.data.id] })
    },
  })
}

export function useDeleteAiThread() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; bookId: string }) => apiDelete<{ data: null }>(`/ai/threads/${id}`),
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: [...AI_THREADS_KEY, variables.bookId] })
      queryClient.removeQueries({ queryKey: [...AI_THREADS_KEY, 'detail', variables.id] })
    },
  })
}
