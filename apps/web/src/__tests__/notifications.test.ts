import { afterEach, describe, expect, it } from 'vitest'

import { notify } from '@/lib/notifications'
import { useToastStore } from '@/stores/toast.store'

describe('notify', () => {
  afterEach(() => {
    useToastStore.getState().clearToasts()
  })

  it('provides severity-specific notification methods', () => {
    notify.success({ key: 'toast.bookUpdated' })
    notify.warning('Check this')
    notify.error({ key: 'errors.operationFailed' })

    expect(useToastStore.getState().toasts.map((toast) => [toast.type, toast.message])).toEqual([
      ['success', { key: 'toast.bookUpdated' }],
      ['warning', 'Check this'],
      ['error', { key: 'errors.operationFailed' }],
    ])
  })

  it('replaces keyed feedback through the severity-specific methods', () => {
    const id = notify.warning('Partially uploaded', { dedupeKey: 'upload:1' })
    expect(notify.success({ key: 'library.uploadImported', params: { count: 2 } }, { dedupeKey: 'upload:1' })).toBe(id)
    expect(useToastStore.getState().toasts).toEqual([expect.objectContaining({ id, type: 'success', duration: 4_000 })])
  })

  it('merges repeated feedback in the queue regardless of parameter order', () => {
    notify.info('One')
    notify.info('Two')
    notify.info('Three')
    const id = notify.warning({ key: 'library.batchPartial', params: { succeeded: 1, failed: 2 } })
    expect(notify.warning({ key: 'library.batchPartial', params: { failed: 2, succeeded: 1 } })).toBe(id)
    expect(useToastStore.getState().queuedToasts).toHaveLength(1)
  })

  it('keeps different results, titles, severities, and action targets separate', () => {
    const first = notify.success({ key: 'library.bookRestored', params: { title: 'A' } })
    expect(notify.success({ key: 'library.bookRestored', params: { title: 'B' } })).not.toBe(first)
    expect(notify.info({ key: 'library.bookRestored', params: { title: 'A' } })).not.toBe(first)
    expect(notify.success({ key: 'library.bookRestored', params: { title: 'A' } }, { title: 'Other' })).not.toBe(first)
    const action = { label: 'Retry', onClick: () => {} }
    expect(notify.error('Failed', { action })).not.toBe(notify.error('Failed', { action }))
    expect(notify.info('Working', { duration: 'persistent' })).not.toBe(notify.info('Working', { duration: 'persistent' }))
  })

  it('allows the same feedback again after dismissal', () => {
    const first = notify.success('Copied')
    expect(notify.success('Copied')).toBe(first)
    useToastStore.getState().removeToast(first)
    expect(notify.success('Copied')).not.toBe(first)
  })
})
