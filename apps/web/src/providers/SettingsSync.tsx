import { useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { SettingsRes } from '@bookdock/shared'

import { apiGet, apiPut } from '@/api/client'
import { customThemesFromSync } from '@/lib/reading-theme'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

const SYNC_CHANNEL = 'bd-settings'
const SESSION_ID = Math.random().toString(36).slice(2)
const PENDING_SETTINGS_STORAGE_KEY = 'bd-settings-pending'

// Only user-level settings that should travel across devices sync to the server. Flat reading
// fields are deliberately excluded (intents sync, outcomes stay local):
// preset/global edits travel inside the `readingConfig` blob, and the
// device-local active preset (`activePresetId`) rides the BroadcastChannel
// but never the PUT. Device-adaptation keys (toolbarLocked, sidebarWidth,
// gridColumns, library view prefs) stay in localStorage per device.
const SETTINGS_KEYS = [
  'uiTheme',
  'fontPreferences',
  'fontOrder',
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
  if (JSON.stringify(state.fontPreferences) !== JSON.stringify(prevState.fontPreferences)) return true
  if (JSON.stringify(state.fontOrder) !== JSON.stringify(prevState.fontOrder)) return true
  return SETTINGS_KEYS.filter((key) => key !== 'fontPreferences' && key !== 'fontOrder').some((key) => {
    // @ts-expect-error dynamic settings keys
    return state[key] !== prevState[key]
  })
}

interface PendingSettings {
  userId: string
  payload: SettingsRes
}

function persistPendingSettings(userId: string, payload: SettingsRes) {
  try {
    localStorage.setItem(PENDING_SETTINGS_STORAGE_KEY, JSON.stringify({ userId, payload }))
  } catch {
    // The normal localStorage setters still keep the UI usable when storage is unavailable.
  }
}

function getPendingSettings(userId: string): SettingsRes | null {
  try {
    const raw = localStorage.getItem(PENDING_SETTINGS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingSettings>
    if (parsed.userId !== userId || !parsed.payload || typeof parsed.payload !== 'object') return null
    return parsed.payload
  } catch {
    return null
  }
}

function clearPendingSettings(userId: string, payload: SettingsRes) {
  const pending = getPendingSettings(userId)
  if (!pending || JSON.stringify(pending) !== JSON.stringify(payload)) return
  try {
    localStorage.removeItem(PENDING_SETTINGS_STORAGE_KEY)
  } catch {
    // ignore localStorage errors in private/incognito modes
  }
}

function applySettings(settings: Partial<SettingsRes>) {
  useUiStore.setState((state) => {
    const patch: Partial<typeof state> = {}
    for (const key of SETTINGS_KEYS) {
      if (key in settings) {
        // @ts-expect-error dynamic settings keys
        patch[key] = settings[key]
      }
    }
    return patch
  })
  const syncedThemes = customThemesFromSync(settings.customThemes)
  if (syncedThemes) useUiStore.getState().setCustomThemes(syncedThemes)
  // The profiles blob is authoritative for the reading keys: re-apply the
  // local resolution chain (bound > device active > global) so the flat fields
  // follow the synced config.
  useUiStore.getState().applyReadingResolution()
}

export function SettingsSync() {
  const queryClient = useQueryClient()
  const { mutate: saveSettings } = useMutation({
    mutationFn: (settings: SettingsRes) => apiPut('/settings', settings),
  })
  const mutateRef = useRef(saveSettings)
  const settingsUserRef = useRef<string | null>(null)
  const suppressSyncRef = useRef(false)
  useEffect(() => {
    mutateRef.current = saveSettings
  }, [saveSettings])

  // (Re)load settings whenever a session appears: initial mount, login, and
  // guest pass-through all surface as a user id change. Logged-out visitors
  // skip the request entirely so /login never sees a 401.
  const user = useAuthStore((s) => s.user)
  const userId = user?.id ?? null
  const isGuest = user?.guest === true || user?.role === 'guest'

  useEffect(() => {
    if (settingsUserRef.current !== userId) {
      settingsUserRef.current = userId
      suppressSyncRef.current = true
      useUiStore.setState({ fontPreferences: {}, fontOrder: [] })
      suppressSyncRef.current = false
    }
    if (!userId || isGuest) return
    const pending = getPendingSettings(userId)
    if (pending) {
      // A reload can happen before the debounced PUT completes. Keep the
      // locally committed snapshot visible and retry it instead of allowing a
      // stale server response to overwrite it.
      applySettings(pending)
      mutateRef.current(pending, { onSuccess: () => clearPendingSettings(userId, pending) })
      return
    }
    apiGet<{ data: SettingsRes }>('/settings')
      .then((res) => {
        if (!res.data) return
        queryClient.setQueryData(['settings'], res)
        applySettings(res.data)
      })
      .catch(() => undefined)
  }, [isGuest, queryClient, userId])

  useEffect(() => {
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(SYNC_CHANNEL) : null
    if (channel) {
      channel.onmessage = (event) => {
        if (event.data?.sessionId === SESSION_ID) return
        const currentUser = useAuthStore.getState().user
        if (!currentUser || currentUser.guest === true || currentUser.role === 'guest') return
        const data = event.data?.settings as Partial<Record<string, unknown>> | undefined
        if (!data) return
        applySettings(data as Partial<SettingsRes>)
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
    let settingsDirty = false
    const bcRef: { current: BroadcastChannel | null } = { current: null }
    if (typeof BroadcastChannel !== 'undefined') {
      try { bcRef.current = new BroadcastChannel(SYNC_CHANNEL) } catch { /* ignore */ }
    }

    const unsub = useUiStore.subscribe((state, prevState) => {
      if (suppressSyncRef.current) return
      const settingsTouched = settingsChanged(state, prevState)
      const activeTouched = state.activePresetId !== prevState.activePresetId
      if (!settingsTouched && !activeTouched) return
      const user = useAuthStore.getState().user
      if (!user || user.guest === true || user.role === 'guest') return
      if (settingsTouched) {
        const userId = useAuthStore.getState().user?.id
        if (userId) persistPendingSettings(userId, pickSettings(state))
        settingsDirty = true
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const latestState = useUiStore.getState()
        const payload = pickSettings(latestState)
        const user = useAuthStore.getState().user
        const pending = user ? getPendingSettings(user.id) : null
        // The device-local active preset is broadcast-only, never PUT
        if (user && (settingsDirty || pending)) {
          settingsDirty = false
          const payloadToSave = pending ?? payload
          mutateRef.current(payloadToSave, { onSuccess: () => clearPendingSettings(user.id, payloadToSave) })
        }
        bcRef.current?.postMessage({ sessionId: SESSION_ID, settings: { ...payload, activePresetId: latestState.activePresetId } })
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
