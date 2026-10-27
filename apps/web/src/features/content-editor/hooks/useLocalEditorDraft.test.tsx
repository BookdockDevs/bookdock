import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ account: 'user-a', records: new Map<string, any>(), fail: false }))
vi.mock('@/stores/auth.store', () => {
  const useAuthStore = Object.assign((select: (state: unknown) => unknown) => select({ user: { id: state.account } }), { getState: () => ({ user: { id: state.account } }) })
  return { useAuthStore, getAuthSessionRevision: () => 1 }
})
vi.mock('../lib/local-draft-store', () => ({
  DRAFT_MAX_AGE: 90 * 86400000,
  draftKey: (account: string, book: string, format: string, target: unknown) => JSON.stringify([account, format, book, target ?? null]),
  readLocalDraft: async (key: string) => { if (state.fail) throw new Error('unavailable'); return state.records.get(key) },
  replaceLocalDraft: async (key: string, expected: string | null, value: any, valid: () => boolean) => {
    if (state.fail) throw new Error('quota')
    if (!valid() || (state.records.get(key)?.token ?? null) !== expected) return false
    if (value) state.records.set(key, value); else state.records.delete(key)
    return true
  },
}))

import { useLocalEditorDraft } from './useLocalEditorDraft'
import { draftKey } from '../lib/local-draft-store'

const schema = { safeParse: (value: unknown): { success: true; data: { text: string } } | { success: false } => typeof value === 'object' && value !== null && 'text' in value && typeof value.text === 'string' ? { success: true, data: { text: value.text } } : { success: false } }
function options(overrides: Partial<Parameters<typeof useLocalEditorDraft<{ text: string }>>[0]> = {}) {
  return { bookId: 'book', format: 'txt' as const, revisionId: 'rev-1', enabled: true, dirty: true, payload: () => ({ text: 'edited' }), schema, restore: vi.fn(() => true), ...overrides }
}

