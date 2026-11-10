import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSessionScope, setSessionAccount } from '@/lib/session-scope'

import {
  clearStoredSettings,
  fetchSettings,
  readStoredSettings,
  seedSettingsQuery,
  SETTINGS_CACHE_KEY,
  writeStoredSettings,
} from '@/lib/settings-cache'

describe('settings-cache', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    resetSessionScope()
    vi.unstubAllGlobals()
  })

  it('reads null when nothing is cached', () => {
    expect(readStoredSettings('user-1')).toBeNull()
  })

  it('rejects a settings response from the previous session before writing the new account cache', async () => {
    localStorage.setItem('bd-user', JSON.stringify({ id: 'previous' }))
    setSessionAccount('previous')
    let resolveResponse!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve })))
    const pending = fetchSettings()
    const rejection = expect(pending).rejects.toThrow()
    localStorage.setItem('bd-user', JSON.stringify({ id: 'next' }))
    setSessionAccount('next')
    resolveResponse(new Response(JSON.stringify({ data: { fontOrder: ['previous-font'] } }), { headers: { 'Content-Type': 'application/json' } }))
    await rejection
    expect(readStoredSettings('previous')).toBeNull()
    expect(readStoredSettings('next')).toBeNull()
  })

  it('writes and reads back settings for the matching user', () => {
    writeStoredSettings({ trash: { enabled: false } }, 'user-1')
    const cached = readStoredSettings('user-1')
    expect(cached).toEqual({ trash: { enabled: false } })
  })

  it('rejects cached settings when accessed by a different user', () => {
    writeStoredSettings({ trash: { enabled: false } }, 'user-1')
    expect(readStoredSettings('user-2')).toBeNull()
  })

  it('clears stored settings cache on demand', () => {
    writeStoredSettings({ trash: { enabled: true } }, 'user-1')
    expect(localStorage.getItem(SETTINGS_CACHE_KEY)).not.toBeNull()

    clearStoredSettings()
    expect(localStorage.getItem(SETTINGS_CACHE_KEY)).toBeNull()
    expect(readStoredSettings('user-1')).toBeNull()
  })

  it('seeds QueryClient with cached settings and stale timestamp', () => {
    writeStoredSettings({ library: { shelfSort: 'name-asc' } }, 'user-1')

    const client = new QueryClient()
    expect(client.getQueryData(['settings'])).toBeUndefined()

    seedSettingsQuery(client, 'user-1')
    expect(client.getQueryData(['settings'])).toEqual({
      data: { library: { shelfSort: 'name-asc' } },
    })

    const state = client.getQueryState(['settings'])
    expect(state?.dataUpdatedAt).toBe(0)
  })

  it('rejects legacy or unidentified cache snapshots without userId', () => {
    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify({ library: { view: 'list' } }))
    expect(readStoredSettings('user-1')).toBeNull()

    localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify({ userId: null, data: { library: { view: 'list' } } }))
    expect(readStoredSettings('user-1')).toBeNull()
  })

  it('does not read or write settings when user is null or guest', () => {
    writeStoredSettings({ library: { view: 'grid' } }, null)
    expect(localStorage.getItem(SETTINGS_CACHE_KEY)).toBeNull()
    expect(readStoredSettings(null)).toBeNull()
  })
})
