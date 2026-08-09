import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { FontListItem, FontScope } from '@bookdock/shared'

import { apiDelete, apiGet, apiPatch, apiUpload } from '../client'

const FONTS_KEY = ['fonts'] as const

export function useFonts() {
  return useQuery({
    queryKey: FONTS_KEY,
    queryFn: () => apiGet<{ data: FontListItem[] }>('/fonts'),
  })
}

export function useUploadFont() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => apiUpload<{ data: FontListItem }>('/fonts', file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FONTS_KEY })
    },
  })
}

export function useDeleteFont() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => apiDelete(`/fonts/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FONTS_KEY })
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
