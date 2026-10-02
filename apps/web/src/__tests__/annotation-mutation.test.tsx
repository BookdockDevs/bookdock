import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ANNOTATION_MAX_TEXT_LENGTH, type AnnotationRes } from '@bookdock/shared'

import { apiDelete, apiPost } from '@/api/client'

import { useCreateAnnotation } from '../features/reader/hooks/useAnnotations'

vi.mock('@/api/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}))

describe('annotation length guard', () => {
  it('rejects before replacing old highlights or issuing requests', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const old: AnnotationRes = { id: 'old', bookId: 'book', cfiRange: 'cfi', cfiAnchor: null, type: 'highlight', color: 'yellow', style: 'underline', text: 'Existing quote', note: null, chapter: null, createdAt: 0, updatedAt: 0 }
    client.setQueryData(['annotations', 'book'], { data: [old] })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useCreateAnnotation('book'), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync({ type: 'highlight', cfiRange: 'cfi', text: 'x'.repeat(ANNOTATION_MAX_TEXT_LENGTH + 1) })).rejects.toMatchObject({ code: 'ANNOTATION_TEXT_TOO_LONG' })
    })
    expect(apiDelete).not.toHaveBeenCalled()
    expect(apiPost).not.toHaveBeenCalled()
    expect(client.getQueryData(['annotations', 'book'])).toEqual({ data: [old] })
    client.clear()
  })
})
