import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { apiGet } from '@/api/client'
import { useReaderIdeas } from '../reader/hooks/useIdeas'
import { LocalReaderContext } from './reader-source-context'
import type { LocalReaderSession } from './reader-source-context'

vi.mock('@/api/client', () => ({ apiGet: vi.fn(), apiDelete: vi.fn(), apiPost: vi.fn(), apiPut: vi.fn() }))

describe('local query invalidation', () => {
  it('never replaces the local book query with a disabled remote observer transport', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const getBook = vi.fn().mockResolvedValue({ data: { id: 'book' } })
    const local = { namespace: 'local:test', getBook } as unknown as LocalReaderSession
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}><LocalReaderContext.Provider value={local}>{children}</LocalReaderContext.Provider></QueryClientProvider>
    const hook = renderHook(() => {
      const book = useQuery({ queryKey: ['book', local.namespace], queryFn: getBook })
      useReaderIdeas('book')
      return book
    }, { wrapper })
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true))
    await act(() => client.invalidateQueries({ queryKey: ['book', local.namespace] }))
    expect(getBook).toHaveBeenCalledTimes(2)
    expect(apiGet).not.toHaveBeenCalled()
    hook.unmount()
    client.clear()
  })
})
