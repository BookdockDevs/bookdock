import { afterEach, describe, expect, it, vi } from 'vitest'

import { notify } from '@/lib/notifications'
import { hasUndoOpportunity, publishUndoOpportunity, runUndo } from '@/lib/undo'
import { useAuthStore } from '@/stores/auth.store'
import { useToastStore } from '@/stores/toast.store'

describe('notify', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    useToastStore.getState().clearToasts()
    useAuthStore.getState().clearAuth()
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

  it('adds undo to the operation success notification instead of creating another toast', () => {
    const receipt = { token: 'receipt', label: 'Undo' }
    publishUndoOpportunity({ ...receipt, expiresAt: Date.now() + 120_000, generation: 100 })
    const id = notify.success({ key: 'toast.bookUpdated' }, { undo: receipt })
    const toasts = useToastStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ id, message: { key: 'toast.bookUpdated' }, action: { icon: 'undo' }, priority: 'high' })
  })

  it('does not let an older receipt response replace the latest undo notification', () => {
    const expiresAt = Date.now() + 120_000
    const receipt = { token: 'newer-receipt', label: 'Undo' }
    publishUndoOpportunity({ ...receipt, expiresAt, generation: 200 })
    notify.success('Newer operation', { undo: receipt })
    publishUndoOpportunity({ token: 'older-receipt', label: 'Undo', expiresAt: expiresAt - 1_000, generation: 199 })
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0]).toMatchObject({ message: 'Newer operation', action: { icon: 'undo' } })
  })

  it('attaches an undo action only to its explicitly associated notification and only once', () => {
    const receipt = { token: 'specific-receipt', label: 'Undo' }
    publishUndoOpportunity({ ...receipt, expiresAt: Date.now() + 120_000, generation: 300 })

    notify.success('Copied')
    const operationId = notify.success('Pinned', { undo: receipt })
    const laterId = notify.warning('Another result', { undo: receipt })

    expect(useToastStore.getState().toasts.find((toast) => toast.id === operationId)).toMatchObject({ action: { icon: 'undo' } })
    expect(useToastStore.getState().toasts.find((toast) => toast.id === laterId)).not.toHaveProperty('action')
    expect(useToastStore.getState().toasts.find((toast) => toast.message === 'Copied')).not.toHaveProperty('action')
  })

  it('keeps a partial retry notification persistent after the undo action expires', () => {
    vi.useFakeTimers()
    try {
      const receipt = { token: 'partial-receipt', label: 'Undo' }
      const retry = vi.fn()
      publishUndoOpportunity({ ...receipt, expiresAt: Date.now() + 120_000, generation: 400 })
      const id = notify.warning('Partially updated', {
        dedupeKey: 'partial-update',
        duration: 'persistent',
        action: { label: 'Retry failed items', onClick: retry },
        undo: receipt,
      })
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        id, duration: 10_000, action: { label: 'Retry failed items' }, secondaryAction: { icon: 'undo' },
      })

      vi.advanceTimersByTime(10_000)

      expect(useToastStore.getState().toasts[0]).toMatchObject({
        id, duration: 'persistent', action: { label: 'Retry failed items' },
      })
      expect(useToastStore.getState().toasts[0]?.secondaryAction).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('preserves a partial operation retry action after undo succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const receipt = { token: 'partial-success-receipt', label: 'Undo' }
    const retry = vi.fn()
    publishUndoOpportunity({ ...receipt, expiresAt: Date.now() + 120_000, generation: 500 })
    const id = notify.warning({ key: 'library.batchPartial', params: { action: '置顶', succeeded: 2, failed: 1 } }, {
      dedupeKey: 'partial-success', duration: 'persistent', action: { label: '重试失败项', onClick: retry }, undo: receipt,
    })

    await runUndo()

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      id, message: { key: 'undo.partialSucceeded', params: { succeeded: 2, failed: 1 } },
      duration: 'persistent', action: { label: '重试失败项' }, type: 'success',
    })
    expect(useToastStore.getState().toasts[0]?.secondaryAction).toBeUndefined()
  })

  it.each(['server', 'network', 'local'])('clears the undo opportunity after a %s failure', async (failure) => {
    const request = vi.fn()
    if (failure === 'server') request.mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: { code: 'INTERNAL_ERROR' } }) })
    else request.mockRejectedValue(new Error('unavailable'))
    vi.stubGlobal('fetch', request)
    const receipt = { token: `failed-${failure}`, label: 'Undo' }
    publishUndoOpportunity({ ...receipt, expiresAt: Date.now() + 120_000, generation: 502, ...(failure === 'local' ? { execute: async () => { throw new Error('unavailable') } } : {}) })
    const id = notify.success('Pinned', { undo: receipt })

    await runUndo()
    expect(useToastStore.getState().toasts[0]).toMatchObject({ id, type: 'error', message: { key: 'undo.retryableFailure' }, duration: 9_000 })
    expect(useToastStore.getState().toasts[0]?.action).toBeUndefined()
    expect(hasUndoOpportunity()).toBe(false)
    await runUndo()
    expect(request).toHaveBeenCalledTimes(failure === 'local' ? 0 : 1)
  })

  it('does not log out a new account when an old undo request returns 401', async () => {
    useAuthStore.getState().setAuth({ id: 'account-a', username: 'a', role: 'member' })
    let respond!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { respond = resolve })))
    const receipt = { token: 'old-account-receipt', label: 'Undo' }
    publishUndoOpportunity({ ...receipt, expiresAt: Date.now() + 120_000, generation: 600 })
    notify.success('Old account action', { undo: receipt })

    const pendingUndo = runUndo()
    useAuthStore.getState().setAuth({ id: 'account-b', username: 'b', role: 'member' })
    respond(new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'expired' } }), { status: 401 }))
    await pendingUndo

    expect(useAuthStore.getState().user?.id).toBe('account-b')
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
