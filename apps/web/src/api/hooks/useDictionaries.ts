import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { DictionaryItem, DictionaryList, DictionaryLookupResult, DictionaryScope } from '@bookdock/shared'

import { assertSessionEpoch, getSessionEpoch } from '@/lib/session-scope'
import { useAuthStore } from '@/stores/auth.store'

import { apiDelete, apiGet, apiPatch, apiPut, apiUpload } from '../client'

export const DICTIONARIES_KEY = ['dictionaries'] as const
export const dictionaryListKey = (accountId: string | null) => [...DICTIONARIES_KEY, 'account', accountId] as const

export function useDictionaries(options?: { enabled?: boolean }) {
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useQuery({
    queryKey: dictionaryListKey(accountId),
    queryFn: async ({ signal }) => {
      if (!accountId || useAuthStore.getState().user?.id !== accountId) throw new DOMException('Dictionary account changed', 'AbortError')
      const epoch = getSessionEpoch()
      const response = await apiGet<{ data: DictionaryList }>('/dictionaries', signal)
      signal.throwIfAborted()
      assertSessionEpoch(epoch)
      return response
    },
    enabled: Boolean(accountId) && options?.enabled !== false,
  })
}

export function useDictionaryLookup(id: string | null, word: string) {
  const client = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  return useQuery({
    queryKey: [...dictionaryListKey(accountId), 'lookup', id, word],
    queryFn: async ({ signal }) => {
      if (!accountId || useAuthStore.getState().user?.id !== accountId || !id) throw new DOMException('Dictionary account changed', 'AbortError')
      const epoch = getSessionEpoch()
      const response = await apiGet<{ data: DictionaryLookupResult }>(`/dictionaries/${encodeURIComponent(id)}/lookup?word=${encodeURIComponent(word)}`, signal)
      signal.throwIfAborted()
      assertSessionEpoch(epoch)
      client.setQueryData<{ data: DictionaryList }>(dictionaryListKey(accountId), (previous) => previous ? { data: { ...previous.data, lastUsedId: id } } : previous)
      return response
    },
    enabled: Boolean(accountId && id && word.trim() && word.trim().length <= 100),
    retry: false,
    gcTime: 0,
  })
}

export type DictionaryMutationAction =
  | { kind: 'import'; files: File[]; onProgress?: (percent: number) => void }
  | { kind: 'delete'; id: string }
  | { kind: 'toggle'; id: string; enabled: boolean }
  | { kind: 'update'; id: string; name?: string; scope?: DictionaryScope; enabled?: boolean }
  | { kind: 'order'; ids: string[] }

export function useDictionaryMutation() {
  const client = useQueryClient()
  const accountId = useAuthStore((state) => state.user?.id ?? null)
  const listKey = dictionaryListKey(accountId)
  return useMutation({
    mutationKey: [...listKey, 'mutation'],
    mutationFn: async (action: DictionaryMutationAction) => {
      if (!accountId || useAuthStore.getState().user?.id !== accountId) throw new DOMException('Dictionary account changed', 'AbortError')
      if (action.kind === 'import') {
        const form = new FormData()
        action.files.forEach((file) => form.append('files', file))
        return apiUpload<{ data: DictionaryItem }>('/dictionaries', form, 'POST', { onProgress: action.onProgress })
      }
      if (action.kind === 'delete') return apiDelete(`/dictionaries/${action.id}`)
      if (action.kind === 'toggle') return apiPatch(`/dictionaries/${action.id}`, { enabled: action.enabled })
      if (action.kind === 'update') {
        return apiPatch<{ data: DictionaryList }>(`/dictionaries/${action.id}`, {
          name: action.name,
          scope: action.scope,
          enabled: action.enabled,
        })
      }
      return apiPut('/dictionaries/order', { ids: action.ids })
    },
    onMutate: async (action) => {
      if (!accountId || useAuthStore.getState().user?.id !== accountId) throw new DOMException('Dictionary account changed', 'AbortError')
      if (action.kind !== 'order') return undefined
      await client.cancelQueries({ queryKey: listKey })
      const previous = client.getQueryData<{ data: DictionaryList }>(listKey)
      if (previous) {
        client.setQueryData(listKey, {
          data: {
            ...previous.data,
            items: action.ids.map((id) => previous.data.items.find((item) => item.id === id)!).filter(Boolean),
          },
        })
      }
      return { previous, accountId }
    },
    onError: (_error, _action, context) => {
      if (context?.previous && useAuthStore.getState().user?.id === context.accountId) client.setQueryData(dictionaryListKey(context.accountId), context.previous)
    },
    onSettled: () => {
      if (useAuthStore.getState().user?.id !== accountId) return
      void client.invalidateQueries({ queryKey: listKey })
      void client.invalidateQueries({ queryKey: ['storage-backend'] })
    },
  })
}
