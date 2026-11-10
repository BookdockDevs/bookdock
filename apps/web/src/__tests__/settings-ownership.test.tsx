import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { SettingsRes } from '@bookdock/shared'

import { READER_SHORTCUT_DEFAULTS } from '@/features/reader/lib/reader-shortcuts'
import { bindReadingPreferenceAccount, DEVICE_READING_CONFIG_KEY, DEVICE_SETTINGS_KEY } from '@/features/reader/lib/reading-preference-owner'
import { emptyConfig, READING_PROFILE_DEFAULTS, serializeReadingConfig } from '@/features/reader/lib/reading-profiles'
import { SettingsSync } from '@/providers/SettingsSync'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

const config = (fontSize: number) => serializeReadingConfig(emptyConfig({ ...READING_PROFILE_DEFAULTS, fontSize }))
const user = { id: 'service-account', username: 'Reader', role: 'user' }
const theme = { id: 'custom-theme', name: 'Custom', colors: { bg: '#ffffff', fg: '#000000', primary: '#0000ff' } }
let client: QueryClient
let serverSettings: SettingsRes

beforeEach(() => {
  vi.useFakeTimers()
  window.history.replaceState(null, '', '/local')
  bindReadingPreferenceAccount(null)
  useAuthStore.setState({ user: null })
  useUiStore.setState({ readingConfig: config(22), fontSize: 22, activePresetId: null, boundPresetId: null, fontPreferences: {}, fontOrder: [], customThemes: [], selectionToolbarHidden: [] })
  localStorage.clear()
  serverSettings = {}
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: { readerShortcuts: JSON.stringify(READER_SHORTCUT_DEFAULTS), ...serverSettings } }), { headers: { 'Content-Type': 'application/json' } })))
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
})
afterEach(() => {
  cleanup(); client.clear(); bindReadingPreferenceAccount(null); useAuthStore.setState({ user: null })
  localStorage.clear(); window.history.replaceState(null, '', '/'); vi.unstubAllGlobals(); vi.useRealTimers()
})
function mount() { return render(<QueryClientProvider client={client}><SettingsSync /></QueryClientProvider>) }

describe('presentation ownership independent of library source', () => {
  it('preserves existing anonymous presentation on first startup and retains invalid legacy input for recovery', () => {
    useUiStore.setState({ fontOrder: ['serif'], coverFit: 'full', customThemes: [theme] })
    localStorage.setItem(DEVICE_READING_CONFIG_KEY, 'invalid legacy config')
    mount()
    expect(useUiStore.getState()).toMatchObject({ fontOrder: ['serif'], coverFit: 'full', customThemes: [theme] })
    expect(localStorage.getItem(DEVICE_READING_CONFIG_KEY)).toBe('invalid legacy config')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps connected profiles/resources across source changes and syncs deliberate global edits', async () => {
    localStorage.setItem(DEVICE_READING_CONFIG_KEY, config(25))
    useAuthStore.getState().setAuth(user)
    serverSettings = { readingConfig: config(31), fontPreferences: { custom: { enabled: true } }, fontOrder: ['custom'], customThemes: JSON.stringify([theme]), selectionToolbarHidden: ['translate'] }
    const view = mount()
    await act(async () => { await vi.runAllTimersAsync() })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(client.getQueryState(['settings'])?.error).toBeNull()
    expect(useUiStore.getState()).toMatchObject({ fontSize: 31, fontOrder: ['custom'], customThemes: [theme], selectionToolbarHidden: ['translate'] })
    window.history.replaceState(null, '', '/')
    view.rerender(<QueryClientProvider client={client}><SettingsSync /></QueryClientProvider>)
    window.history.replaceState(null, '', '/local/books/book')
    view.rerender(<QueryClientProvider client={client}><SettingsSync /></QueryClientProvider>)
    expect(useUiStore.getState().fontSize).toBe(31)
    expect(useUiStore.getState().fontPreferences).toEqual({ custom: { enabled: true } })
    act(() => useUiStore.getState().setFontSize(32))
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    const writes = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === 'PUT').map(([, options]) => JSON.parse(String(options?.body)))
    expect(writes).toContainEqual(expect.objectContaining({ readingConfig: config(32) }))
    expect(localStorage.getItem(DEVICE_READING_CONFIG_KEY)).toBe(config(25))
  })

  it('preserves legacy anonymous config and device resources without an account request', async () => {
    localStorage.setItem(DEVICE_READING_CONFIG_KEY, config(25))
    const view = mount()
    expect(useUiStore.getState().fontSize).toBe(25)
    act(() => { useUiStore.getState().setFontSize(27); useUiStore.getState().setCustomThemes([theme]) })
    expect(JSON.parse(localStorage.getItem(DEVICE_SETTINGS_KEY)!)).toMatchObject({ readingConfig: config(27), customThemes: JSON.stringify([theme]) })
    view.unmount()
    useUiStore.setState({ readingConfig: config(22), fontSize: 22, customThemes: [] })
    window.history.replaceState(null, '', '/')
    mount()
    expect(useUiStore.getState()).toMatchObject({ fontSize: 27, customThemes: [theme] })
    await act(async () => { await vi.runAllTimersAsync() })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('restores the device owner after service-account logout without overwriting its saved config', async () => {
    localStorage.setItem(DEVICE_READING_CONFIG_KEY, config(25))
    localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify({ customThemes: JSON.stringify([theme]) }))
    mount()
    expect(useUiStore.getState().fontSize).toBe(25)
    serverSettings = { readingConfig: config(31), customThemes: '[]' }
    await act(async () => { useAuthStore.getState().setAuth(user); await vi.runAllTimersAsync() })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(useUiStore.getState().fontSize).toBe(31)
    await act(async () => { useAuthStore.getState().clearAuth(); await vi.runAllTimersAsync() })
    expect(useUiStore.getState()).toMatchObject({ fontSize: 25, customThemes: [theme] })
    expect(localStorage.getItem(DEVICE_READING_CONFIG_KEY)).toBe(config(25))
    expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false)
  })

  it('does not send a queued account edit after logout while preserving the device config', async () => {
    localStorage.setItem(DEVICE_READING_CONFIG_KEY, config(25))
    useAuthStore.getState().setAuth(user)
    serverSettings = { readingConfig: config(31) }
    mount()
    await act(async () => { await vi.runAllTimersAsync() })
    act(() => useUiStore.getState().setFontSize(33))
    act(() => useAuthStore.getState().clearAuth())
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    expect(vi.mocked(fetch).mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false)
    expect(useUiStore.getState().fontSize).toBe(25)
    expect(localStorage.getItem(DEVICE_READING_CONFIG_KEY)).toBe(config(25))
  })
})
