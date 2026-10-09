import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsSync } from '../providers/SettingsSync'
import { useAuthStore } from '../stores/auth.store'
import { useUiStore } from '../stores/ui.store'

import { customThemesFromSync } from '../lib/reading-theme'
import { writeStoredSettings } from '../lib/settings-cache'
import { useToastStore } from '../stores/toast.store'

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
    useUiStore.setState({
      readingConfig: baseline.readingConfig,
      fontSize: baseline.fontSize,
      fontPreferences: baseline.fontPreferences,
      fontOrder: baseline.fontOrder,
      activePresetId: null,
      boundPresetId: null,
    })
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

  it('saves font visibility and display-name preferences with user settings', async () => {
    mountSync()
    await vi.runAllTimersAsync()

    useUiStore.getState().setFontPreference('serif', { enabled: false, displayName: '正文' })
    await vi.advanceTimersByTimeAsync(1000)

    const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(put).toBeDefined()
    const body = JSON.parse(String(put?.[1]?.body)) as { fontPreferences: Record<string, unknown> }
    expect(body.fontPreferences).toEqual({ serif: { enabled: false, displayName: '正文' } })
  })

  it('saves the custom font display order with user settings', async () => {
    mountSync()
    await vi.runAllTimersAsync()

    useUiStore.getState().setFontOrder(['noto-sans-sc', 'serif', 'custom-1'])
    await vi.advanceTimersByTimeAsync(1000)

    const put = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(put).toBeDefined()
    const body = JSON.parse(String(put?.[1]?.body)) as { fontOrder: string[] }
    expect(body.fontOrder).toEqual(['noto-sans-sc', 'serif', 'custom-1'])
  })

  it('retains pending settings and merges repeated sync failures into one notice', async () => {
    useToastStore.getState().clearToasts()
    mountSync()
    await vi.runAllTimersAsync()
    vi.mocked(fetch).mockRejectedValue(new Error('Offline'))
    useUiStore.getState().setFontOrder(['serif'])
    await vi.advanceTimersByTimeAsync(1100)
    expect(localStorage.getItem('bd-settings-pending')).toContain('serif')
    const first = useToastStore.getState().toasts.find((toast) => toast.dedupeKey === 'settings-sync')
    expect(first?.type).toBe('warning')
    useUiStore.getState().setFontOrder(['serif', 'sans-serif'])
    await vi.advanceTimersByTimeAsync(1100)
    const notices = useToastStore.getState().toasts.filter((toast) => toast.dedupeKey === 'settings-sync')
    expect(notices).toHaveLength(1)
    expect(notices[0].id).toBe(first?.id)
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: {} })))
    useUiStore.getState().setFontOrder(['sans-serif'])
    await vi.advanceTimersByTimeAsync(1100)
    expect(localStorage.getItem('bd-settings-pending')).toBeNull()
    const recovered = useToastStore.getState().toasts.find((toast) => toast.dedupeKey === 'settings-sync')
    expect(recovered?.id).toBe(first?.id)
    expect(recovered?.type).toBe('info')
    expect(recovered?.message).toEqual({ key: 'settings.syncRestored' })
    useToastStore.getState().clearToasts()
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

  it('does not answer a foreign broadcast that changed nothing', async () => {
    // The observable half of the echo loop. A tab that replies to a payload it
    // did not change is what turned two tabs into a once-a-second PUT storm, so
    // the reply has to be tied to an actual edit.
    const channels: FakeChannel[] = []
    class FakeChannel {
      onmessage: ((e: { data: unknown }) => void) | null = null
      posted: unknown[] = []
      constructor() { channels.push(this) }
      postMessage(data: unknown) { this.posted.push(data) }
      close() { /* nothing to release */ }
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel)

    useUiStore.setState({ customThemes: [theme] })
    mountSync()
    await vi.runAllTimersAsync()

    const inbox = channels.find((c) => c.onmessage)
    expect(inbox).toBeDefined()
    vi.mocked(fetch).mockClear()

    // Another tab answers with byte-identical settings.
    inbox!.onmessage!({
      data: {
        sessionId: 'another-tab',
        settings: { customThemes: JSON.stringify([theme]) },
        activePresetId: null,
      },
    })
    await vi.advanceTimersByTimeAsync(3000)

    // Nothing changed here, so this tab owes the other one no answer.
    expect(channels.every((c) => c.posted.length === 0)).toBe(true)
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('answers a foreign broadcast that really changed something', async () => {
    const channels: FakeChannel[] = []
    class FakeChannel {
      onmessage: ((e: { data: unknown }) => void) | null = null
      posted: unknown[] = []
      constructor() { channels.push(this) }
      postMessage(data: unknown) { this.posted.push(data) }
      close() { /* nothing to release */ }
    }
    vi.stubGlobal('BroadcastChannel', FakeChannel)

    useUiStore.setState({ customThemes: [theme] })
    mountSync()
    await vi.runAllTimersAsync()

    const inbox = channels.find((c) => c.onmessage)
    const night = { id: 't2', name: 'Night', colors: { bg: '#000', fg: '#eee', primary: '#0af' } }
    inbox!.onmessage!({
      data: {
        sessionId: 'another-tab',
        settings: { customThemes: JSON.stringify([night]) },
        activePresetId: null,
      },
    })
    await vi.advanceTimersByTimeAsync(3000)

    // A real change is still adopted, which is the whole point of the channel.
    expect(useUiStore.getState().customThemes).toEqual([night])
  })

  it('ignores a synced custom-theme list that is identical in content', () => {
    // The echo loop: a received payload is re-parsed into new theme objects, so
    // reference equality called every reply an edit and two tabs answered each
    // other once a second, forever. Content equality is what says "not a change".
    useUiStore.setState({ customThemes: [theme] })
    const before = useUiStore.getState().customThemes

    // Same content, different array and different object identity.
    useUiStore.getState().setCustomThemes([{ ...theme, colors: { ...theme.colors } }])

    expect(useUiStore.getState().customThemes).toBe(before)
  })

  it('still applies a synced custom-theme list whose content differs', () => {
    useUiStore.setState({ customThemes: [theme] })
    const other = { id: 't2', name: 'Night', colors: { bg: '#000', fg: '#eee', primary: '#0af' } }

    useUiStore.getState().setCustomThemes([other])

    expect(useUiStore.getState().customThemes).toEqual([other])
  })

  it('keeps anonymous preferences local without a database account', async () => {
    useAuthStore.getState().clearAuth()
    mountSync()
    await vi.runAllTimersAsync()

    useUiStore.getState().setFontPreference('serif', { enabled: false })
    await vi.advanceTimersByTimeAsync(1000)

    expect(vi.mocked(fetch)).not.toHaveBeenCalledWith('/api/v1/settings', expect.anything())
    expect(useUiStore.getState().fontPreferences).toEqual({ serif: { enabled: false } })
  })

  it('never syncs the logout reset back to the server', async () => {
    // A logout must stay local: the reset defaults the snapshots (names
    // survive) but must neither queue a pending snapshot nor PUT, or the next
    // login replays the defaults over the server config.
    mountSync()
    await vi.runAllTimersAsync()

    useUiStore.getState().setFontSize(26)
    await vi.advanceTimersByTimeAsync(1000)
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true)
    vi.mocked(fetch).mockClear()

    useAuthStore.getState().clearAuth()
    await vi.advanceTimersByTimeAsync(3000)

    // Local values reset by design (shared browser), server untouched.
    expect(useUiStore.getState().fontSize).not.toBe(26)
    expect(localStorage.getItem('bd-settings-pending')).toBeNull()
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)

    // Re-login replays nothing: no PUT means the server config stands.
    useAuthStore.getState().setAuth(user)
    await vi.runAllTimersAsync()
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false)
  })

  it('hydrates useUiStore immediately on mount from cached user settings', () => {
    const cachedSettings = {
      fontPreferences: { 'custom-font': { enabled: true, displayName: 'My Font' } },
      fontOrder: ['custom-font'],
    }
    writeStoredSettings(cachedSettings, user.id)

    mountSync()

    expect(useUiStore.getState().fontPreferences).toEqual(cachedSettings.fontPreferences)
    expect(useUiStore.getState().fontOrder).toEqual(cachedSettings.fontOrder)
  })
})
