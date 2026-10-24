import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { hasUndoOpportunity, publishUndoOpportunity } from '@/lib/undo'
import { notify } from '@/lib/notifications'
import { useAuthStore } from '@/stores/auth.store'
import { useToastStore } from '@/stores/toast.store'
import { queryClient } from '@/lib/query-client'
import { UndoHotkey } from '@/providers/AppProviders'

describe('application undo shortcut', () => {
  afterEach(() => vi.restoreAllMocks())

  beforeEach(() => {
    localStorage.clear()
    useToastStore.getState().clearToasts()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: null }) }))
  })

  it('does not consume Ctrl+Z when no undo opportunity exists', () => {
    render(<UndoHotkey />)
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('leaves text editing, IME composition and modal dialog shortcuts to their contexts', () => {
    publishUndoOpportunity({ token: 'receipt' })
    render(<><textarea data-testid="editor" /><div role="dialog" aria-modal="true"><button data-testid="modal-key" /></div><UndoHotkey /></>)
    const editor = document.querySelector('textarea')!
    const textEvent = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    editor.dispatchEvent(textEvent)
    const composing = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true, isComposing: true })
    document.body.dispatchEvent(composing)
    const modal = document.querySelector('[data-testid="modal-key"]')!
    const modalEvent = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    modal.dispatchEvent(modalEvent)
    expect(textEvent.defaultPrevented).toBe(false)
    expect(composing.defaultPrevented).toBe(false)
    expect(modalEvent.defaultPrevented).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('takes over the configured application shortcut only with a valid opportunity', async () => {
    const receipt = { token: 'receipt' }
    publishUndoOpportunity(receipt)
    notify.success('整理完成', { undo: receipt })
    render(<UndoHotkey />)
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/v1/books/undo/receipt', { method: 'POST' }))
  })

  it('invalidates only the query prefixes affected by a completed undo', () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    render(<UndoHotkey />)

    window.dispatchEvent(new CustomEvent('bd:undo-complete', { detail: { queryKeys: [['books'], ['book', 'book-1']] } }))

    expect(invalidate).toHaveBeenCalledTimes(2)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['books'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['book', 'book-1'] })
    expect(invalidate).not.toHaveBeenCalledWith()
    invalidate.mockRestore()
  })

  it('clears the opportunity and its notification when the account changes', () => {
    publishUndoOpportunity({ token: 'receipt' })
    useAuthStore.setState({ user: { id: 'new-account', username: 'new', role: 'user' } })
    expect(hasUndoOpportunity()).toBe(false)
    expect(useToastStore.getState().toasts).toHaveLength(0)
    useAuthStore.setState({ user: null })
  })
})