describe('local editor recovery', () => {
  beforeEach(() => { state.records.clear(); state.account = 'user-a'; state.fail = false })
  afterEach(() => { vi.useRealTimers() })

  it('automatically restores a same-revision draft after loading', async () => {
    const key = draftKey('user-a', 'book', 'txt')
    state.records.set(key, { version: 1, key, revisionId: 'rev-1', token: 'old', savedAt: Date.now(), payload: { text: 'old draft' } })
    const config = options()
    const { result } = renderHook(() => useLocalEditorDraft(config))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(config.restore).toHaveBeenCalledWith({ text: 'old draft' })
    expect(result.current.candidate).toBeNull()
    expect(state.records.get(key).token).toBe('old')
  })

  it('retains revision conflicts and discards only after explicit choice', async () => {
    const key = draftKey('user-a', 'book', 'txt')
    state.records.set(key, { version: 1, key, revisionId: 'old-revision', token: 'old', savedAt: Date.now(), payload: { text: 'recover me' } })
    const config = options()
    const { result } = renderHook(() => useLocalEditorDraft(config))
    await waitFor(() => expect(result.current.candidate).not.toBeNull())
    act(() => result.current.restore())
    expect(config.restore).not.toHaveBeenCalled()
    await act(async () => result.current.discard())
    expect(state.records.has(key)).toBe(false)
  })

  it('detects another tab, preserves its draft, and reports a failure', async () => {
    const key = draftKey('user-a', 'book', 'txt')
    const { result } = renderHook(() => useLocalEditorDraft(options()))
    await waitFor(() => expect(result.current.ready).toBe(true))
    state.records.set(key, { token: 'other-tab' })
    await waitFor(() => expect(result.current.failure).toContain('另一标签页'), { timeout: 3000 })
    expect(state.records.get(key).token).toBe('other-tab')
  })

  it('flushes the latest edit immediately before leaving', async () => {
    const key = draftKey('user-a', 'book', 'txt')
    const { result } = renderHook(() => useLocalEditorDraft(options()))
    await waitFor(() => expect(result.current.ready).toBe(true))
    let saved = false
    await act(async () => { saved = await result.current.flush({ text: 'last keystroke' }) })
    expect(saved).toBe(true)
    expect(state.records.get(key).payload).toEqual({ text: 'last keystroke' })
  })

  it('refuses to leave as protected if the immediate flush fails', async () => {
    const { result } = renderHook(() => useLocalEditorDraft(options()))
    await waitFor(() => expect(result.current.ready).toBe(true))
    state.fail = true
    let saved = true
    await act(async () => { saved = await result.current.flush() })
    expect(saved).toBe(false)
    expect(result.current.failure).toContain('本地暂存失败')
  })

  it('retains a same-revision record that cannot safely be restored', async () => {
    const key = draftKey('user-a', 'book', 'txt')
    state.records.set(key, { version: 1, key, revisionId: 'rev-1', token: 'old', savedAt: Date.now(), payload: { text: 'draft' } })
    const { result } = renderHook(() => useLocalEditorDraft(options({ restore: () => false })))
    await waitFor(() => expect(result.current.candidate?.token).toBe('old'))
    expect(result.current.failure).toContain('不匹配')
    expect(state.records.get(key).token).toBe('old')
  })

  it('reports storage failures without preventing editing', async () => {
    state.fail = true
    const { result } = renderHook(() => useLocalEditorDraft(options()))
    await waitFor(() => expect(result.current.failure).toContain('本地暂存失败'))
    expect(result.current.ready).toBe(true)
  })

  it('debounces a dirty draft, retains it until cleared, and clears only its own version', async () => {
    const key = draftKey('user-a', 'book', 'txt')
    const { result } = renderHook(() => useLocalEditorDraft(options()))
    await waitFor(() => expect(result.current.ready).toBe(true))
    await waitFor(() => expect(state.records.get(key)?.payload).toEqual({ text: 'edited' }), { timeout: 3000 })
    const saved = state.records.get(key)
    expect(saved.revisionId).toBe('rev-1')
    expect(state.records.get(key)).toEqual(saved)
    await act(async () => result.current.clear())
    expect(state.records.has(key)).toBe(false)
  })

  it('does not report new edits as locally stored until their write completes', async () => {
    const { result, rerender } = renderHook(({ value }) => useLocalEditorDraft(options({ changeToken: value, payload: () => ({ text: value }) })), { initialProps: { value: 'first' } })
    await waitFor(() => expect(result.current.status).toBe('saved'), { timeout: 3000 })
    rerender({ value: 'second' })
    expect(result.current.status).toBe('pending')
    await waitFor(() => expect(result.current.status).toBe('saved'), { timeout: 3000 })
    expect(state.records.get(draftKey('user-a', 'book', 'txt')).payload.text).toBe('second')
  })

  it('cancels pending work when the content target changes', async () => {
    const first = draftKey('user-a', 'book', 'txt')
    const second = draftKey('user-a', 'other', 'txt')
    const { result, rerender } = renderHook(({ bookId }) => useLocalEditorDraft(options({ bookId })), { initialProps: { bookId: 'book' } })
    await waitFor(() => expect(result.current.ready).toBe(true))
    rerender({ bookId: 'other' })
    await waitFor(() => expect(state.records.has(second)).toBe(true), { timeout: 3000 })
    expect(state.records.has(first)).toBe(false)
  })

  it('does not overwrite corrupt or incompatible records', async () => {
    const key = draftKey('user-a', 'book', 'txt')
    state.records.set(key, { version: 900, key, token: 'broken' })
    const { result } = renderHook(() => useLocalEditorDraft(options()))
    await waitFor(() => expect(result.current.failure).toContain('损坏'))
    expect(result.current.ready).toBe(true)
    expect(state.records.get(key).token).toBe('broken')
  })

  it('cleans expired records only for the current account and target', async () => {
    const key = draftKey('user-a', 'book', 'txt')
    const other = draftKey('user-b', 'book', 'txt')
    for (const item of [key, other]) state.records.set(item, { version: 1, key: item, revisionId: 'rev-1', token: item, savedAt: Date.now() - 100 * 86400000, payload: { text: 'old' } })
    const { result } = renderHook(() => useLocalEditorDraft(options({ dirty: false })))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(state.records.has(key)).toBe(false)
    expect(state.records.has(other)).toBe(true)
  })
})
