import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiDelete, apiUpload } from '@/api/client'
import { ADMIN_USERS_QUERY_KEY, ME_QUERY_KEY, useDeleteAvatar, useUploadAvatar } from '@/features/auth/hooks'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/api/client', () => ({ apiDelete: vi.fn(), apiUpload: vi.fn() }))

describe('avatar mutations', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'member', avatarKey: 'ab/old.gif' } })
    vi.mocked(apiUpload).mockReset()
    vi.mocked(apiDelete).mockReset()
  })

  it.each(['upload', 'remove'] as const)('refreshes account/member caches after %s without invalidating book content', async (operation) => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity }, mutations: { retry: false } } })
    const memberKey = ['libraries', 'lib1', 'members']
    const catalogKey = ['libraries', 'lib1', 'catalog']
    for (const key of [ME_QUERY_KEY, ADMIN_USERS_QUERY_KEY, memberKey, catalogKey]) client.setQueryData(key, { data: [] })
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>
    }
    vi.mocked(apiUpload).mockResolvedValue({ data: { id: 'u1', username: 'tester', role: 'member', avatarKey: 'cd/new.gif' } })
    vi.mocked(apiDelete).mockResolvedValue({ data: null })
    const { result } = renderHook(() => ({ upload: useUploadAvatar(), remove: useDeleteAvatar() }), { wrapper: Wrapper })
    await act(async () => {
      if (operation === 'upload') await result.current.upload.mutateAsync(new File(['gif'], 'avatar.gif', { type: 'image/gif' }))
      else await result.current.remove.mutateAsync()
    })
    expect(useAuthStore.getState().user?.avatarKey).toBe(operation === 'upload' ? 'cd/new.gif' : null)
    for (const key of [ME_QUERY_KEY, ADMIN_USERS_QUERY_KEY, memberKey]) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    expect(client.getQueryState(catalogKey)?.isInvalidated).toBe(false)
    client.clear()
  })
})
