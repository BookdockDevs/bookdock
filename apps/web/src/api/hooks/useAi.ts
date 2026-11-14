import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { AiChatJobRes, AiConfigRes, AiConfigUpdateReq, AiConnectionCreateReq, AiConnectionModelTestRes, AiConnectionRes, AiConnectionUpdateReq, AiMessageRevisionRes, AiModelEntryCreateReq, AiModelEntryRes, AiModelEntryUpdateReq, AiModelKind, AiPromptCreateReq, AiPromptTemplate, AiPromptUpdateReq, AiProviderRes, AiThreadDetailRes, AiThreadRes, AiThreadUpdateReq } from '@bookdock/shared'

import { useLocalReader } from '@/features/reading-data/reader-source-context'
import { assertSessionEpoch, getSessionEpoch } from '@/lib/session-scope'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorMessage } from '@/lib/error-message'
import { useAuthStore } from '@/stores/auth.store'

import { ApiError, apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../client'

export const AI_CONFIG_KEY = ['ai', 'config'] as const
export const aiConfigKey = (accountId: string | null) => [...AI_CONFIG_KEY, 'account', accountId] as const
/** Execution status is account-scoped so a switched account never reuses the previous list. */
export const aiStatusKey = (accountId: string | null) => ['ai-status', 'account', accountId] as const
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
    onSuccess: (response) => {
      if (useAuthStore.getState().user?.id !== accountId) return
      queryClient.setQueryData(configKey, response)
      void queryClient.invalidateQueries({ queryKey: ['ai-status'] })
    },
  })
}

function invalidateAiCatalog(queryClient: ReturnType<typeof useQueryClient>, accountId: string | null) {
  if (useAuthStore.getState().user?.id !== accountId) return
  void queryClient.invalidateQueries({ queryKey: aiConfigKey(accountId) })
  void queryClient.invalidateQueries({ queryKey: ['ai-status'] })
}

/**
 * Quick commands are definition rows: these mutations touch one command each,
 * so a personal switch never rewrites the publisher's text and a copy never
 * depends on what the client last cached.
 */
export function useCreateAiPrompt() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'create-prompt'],
    mutationFn: (body: AiPromptCreateReq) => requestForAiAccount(accountId, () => apiPost<{ data: AiPromptTemplate }>('/ai/prompts', body)),
    onSuccess: () => invalidateAiCatalog(queryClient, accountId),
  })
}

export function useUpdateAiPrompt() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'update-prompt'],
    mutationFn: ({ id, body }: { id: string; body: AiPromptUpdateReq }) => requestForAiAccount(accountId, () => apiPatch<{ data: AiPromptTemplate }>(`/ai/prompts/${id}`, body)),
    onSuccess: () => invalidateAiCatalog(queryClient, accountId),
  })
}

export function useDeleteAiPrompt() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'delete-prompt'],
    mutationFn: (id: string) => requestForAiAccount(accountId, () => apiDelete<{ data: null }>(`/ai/prompts/${id}`)),
    onSuccess: () => invalidateAiCatalog(queryClient, accountId),
  })
}

export function useReorderAiPrompts() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'reorder-prompts'],
    mutationFn: (ids: string[]) => requestForAiAccount(accountId, () => apiPut<{ data: AiPromptTemplate[] }>('/ai/prompts/reorder', { ids })),
    onSuccess: (response) => {
      if (useAuthStore.getState().user?.id !== accountId) return
      const config = queryClient.getQueryData<{ data: AiConfigRes }>(aiConfigKey(accountId))
      if (config) queryClient.setQueryData(aiConfigKey(accountId), { data: { ...config.data, prompts: response.data } })
      void queryClient.invalidateQueries({ queryKey: ['ai-status'] })
    },
  })
}

export function useRestoreAiPrompts() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'restore-prompts'],
    mutationFn: () => requestForAiAccount(accountId, () => apiPost<{ data: AiPromptTemplate[] }>('/ai/prompts/restore')),
    onSuccess: (response) => {
      if (useAuthStore.getState().user?.id !== accountId) return
      const config = queryClient.getQueryData<{ data: AiConfigRes }>(aiConfigKey(accountId))
      if (config) queryClient.setQueryData(aiConfigKey(accountId), { data: { ...config.data, prompts: response.data } })
      void queryClient.invalidateQueries({ queryKey: ['ai-status'] })
    },
  })
}

export function useCreateAiConnection() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'create-connection'],
    mutationFn: (body: AiConnectionCreateReq) => requestForAiAccount(accountId, () => apiPost<{ data: AiConnectionRes }>('/ai/connections', body)),
    onSuccess: () => invalidateAiCatalog(queryClient, accountId),
  })
}

export function useUpdateAiConnection() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'update-connection'],
    mutationFn: ({ id, body }: { id: string; body: AiConnectionUpdateReq }) => requestForAiAccount(accountId, () => apiPatch<{ data: AiConnectionRes }>(`/ai/connections/${id}`, body)),
    onSuccess: () => invalidateAiCatalog(queryClient, accountId),
  })
}

export function useDeleteAiConnection() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'delete-connection'],
    mutationFn: (id: string) => requestForAiAccount(accountId, () => apiDelete<{ data: null }>(`/ai/connections/${id}`)),
    onSuccess: () => invalidateAiCatalog(queryClient, accountId),
  })
}

export function useCreateAiModel() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'create-model'],
    mutationFn: ({ connectionId, body }: { connectionId: string; body: AiModelEntryCreateReq }) => requestForAiAccount(accountId, () => apiPost<{ data: AiModelEntryRes }>(`/ai/connections/${connectionId}/models`, body)),
    onSuccess: () => invalidateAiCatalog(queryClient, accountId),
  })
}

export function useUpdateAiModel() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'update-model'],
    mutationFn: ({ id, body }: { id: string; body: AiModelEntryUpdateReq }) => requestForAiAccount(accountId, () => apiPatch<{ data: AiModelEntryRes }>(`/ai/models/${id}`, body)),
    onSuccess: () => invalidateAiCatalog(queryClient, accountId),
  })
}

export function useDeleteAiModel() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'delete-model'],
    mutationFn: (id: string) => requestForAiAccount(accountId, () => apiDelete<{ data: null }>(`/ai/models/${id}`)),
    onSuccess: () => invalidateAiCatalog(queryClient, accountId),
  })
}

/** Discovery refresh merges on the upstream id and never deletes unknown entries. */
export function useRefreshAiConnectionModels() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...aiConfigKey(accountId), 'refresh-models'],
    mutationFn: ({ connectionId, kind }: { connectionId: string; kind?: AiModelKind }) => requestForAiAccount(accountId, () => apiPost<{ data: AiModelEntryRes[] }>(`/ai/connections/${connectionId}/models/discover`, { kind })),
    onSuccess: () => invalidateAiCatalog(queryClient, accountId),
  })
}

export function useTestAiModel() {
  return useMutation({
    mutationFn: (id: string) => apiPost<{ data: AiConnectionModelTestRes }>(`/ai/models/${id}/test`),
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
