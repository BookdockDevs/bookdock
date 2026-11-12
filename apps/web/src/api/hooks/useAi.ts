import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { AiChatJobRes, AiConfigRes, AiConfigTestReq, AiConnectionTestRes, AiMessageRevisionRes, AiModelDiscoveryReq, AiModelRes, AiConfigUpdateReq, AiProfileCreateReq, AiProfileRes, AiProfileUpdateReq, AiProviderRes, AiThreadDetailRes, AiThreadRes, AiThreadUpdateReq } from '@bookdock/shared'

import { useLocalReader } from '@/features/reading-data/reader-source-context'
import { assertSessionEpoch, getSessionEpoch } from '@/lib/session-scope'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage } from '@/lib/error-message'
import { useAuthStore } from '@/stores/auth.store'

import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from '../client'

export const AI_CONFIG_KEY = ['ai', 'config'] as const
export const aiConfigKey = (accountId: string | null) => [...AI_CONFIG_KEY, 'account', accountId] as const
export const AI_PROVIDERS_KEY = ['ai', 'providers'] as const
export const AI_THREADS_KEY = ['ai', 'threads'] as const
export const aiThreadsScopeKey = (bookId: string, localNamespace?: string | null) =>
  localNamespace ? [...AI_THREADS_KEY, localNamespace] as const : [...AI_THREADS_KEY, bookId] as const
export const aiThreadDetailKey = (threadId: string | null, localNamespace?: string | null) =>
  localNamespace ? [...AI_THREADS_KEY, localNamespace, 'detail', threadId] as const : [...AI_THREADS_KEY, 'detail', threadId] as const

async function requestForAiAccount<T>(accountId: string | null, send: () => Promise<T>): Promise<T> {
  if (!accountId || useAuthStore.getState().user?.id !== accountId) throw new DOMException('AI account changed', 'AbortError')
  const epoch = getSessionEpoch()
  const response = await send()
  assertSessionEpoch(epoch)
  return response
}

export function useAiProviders(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: AI_PROVIDERS_KEY,
    queryFn: () => apiGet<{ data: AiProviderRes[] }>('/ai/providers'),
    enabled: options?.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  })
}

export function useAiConfig(options?: { enabled?: boolean }) {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useQuery({
    queryKey: aiConfigKey(accountId),
    queryFn: async ({ signal }) => {
      if (!accountId || useAuthStore.getState().user?.id !== accountId) throw new DOMException('AI account changed', 'AbortError')
      const epoch = getSessionEpoch()
      const response = await apiGet<{ data: AiConfigRes }>('/ai/config', signal)
      signal.throwIfAborted()
      assertSessionEpoch(epoch)
      return response
    },
    enabled: Boolean(accountId) && options?.enabled !== false,
    retry: false,
  })
}

export function useAiThreads(bookId: string, options?: { enabled?: boolean }) {
  const local = useLocalReader()
  return useQuery({
    queryKey: aiThreadsScopeKey(bookId, local?.namespace),
    networkMode: local ? 'always' : 'online',
    queryFn: () => local ? local.listAiThreads() : apiGet<{ data: AiThreadRes[] }>(`/ai/threads?bookId=${encodeURIComponent(bookId)}`),
    enabled: options?.enabled ?? Boolean(bookId),
    staleTime: 30 * 1000,
  })
}

export function useAiThread(threadId: string | null, options?: { enabled?: boolean }) {
  const local = useLocalReader()
  return useQuery({
    queryKey: aiThreadDetailKey(threadId, local?.namespace),
    networkMode: local ? 'always' : 'online',
    queryFn: () => local ? local.getAiThread(threadId!) : apiGet<{ data: AiThreadDetailRes }>(`/ai/threads/${threadId}`),
    enabled: (options?.enabled ?? true) && Boolean(threadId),
  })
}

export const aiJobsKey = (accountId: string, kind: 'book' | 'local', scopeKey: string) => ['ai', 'jobs', accountId, kind, scopeKey] as const

