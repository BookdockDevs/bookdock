import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BookListItem } from '@bookdock/shared'

import { apiDelete, apiPatch, apiPut, apiUpload } from '@/api/client'
import { useRemoveCover, useUpdateBook, useUpdateBookMembership, useUploadCover, useUpdateCatalogVersion, useUploadCatalogVersionCover, useRemoveCatalogVersionCover } from '@/features/library/hooks'
import { notify } from '@/lib/notifications'

vi.mock('@/api/client', async (original) => ({
  ...await original<typeof import('@/api/client')>(),
  apiPatch: vi.fn(),
  apiPut: vi.fn(),
  apiUpload: vi.fn(),
  apiDelete: vi.fn(),
}))
vi.mock('@/lib/notifications', () => ({ notify: { success: vi.fn(), error: vi.fn() } }))

const book: BookListItem = {
  id: 'b1', title: 'Book', author: '', format: 'txt', coverKey: null, size: 1,
  readStatus: 'reading', progress: 20, shelfId: 's1', createdAt: 1, updatedAt: 1,
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(apiPatch).mockResolvedValue({ data: book })
  vi.mocked(apiPut).mockResolvedValue({ data: null })
  vi.mocked(apiUpload).mockResolvedValue({ data: book })
  vi.mocked(apiDelete).mockResolvedValue({ data: book })
})

describe('detail quick-edit mutations', () => {
  it.each(['upload', 'remove'])('refreshes detail/list and reader caches after cover %s', async (action) => {
    const { client, wrapper } = setup()
    const keys = [['books', 'detail', 'b1'], ['books', 'infinite', {}], ['book', 'b1']]
    for (const key of keys) client.setQueryData(key, { data: book })
    const { result } = renderHook(() => ({ upload: useUploadCover(), remove: useRemoveCover() }), { wrapper })
    const file = new File(['image'], 'cover.png', { type: 'image/png' })
    await act(async () => {
      if (action === 'upload') await result.current.upload.mutateAsync({ bookId: 'b1', file })
      else await result.current.remove.mutateAsync('b1')
    })
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    if (action === 'upload') expect(apiUpload).toHaveBeenCalledExactlyOnceWith('/books/b1/cover', file, 'PUT')
    else expect(apiDelete).toHaveBeenCalledExactlyOnceWith('/books/b1/cover')
    expect(notify.success).toHaveBeenCalledTimes(1)
  })

  it.each(['upload', 'remove'])('retains the original artwork after failed cover %s', async (action) => {
    const { client, wrapper } = setup()
    const original = { data: { ...book, coverKey: 'original-cover' } }
    client.setQueryData(['books', 'detail', 'b1'], original)
    vi.mocked(apiUpload).mockRejectedValue(new Error('Offline'))
    vi.mocked(apiDelete).mockRejectedValue(new Error('Offline'))
    const { result } = renderHook(() => ({ upload: useUploadCover(), remove: useRemoveCover() }), { wrapper })
    await act(async () => {
      const request = action === 'upload'
        ? result.current.upload.mutateAsync({ bookId: 'b1', file: new File(['image'], 'cover.png') })
        : result.current.remove.mutateAsync('b1')
      await expect(request).rejects.toThrow('Offline')
    })
    expect(client.getQueryData(['books', 'detail', 'b1'])).toEqual(original)
    expect(notify.error).toHaveBeenCalledTimes(1)
    expect(notify.success).not.toHaveBeenCalled()
  })

  it('writes only the shelf and invalidates detail, membership, lists, counts and reader cache', async () => {
    const { client, wrapper } = setup()
    const keys = [['books', 'detail', 'b1'], ['books', 'b1', 'shelves'], ['books', 'infinite', {}], ['book', 'b1'], ['shelves'], ['tags'], ['batch-selection']]
    for (const key of keys) client.setQueryData(key, { data: book })
    const { result } = renderHook(useUpdateBookMembership, { wrapper })
    await act(() => result.current.mutateAsync({ bookId: 'b1', shelfId: null }))
    expect(apiPut).toHaveBeenCalledExactlyOnceWith('/books/b1/shelves', { shelfId: null })
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    expect(notify.success).toHaveBeenCalledTimes(1)
  })

  it('still supports explicit tag clearing without changing the shelf', async () => {
    const { wrapper } = setup()
    const { result } = renderHook(useUpdateBookMembership, { wrapper })
    await act(() => result.current.mutateAsync({ bookId: 'b1', tagIds: [] }))
    expect(apiPut).toHaveBeenCalledExactlyOnceWith('/books/b1/tags', { tagIds: [] })
  })

  it.each(['status', 'shelf'])('retains confirmed caches when the %s write fails and notifies once', async (field) => {
    const { client, wrapper } = setup()
    client.setQueryData(['books', 'detail', 'b1'], { data: book })
    client.setQueryData(['books', 'b1', 'shelves'], { data: 's1' })
    vi.mocked(apiPatch).mockRejectedValue(new Error('Offline'))
    vi.mocked(apiPut).mockRejectedValue(new Error('Offline'))
    const { result } = renderHook(() => ({ status: useUpdateBook(), shelf: useUpdateBookMembership() }), { wrapper })
    await act(async () => {
      const request = field === 'status'
        ? result.current.status.mutateAsync({ bookId: 'b1', readStatus: 'finished' })
        : result.current.shelf.mutateAsync({ bookId: 'b1', shelfId: null })
      await expect(request).rejects.toThrow('Offline')
    })
    expect(client.getQueryData(['books', 'detail', 'b1'])).toEqual({ data: book })
    expect(client.getQueryData(['books', 'b1', 'shelves'])).toEqual({ data: 's1' })
    expect(notify.error).toHaveBeenCalledTimes(1)
    expect(notify.success).not.toHaveBeenCalled()
  })

  it('keeps status pending until active detail and filtered list refresh, without changing progress', async () => {
    const { client, wrapper } = setup()
    let finishDetail!: (value: { data: BookListItem }) => void
    const detailKey = ['books', 'detail', 'b1']
    const listKey = ['books', { status: 'reading' }]
    client.setQueryData(detailKey, { data: book })
    client.setQueryData(listKey, { data: [book] })
    client.setQueryData(['book', 'b1'], { data: book })
    const detail = new QueryObserver(client, { queryKey: detailKey, queryFn: () => new Promise<{ data: BookListItem }>((resolve) => { finishDetail = resolve }) })
    const list = new QueryObserver(client, { queryKey: listKey, queryFn: async () => ({ data: [] }) })
    const stopDetail = detail.subscribe(() => {})
    const stopList = list.subscribe(() => {})
    const { result } = renderHook(useUpdateBook, { wrapper })
    act(() => result.current.mutate({ bookId: 'b1', readStatus: 'finished' }))
    await waitFor(() => expect(finishDetail).toBeTypeOf('function'))
    expect(result.current.isPending).toBe(true)
    expect(client.getQueryData(detailKey)).toEqual({ data: book })
    act(() => finishDetail({ data: { ...book, readStatus: 'finished' } }))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(apiPatch).toHaveBeenCalledExactlyOnceWith('/books/b1', { readStatus: 'finished' })
    expect(client.getQueryData(detailKey)).toEqual({ data: { ...book, readStatus: 'finished' } })
    expect(client.getQueryData(listKey)).toEqual({ data: [] })
    expect(client.getQueryState(['book', 'b1'])?.isInvalidated).toBe(true)
    stopDetail()
    stopList()
  })
})


