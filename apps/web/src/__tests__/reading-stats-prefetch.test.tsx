import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { apiGet } from '@/api/client'
import { useBookReadingRecords, usePrefetchBookReadingStats, useReadingSummary } from '@/api/hooks/reading-records'

vi.mock('@/api/client', () => ({ apiGet: vi.fn().mockResolvedValue({ data: {} }) }))
vi.mock('@/lib/reveal-hidden', () => ({ withReveal: (path: string) => path }))

describe('reading stats prefetch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('warms the live total and ledger queries without fetching the retired mixed detail feed', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    renderHook(() => usePrefetchBookReadingStats('b1'), { wrapper })

    await waitFor(() => expect(client.getQueryData(['reading-records', 'ledger', 'b1'])).toEqual({ data: {} }))
    expect(client.getQueryData(['reading-records', 'book', 'b1'])).toEqual({ data: {} })
    expect(vi.mocked(apiGet).mock.calls.map(([path]) => path)).toEqual([
      '/reading-records/book/b1',
      '/reading-records/book/b1/ledger',
    ])
    client.clear()
  })

  it('does not prefetch private reading data for a guest', () => {
    const client = new QueryClient()
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    renderHook(() => usePrefetchBookReadingStats(undefined), { wrapper })
    expect(apiGet).not.toHaveBeenCalled()
    client.clear()
  })
})

describe('scoped reading queries', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps per-book period caches separate and respects disabled queries', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    const { rerender } = renderHook(({ date, enabled }) => useBookReadingRecords('b1', { enabled, range: { from: date, to: date, timezone: 'Asia/Shanghai' } }), { wrapper, initialProps: { date: '2026-10-18', enabled: true } })
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/reading-records/book/b1?from=2026-10-18&to=2026-10-18&timezone=Asia%2FShanghai'))
    rerender({ date: '2026-10-17', enabled: true })
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/reading-records/book/b1?from=2026-10-17&to=2026-10-17&timezone=Asia%2FShanghai'))
    rerender({ date: '2026-10-16', enabled: false })
    expect(apiGet).toHaveBeenCalledTimes(2)
    expect(client.getQueryCache().getAll()).toHaveLength(3)
    client.clear()
  })

  it('calculates the current date in the requested viewing timezone', async () => {
    const timezone = 'Pacific/Kiritimati'
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
    renderHook(() => useReadingSummary('2026-10-01', '2026-10-31', timezone), { wrapper })
    await waitFor(() => expect(apiGet).toHaveBeenCalled())
    const url = new URL(vi.mocked(apiGet).mock.calls[0][0], 'https://bookdock.test')
    expect(Object.fromEntries(url.searchParams)).toEqual({ today, timezone, from: '2026-10-01', to: '2026-10-31' })
    client.clear()
  })
})
