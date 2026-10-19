import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError, apiPost } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'
import { queueReadingRecord, retryReadingRecords, useReadingSaveState } from '../reading-record-queue'

vi.mock('@/api/client', async (original) => ({ ...await original<typeof import('@/api/client')>(), apiPost: vi.fn().mockResolvedValue({}) }))
vi.mock('@/lib/query-client', () => ({ queryClient: { invalidateQueries: vi.fn() } }))

const record = {
  bookId: 'book-1', date: '2026-10-18', durationSeconds: 60,
  requestId: 'request-1', source: 'manual' as const,
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.mocked(apiPost).mockResolvedValue({})
  useReadingSaveState.setState({ pending: 0, saveFailed: false, storageFailed: false })
  useAuthStore.setState({ user: { id: 'reader-1', username: 'reader', role: 'user' } })
})

describe('durable reading writes', () => {
  it('retains terminal rejections without blocking later books, and retries them only explicitly', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new ApiError('VALIDATION_ERROR', 'invalid', undefined, 400))
    const rejectedRecord = { ...record, requestId: 'terminal-record' }
    queueReadingRecord('reader-1', rejectedRecord)
    await vi.waitFor(() => expect(useReadingSaveState.getState().saveFailed).toBe(true))
    queueReadingRecord('reader-1', { ...record, bookId: 'book-2', requestId: 'later-record' })
    await vi.waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2))
    expect(apiPost).toHaveBeenLastCalledWith('/reading-records', expect.objectContaining({ bookId: 'book-2' }))
    await vi.waitFor(() => expect(JSON.parse(localStorage.getItem('bd-reading-pending:reader-1')!)).toEqual([rejectedRecord]))
    await retryReadingRecords()
    expect(apiPost).toHaveBeenCalledTimes(2)
    useReadingSaveState.setState({ saveFailed: false })
    await retryReadingRecords()
    expect(useReadingSaveState.getState().saveFailed).toBe(true)
    await retryReadingRecords(true)
    expect(apiPost).toHaveBeenCalledTimes(3)
    expect(useReadingSaveState.getState()).toMatchObject({ pending: 0, saveFailed: false })
  })

  it('retains failed writes and retries with the same identity', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('offline'))
    queueReadingRecord('reader-1', record)
    await vi.waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1))
    expect(JSON.parse(localStorage.getItem('bd-reading-pending:reader-1')!)).toEqual([record])
    expect(useReadingSaveState.getState().pending).toBe(1)
    expect(useReadingSaveState.getState().saveFailed).toBe(true)
    await retryReadingRecords()
    expect(apiPost).toHaveBeenLastCalledWith('/reading-records', { ...record, expectedUserId: 'reader-1' })
    expect(JSON.parse(localStorage.getItem('bd-reading-pending:reader-1')!)).toEqual([])
    expect(useReadingSaveState.getState().saveFailed).toBe(false)
  })

  it('does not report normal in-flight saves as failures', async () => {
    let complete!: (value: unknown) => void
    vi.mocked(apiPost).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    queueReadingRecord('reader-1', { ...record, requestId: 'in-flight' })
    await vi.waitFor(() => expect(apiPost).toHaveBeenCalledOnce())
    expect(useReadingSaveState.getState()).toMatchObject({ pending: 1, saveFailed: false })
    complete({})
    await vi.waitFor(() => expect(useReadingSaveState.getState().pending).toBe(0))
  })

  it('never sends another account pending writes', async () => {
    queueReadingRecord('other-reader', record)
    await retryReadingRecords()
    expect(apiPost).not.toHaveBeenCalled()
    expect(localStorage.getItem('bd-reading-pending:other-reader')).toContain('request-1')
  })

  it('deduplicates pending records by request identity', async () => {
    vi.mocked(apiPost).mockRejectedValue(new Error('offline'))
    queueReadingRecord('reader-1', record)
    queueReadingRecord('reader-1', record)
    await vi.waitFor(() => expect(apiPost).toHaveBeenCalled())
    expect(JSON.parse(localStorage.getItem('bd-reading-pending:reader-1')!)).toHaveLength(1)
  })

  it('keeps failed local writes in memory until the server accepts them', async () => {
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('offline'))
    queueReadingRecord('reader-1', { ...record, requestId: 'quota-record' })
    await vi.waitFor(() => expect(apiPost).toHaveBeenCalled())
    expect(useReadingSaveState.getState().pending).toBe(1)
    write.mockRestore()
    await retryReadingRecords()
    expect(apiPost).toHaveBeenLastCalledWith('/reading-records', expect.objectContaining({ requestId: 'quota-record' }))
    expect(useReadingSaveState.getState().pending).toBe(0)
  })

  it('retains recovery data through logout without exposing it to another account', async () => {
    vi.mocked(apiPost).mockRejectedValueOnce(new Error('offline'))
    queueReadingRecord('reader-1', record)
    await vi.waitFor(() => expect(apiPost).toHaveBeenCalled())
    useAuthStore.getState().clearAuth()
    expect(localStorage.getItem('bd-reading-pending:reader-1')).toContain('request-1')
    vi.mocked(apiPost).mockClear()
    useAuthStore.getState().setAuth({ id: 'reader-2', username: 'other', role: 'user' })
    await retryReadingRecords()
    expect(apiPost).not.toHaveBeenCalled()
    expect(useReadingSaveState.getState().pending).toBe(0)
  })

  it('splits captured sessions exceeding the API daily duration limit', async () => {
    const startedAt = Date.now() - 25 * 3600_000
    queueReadingRecord('reader-1', { ...record, requestId: 'long-record', durationSeconds: 25 * 3600,
      fragments: [{ startedAt, endedAt: startedAt + 25 * 3600_000 }], coverage: [[0.1, 0.3]],
    })
    await vi.waitFor(() => expect(apiPost).toHaveBeenCalledTimes(2))
    expect(vi.mocked(apiPost).mock.calls.map((call) => (call[1] as typeof record).durationSeconds)).toEqual([86400, 3600])
    expect(apiPost).toHaveBeenNthCalledWith(2, '/reading-records', expect.objectContaining({ requestId: 'long-record.1', coverage: [] }))
  })

  it('recovers expired suspended sessions from closed tabs', async () => {
    localStorage.setItem('bd-reading-manual:reader-1:closed-tab', JSON.stringify({
      'book-1': { userId: 'reader-1', phase: 'suspended', expiresAt: Date.now() - 1, pendingRecord: record },
      'book-2': { userId: 'reader-1', phase: 'paused', pendingRecord: { ...record, requestId: 'paused' } },
    }))
    await retryReadingRecords()
    expect(apiPost).toHaveBeenCalledWith('/reading-records', { ...record, expectedUserId: 'reader-1' })
    expect(JSON.parse(localStorage.getItem('bd-reading-manual:reader-1:closed-tab')!)).toHaveProperty('book-2')
    expect(JSON.parse(localStorage.getItem('bd-reading-manual:reader-1:closed-tab')!)).not.toHaveProperty('book-1')
  })

  it('recovers expired automatic drafts while discarding short captures and retaining unexpired ones', async () => {
    const key = 'bd-reading-auto:reader-1:closed-tab'
    localStorage.setItem(key, JSON.stringify({
      'book-1': { userId: 'reader-1', phase: 'suspended', expiresAt: Date.now() - 1, pendingRecord: { ...record, source: 'auto' } },
      short: { userId: 'reader-1', phase: 'suspended', expiresAt: Date.now() - 1, pendingRecord: { ...record, source: 'auto', requestId: 'short', durationSeconds: 40 } },
      pending: { userId: 'reader-1', phase: 'suspended', expiresAt: Date.now() + 60_000, pendingRecord: { ...record, source: 'auto', requestId: 'pending' } },
    }))
    await retryReadingRecords()
    expect(apiPost).toHaveBeenCalledTimes(1)
    expect(apiPost).toHaveBeenCalledWith('/reading-records', { ...record, source: 'auto', expectedUserId: 'reader-1' })
    expect(Object.keys(JSON.parse(localStorage.getItem(key)!))).toEqual(['pending'])
  })
})
