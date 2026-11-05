import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { DictionaryItem, DictionaryList, DictionaryLookupResult, DictionaryScope } from '@bookdock/shared'

import { apiDelete, apiGet, apiPatch, apiPut, apiUpload } from '../client'

export const DICTIONARIES_KEY = ['dictionaries'] as const

export function useDictionaries(options?: { enabled?: boolean }) {
  return useQuery({ queryKey: DICTIONARIES_KEY, queryFn: () => apiGet<{ data: DictionaryList }>('/dictionaries'), ...options })
}

export function useDictionaryLookup(id: string | null, word: string) {
  const client = useQueryClient()
  return useQuery({
    queryKey: [...DICTIONARIES_KEY, 'lookup', id, word],
    queryFn: async ({ signal }) => {
      const response = await apiGet<{ data: DictionaryLookupResult }>(`/dictionaries/${id}/lookup?word=${encodeURIComponent(word)}`, signal)
      if (!signal.aborted) client.setQueryData<{ data: DictionaryList }>(DICTIONARIES_KEY, (previous) => previous ? { data: { ...previous.data, lastUsedId: id } } : previous)
      return response
    },
    enabled: Boolean(id && word.trim() && word.trim().length <= 100),
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
  return useMutation({
    mutationFn: async (action: DictionaryMutationAction) => {
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
      if (action.kind !== 'order') return undefined
      await client.cancelQueries({ queryKey: DICTIONARIES_KEY })
      const previous = client.getQueryData<{ data: DictionaryList }>(DICTIONARIES_KEY)
      if (previous) {
        client.setQueryData(DICTIONARIES_KEY, {
          data: {
            ...previous.data,
            items: action.ids.map((id) => previous.data.items.find((item) => item.id === id)!).filter(Boolean),
          },
        })
      }
      return previous
    },
    onError: (_error, _action, previous) => { if (previous) client.setQueryData(DICTIONARIES_KEY, previous) },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: DICTIONARIES_KEY })
      void client.invalidateQueries({ queryKey: ['storage-backend'] })
    },
  })
}