describe('shared version shortcut cache refresh', () => {
  it.each(['metadata', 'upload', 'remove'])('refreshes catalog and collected reader projections after %s', async (action) => {
    const { client, wrapper } = setup()
    const keys = [['libraries', 'l1', 'catalog'], ['books', 'detail', 'collected-card'], ['books', 'infinite', {}], ['book', 'v1'], ['book', 'collected-card']]
    for (const key of keys) client.setQueryData(key, { data: book })
    const { result } = renderHook(() => ({ update: useUpdateCatalogVersion(), upload: useUploadCatalogVersionCover(), remove: useRemoveCatalogVersionCover() }), { wrapper })
    const target = { libraryId: 'l1', libraryBookId: 'w1', versionLinkId: 'link1' }
    await act(async () => {
      if (action === 'metadata') await result.current.update.mutateAsync({ ...target, patch: { title: 'New' } })
      else if (action === 'upload') await result.current.upload.mutateAsync({ ...target, file: new File(['cover'], 'cover.png') })
      else await result.current.remove.mutateAsync(target)
    })
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true)
    client.clear()
  })

  it.each(['metadata', 'upload', 'remove'])('retains confirmed cached data on failed %s', async (action) => {
    const { client, wrapper } = setup()
    const key = ['books', 'detail', 'collected-card']
    client.setQueryData(key, { data: book })
    vi.mocked(apiPatch).mockRejectedValueOnce(new Error('Offline'))
    vi.mocked(apiUpload).mockRejectedValueOnce(new Error('Offline'))
    vi.mocked(apiDelete).mockRejectedValueOnce(new Error('Offline'))
    const { result } = renderHook(() => ({ update: useUpdateCatalogVersion(), upload: useUploadCatalogVersionCover(), remove: useRemoveCatalogVersionCover() }), { wrapper })
    const target = { libraryId: 'l1', libraryBookId: 'w1', versionLinkId: 'link1' }
    await act(async () => {
      const pending = action === 'metadata' ? result.current.update.mutateAsync({ ...target, patch: { title: 'New' } }) : action === 'upload' ? result.current.upload.mutateAsync({ ...target, file: new File(['cover'], 'cover.png') }) : result.current.remove.mutateAsync(target)
      await expect(pending).rejects.toThrow('Offline')
    })
    expect(client.getQueryData(key)).toEqual({ data: book })
    expect(client.getQueryState(key)?.isInvalidated).toBe(false)
    client.clear()
  })
})
