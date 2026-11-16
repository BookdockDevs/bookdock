import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

import { useAuthStore } from '@/stores/auth.store'

import type { AnnotationRes } from '@bookdock/shared'

import { apiDelete, apiPatch, apiPost, apiPut } from '@/api/client'
import { useClearLibraryCategory, useClearLibraryTag, useToggleShelfHidden, useUpdateLibraryCategory, useUpdateLibraryTag } from '@/features/library/hooks'
import { useBatchDeleteAnnotations } from '@/features/reader/hooks/useAnnotations'
import { notify } from '@/lib/notifications'

vi.mock('@/api/client', async (original) => ({
  ...await original<typeof import('@/api/client')>(),
  apiDelete: vi.fn(), apiPatch: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn(),
}))
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), error: vi.fn() } }))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory())
  useAuthStore.setState({ user: { id: 'u1', username: 'tester', role: 'member' } })

  vi.clearAllMocks()
  for (const request of [apiDelete, apiPatch, apiPost, apiPut]) vi.mocked(request).mockResolvedValue({ data: {} })
})

describe('operation feedback', () => {
  it('reports a failed private shelf visibility change once', async () => {
    const { client, wrapper } = setup()
    vi.mocked(apiPut).mockRejectedValue(new Error('Offline'))
    const { result } = renderHook(() => ({ shelf: useToggleShelfHidden() }), { wrapper })
    await act(async () => {
      await expect(result.current.shelf.mutateAsync({ id: 'item', hidden: true })).rejects.toThrow('Offline')
    })
    expect(notify.error).toHaveBeenCalledTimes(1)
    expect(notify.error).toHaveBeenCalledWith({ key: 'library.taxonomyVisibilityFailed' })
    expect(notify.success).not.toHaveBeenCalled()
    client.clear()
  })

  it('notifies taxonomy renames and clears but keeps pin and visibility success quiet', async () => {
    const { client, wrapper } = setup()
    const { result } = renderHook(() => ({
      clearCategory: useClearLibraryCategory(), clearTag: useClearLibraryTag(),
      updateCategory: useUpdateLibraryCategory(), updateTag: useUpdateLibraryTag(),
    }), { wrapper })
    await act(async () => {
      await result.current.updateCategory.mutateAsync({ libraryId: 'lib', path: ['Fiction'], source: 'server', patch: { name: 'Literature' } })
      await result.current.updateTag.mutateAsync({ libraryId: 'lib', name: 'Classic', source: 'server', patch: { renamedTo: 'Favorite' } })
      await result.current.clearCategory.mutateAsync({ libraryId: 'lib', path: ['Literature'], source: 'server' })
      await result.current.clearTag.mutateAsync({ libraryId: 'lib', name: 'Favorite', source: 'server' })
    })
    expect(vi.mocked(notify.success).mock.calls.map(([message]) => message)).toEqual([
      { key: 'toast.categoryUpdated' }, { key: 'toast.tagRenamed' },
      { key: 'toast.categoryCleared' }, { key: 'toast.tagCleared' },
    ])
    vi.mocked(notify.success).mockClear()
    await act(async () => {
      await result.current.updateCategory.mutateAsync({ libraryId: 'lib', path: ['Literature'], patch: { pinned: true } })
      await result.current.updateTag.mutateAsync({ libraryId: 'lib', name: 'Favorite', patch: { hidden: true } })
    })
    expect(notify.success).not.toHaveBeenCalled()
    client.clear()
  })
})

describe('annotation batch deletion', () => {
  it.each([0, 1, 2])('reports %i failed items from the batch endpoint and clears them from the cache', async (failedCount) => {
    const { client, wrapper } = setup()
    const annotations: AnnotationRes[] = ['a', 'b', 'untouched'].map((id) => ({
      id, bookId: 'book', cfiRange: `cfi:${id}`, cfiAnchor: null, type: 'note',
      color: 'yellow', style: 'underline', text: id, note: null, chapter: null, createdAt: 0, updatedAt: 0,
    }))
    client.setQueryData(['annotations', 'book'], { data: annotations })
    vi.mocked(apiPost).mockResolvedValue({ data: { succeeded: 2 - failedCount, failed: failedCount } })
    const { result } = renderHook(() => useBatchDeleteAnnotations('book'), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync(['a', 'b'])).resolves.toEqual({ succeeded: 2 - failedCount, failed: failedCount, undo: undefined })
    })
    // The batch endpoint reports counts only; failed items reappear through
    // the refetch that the mutation's onSettled triggers.
    expect(client.getQueryData<{ data: AnnotationRes[] }>(['annotations', 'book'])?.data.map((item) => item.id).sort())
      .toEqual(['untouched'])
    client.clear()
  })
})
