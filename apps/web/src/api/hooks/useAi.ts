import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { AiConfigRes, AiConfigTestReq, AiConnectionTestRes, AiMessageRevisionRes, AiModelDiscoveryReq, AiModelRes, AiConfigUpdateReq, AiProfileCreateReq, AiProfileRes, AiProfileUpdateReq, AiProviderRes, AiThreadDetailRes, AiThreadRes, AiThreadUpdateReq } from '@bookdock/shared'

import { apiDelete, apiGet, apiPatch, apiPost } from '../client'

export const AI_CONFIG_KEY = ['ai', 'config'] as const
export const AI_PROVIDERS_KEY = ['ai', 'providers'] as const
export const AI_THREADS_KEY = ['ai', 'threads'] as const

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

export function useAiMessageRevisions(threadId: string | null, messageId: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...AI_THREADS_KEY, 'revisions', threadId, messageId],
    queryFn: () => apiGet<{ data: AiMessageRevisionRes[] }>(`/ai/threads/${threadId}/messages/${messageId}/revisions`),
    enabled: (options?.enabled ?? true) && Boolean(threadId && messageId),
  })
}

export function useSelectAiMessageRevision() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ threadId, messageId }: { threadId: string; messageId: string }) => apiPost<{ data: AiMessageRevisionRes }>(`/ai/threads/${threadId}/messages/${messageId}/revisions/select`),
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: [...AI_THREADS_KEY, 'detail', variables.threadId] })
      void queryClient.invalidateQueries({ queryKey: [...AI_THREADS_KEY, 'revisions', variables.threadId] })
      void queryClient.invalidateQueries({ queryKey: AI_THREADS_KEY })
    },
  })
}

export function useUpdateAiConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: AiConfigUpdateReq) => apiPatch<{ data: AiConfigRes }>('/ai/config', body),
    onMutate: async (body) => {
      if (body.prompts === undefined || body.prompts === null) return undefined
      const previous = queryClient.getQueryData<{ data: AiConfigRes }>(AI_CONFIG_KEY)
      const next = previous ? {
        data: {
          ...previous.data,
          prompts: body.prompts.map((prompt, index) => {
            const previousPrompt = previous.data.prompts.find((item) => item.id === prompt.id)
            return {
              id: prompt.id,
              name: prompt.name,
              prompt: prompt.prompt,
              scope: previousPrompt?.scope ?? prompt.scope ?? 'both',
              enabled: prompt.enabled ?? previousPrompt?.enabled ?? true,
              order: prompt.order ?? previousPrompt?.order ?? (index + 1) * 10,
              builtIn: previousPrompt?.builtIn ?? false,
            }
          }),
        },
      } : undefined
      if (next) queryClient.setQueryData(AI_CONFIG_KEY, next)
      await queryClient.cancelQueries({ queryKey: AI_CONFIG_KEY })
      if (next) queryClient.setQueryData(AI_CONFIG_KEY, next)
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(AI_CONFIG_KEY, context.previous)
    },
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
