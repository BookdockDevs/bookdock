import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AnnotationRes } from '@bookdock/shared'

import { apiDelete, apiPatch, apiPost, apiPut } from '@/api/client'
import { useCreateLibraryCategory, useCreateLibraryTag, useDeleteLibraryCategory, useDeleteLibraryTag, useToggleShelfHidden, useToggleTagHidden, useUpdateLibraryCategory, useUpdateLibraryTag } from '@/features/library/hooks'
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
  vi.clearAllMocks()
  for (const request of [apiDelete, apiPatch, apiPost, apiPut]) vi.mocked(request).mockResolvedValue({ data: {} })
})

describe('operation feedback', () => {
  it.each(['shelf', 'tag'])('reports a failed private %s visibility change once', async (kind) => {
    const { client, wrapper } = setup()
    vi.mocked(apiPut).mockRejectedValue(new Error('Offline'))
    const { result } = renderHook(() => ({ shelf: useToggleShelfHidden(), tag: useToggleTagHidden() }), { wrapper })
    await act(async () => {
      await expect(result.current[kind].mutateAsync({ id: 'item', hidden: true })).rejects.toThrow('Offline')
    })
    expect(notify.error).toHaveBeenCalledTimes(1)
    expect(notify.error).toHaveBeenCalledWith({ key: 'library.taxonomyVisibilityFailed' })
    expect(notify.success).not.toHaveBeenCalled()
    client.clear()
  })

  it('notifies shared taxonomy submissions but keeps pin and visibility success quiet', async () => {
    const { client, wrapper } = setup()
    const { result } = renderHook(() => ({
      category: useCreateLibraryCategory(), tag: useCreateLibraryTag(),
      updateCategory: useUpdateLibraryCategory(), updateTag: useUpdateLibraryTag(),
      deleteCategory: useDeleteLibraryCategory(), deleteTag: useDeleteLibraryTag(),
    }), { wrapper })
    await act(async () => {
      await result.current.category.mutateAsync({ libraryId: 'lib', name: 'Fiction' })
      await result.current.tag.mutateAsync({ libraryId: 'lib', name: 'Classic' })
      await result.current.updateCategory.mutateAsync({ libraryId: 'lib', categoryId: 'cat', patch: { parentId: null } })
      await result.current.updateTag.mutateAsync({ libraryId: 'lib', tagId: 'tag', patch: { name: 'New' } })
      await result.current.deleteCategory.mutateAsync({ libraryId: 'lib', categoryId: 'cat' })
      await result.current.deleteTag.mutateAsync({ libraryId: 'lib', tagId: 'tag' })
    })
    expect(vi.mocked(notify.success).mock.calls.map(([message]) => message)).toEqual([
      { key: 'toast.categoryCreated' }, { key: 'toast.tagCreated' }, { key: 'toast.categoryUpdated' },
      { key: 'toast.tagRenamed' }, { key: 'toast.categoryDeleted' }, { key: 'toast.tagDeleted' },
    ])
    vi.mocked(notify.success).mockClear()
    await act(async () => {
      await result.current.updateCategory.mutateAsync({ libraryId: 'lib', categoryId: 'cat', patch: { pinned: true } })
      await result.current.updateTag.mutateAsync({ libraryId: 'lib', tagId: 'tag', patch: { hidden: true } })
    })
    expect(notify.success).not.toHaveBeenCalled()
    client.clear()
  })
})

describe('annotation batch deletion', () => {
  it.each([0, 1, 2])('counts %i rejected requests and restores only their cache entries', async (failedCount) => {
    const { client, wrapper } = setup()
    const annotations: AnnotationRes[] = ['a', 'b', 'untouched'].map((id) => ({
      id, bookId: 'book', cfiRange: `cfi:${id}`, cfiAnchor: null, type: 'note',
      color: 'yellow', style: 'underline', text: id, note: null, chapter: null, createdAt: 0, updatedAt: 0,
    }))
    client.setQueryData(['annotations', 'book'], { data: annotations })
    const failedIds = ['a', 'b'].slice(0, failedCount)
    vi.mocked(apiDelete).mockImplementation(async (path) => {
      if (failedIds.some((id) => path.endsWith(`/${id}`))) throw new Error('Rejected')
      return { data: null }
    })
    const { result } = renderHook(() => useBatchDeleteAnnotations('book'), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync(['a', 'b'])).resolves.toEqual({ succeeded: 2 - failedCount, failedIds })
    })
    expect(client.getQueryData<{ data: AnnotationRes[] }>(['annotations', 'book'])?.data.map((item) => item.id).sort())
      .toEqual([...failedIds, 'untouched'].sort())
    client.clear()
  })
})
