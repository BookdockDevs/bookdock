import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AiChatJobRes } from '@bookdock/shared'

import { apiPost, apiGet } from '@/api/client'
import { useAiJobs } from '@/api/hooks/useAi'
import { LocalReaderContext, type LocalReaderSession } from '@/features/reading-data/reader-source-context'
import { useAuthStore } from '@/stores/auth.store'

vi.mock('@/api/client', async (actual) => ({ ...await actual<typeof import('@/api/client')>(), apiGet: vi.fn(), apiPost: vi.fn() }))
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }))

const job: AiChatJobRes = {
  id: 'job-1', kind: 'local', scopeKey: 'local:vault:book:revision', clientRequestId: 'assistant-1', threadId: 'thread-1',
  runId: null, state: 'completed', content: 'Finished while the reader was closed.', citations: [], receipt: null, tool: null, error: null, createdAt: 1, updatedAt: 2,
}

describe('background AI recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.getState().setAuth({ id: 'account-1', username: 'one', role: 'member' })
  })

  function mount() {
    const applyAiThreadResult = vi.fn().mockResolvedValue(true)
    const local = { namespace: job.scopeKey, applyAiThreadResult } as unknown as LocalReaderSession
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}><LocalReaderContext.Provider value={local}>{children}</LocalReaderContext.Provider></QueryClientProvider>
    return { ...renderHook(() => useAiJobs('book'), { wrapper }), applyAiThreadResult }
  }

  it('recovers a completed local answer into its original saved message before acknowledging', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: [job] })
    const view = mount()
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true))
    expect(view.applyAiThreadResult).toHaveBeenCalledWith('thread-1', 'assistant-1', { content: job.content, context: null, citations: [], aborted: false })
    expect(apiPost).toHaveBeenCalledWith('/ai/jobs/job-1/acknowledge')
    expect(view.applyAiThreadResult.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(apiPost).mock.invocationCallOrder[0]!)
    vi.mocked(apiGet).mockResolvedValue({ data: [] })
    await act(async () => { await view.result.current.refetch() })
    expect(view.applyAiThreadResult).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('does not rewrite an unchanged result when progress is fetched again', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: [job] })
    const view = mount()
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true))
    await act(async () => { await view.result.current.refetch() })
    expect(view.applyAiThreadResult).toHaveBeenCalledTimes(1)
    expect(apiPost).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('does not acknowledge a result when writing it to local storage fails', async () => {
    vi.mocked(apiGet).mockResolvedValue({ data: [job] })
    const view = mount()
    view.applyAiThreadResult.mockRejectedValue(new Error('Storage full'))
    await waitFor(() => expect(view.result.current.isError).toBe(true))
    expect(apiPost).not.toHaveBeenCalled()
    view.unmount()
  })
})
