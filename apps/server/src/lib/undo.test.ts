import { describe, expect, it, vi } from 'vitest'

import { AppError } from '../middleware/error'
import { executeUndoReceipt, issueUndoReceipt } from './undo'

describe('undo receipts', () => {
  it('binds a single latest receipt to its user and acknowledges retries without rerunning it', async () => {
    const restore = vi.fn()
    const token = issueUndoReceipt('alice', restore)

    await expect(executeUndoReceipt('bob', token)).rejects.toMatchObject({ code: 'UNDO_UNAVAILABLE' })
    await executeUndoReceipt('alice', token)
    await executeUndoReceipt('alice', token)

    expect(restore).toHaveBeenCalledTimes(1)
  })

  it('invalidates the previous opportunity only when a new receipt is issued', async () => {
    const first = issueUndoReceipt('alice', vi.fn())
    const second = issueUndoReceipt('alice', vi.fn())

    await expect(executeUndoReceipt('alice', first)).rejects.toMatchObject({ code: 'UNDO_UNAVAILABLE' })
    await expect(executeUndoReceipt('alice', second)).resolves.toBeUndefined()
  })

  it('keeps a transiently failed restore retryable but retires a conflicted restore', async () => {
    vi.useFakeTimers()
    let shouldFail = true
    const token = issueUndoReceipt('alice', () => {
      if (shouldFail) throw new Error('temporary database error')
    })
    vi.advanceTimersByTime(60_000)
    await expect(executeUndoReceipt('alice', token)).rejects.toThrow('temporary database error')
    vi.advanceTimersByTime(60_001)
    shouldFail = false
    await expect(executeUndoReceipt('alice', token)).resolves.toBeUndefined()

    const conflicted = issueUndoReceipt('alice', () => { throw new AppError('UNDO_CONFLICT') })
    await expect(executeUndoReceipt('alice', conflicted)).rejects.toMatchObject({ code: 'UNDO_CONFLICT' })
    await expect(executeUndoReceipt('alice', conflicted)).rejects.toMatchObject({ code: 'UNDO_UNAVAILABLE' })
    vi.useRealTimers()
  })

  it('expires receipts without executing their restore callback', async () => {
    vi.useFakeTimers()
    const restore = vi.fn()
    const token = issueUndoReceipt('alice', restore)
    vi.advanceTimersByTime(120_001)
    await expect(executeUndoReceipt('alice', token)).rejects.toMatchObject({ code: 'UNDO_UNAVAILABLE' })
    expect(restore).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
