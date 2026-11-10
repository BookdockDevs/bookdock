import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { TtsProviderRes, TtsServiceCreateReq, TtsServiceRes, TtsServiceUpdateReq, TtsVoiceRes } from '@bookdock/shared'

import { assertSessionEpoch, getSessionEpoch } from '@/lib/session-scope'
import { useAuthStore } from '@/stores/auth.store'

import { apiDelete, apiGet, apiPost, apiPut } from '../client'

export const TTS_PROVIDERS_KEY = ['tts', 'providers'] as const
export const TTS_SERVICES_KEY = ['tts', 'services'] as const
export const ttsServicesKey = (accountId: string | null) => [...TTS_SERVICES_KEY, 'account', accountId] as const

async function requestForTtsAccount<T>(accountId: string | null, send: () => Promise<T>): Promise<T> {
  if (!accountId || useAuthStore.getState().user?.id !== accountId) throw new DOMException('Speech account changed', 'AbortError')
  const epoch = getSessionEpoch()
  const response = await send()
  assertSessionEpoch(epoch)
  return response
}

export function useTtsProviders(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: TTS_PROVIDERS_KEY,
    queryFn: () => apiGet<{ data: TtsProviderRes[] }>('/tts/providers'),
    enabled: options.enabled !== false,
  })
}

export function useTtsServices(options: { enabled?: boolean } = {}) {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useQuery({
    queryKey: ttsServicesKey(accountId),
    queryFn: async ({ signal }) => {
      const response = await requestForTtsAccount(accountId, () => apiGet<{ data: TtsServiceRes[] }>('/tts/services', signal))
      signal.throwIfAborted()
      return response
    },
    enabled: Boolean(accountId) && options.enabled !== false,
  })
}

export function useTtsServiceVoices(serviceId: string | null | undefined) {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useQuery({
    queryKey: ['tts', 'voices', 'account', accountId, serviceId],
    queryFn: async ({ signal }) => {
      if (!serviceId) throw new DOMException('Speech service is unavailable', 'AbortError')
      const response = await requestForTtsAccount(accountId, () => apiGet<{ data: TtsVoiceRes[] }>(`/tts/services/${encodeURIComponent(serviceId)}/voices`, signal))
      signal.throwIfAborted()
      return response
    },
    enabled: Boolean(accountId && serviceId),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateTtsService() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...ttsServicesKey(accountId), 'create'],
    mutationFn: (body: TtsServiceCreateReq) => requestForTtsAccount(accountId, () => apiPost<{ data: TtsServiceRes }>('/tts/services', body)),
    onSuccess: () => { if (useAuthStore.getState().user?.id === accountId) void queryClient.invalidateQueries({ queryKey: ttsServicesKey(accountId) }) },
  })
}

export function useUpdateTtsService() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...ttsServicesKey(accountId), 'update'],
    mutationFn: ({ id, body }: { id: string; body: TtsServiceUpdateReq }) => requestForTtsAccount(accountId, () => apiPut<{ data: TtsServiceRes }>(`/tts/services/${id}`, body)),
    onSuccess: () => {
      if (useAuthStore.getState().user?.id !== accountId) return
      void queryClient.invalidateQueries({ queryKey: ttsServicesKey(accountId) })
      void queryClient.invalidateQueries({ queryKey: ['tts', 'voices', 'account', accountId] })
    },
  })
}

export function useDeleteTtsService() {
  const queryClient = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...ttsServicesKey(accountId), 'delete'],
    mutationFn: (id: string) => requestForTtsAccount(accountId, () => apiDelete<{ data: null }>(`/tts/services/${id}`)),
    onSuccess: () => {
      if (useAuthStore.getState().user?.id !== accountId) return
      void queryClient.invalidateQueries({ queryKey: ttsServicesKey(accountId) })
      void queryClient.invalidateQueries({ queryKey: ['tts', 'voices', 'account', accountId] })
    },
  })
}

export function useTestTtsService() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...ttsServicesKey(accountId), 'test'],
    mutationFn: (id: string) => requestForTtsAccount(accountId, () => apiPost<{ data: { ok: true } }>(`/tts/services/${id}/test`)),
  })
}

export function useTestTtsServiceDraft() {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...ttsServicesKey(accountId), 'test-draft'],
    mutationFn: (body: TtsServiceCreateReq) => requestForTtsAccount(accountId, () => apiPost<{ data: { ok: true } }>('/tts/services/test', body)),
  })
}
