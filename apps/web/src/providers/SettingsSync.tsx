import { useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'

import type { SettingsRes } from '@bookdock/shared'

import { apiGet, apiPut } from '@/api/client'
import { customThemesFromSync } from '@/lib/reading-theme'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

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
  'coverText',
  'coverFit',
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
  // Custom themes sync as a JSON string: reading configs reference them by
  // id, so the referenced resource must travel with the intent.
  settings.customThemes = JSON.stringify(state.customThemes)
  return settings
}

function settingsChanged(
  state: ReturnType<typeof useUiStore.getState>,
  prevState: ReturnType<typeof useUiStore.getState>,
): boolean {
  if (state.customThemes !== prevState.customThemes) return true
  return SETTINGS_KEYS.some((key) => {
    // @ts-expect-error dynamic settings keys
    return state[key] !== prevState[key]
  })
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
          return patch
        })
        // Applied via the store action so localStorage persistence runs too
        const syncedThemes = customThemesFromSync(res.data.customThemes)
        if (syncedThemes) useUiStore.getState().setCustomThemes(syncedThemes)
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
