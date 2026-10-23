import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiGet } from '@/api/client'

import { READING_RECORDS_KEY, useReadingLedgerRecovery } from './reading-records'

vi.mock('@/api/client', () => ({ apiGet: vi.fn() }))
vi.mock('@/lib/reveal-hidden', () => ({ withReveal: (url: string) => url }))

const clients: QueryClient[] = []

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  clients.push(client)
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children)
  return { client, wrapper }
}

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear())
  vi.resetAllMocks()
})

describe('reading ledger version recovery', () => {
  it('retries with the latest overview and replaces multiple pages with one fresh page', async () => {
    const { client, wrapper } = setup()
    let ledgers = 0
    vi.mocked(apiGet).mockImplementation(async (url) => {
      if (url.endsWith('/ledger')) return { data: { dataVersion: ++ledgers } } as never
      if (url.includes('/sessions')) return { data: { dataVersion: 2, items: [], nextCursor: null, hasMore: false } } as never
      return { data: { dataVersion: 2 } } as never
    })
    const key = [...READING_RECORDS_KEY, 'ledger-sessions', 'book', undefined, undefined, 2]
    client.setQueryData(key, { pages: [{ data: { dataVersion: 1 } }, { data: { dataVersion: 1 } }], pageParams: [undefined, 'old-cursor'] })
    const { result } = renderHook(() => useReadingLedgerRecovery('book', true), { wrapper })
    await waitFor(() => expect(client.getQueryData<{ pages: unknown[] }>(key)?.pages).toHaveLength(1))
    expect(ledgers).toBe(2)
    expect(result.current.failed).toBe(false)
    expect(vi.mocked(apiGet).mock.calls.filter(([url]) => url.includes('/sessions'))).toHaveLength(2)
    expect(vi.mocked(apiGet).mock.calls.some(([url]) => url.includes('cursor='))).toBe(false)
  })

  it('stops after two completed attempts even when reset data temporarily removes the mismatch', async () => {
    const { wrapper } = setup()
    let ledgers = 0
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => { release = resolve })
    vi.mocked(apiGet).mockImplementation(async (url) => {
      if (url.endsWith('/ledger')) return { data: { dataVersion: ++ledgers } } as never
      await pending
      if (url.includes('/sessions')) return { data: { dataVersion: 9, items: [], nextCursor: null, hasMore: false } } as never
      return { data: { dataVersion: 9 } } as never
    })
    const { result, rerender } = renderHook(({ mismatch }) => useReadingLedgerRecovery('book', mismatch), {
      wrapper, initialProps: { mismatch: true },
    })
    await waitFor(() => expect(ledgers).toBe(1))
    rerender({ mismatch: false })
    await act(async () => { release!(); await pending })
    await waitFor(() => expect(result.current.failed).toBe(true))
    rerender({ mismatch: true })
    expect(ledgers).toBe(2)
    expect(vi.mocked(apiGet).mock.calls).toHaveLength(6)
  })

  it('allows a fresh recovery after an explicit retry', async () => {
    const { wrapper } = setup()
    let consistent = false
    let ledgers = 0
    vi.mocked(apiGet).mockImplementation(async (url) => {
      if (url.endsWith('/ledger')) { ledgers++; return { data: { dataVersion: 1 } } as never }
      const dataVersion = consistent ? 1 : 2
      return { data: url.includes('/sessions') ? { dataVersion, items: [], nextCursor: null, hasMore: false } : { dataVersion } } as never
    })
    const { result } = renderHook(() => useReadingLedgerRecovery('book', true), { wrapper })
    await waitFor(() => expect(result.current.failed).toBe(true))
    consistent = true
    act(() => result.current.retry())
    await waitFor(() => expect(ledgers).toBe(3))
    await waitFor(() => expect(result.current.failed).toBe(false))
  })

  it('does not start follow-up requests after unmount', async () => {
    const { wrapper } = setup()
    let release: (() => void) | undefined
    const pending = new Promise<void>((resolve) => { release = resolve })
    vi.mocked(apiGet).mockImplementation(async () => {
      await pending
      return { data: { dataVersion: 1 } } as never
    })
    const { unmount } = renderHook(() => useReadingLedgerRecovery('book', true), { wrapper })
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1))
    unmount()
    await act(async () => { release!(); await pending })
    expect(apiGet).toHaveBeenCalledTimes(1)
  })
})
