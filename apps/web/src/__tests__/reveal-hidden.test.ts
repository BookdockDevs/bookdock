import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { queryClient } from '@/lib/query-client'
import { toggleRevealHidden, withReveal } from '@/lib/reveal-hidden'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

const alice = { id: 'alice', username: 'Alice', role: 'member' }
const bob = { id: 'bob', username: 'Bob', role: 'member' }

beforeEach(() => {
  useAuthStore.getState().clearAuth()
  localStorage.clear()
  queryClient.clear()
})

afterEach(() => {
  useAuthStore.getState().clearAuth()
  queryClient.clear()
})

describe('account-local hidden display', () => {
  it('defaults off and ignores the legacy global preference', () => {
    localStorage.setItem('bd-reveal-hidden', 'true')
    useAuthStore.getState().setAuth(alice)
    expect(useUiStore.getState().revealHidden).toBe(false)
    expect(withReveal('/books/abc')).toBe('/books/abc')
  })

  it('restores only the confirmed account preference after logout and reload', async () => {
    useAuthStore.getState().setAuth(alice)
    await toggleRevealHidden()
    expect(withReveal('/shelves')).toBe('/shelves?showHidden=1')
    expect(withReveal('/books/abc/file?reader=1')).toBe('/books/abc/file?reader=1&showHidden=1')
    useAuthStore.getState().clearAuth()
    expect(useUiStore.getState().revealHidden).toBe(false)
    expect(localStorage.getItem('bd-reveal-hidden:alice')).toBe('true')
    useAuthStore.getState().setAuth(bob)
    expect(useUiStore.getState().revealHidden).toBe(false)
    useAuthStore.getState().setAuth(alice)
    expect(useUiStore.getState().revealHidden).toBe(true)
    // A reload leaves the profile unconfirmed until the session probe succeeds.
    useUiStore.setState({ revealHidden: false, revealHiddenUserId: null })
    expect(withReveal('/books/abc')).toBe('/books/abc')
    useAuthStore.getState().setAuth(alice)
    expect(useUiStore.getState().revealHidden).toBe(true)
  })

  it('never reveals for anonymous readers', async () => {
    localStorage.setItem('bd-reveal-hidden:alice', 'true')
    useAuthStore.getState().clearAuth()
    await toggleRevealHidden()
    expect(useUiStore.getState().revealHidden).toBe(false)
    expect(withReveal('/books/abc')).toBe('/books/abc')
  })

  it('drops hidden-inclusive cached reads and cancels their late responses', async () => {
    useAuthStore.getState().setAuth(alice)
    await toggleRevealHidden()
    const prefixes = ['books', 'book', 'shelves', 'tags', 'chapters', 'progress', 'annotations', 'reading-records', 'batch-selection']
    for (const prefix of prefixes) queryClient.setQueryData([prefix, 'test'], { hidden: true })
    queryClient.setQueryData(['libraries', 'shared', 'catalog'], { shared: true })
    let resolve!: (value: string) => void
    const pending = queryClient.fetchQuery({ queryKey: ['book', 'late'], queryFn: () => new Promise<string>((r) => { resolve = r }) }).catch(() => {})
    await toggleRevealHidden()
    resolve('hidden response')
    await pending
    for (const prefix of prefixes) expect(queryClient.getQueryData([prefix, 'test'])).toBeUndefined()
    expect(queryClient.getQueryData(['book', 'late'])).toBeUndefined()
    expect(queryClient.getQueryData(['libraries', 'shared', 'catalog'])).toEqual({ shared: true })
  })

  it('clears account caches even when both accounts have the same preference', () => {
    useAuthStore.getState().setAuth(alice)
    queryClient.setQueryData(['book', 'alice'], { title: 'Alice book' })
    useAuthStore.getState().setAuth(bob)
    expect(queryClient.getQueryData(['book', 'alice'])).toBeUndefined()
  })

  it('closes the list display preference without waiting for reader exit', async () => {
    useAuthStore.getState().setAuth(alice)
    await toggleRevealHidden()
    await toggleRevealHidden()
    expect(useUiStore.getState().revealHidden).toBe(false)
  })
})