export function useAiJobs(bookId: string) {
  const local = useLocalReader()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const queryClient = useQueryClient()
  const translate = useTranslation()
  const kind = local ? 'local' : 'book'
  const scopeKey = local?.namespace ?? bookId
  const queryKey = aiJobsKey(accountId ?? '', kind, scopeKey)
  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const epoch = getSessionEpoch()
      const previous = queryClient.getQueryData<{ data: AiChatJobRes[] }>(queryKey)
      const response = await apiGet<{ data: AiChatJobRes[] }>(`/ai/jobs?kind=${kind}&scopeKey=${encodeURIComponent(scopeKey)}`, signal)
      assertSessionEpoch(epoch)
      signal.throwIfAborted()
      if (!Array.isArray(response.data)) throw new ApiError('AI_PROVIDER_ERROR', 'Invalid AI job response')
      for (const job of response.data) {
        if (previous?.data.find((item) => item.id === job.id)?.updatedAt === job.updatedAt) continue
        if (local && job.threadId) {
          const error = job.error ? getUserErrorMessage(new ApiError(job.error.code, job.error.message), translate, 'reader.aiRequestFailed') : ''
          await local.applyAiThreadResult(job.threadId, job.clientRequestId, {
            content: job.content + (error ? `\n\n${translate('reader.aiRequestFailedWithMessage', { message: error })}` : ''),
            context: job.receipt, citations: job.citations, aborted: job.state !== 'running' && job.state !== 'completed',
          })
          assertSessionEpoch(epoch)
          if (job.state !== 'running') await apiPost(`/ai/jobs/${encodeURIComponent(job.id)}/acknowledge`)
        }
        if (job.threadId) void queryClient.invalidateQueries({ queryKey: aiThreadDetailKey(job.threadId, local?.namespace) })
        void queryClient.invalidateQueries({ queryKey: aiThreadsScopeKey(bookId, local?.namespace) })
      }
      return response
    },
    enabled: Boolean(accountId),
    refetchInterval: (query) => query.state.data?.data.some((job) => job.state === 'running') ? 500 : false,
    refetchOnMount: 'always',
    retry: false,
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
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const configKey = aiConfigKey(accountId)
  return useMutation({
    mutationKey: [...configKey, 'update'],
    mutationFn: (body: AiConfigUpdateReq) => requestForAiAccount(accountId, () => apiPatch<{ data: AiConfigRes }>('/ai/config', body)),
    onMutate: async (body) => {
      if (!accountId || useAuthStore.getState().user?.id !== accountId) throw new DOMException('AI account changed', 'AbortError')
      if (body.prompts === undefined || body.prompts === null) return undefined
      const previous = queryClient.getQueryData<{ data: AiConfigRes }>(configKey)
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
      if (next) queryClient.setQueryData(configKey, next)
      await queryClient.cancelQueries({ queryKey: configKey })
      if (next && useAuthStore.getState().user?.id === accountId) queryClient.setQueryData(configKey, next)
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous && useAuthStore.getState().user?.id === accountId) queryClient.setQueryData(configKey, context.previous)
    },
    onSuccess: (response) => {
      if (useAuthStore.getState().user?.id !== accountId) return
      queryClient.setQueryData(configKey, response)
      void queryClient.invalidateQueries({ queryKey: ['ai-status'] })
    },
  })
}

export function useCreateAiProfile() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'create-profile'],
    mutationFn: (body: AiProfileCreateReq) => requestForAiAccount(accountId, () => apiPost<{ data: AiProfileRes }>('/ai/profiles', body)),
    onSuccess: () => {
      if (useAuthStore.getState().user?.id !== accountId) return
      void queryClient.invalidateQueries({ queryKey: aiConfigKey(accountId) })
      void queryClient.invalidateQueries({ queryKey: ['ai-status'] })
    },
  })
}

export function useUpdateAiProfile() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'update-profile'],
    mutationFn: ({ id, body }: { id: string; body: AiProfileUpdateReq }) => requestForAiAccount(accountId, () => apiPatch<{ data: AiProfileRes }>(`/ai/profiles/${id}`, body)),
    onSuccess: () => {
      if (useAuthStore.getState().user?.id !== accountId) return
      void queryClient.invalidateQueries({ queryKey: aiConfigKey(accountId) })
      void queryClient.invalidateQueries({ queryKey: ['ai-status'] })
    },
  })
}

export function useDeleteAiProfile() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'delete-profile'],
    mutationFn: (id: string) => requestForAiAccount(accountId, () => apiDelete<{ data: null }>(`/ai/profiles/${id}`)),
    onSuccess: () => {
      if (useAuthStore.getState().user?.id !== accountId) return
      void queryClient.invalidateQueries({ queryKey: aiConfigKey(accountId) })
      void queryClient.invalidateQueries({ queryKey: ['ai-status'] })
    },
  })
}

export function useActivateAiProfile() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'activate-profile'],
    mutationFn: (activeProfileId: string) => requestForAiAccount(accountId, () => apiPatch<{ data: AiConfigRes }>('/ai/config', { activeProfileId })),
    onSuccess: (response) => {
      if (useAuthStore.getState().user?.id !== accountId) return
      queryClient.setQueryData(aiConfigKey(accountId), response)
      void queryClient.invalidateQueries({ queryKey: ['ai-status'] })
    },
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
  const local = useLocalReader()
  const queryClient = useQueryClient()
  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: ({ id, body }: { id: string; body: AiThreadUpdateReq }) =>
      local ? local.updateAiThread(id, body) : apiPatch<{ data: AiThreadRes }>(`/ai/threads/${id}`, body),
    onSuccess: (response) => {
      void queryClient.invalidateQueries({ queryKey: aiThreadsScopeKey(response.data.bookId, local?.namespace) })
      void queryClient.invalidateQueries({ queryKey: aiThreadDetailKey(response.data.id, local?.namespace) })
    },
  })
}

export function useDeleteAiThread() {
  const local = useLocalReader()
  const queryClient = useQueryClient()
  return useMutation({
    networkMode: local ? 'always' : 'online',
    mutationFn: ({ id }: { id: string; bookId: string }) =>
      local ? local.deleteAiThread(id).then(() => ({ data: null })) : apiDelete<{ data: null }>(`/ai/threads/${id}`),
    onSuccess: (_response, variables) => {
      void queryClient.invalidateQueries({ queryKey: aiThreadsScopeKey(variables.bookId, local?.namespace) })
      queryClient.removeQueries({ queryKey: aiThreadDetailKey(variables.id, local?.namespace) })
    },
  })
}
