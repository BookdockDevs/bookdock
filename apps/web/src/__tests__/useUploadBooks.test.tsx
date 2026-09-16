import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'

import { useToastStore } from '@/stores/toast.store'

import { useUploadBooks } from '../features/library/hooks'

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useUploadBooks', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient()
    useToastStore.getState().clearToasts()
    queryClient.setQueryData(['books'], { data: [] })
  })

  it('does not settle or notify while picker-selected files are pending', () => {
    const { result } = renderHook(() => useUploadBooks(), { wrapper: wrapper(queryClient) })

    act(() => {
      result.current.addFiles([new File([], 'book.epub')])
    })

    expect(result.current.items[0]?.status).toBe('pending')
    expect(useToastStore.getState().toasts).toHaveLength(0)
    expect(queryClient.getQueryState(['books'])?.isInvalidated).not.toBe(true)
  })
})
