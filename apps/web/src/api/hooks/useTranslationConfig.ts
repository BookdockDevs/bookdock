import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { TranslationPreferences } from '@bookdock/shared'

import { apiGet, apiPut } from '../client'

export const TRANSLATION_CONFIG_KEY = ['translation', 'config'] as const

export function useTranslationConfig(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: TRANSLATION_CONFIG_KEY,
    queryFn: () => apiGet<{ data: TranslationPreferences }>('/translation/config'),
    ...options,
  })
}

export function useSaveTranslationConfig() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (value: TranslationPreferences) => apiPut<{ data: TranslationPreferences }>('/translation/config', value),
    onSuccess: (response) => client.setQueryData(TRANSLATION_CONFIG_KEY, response),
  })
}
