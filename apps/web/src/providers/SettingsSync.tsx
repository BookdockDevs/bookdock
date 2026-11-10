import { useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { SettingsRes } from '@bookdock/shared'
import { DEFAULT_SELECTION_TOOLBAR_ORDER, settingsUpdateSchema } from '@bookdock/shared'

import { apiPut } from '@/api/client'
import { readReaderShortcuts, readerShortcutStorageKey } from '@/features/reader/lib/reader-shortcuts'
import { bindReadingPreferenceAccount, DEVICE_READING_CONFIG_KEY, DEVICE_SETTINGS_KEY, readingPreferenceAccountId, withReadingPreferenceHydration } from '@/features/reader/lib/reading-preference-owner'
import { emptyConfig, parseReadingConfig, READING_PROFILE_DEFAULTS, serializeReadingConfig } from '@/features/reader/lib/reading-profiles'
import { customThemesFromSync } from '@/lib/reading-theme'
import { notify } from '@/lib/notifications'
import { fetchSettings, readStoredSettings } from '@/lib/settings-cache'
import { useAuthStore } from '@/stores/auth.store'
import { useSettingsSyncStore } from '@/stores/settings-sync.store'
import { PENDING_SETTINGS_STORAGE_KEY, useUiStore } from '@/stores/ui.store'

const SYNC_CHANNEL = 'bd-settings'
const SESSION_ID = Math.random().toString(36).slice(2)

// Only user-level settings that should travel across devices sync to the server. Flat reading
// fields are deliberately excluded (intents sync, outcomes stay local):
// preset/global edits travel inside the `readingConfig` blob, and the
// device-local active preset (`activePresetId`) rides the BroadcastChannel
// but never the PUT. Library and profile preferences are not here either — they
// ride the `library` / `profile` values in the same payload, mutated through
// their own hooks so they get an optimistic cache merge.
// Device-adaptation keys (toolbarLocked, sidebarWidth, gridColumns, page size,
// and every view preference inside a reader panel) stay in localStorage per
// device and survive logout.
const SETTINGS_KEYS = [
  'fontPreferences',
  'fontOrder',
  'selectionToolbarOrder',
  'selectionToolbarHidden',
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
  if (JSON.stringify(state.customThemes) !== JSON.stringify(prevState.customThemes)) return true
  if (JSON.stringify(state.fontPreferences) !== JSON.stringify(prevState.fontPreferences)) return true
  if (JSON.stringify(state.fontOrder) !== JSON.stringify(prevState.fontOrder)) return true
  if (JSON.stringify(state.selectionToolbarOrder) !== JSON.stringify(prevState.selectionToolbarOrder)) return true
  if (JSON.stringify(state.selectionToolbarHidden) !== JSON.stringify(prevState.selectionToolbarHidden)) return true
  return SETTINGS_KEYS.filter((key) => key !== 'fontPreferences' && key !== 'fontOrder' && key !== 'selectionToolbarOrder' && key !== 'selectionToolbarHidden').some((key) => {
    // @ts-expect-error dynamic settings keys
    return state[key] !== prevState[key]
  })
}

function deviceSettings(fallback: SettingsRes): SettingsRes {
  let stored: SettingsRes = {}
  let config: string | null = null
  try {
    const raw = localStorage.getItem(DEVICE_SETTINGS_KEY)
    if (raw) stored = settingsUpdateSchema.pick({
      fontPreferences: true, fontOrder: true, selectionToolbarOrder: true, selectionToolbarHidden: true,
      customThemes: true, coverFit: true, readingTimerMode: true, manualTimerGraceMinutes: true,
      ttsEngine: true, ttsServiceId: true, ttsVoiceId: true, ttsRate: true, ttsAutoNext: true, ttsFollow: true, readingConfig: true,
    }).parse(JSON.parse(raw))
    config = localStorage.getItem(DEVICE_READING_CONFIG_KEY)
    if (config && !parseReadingConfig(config)) notify.warning({ key: 'settings.deviceStorageFailed' })
  } catch { notify.warning({ key: 'settings.deviceStorageFailed' }) }
  return {
    fontPreferences: {}, fontOrder: [], selectionToolbarOrder: [...DEFAULT_SELECTION_TOOLBAR_ORDER], selectionToolbarHidden: [],
    customThemes: '[]', coverFit: 'crop', readingTimerMode: 'auto', manualTimerGraceMinutes: 5,
    ttsEngine: 'system', ttsServiceId: null, ttsVoiceId: '', ttsRate: 1, ttsAutoNext: true, ttsFollow: true,
    ...fallback, ...stored,
    readingConfig: config && parseReadingConfig(config) ? config : stored.readingConfig && parseReadingConfig(stored.readingConfig) ? stored.readingConfig : fallback.readingConfig,
  }
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
  withReadingPreferenceHydration(() => {
    if (typeof settings.readerShortcuts === 'string') {
      try { localStorage.setItem(readerShortcutStorageKey(useAuthStore.getState().user?.id ?? null), settings.readerShortcuts) } catch { /* ignore */ }
      window.dispatchEvent(new Event('bd-reader-shortcuts-loaded'))
    }
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
    if (Array.isArray(settings.selectionToolbarOrder)) {
      try { localStorage.setItem('bd-selection-toolbar-order', JSON.stringify(settings.selectionToolbarOrder)) } catch { /* ignore */ }
    }
    if (Array.isArray(settings.selectionToolbarHidden)) {
      try { localStorage.setItem('bd-selection-toolbar-hidden', JSON.stringify(settings.selectionToolbarHidden)) } catch { /* ignore */ }
    }
    if (typeof settings.readingConfig === 'string') {
      try {
        localStorage.setItem('bd-reading-config', settings.readingConfig)
        if (!readingPreferenceAccountId()) {
          const existing = localStorage.getItem(DEVICE_READING_CONFIG_KEY)
          if (!existing || parseReadingConfig(existing)) localStorage.setItem(DEVICE_READING_CONFIG_KEY, settings.readingConfig)
        }
      } catch {
        // ignore
      }
    }
    const syncedThemes = customThemesFromSync(settings.customThemes)
    if (syncedThemes) useUiStore.getState().setCustomThemes(syncedThemes)
    // The profiles blob is authoritative for the reading keys: re-apply the
    // local resolution chain (bound > device active > global) so the flat fields
    // follow the synced config.
    useUiStore.getState().applyReadingResolution()
  })
}

export function SettingsSync() {
  const queryClient = useQueryClient()
  const syncFailedRef = useRef(false)
  const { mutate: saveSettings } = useMutation({
    mutationFn: ({ userId, settings }: { userId: string; settings: SettingsRes }) => {
      if (useAuthStore.getState().user?.id !== userId) throw new DOMException('Settings owner changed', 'AbortError')
      return apiPut('/settings', settings)
    },
    onError: (_error, request) => {
      if (useAuthStore.getState().user?.id !== request.userId) return
      syncFailedRef.current = true
      notify.warning({ key: 'settings.syncFailed' }, { dedupeKey: 'settings-sync' })
    },
    onSuccess: (_result, { userId, settings }) => {
      if (useAuthStore.getState().user?.id !== userId) return
      if (syncFailedRef.current) {
        const currentUserId = useAuthStore.getState().user?.id
        const pending = currentUserId ? getPendingSettings(currentUserId) : null
        if (pending && JSON.stringify(pending) !== JSON.stringify(settings)) return
        syncFailedRef.current = false
        notify.info({ key: 'settings.syncRestored' }, { dedupeKey: 'settings-sync' })
      }
    },
  })
  const mutateRef = useRef(saveSettings)
  const settingsUserRef = useRef<string | null | undefined>(undefined)
  const suppressSyncRef = useRef(false)
  useEffect(() => {
    mutateRef.current = saveSettings
  }, [saveSettings])

  // (Re)load settings whenever a session appears: initial mount, login, and
  // guest pass-through all surface as a user id change. Logged-out visitors
  // skip the request entirely so /login never sees a 401.
  const user = useAuthStore((s) => s.user)
  const userId = user?.id ?? null
  const isGuest = !user

  const { data: settingsRes, isError: settingsError } = useQuery<{ data: SettingsRes }>({
    enabled: Boolean(userId) && !isGuest,
    queryKey: ['settings'],
    queryFn: fetchSettings,
  })

  useEffect(() => {
    if (settingsUserRef.current !== userId) {
      const firstOwner = settingsUserRef.current === undefined
      syncFailedRef.current = false
      bindReadingPreferenceAccount(userId)
      settingsUserRef.current = userId
      if (userId && !isGuest) {
        const cached = readStoredSettings(userId)
        const pending = getPendingSettings(userId)
        suppressSyncRef.current = true
        if (pending) {
          applySettings(pending)
        } else if (cached) {
          applySettings(cached)
        }
        suppressSyncRef.current = false
        useSettingsSyncStore.setState({ userId, ready: Boolean(pending || cached), failed: false })
        if (pending) {
          mutateRef.current({ userId, settings: pending }, { onSuccess: () => clearPendingSettings(userId, pending) })
        }
      } else {
        useSettingsSyncStore.setState({ userId: null, ready: true, failed: false })
        suppressSyncRef.current = true
        applySettings(deviceSettings(firstOwner ? pickSettings(useUiStore.getState()) : { readingConfig: serializeReadingConfig(emptyConfig(READING_PROFILE_DEFAULTS)) }))
        try {
          if (localStorage.getItem(DEVICE_SETTINGS_KEY) === null) localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(pickSettings(useUiStore.getState())))
        } catch { notify.warning({ key: 'settings.deviceStorageFailed' }, { dedupeKey: 'device-settings' }) }
        suppressSyncRef.current = false
      }
    }
  }, [isGuest, userId])

  useEffect(() => {
    if (!userId || isGuest || !settingsRes?.data) return
    const pending = getPendingSettings(userId)
    if (pending) return

    suppressSyncRef.current = true
    applySettings(settingsRes.data)
    suppressSyncRef.current = false
    useSettingsSyncStore.setState({ userId, ready: true, failed: false })
    const normalizedShortcuts = JSON.stringify(readReaderShortcuts(userId))
    if (normalizedShortcuts !== settingsRes.data.readerShortcuts) {
      void apiPut('/settings', { readerShortcuts: normalizedShortcuts }).catch(() => {
        const pending = { ...(getPendingSettings(userId) ?? {}), readerShortcuts: normalizedShortcuts } as SettingsRes
        persistPendingSettings(userId, pending)
        window.dispatchEvent(new Event('bd-settings-pending'))
        notify.warning({ key: 'settings.syncFailed' }, { dedupeKey: 'settings-sync' })
      })
    }
  }, [isGuest, settingsRes, userId])

  useEffect(() => {
    const state = useSettingsSyncStore.getState()
    if (state.userId === userId && !state.ready) {
      useSettingsSyncStore.setState({ failed: settingsError })
    }
  }, [settingsError, userId])

  useEffect(() => {
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(SYNC_CHANNEL) : null
    if (channel) {
      channel.onmessage = (event) => {
        if (event.data?.sessionId === SESSION_ID) return
        const currentUser = useAuthStore.getState().user
        if (!currentUser || event.data?.userId !== currentUser.id) return
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

    const retryPending = () => {
      const currentUserId = useAuthStore.getState().user?.id
      if (!currentUserId) return
      const pending = getPendingSettings(currentUserId)
      if (pending) mutateRef.current({ userId: currentUserId, settings: pending }, { onSuccess: () => clearPendingSettings(currentUserId, pending) })
    }
    const broadcastShortcuts = () => {
      const currentUser = useAuthStore.getState().user
      if (currentUser && channel) channel.postMessage({ userId: currentUser.id, sessionId: SESSION_ID, settings: { readerShortcuts: JSON.stringify(readReaderShortcuts(currentUser.id)) } })
    }
    window.addEventListener('bd-settings-pending', retryPending)
    window.addEventListener('online', retryPending)
    window.addEventListener('bd-reader-shortcuts-updated', broadcastShortcuts)

    return () => {
      window.removeEventListener('bd-settings-pending', retryPending)
      window.removeEventListener('online', retryPending)
      window.removeEventListener('bd-reader-shortcuts-updated', broadcastShortcuts)
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
      if (readingPreferenceAccountId() !== (user?.id ?? null)) return
      if (!user) {
        if (settingsTouched) {
          try { localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(pickSettings(state))) }
          catch { notify.warning({ key: 'settings.deviceStorageFailed' }, { dedupeKey: 'device-settings' }) }
        }
        return
      }
      const scheduledUserId = user.id
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
        if (user?.id !== scheduledUserId) { settingsDirty = false; return }
        const pending = user ? getPendingSettings(user.id) : null
        // The device-local active preset is broadcast-only, never PUT
        if (user && (settingsDirty || pending)) {
          settingsDirty = false
          const payloadToSave = pending ?? payload
          mutateRef.current({ userId: user.id, settings: payloadToSave }, {
            onSuccess: () => {
              clearPendingSettings(user.id, payloadToSave)
              void queryClient.invalidateQueries({ queryKey: ['settings'] })
            },
          })
        }
        bcRef.current?.postMessage({ userId: user?.id ?? null, sessionId: SESSION_ID, settings: { ...payload, activePresetId: latestState.activePresetId } })
      }, 1000)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
      bcRef.current?.close()
    }
  }, [queryClient])

  return null
}
