import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as apiClient from '@/api/client'
import { useReToc } from '@/api/hooks/useTocRules'

import { useAppendBookContent, usePushVersion } from '../features/library/hooks'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>()
  return { ...actual, apiPost: vi.fn() }
})

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const cityTarget = { libraryId: 'lib1', libraryBookId: 'lb1', versionLinkId: 'lbv1' }
const cityBook = { versions: [{ id: 'lbv1', bookVersionId: 'book-v1' }] }

function seedStaleVersionCaches(queryClient: QueryClient) {
  queryClient.setQueryData(['libraries', 'lib1', 'catalog'], { data: [] })
  queryClient.setQueryData(['book', 'book-v1'], { data: { id: 'book-v1', revisionId: 'r1' } })
  queryClient.setQueryData(['books', 'detail', 'book-v1'], { data: { id: 'book-v1', revisionId: 'r1' } })
  queryClient.setQueryData(['chapters', 'book-v1'], { data: [{ id: 'c1', title: '旧目录' }] })
  queryClient.setQueryData(['progress', 'book-v1'], { data: null })
}

function expectVersionCachesRetired(queryClient: QueryClient) {
  // The reader paints ['chapters'] first (staleTime Infinity) and corrects
  // itself only when the renderer re-parses: leaving these stale is the
  // stale-TOC flash on every entry.
  expect(queryClient.getQueryState(['book', 'book-v1'])?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(['books', 'detail', 'book-v1'])?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(['chapters', 'book-v1'])?.isInvalidated).toBe(true)
  expect(queryClient.getQueryState(['progress', 'book-v1'])?.isInvalidated).toBe(true)
}

describe('shared-library content writes retire version-scoped caches', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    seedStaleVersionCaches(queryClient)
  })

  it('city re-toc retires the version caches, not just the catalog', async () => {
    vi.mocked(apiClient.apiPost).mockResolvedValue({
      data: { revisionId: 'r2', revisionNo: 2, chaptersChanged: true, book: cityBook },
    } as never)
    const { result } = renderHook(() => useReToc(cityTarget), { wrapper: wrapper(queryClient) })

    result.current.mutate({})

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryState(['libraries', 'lib1', 'catalog'])?.isInvalidated).toBe(true)
    expectVersionCachesRetired(queryClient)
  })

  it('city append retires the version caches, not just the catalog', async () => {
    vi.mocked(apiClient.apiPost).mockResolvedValue({
      data: { revisionId: 'r2', revisionNo: 2, book: cityBook },
    } as never)
    const { result } = renderHook(() => useAppendBookContent(), { wrapper: wrapper(queryClient) })

    result.current.mutate({ target: cityTarget, text: '新内容' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryState(['libraries', 'lib1', 'catalog'])?.isInvalidated).toBe(true)
    expectVersionCachesRetired(queryClient)
  })

  it('push retires the version caches, not just the catalog', async () => {
    vi.mocked(apiClient.apiPost).mockResolvedValue({
      data: { revisionNo: 2, alreadyUpToDate: false, diverged: false, book: cityBook },
    } as never)
    const { result } = renderHook(() => usePushVersion(), { wrapper: wrapper(queryClient) })

    result.current.mutate(cityTarget)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(queryClient.getQueryState(['libraries', 'lib1', 'catalog'])?.isInvalidated).toBe(true)
    expectVersionCachesRetired(queryClient)
  })
})
