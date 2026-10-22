import type { ReactNode } from 'react'

import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiPost, apiPut } from '@/api/client'
import { invalidateActivityQueries } from '@/features/activity/hooks'

import { useCreateAnnotation, useUpdateAnnotation } from './useAnnotations'

vi.mock('@/api/client', () => ({ apiPost: vi.fn(), apiPut: vi.fn() }))
vi.mock('@/features/activity/hooks', () => ({ invalidateActivityQueries: vi.fn() }))

const note = {
  id: 'note-1', bookId: 'book-1', cfiRange: 'epubcfi(/6/2)', cfiAnchor: null, type: 'note' as const,
  color: 'yellow' as const, style: 'underline' as const, text: '', contextText: null, note: 'Idea',
  chapter: null, chapterHref: null, createdAt: 1, updatedAt: 1, visibility: 'shared' as const,
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  }
}

describe('idea activity invalidation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('invalidates a newly created note when the API applies its default shared visibility', async () => {
    vi.mocked(apiPost).mockResolvedValue({ data: note })
    const { wrapper } = setup()
    const { result } = renderHook(() => useCreateAnnotation('book-1'), { wrapper })

    await result.current.mutateAsync({ type: 'note', cfiRange: note.cfiRange, note: 'Idea' })

    expect(invalidateActivityQueries).toHaveBeenCalledOnce()
  })

  it('invalidates a newly created private note', async () => {
    vi.mocked(apiPost).mockResolvedValue({ data: { ...note, visibility: 'private' } })
    const { wrapper } = setup()
    const { result } = renderHook(() => useCreateAnnotation('book-1'), { wrapper })

    await result.current.mutateAsync({ type: 'note', cfiRange: note.cfiRange, note: 'Private idea', visibility: 'private' })

    expect(invalidateActivityQueries).toHaveBeenCalledOnce()
  })

  it('invalidates a body-only edit to an existing shared note', async () => {
    vi.mocked(apiPut).mockResolvedValue({ data: { ...note, note: 'Updated idea' } })
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(['annotations', 'book-1'], { data: [note] })
    const { result } = renderHook(() => useUpdateAnnotation('book-1'), { wrapper })

    await result.current.mutateAsync({ id: note.id, body: { note: 'Updated idea' } })

    expect(invalidateActivityQueries).toHaveBeenCalledOnce()
  })

  it('invalidates an edit to an existing private note', async () => {
    const privateNote = { ...note, visibility: 'private' as const }
    vi.mocked(apiPut).mockResolvedValue({ data: { ...privateNote, note: 'Updated private idea' } })
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(['annotations', 'book-1'], { data: [privateNote] })
    const { result } = renderHook(() => useUpdateAnnotation('book-1'), { wrapper })

    await result.current.mutateAsync({ id: note.id, body: { note: 'Updated private idea' } })

    expect(invalidateActivityQueries).toHaveBeenCalledOnce()
  })

  it('invalidates when a shared note is changed to private', async () => {
    vi.mocked(apiPut).mockResolvedValue({ data: { ...note, visibility: 'private' } })
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(['annotations', 'book-1'], { data: [note] })
    const { result } = renderHook(() => useUpdateAnnotation('book-1'), { wrapper })

    await result.current.mutateAsync({ id: note.id, body: { visibility: 'private' } })

    expect(invalidateActivityQueries).toHaveBeenCalledOnce()
  })

  it('invalidates when a private note is changed to shared', async () => {
    const privateNote = { ...note, visibility: 'private' as const }
    vi.mocked(apiPut).mockResolvedValue({ data: { ...note, note: 'Published idea' } })
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(['annotations', 'book-1'], { data: [privateNote] })
    const { result } = renderHook(() => useUpdateAnnotation('book-1'), { wrapper })

    await result.current.mutateAsync({ id: note.id, body: { visibility: 'shared' } })

    expect(invalidateActivityQueries).toHaveBeenCalledOnce()
  })

  it('does not invalidate idea activity for highlight edits', async () => {
    const highlight = { ...note, type: 'highlight' as const }
    vi.mocked(apiPut).mockResolvedValue({ data: { ...highlight, text: 'Marked passage' } })
    const { queryClient, wrapper } = setup()
    queryClient.setQueryData(['annotations', 'book-1'], { data: [highlight] })
    const { result } = renderHook(() => useUpdateAnnotation('book-1'), { wrapper })

    await result.current.mutateAsync({ id: note.id, body: { text: 'Marked passage' } })

    expect(invalidateActivityQueries).not.toHaveBeenCalled()
  })
})
