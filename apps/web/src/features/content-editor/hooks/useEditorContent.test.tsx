import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as apiClient from '@/api/client'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>()
  return { ...actual, apiPut: vi.fn() }
})
vi.mock('@/features/reading-data/catalog-source-context', () => ({ useLocalCatalog: () => null }))

import { useAuthStore } from '@/stores/auth.store'
import { useSaveEditorTxt } from './useEditorContent'

const bookId = 'book-1'
// The editor reads its book through ['books', 'detail']; ['book'] alone belongs to the
// reader. Leaving the detail stale makes the next content request keep the old revision,
// which the server rejects, and leaves the reader painting a stale TOC.
const paintedKeys = [['book', bookId], ['books', 'detail', bookId], ['chapters', bookId], ['content-editor', bookId]]

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('editor save retires the caches it paints from', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    useAuthStore.setState({ user: { id: 'user', username: 'user', role: 'owner' } as never })
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    for (const key of paintedKeys) queryClient.setQueryData(key, { data: { revisionId: 'rev-1' } })
  })

  it('invalidates the book detail and chapters so reloads use the saved revision', async () => {
    vi.mocked(apiClient.apiPut).mockResolvedValue({ data: { revisionId: 'rev-2', unlocated: {} } } as never)
    const { result } = renderHook(() => useSaveEditorTxt(bookId), { wrapper: wrapper(queryClient) })

    result.current.mutate({ baseRevisionId: 'rev-1', chapters: [], tocRuleSelection: { ruleId: null, patterns: null, label: null, auto: false } } as never)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    for (const key of paintedKeys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
  })
})
