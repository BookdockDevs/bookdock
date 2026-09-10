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

    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual(['Two', 'Three', 'Four'])
  })
})
