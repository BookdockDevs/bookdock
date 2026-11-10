import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { TranslationPreferences } from '@bookdock/shared'

import { assertSessionEpoch, getSessionEpoch } from '@/lib/session-scope'
import { useAuthStore } from '@/stores/auth.store'

import { apiGet, apiPut } from '../client'

export const TRANSLATION_CONFIG_KEY = ['translation', 'config'] as const
export const translationConfigKey = (accountId: string | null) => [...TRANSLATION_CONFIG_KEY, 'account', accountId] as const

export function useTranslationConfig(options?: { enabled?: boolean }) {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useQuery({
    queryKey: translationConfigKey(accountId),
    queryFn: async ({ signal }) => {
      if (!accountId || useAuthStore.getState().user?.id !== accountId) throw new DOMException('Translation account changed', 'AbortError')
      const epoch = getSessionEpoch()
      const response = await apiGet<{ data: TranslationPreferences }>('/translation/config', signal)
      signal.throwIfAborted()
      assertSessionEpoch(epoch)
      return response
    },
    enabled: Boolean(accountId) && options?.enabled !== false,
  })
}

export function useSaveTranslationConfig() {
  const client = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useMutation({
    mutationKey: [...translationConfigKey(accountId), 'save'],
    mutationFn: async (value: TranslationPreferences) => {
      if (!accountId || useAuthStore.getState().user?.id !== accountId) throw new DOMException('Translation account changed', 'AbortError')
      const epoch = getSessionEpoch()
      const response = await apiPut<{ data: TranslationPreferences }>('/translation/config', value)
      assertSessionEpoch(epoch)
      return response
    },
    onSuccess: (response) => {
      if (useAuthStore.getState().user?.id === accountId) client.setQueryData(translationConfigKey(accountId), response)
    },
  })
}
