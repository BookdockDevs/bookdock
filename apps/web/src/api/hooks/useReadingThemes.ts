import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { InstanceThemeItemKind, InstanceThemeLibraryRes, ThemeAssetRes } from '@bookdock/shared'

import { apiDelete, apiGet, apiPost, apiUpload } from '../client'

export const INSTANCE_THEMES_KEY = ['reading-themes', 'instance'] as const

export function useInstanceThemeLibrary(enabled = true) {
  return useQuery({
    queryKey: INSTANCE_THEMES_KEY,
    queryFn: () => apiGet<{ data: InstanceThemeLibraryRes }>('/reading-themes/instance'),
    staleTime: 60 * 1000,
    enabled,
  })
}

export async function publishInstanceThemeItemsApi(body: {
  items: { kind: InstanceThemeItemKind; itemId: string; payload: Record<string, unknown> }[]
  assetIds?: string[]
}): Promise<InstanceThemeLibraryRes> {
  const res = await apiPost<{ data: InstanceThemeLibraryRes }>('/reading-themes/instance', body)
  return res.data
}

export async function removeInstanceThemeItemApi(kind: InstanceThemeItemKind, itemId: string): Promise<InstanceThemeLibraryRes> {
  const res = await apiDelete<{ data: InstanceThemeLibraryRes }>(`/reading-themes/instance/${kind}/${encodeURIComponent(itemId)}`)
  return res.data
}

export function usePublishInstanceThemeItems() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      items: { kind: InstanceThemeItemKind; itemId: string; payload: Record<string, unknown> }[]
      assetIds?: string[]
    }) => apiPost<{ data: InstanceThemeLibraryRes }>('/reading-themes/instance', body),
    onSuccess: (res) => {
      queryClient.setQueryData(INSTANCE_THEMES_KEY, res)
    },
  })
}

export function useRemoveInstanceThemeItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, itemId }: { kind: InstanceThemeItemKind; itemId: string }) =>
      apiDelete<{ data: InstanceThemeLibraryRes }>(`/reading-themes/instance/${kind}/${encodeURIComponent(itemId)}`),
    onSuccess: (res) => {
      queryClient.setQueryData(INSTANCE_THEMES_KEY, res)
    },
  })
}

export async function uploadThemeAssetToServer(input: {
  assetId: string
  blob: Blob
  fileName: string
  width?: number
  height?: number
}): Promise<ThemeAssetRes> {
  const form = new FormData()
  form.append('assetId', input.assetId)
  if (input.width !== undefined) form.append('width', String(input.width))
  if (input.height !== undefined) form.append('height', String(input.height))
  const file = input.blob instanceof File ? input.blob : new File([input.blob], input.fileName, { type: input.blob.type || 'image/png' })
  form.append('file', file)
  const res = await apiUpload<{ data: ThemeAssetRes }>('/reading-themes/assets', form, 'POST')
  return res.data
}

export async function fetchThemeAssetFromServer(assetId: string): Promise<Blob | null> {
  if (typeof fetch !== 'function') return null
  const res = await fetch(`/api/v1/reading-themes/assets/${encodeURIComponent(assetId)}`)
  if (!res.ok) return null
  return res.blob()
}
