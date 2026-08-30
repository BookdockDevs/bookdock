import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { TtsProviderRes, TtsServiceCreateReq, TtsServiceRes, TtsServiceUpdateReq, TtsVoiceRes } from '@bookdock/shared'

import { apiDelete, apiGet, apiPost, apiPut } from '../client'

export const TTS_PROVIDERS_KEY = ['tts', 'providers'] as const
export const TTS_SERVICES_KEY = ['tts', 'services'] as const

export function useTtsProviders() {
  return useQuery({
    queryKey: TTS_PROVIDERS_KEY,
    queryFn: () => apiGet<{ data: TtsProviderRes[] }>('/tts/providers'),
  })
}

export function useTtsServices() {
  return useQuery({
    queryKey: TTS_SERVICES_KEY,
    queryFn: () => apiGet<{ data: TtsServiceRes[] }>('/tts/services'),
  })
}

export function useTtsServiceVoices(serviceId: string | null | undefined) {
  return useQuery({
    queryKey: ['tts', 'voices', serviceId],
    queryFn: () => apiGet<{ data: TtsVoiceRes[] }>(`/tts/services/${serviceId}/voices`),
    enabled: Boolean(serviceId),
    staleTime: 5 * 60 * 1000,
  })
}

export function useCreateTtsService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: TtsServiceCreateReq) => apiPost<{ data: TtsServiceRes }>('/tts/services', body),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: TTS_SERVICES_KEY }) },
  })
}

export function useUpdateTtsService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TtsServiceUpdateReq }) => apiPut<{ data: TtsServiceRes }>(`/tts/services/${id}`, body),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: TTS_SERVICES_KEY }) },
  })
}

export function useDeleteTtsService() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete<{ data: null }>(`/tts/services/${id}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: TTS_SERVICES_KEY }) },
  })
}

export function useTestTtsService() {
  return useMutation({
    mutationFn: (id: string) => apiPost<{ data: { ok: true } }>(`/tts/services/${id}/test`),
  })
}

export function useTestTtsServiceDraft() {
  return useMutation({
    mutationFn: (body: TtsServiceCreateReq) => apiPost<{ data: { ok: true } }>('/tts/services/test', body),
  })
}
