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
})
