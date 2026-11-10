import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { FontListItem, FontScope } from '@bookdock/shared'

import { getAuthSessionRevision, useAuthStore } from '@/stores/auth.store'

import { apiDelete, apiGet, apiPatch, apiUpload } from '../client'

const FONTS_KEY = ['fonts'] as const

export function useFonts(enabled = true) {
  const user = useAuthStore((state) => state.user)
  const revision = getAuthSessionRevision()
  return useQuery({
    queryKey: [...FONTS_KEY, user?.id ?? null, revision],
    queryFn: async () => {
      if (getAuthSessionRevision() !== revision) throw new DOMException('Font account changed', 'AbortError')
      const result = await apiGet<{ data: FontListItem[] }>('/fonts')
      if (getAuthSessionRevision() !== revision) throw new DOMException('Font account changed', 'AbortError')
      return result
    },
    staleTime: 5 * 60 * 1000,
    enabled,
  })
}

export function useUploadFont() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (arg: File | { file: File; onProgress?: (percent: number) => void }) => {
      const file = arg instanceof File ? arg : arg.file
      const onProgress = arg instanceof File ? undefined : arg.onProgress
      return apiUpload<{ data: FontListItem }>('/fonts', file, 'POST', { onProgress })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FONTS_KEY })
      void queryClient.invalidateQueries({ queryKey: ['storage-backend'] })
    },
  })
}

export function useDeleteFont() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/fonts/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FONTS_KEY })
      void queryClient.invalidateQueries({ queryKey: ['storage-backend'] })
    },
  })
}

export function useUpdateFontScope() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, scope }: { id: string; scope: FontScope }) =>
      apiPatch<{ data: FontListItem }>(`/fonts/${id}/scope`, { scope }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FONTS_KEY })
    },
  })
}
