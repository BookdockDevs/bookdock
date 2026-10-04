import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { apiGet } from '@/api/client'
import { useShelves, useTags } from '@/features/library/hooks'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  apiGet: vi.fn().mockResolvedValue({ data: [] }),
}))

afterEach(() => {
  useAuthStore.setState({ user: null })
  vi.clearAllMocks()
})

it('pauses personal queries while anonymous and resumes them after login', async () => {
  useAuthStore.setState({ user: null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result } = renderHook(() => ({ shelves: useShelves(), tags: useTags() }), { wrapper })

  expect(result.current.shelves.fetchStatus).toBe('idle')
  expect(result.current.tags.fetchStatus).toBe('idle')
  expect(apiGet).not.toHaveBeenCalled()

  act(() => useAuthStore.setState({ user: { id: 'member', username: 'member', role: 'member', avatarKey: null } }))
  await waitFor(() => expect(result.current.tags.isSuccess && result.current.shelves.isSuccess).toBe(true))
  expect(apiGet).toHaveBeenCalledWith('/shelves')
  expect(apiGet).toHaveBeenCalledWith('/tags')
  client.clear()
})
