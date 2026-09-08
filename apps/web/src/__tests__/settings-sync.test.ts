import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsSync } from '../providers/SettingsSync'
import { useAuthStore } from '../stores/auth.store'
import { useUiStore } from '../stores/ui.store'

import { customThemesFromSync } from '../lib/reading-theme'

const theme = { id: 't1', name: 'Theme', colors: { bg: '#fff', fg: '#000', primary: '#00f' } }

describe('customThemesFromSync', () => {
  it('parses a valid synced theme list', () => {
    expect(customThemesFromSync(JSON.stringify([theme]))).toEqual([theme])
  })

  it('filters malformed entries, mirroring the store seed leniency', () => {
    const raw = JSON.stringify([theme, { id: 1 }, null, { id: 'x', name: 'y' }])
    expect(customThemesFromSync(raw)).toEqual([theme])
  })

  it('returns undefined for absent or malformed payloads so local themes survive', () => {
    expect(customThemesFromSync(undefined)).toBeUndefined()
    expect(customThemesFromSync(null)).toBeUndefined()
    expect(customThemesFromSync('not json')).toBeUndefined()
    expect(customThemesFromSync('{}')).toBeUndefined()
  })
})

describe('SettingsSync persistence', () => {
  const baseline = useUiStore.getState()
  const user = { id: 'user-1', username: 'tester', role: 'owner' }

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    useUiStore.setState({ readingConfig: baseline.readingConfig, activePresetId: null, boundPresetId: null })
    useAuthStore.getState().setAuth(user)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }), {
      headers: { 'Content-Type': 'application/json' },
    })))
  })

  afterEach(() => {
    useAuthStore.getState().clearAuth()
    localStorage.clear()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function mountSync() {
    return render(createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(SettingsSync),
    ))
  }

  it('saves a preset even though creation also changes the active pointer', async () => {
    mountSync()
    await vi.runAllTimersAsync()

    useUiStore.getState().createReadingPreset('护眼')
    await vi.advanceTimersByTimeAsync(1000)

    const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(put).toBeDefined()
    const body = JSON.parse(String(put?.[1]?.body)) as { readingConfig: string }
    expect(body.readingConfig).toContain('护眼')
  })

  it('saves ordinary reading changes through the same config snapshot', async () => {
    mountSync()
    await vi.runAllTimersAsync()

    useUiStore.getState().setFontSize(26)
    await vi.advanceTimersByTimeAsync(1000)

    const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(put).toBeDefined()
    const body = JSON.parse(String(put?.[1]?.body)) as { readingConfig: string }
    expect(body.readingConfig).toContain('"fontSize":26')
  })

  it('keeps a locally pending change ahead of stale settings on reload', async () => {
    const first = mountSync()
    await vi.runAllTimersAsync()
    useUiStore.getState().createReadingPreset('护眼')
    const activePresetId = useUiStore.getState().activePresetId
    expect(localStorage.getItem('bd-settings-pending')).toContain('护眼')

    first.unmount()
    useUiStore.setState({ readingConfig: baseline.readingConfig, activePresetId })
    vi.mocked(fetch).mockClear()

    mountSync()
    await vi.runAllTimersAsync()

    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith('/api/v1/settings', expect.objectContaining({ method: 'GET' }))
    expect(useUiStore.getState().readingConfig).toContain('护眼')
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true)
  })
})
