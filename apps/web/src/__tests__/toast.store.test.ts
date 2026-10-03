import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useToastStore } from '@/stores/toast.store'

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.getState().clearToasts()
  })

  afterEach(() => {
    useToastStore.getState().clearToasts()
    vi.useRealTimers()
  })

  it('uses severity-aware defaults and auto-dismisses', () => {
    const id = useToastStore.getState().addToast('Saved', 'success')

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      id,
      message: 'Saved',
      type: 'success',
      duration: 4_000,
    })

    vi.advanceTimersByTime(3_999)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('keeps persistent notifications until explicitly removed', () => {
    const id = useToastStore.getState().addToast('Needs attention', 'error', { duration: 'persistent' })

    vi.advanceTimersByTime(60_000)
    expect(useToastStore.getState().toasts).toHaveLength(1)

    useToastStore.getState().removeToast(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('pauses and resumes an auto-dismiss timer', () => {
    const id = useToastStore.getState().addToast('Saved', 'success')

    vi.advanceTimersByTime(1_000)
    useToastStore.getState().pauseToast(id)
    vi.advanceTimersByTime(10_000)
    expect(useToastStore.getState().toasts).toHaveLength(1)

    useToastStore.getState().resumeToast(id)
    vi.advanceTimersByTime(2_999)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('keeps at most three visible notifications', () => {
    const store = useToastStore.getState()
    store.addToast('One')
    store.addToast('Two')
    store.addToast('Three')
    store.addToast('Four')

    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['One', 'Two', 'Three'])
    expect(useToastStore.getState().queuedToasts.map((toast) => toast.message)).toEqual(['Four'])
    vi.advanceTimersByTime(5_000)
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['Four'])
    vi.advanceTimersByTime(4_999)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('waits for both pointer and focus to leave before resuming', () => {
    const store = useToastStore.getState()
    const id = store.addToast('Saved', 'success')
    vi.advanceTimersByTime(1_000)
    store.pauseToast(id, 'pointer')
    store.pauseToast(id, 'focus')
    store.resumeToast(id, 'pointer')
    vi.advanceTimersByTime(10_000)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    store.resumeToast(id, 'focus')
    vi.advanceTimersByTime(3_000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('updates a task in place and preserves its active pause', () => {
    const store = useToastStore.getState()
    const id = store.addToast('Working', 'info', { duration: 'persistent' })
    store.pauseToast(id, 'focus')
    store.updateToast(id, { message: 'Done', type: 'success' })
    vi.advanceTimersByTime(10_000)
    expect(useToastStore.getState().toasts).toEqual([expect.objectContaining({ id, message: 'Done', duration: 4_000 })])
    store.resumeToast(id, 'focus')
    vi.advanceTimersByTime(4_000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('deduplicates visible and queued events without merging different objects', () => {
    const store = useToastStore.getState()
    const first = store.addToast('Saved', 'success', { dedupeKey: 'save:book-1' })
    expect(store.addToast('Saved again', 'success', { dedupeKey: 'save:book-1' })).toBe(first)
    store.addToast('Other', 'info', { dedupeKey: 'save:book-2' })
    store.addToast('Third', 'info')
    const queued = store.addToast('Working', 'info', { dedupeKey: 'task:1' })
    expect(store.addToast('Done', 'success', { dedupeKey: 'task:1' })).toBe(queued)
    expect(useToastStore.getState().toasts).toHaveLength(3)
    expect(useToastStore.getState().queuedToasts).toEqual([expect.objectContaining({ id: queued, message: 'Done' })])
    store.clearToasts()
    vi.advanceTimersByTime(60_000)
    expect(useToastStore.getState().queuedToasts).toHaveLength(0)
  })

  it('protects persistent and interacting notifications when new events arrive', () => {
    const store = useToastStore.getState()
    const persistent = store.addToast('Needs action', 'warning', { duration: 'persistent' })
    const focused = store.addToast('Reading', 'info')
    store.pauseToast(focused, 'focus')
    store.addToast('Third')
    store.addToast('Fourth')
    vi.advanceTimersByTime(5_000)
    expect(useToastStore.getState().toasts.map((toast) => toast.id)).toEqual(expect.arrayContaining([persistent, focused]))
  })

  it('replaces obsolete actions, titles, and persistent lifetimes for a keyed result', () => {
    const store = useToastStore.getState()
    const id = store.addToast('Failed', 'error', {
      dedupeKey: 'task:1', duration: 'persistent', title: 'Old title', action: { label: 'Retry', onClick: vi.fn() },
    })
    expect(store.addToast('Done', 'success', { dedupeKey: 'task:1' })).toBe(id)
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ id, message: 'Done', action: undefined, title: undefined, duration: 4_000 }),
    ])
    vi.advanceTimersByTime(4_000)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })
})
