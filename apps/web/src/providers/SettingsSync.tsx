import { useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiGet, apiPut } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'
import { legacyActiveId } from '@/features/reader/lib/reading-profiles'
import { customThemesFromSync } from '@/lib/reading-theme'
import type { SettingsRes } from '@bookdock/shared'

const SYNC_CHANNEL = 'bd-settings'
const SESSION_ID = Math.random().toString(36).slice(2)

// Only non-reading, non-device settings sync to the server. Flat reading
// fields are deliberately excluded (intents sync, outcomes stay local):
// preset/global edits travel inside the `readingConfig` blob, and the
// device-local active preset (`activePresetId`) rides the BroadcastChannel
// but never the PUT. Device-adaptation keys (toolbarLocked, sidebarWidth,
// gridColumns, library view prefs) stay in localStorage per device.
const SETTINGS_KEYS = [
  'uiTheme',
  'readingTimerMode',
  'manualTimerGraceMinutes',
  'ttsEngine',
  'ttsServiceId',
  'ttsVoiceId',
  'ttsRate',
  'ttsAutoNext',
  'ttsFollow',
  'readingConfig',
]

function pickSettings(state: ReturnType<typeof useUiStore.getState>): SettingsRes {
  const settings: SettingsRes = {}
  for (const key of SETTINGS_KEYS) {
    // @ts-expect-error dynamic settings keys
    settings[key] = state[key]
  }
  // Cover prefs are mapped back to the legacy boolean pair — the shared
  // settings schema has no coverText/coverFit field and cannot be extended
  // from web. The pair is lossless: coverMode = text hidden, coverFit = contain.
  settings.coverMode = !state.coverText
  settings.coverFit = state.coverFit === 'full'
  // Custom themes sync as a JSON string: reading configs reference them by
  // id, so the referenced resource must travel with the intent.
  settings.customThemes = JSON.stringify(state.customThemes)
  return settings
}

// Inverse of the pickSettings mapping; returns undefined when the payload
// carries neither legacy key so an unrelated sync doesn't clobber cover prefs.
function coverPrefsFromLegacy(data: { coverMode?: boolean; coverFit?: boolean }): { coverText: boolean; coverFit: 'crop' | 'full' } | undefined {
  if (data.coverMode === undefined && data.coverFit === undefined) return undefined
  return { coverText: data.coverMode !== true, coverFit: data.coverFit === true ? 'full' : 'crop' }
}

function settingsChanged(
  state: ReturnType<typeof useUiStore.getState>,
  prevState: ReturnType<typeof useUiStore.getState>,
): boolean {
  if (state.coverText !== prevState.coverText) return true
  if (state.coverFit !== prevState.coverFit) return true
  if (state.customThemes !== prevState.customThemes) return true
  return SETTINGS_KEYS.some((key) => {
    // @ts-expect-error dynamic settings keys
    return state[key] !== prevState[key]
  })
}

// Blobs written before the activation rework carried the device pointer
// inside the payload; a device with no local pointer yet adopts it.
function adoptLegacyActive(raw: string | undefined) {
  const state = useUiStore.getState()
  if (state.activePresetId !== null || !raw) return
  const legacy = legacyActiveId(raw)
  if (legacy) state.activateReadingPreset(legacy)
}

export function SettingsSync() {
  const { mutate: saveSettings } = useMutation({
    mutationFn: (settings: SettingsRes) => apiPut('/settings', settings),
  })
  const mutateRef = useRef(saveSettings)
  useEffect(() => {
    mutateRef.current = saveSettings
  }, [saveSettings])

  // (Re)load settings whenever a session appears: initial mount, login, and
  // guest pass-through all surface as a user id change. Logged-out visitors
  // skip the request entirely so /login never sees a 401.
  const userId = useAuthStore((s) => s.user?.id ?? null)

  useEffect(() => {
    if (!userId) return
    apiGet<{ data: SettingsRes }>('/settings')
      .then((res) => {
        if (!res.data) return
        useUiStore.setState((state) => {
          const patch: Partial<typeof state> = {}
          for (const key of SETTINGS_KEYS) {
            if (key in res.data) {
              // @ts-expect-error dynamic settings keys
              patch[key] = res.data[key]
            }
          }
          const coverPrefs = coverPrefsFromLegacy(res.data)
          if (coverPrefs) {
            patch.coverText = coverPrefs.coverText
            patch.coverFit = coverPrefs.coverFit
          }
          return patch
        })
        // Applied via the store action so localStorage persistence runs too
        const syncedThemes = customThemesFromSync(res.data.customThemes)
        if (syncedThemes) useUiStore.getState().setCustomThemes(syncedThemes)
        adoptLegacyActive(res.data.readingConfig)
        // The profiles blob is authoritative for the reading keys: re-apply
        // the local resolution chain (bound > device active > global) so the
        // flat fields follow the synced config.
        useUiStore.getState().applyReadingResolution()
      })
      .catch(() => undefined)
  }, [userId])

  useEffect(() => {
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(SYNC_CHANNEL) : null
    if (channel) {
      channel.onmessage = (event) => {
        if (event.data?.sessionId === SESSION_ID) return
        const data = event.data?.settings as Partial<Record<string, unknown>> | undefined
        if (!data) return
        useUiStore.setState((state) => {
          const patch: Partial<typeof state> = {}
          for (const key of SETTINGS_KEYS) {
            if (key in data) {
              // @ts-expect-error dynamic settings keys
              patch[key] = data[key]
            }
          }
          const coverPrefs = coverPrefsFromLegacy(data as { coverMode?: boolean; coverFit?: boolean })
          if (coverPrefs) {
            patch.coverText = coverPrefs.coverText
            patch.coverFit = coverPrefs.coverFit
          }
          return patch
        })
        const syncedThemes = customThemesFromSync(data.customThemes)
        if (syncedThemes) useUiStore.getState().setCustomThemes(syncedThemes)
        // The device-local active rides the broadcast (never the PUT) so
        // every tab of this device shares one pointer; resolution follows.
        if (typeof data.activePresetId === 'string' || data.activePresetId === null) {
          useUiStore.getState().activateReadingPreset(data.activePresetId)
        }
        useUiStore.getState().applyReadingResolution()
      }
    }

    return () => {
      channel?.close()
    }
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const bcRef: { current: BroadcastChannel | null } = { current: null }
    if (typeof BroadcastChannel !== 'undefined') {
      try { bcRef.current = new BroadcastChannel(SYNC_CHANNEL) } catch { /* ignore */ }
    }

    const unsub = useUiStore.subscribe((state, prevState) => {
      const settingsTouched = settingsChanged(state, prevState)
      const activeTouched = state.activePresetId !== prevState.activePresetId
      if (!settingsTouched && !activeTouched) return
      if (!useAuthStore.getState().user) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const payload = pickSettings(state)
        // The device-local active preset is broadcast-only, never PUT
        if (settingsTouched) mutateRef.current(payload)
        bcRef.current?.postMessage({ sessionId: SESSION_ID, settings: { ...payload, activePresetId: state.activePresetId } })
      }, 1000)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
      bcRef.current?.close()
    }
  }, [])

  return null
}
