import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { apiPost } from '@/api/client'
import { useReadingRound } from '@/api/hooks/reading-records'

vi.mock('@/api/client', () => ({ apiPost: vi.fn().mockResolvedValue({ data: {} }), apiGet: vi.fn(), apiPut: vi.fn(), apiDelete: vi.fn() }))

describe('reading-round mutations', () => {
  it('refreshes the single-book status, progress, ledger and archive after finishing a round', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { result } = renderHook(() => useReadingRound('b1'), { wrapper })
    await act(async () => { await result.current.mutateAsync('finish') })
    expect(apiPost).toHaveBeenCalledWith('/reading-records/book/b1/round', { action: 'finish' })
    for (const queryKey of [['book', 'b1'], ['progress', 'b1'], ['reading-records'], ['archive']]) expect(invalidate).toHaveBeenCalledWith({ queryKey })
  })
})
