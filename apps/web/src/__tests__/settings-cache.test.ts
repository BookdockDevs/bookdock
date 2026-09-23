import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  clearStoredSettings,
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
  })

  it('reads null when nothing is cached', () => {
    expect(readStoredSettings('user-1')).toBeNull()
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
})
