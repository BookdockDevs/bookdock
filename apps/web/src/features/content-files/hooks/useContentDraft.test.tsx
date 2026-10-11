import { StrictMode, type ReactNode } from 'react'

import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import type { ContentFile } from '@bookdock/shared'

import { apiDelete, apiUpload } from '@/api/client'

import { useContentDraft } from './useContentDraft'

vi.mock('@/api/client', () => ({ apiDelete: vi.fn().mockResolvedValue({}), apiUpload: vi.fn() }))

describe('useContentDraft', () => {
  it('survives StrictMode, retains failed uploads for retry, and cancels only on actual close', async () => {
    vi.mocked(apiDelete).mockClear()
    const resource: ContentFile = { id: 'cfile_123456789012345678901', kind: 'image', name: 'image.png', mimeType: 'image/webp', size: 10, url: '/api/v1/content-files/cfile_123456789012345678901' }
    vi.mocked(apiUpload).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: resource })
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    const onUploaded = vi.fn()
    const { result, unmount } = renderHook(() => useContentDraft({ domain: 'idea', bookVersionId: 'book' }, onUploaded), {
      wrapper: ({ children }: { children: ReactNode }) => <StrictMode><QueryClientProvider client={client}>{children}</QueryClientProvider></StrictMode>,
    })
    await act(async () => {})
    expect(apiDelete).not.toHaveBeenCalled()
    const original = new File(['image'], 'image.png', { type: 'image/png' })
    act(() => result.current.add(original, 'image'))
    await waitFor(() => expect(result.current.entries[0].status).toBe('failed'))
    expect(result.current.entries[0].file).toBe(original)
    expect(onUploaded).not.toHaveBeenCalled()
    act(() => result.current.retry(result.current.entries[0]))
    await waitFor(() => expect(result.current.entries[0].status).toBe('ready'))
    expect(onUploaded).toHaveBeenCalledExactlyOnceWith(resource)
    const draftId = result.current.draftId
    unmount()
    await waitFor(() => expect(apiDelete).toHaveBeenCalledExactlyOnceWith(`/content-files/drafts/${draftId}`))
  })
})
