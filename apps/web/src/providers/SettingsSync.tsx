import { useCallback, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { SettingsRes } from '@bookdock/shared'
import { DEFAULT_SELECTION_TOOLBAR_ORDER, settingsUpdateSchema } from '@bookdock/shared'

import { ApiError, apiPut } from '@/api/client'
import { useInstanceThemeLibrary } from '@/api/hooks/useReadingThemes'
import { readReaderShortcuts, readerShortcutStorageKey } from '@/features/reader/lib/reader-shortcuts'
import { bindReadingPreferenceAccount, DEVICE_READING_CONFIG_KEY, DEVICE_SETTINGS_KEY, readingPreferenceAccountId, withReadingPreferenceHydration } from '@/features/reader/lib/reading-preference-owner'
import { emptyConfig, parseReadingConfig, READING_PROFILE_DEFAULTS, serializeReadingConfig } from '@/features/reader/lib/reading-profiles'
import { readThemeLibrary, serializeThemeLibrary } from '@/features/reading-theme/theme-library'
import { notify } from '@/lib/notifications'
import { fetchSettings, readStoredSettings } from '@/lib/settings-cache'
import { getAuthSessionRevision, useAuthStore } from '@/stores/auth.store'
import { useSettingsSyncStore } from '@/stores/settings-sync.store'
import { PENDING_SETTINGS_STORAGE_KEY, useUiStore } from '@/stores/ui.store'
import { useDeviceFontStore } from '@/features/device-fonts/store'

const SYNC_CHANNEL = 'bd-settings'
const SESSION_ID = Math.random().toString(36).slice(2)
const WRITE_TIMEOUT_MS = 10_000
const MAX_RETRY_DELAY_MS = 30_000

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
  'coverRatio',
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
  settings.customThemes = serializeThemeLibrary(state.personalThemeLibrary)
  return settings
}

function settingsChanged(
  state: ReturnType<typeof useUiStore.getState>,
  prevState: ReturnType<typeof useUiStore.getState>,
): boolean {
  if (state.personalThemeLibrary !== prevState.personalThemeLibrary) return true
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
      customThemes: true, coverFit: true, coverRatio: true, readingTimerMode: true, manualTimerGraceMinutes: true,
      ttsEngine: true, ttsServiceId: true, ttsVoiceId: true, ttsRate: true, ttsAutoNext: true, ttsFollow: true, readingConfig: true,
    }).parse(JSON.parse(raw))
    config = localStorage.getItem(DEVICE_READING_CONFIG_KEY)
    if (config && !parseReadingConfig(config)) notify.warning({ key: 'settings.deviceStorageFailed' })
  } catch { notify.warning({ key: 'settings.deviceStorageFailed' }) }
  return {
    fontPreferences: {}, fontOrder: [], selectionToolbarOrder: [...DEFAULT_SELECTION_TOOLBAR_ORDER], selectionToolbarHidden: [],
    customThemes: '[]', coverFit: 'crop', coverRatio: '2:3', readingTimerMode: 'auto', manualTimerGraceMinutes: 5,
    ttsEngine: 'system', ttsServiceId: null, ttsVoiceId: '', ttsRate: 1, ttsAutoNext: true, ttsFollow: true,
    ...fallback, ...stored,
    readingConfig: config && parseReadingConfig(config) ? config : stored.readingConfig && parseReadingConfig(stored.readingConfig) ? stored.readingConfig : fallback.readingConfig,
  }
}

interface PendingSettings {
  userId: string
  payload: SettingsRes
}

interface SettingsWrite extends PendingSettings {
  storedPayload: SettingsRes | null
  sessionRevision: number
}

function persistPendingSettings(userId: string, payload: SettingsRes) {
  try {
    localStorage.setItem(PENDING_SETTINGS_STORAGE_KEY, JSON.stringify({ userId, payload }))
    return payload
  } catch {
    return getPendingSettings(userId)
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
  const readingConfig = settings.readingConfig
  const validReadingConfig = parseReadingConfig(readingConfig)
  withReadingPreferenceHydration(() => {
    if (typeof settings.readerShortcuts === 'string') {
      try { localStorage.setItem(readerShortcutStorageKey(useAuthStore.getState().user?.id ?? null), settings.readerShortcuts) } catch { /* ignore */ }
      window.dispatchEvent(new Event('bd-reader-shortcuts-loaded'))
    }
    useUiStore.setState((state) => {
      const patch: Partial<typeof state> = {}
      for (const key of SETTINGS_KEYS) {
        if (key === 'readingConfig' && !validReadingConfig) continue
        if (key in settings) {
          // @ts-expect-error dynamic settings keys
          patch[key] = settings[key]
        }
      }
      return patch
    })
    // The device-local merged font order keeps its device fonts in place and
    // re-sorts the rest per the synced intent (see device-fonts/store.ts)
    if (Array.isArray(settings.fontOrder)) useDeviceFontStore.getState().reconcileOrder(settings.fontOrder)
    if (Array.isArray(settings.selectionToolbarOrder)) {
      try { localStorage.setItem('bd-selection-toolbar-order', JSON.stringify(settings.selectionToolbarOrder)) } catch { /* ignore */ }
    }
    if (Array.isArray(settings.selectionToolbarHidden)) {
      try { localStorage.setItem('bd-selection-toolbar-hidden', JSON.stringify(settings.selectionToolbarHidden)) } catch { /* ignore */ }
    }
    if (typeof readingConfig === 'string' && validReadingConfig) {
      try {
        localStorage.setItem('bd-reading-config', readingConfig)
        if (!readingPreferenceAccountId()) {
          const existing = localStorage.getItem(DEVICE_READING_CONFIG_KEY)
          if (!existing || parseReadingConfig(existing)) localStorage.setItem(DEVICE_READING_CONFIG_KEY, readingConfig)
        }
      } catch {
        // ignore
      }
    }
    const library = readThemeLibrary(settings.customThemes)
    if (library) useUiStore.getState().setThemeLibrary(library)
    // The profiles blob is authoritative for the reading keys: re-apply the
    // local resolution chain (bound > device active > global) so the flat fields
    // follow the synced config.
    useUiStore.getState().applyReadingResolution()
  })
}

export function SettingsSync() {
  const queryClient = useQueryClient()
  const pendingWrite = useRef<SettingsWrite | null>(null)
  const sendingWrite = useRef<SettingsWrite | null>(null)
  const syncedQueryData = useRef<{ data: SettingsRes } | undefined>(undefined)
  const isMounted = useRef(false)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const retryDelay = useRef(1000)
  const isCurrentWrite = useCallback((write: SettingsWrite) => isMounted.current && pendingWrite.current === write &&
    useAuthStore.getState().user?.id === write.userId && getAuthSessionRevision() === write.sessionRevision, [])
  const { mutate: saveSettings } = useMutation({
    scope: { id: 'account-settings' },
    networkMode: 'always',
    retry: false,
    mutationFn: async (write: SettingsWrite) => {
      if (!isCurrentWrite(write)) return
      await apiPut('/settings', write.payload, AbortSignal.timeout(WRITE_TIMEOUT_MS))
    },
    onError: (error, write) => {
      if (!isCurrentWrite(write)) return
      const retryable = error instanceof TypeError ||
        (error instanceof DOMException && error.name === 'TimeoutError') ||
        (error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.status === 0 ||
          error.status === 429 || (error.status ?? 0) >= 500))
      if (!retryable) return
      retryTimer.current = setTimeout(retryPending, retryDelay.current)
      retryDelay.current = Math.min(retryDelay.current * 2, MAX_RETRY_DELAY_MS)
    },
    onSuccess: (_result, write) => {
      if (!isCurrentWrite(write)) return
      pendingWrite.current = null
      if (write.storedPayload) clearPendingSettings(write.userId, write.storedPayload)
      retryDelay.current = 1000
      const cached = queryClient.getQueryData<{ data: SettingsRes }>(['settings'])
      if (cached) {
        syncedQueryData.current = queryClient.setQueryData<{ data: SettingsRes }>(
          ['settings'], { data: { ...cached.data, ...write.payload } },
        )
      }
    },
    onSettled: (_result, _error, write) => {
      if (sendingWrite.current === write) sendingWrite.current = null
    },
  })
  const mutateRef = useRef(saveSettings)
  const retryPending = useCallback(() => {
    const write = pendingWrite.current
    if (!write || sendingWrite.current === write || !isCurrentWrite(write)) return
    clearTimeout(retryTimer.current)
    sendingWrite.current = write
    mutateRef.current(write)
  }, [isCurrentWrite])
  const settingsUserRef = useRef<string | null | undefined>(undefined)
  const settingsSessionRef = useRef<number | undefined>(undefined)
  const suppressSyncRef = useRef(false)
  useEffect(() => {
    mutateRef.current = saveSettings
  }, [saveSettings])
  useEffect(() => {
    isMounted.current = true
    return () => {
      isMounted.current = false
      clearTimeout(retryTimer.current)
    }
  }, [])

  // (Re)load settings whenever a session appears: initial mount, login, and
  // guest pass-through all surface as a user id change. Logged-out visitors
  // skip the request entirely so /login never sees a 401.
  const user = useAuthStore((s) => s.user)
  const userId = user?.id ?? null
  const isGuest = !user
  const sessionRevision = getAuthSessionRevision()

  const { data: settingsRes, isError: settingsError } = useQuery<{ data: SettingsRes }>({
    enabled: Boolean(userId) && !isGuest,
    queryKey: ['settings'],
    queryFn: fetchSettings,
  })
  const { data: instanceThemeRes } = useInstanceThemeLibrary(true)

  useEffect(() => {
    if (instanceThemeRes?.data) {
      useUiStore.getState().setInstanceThemeLibrary(instanceThemeRes.data)
    }
  }, [instanceThemeRes])

  useEffect(() => {
    if (settingsUserRef.current !== userId || settingsSessionRef.current !== sessionRevision) {
      const firstOwner = settingsUserRef.current === undefined
      const previousWrite = settingsUserRef.current === userId ? pendingWrite.current : null
      clearTimeout(retryTimer.current)
      retryDelay.current = 1000
      pendingWrite.current = null
      sendingWrite.current = null
      syncedQueryData.current = undefined
      bindReadingPreferenceAccount(userId)
      settingsUserRef.current = userId
      settingsSessionRef.current = sessionRevision
      if (userId && !isGuest) {
        const cached = readStoredSettings(userId)
        const storedPayload = getPendingSettings(userId)
        const pending = previousWrite?.payload ?? storedPayload
        suppressSyncRef.current = true
        if (pending) {
          applySettings({ ...cached, ...pending })
        } else if (cached) {
          applySettings(cached)
        }
        suppressSyncRef.current = false
        useSettingsSyncStore.setState({ userId, ready: Boolean(pending || cached), failed: false })
        if (pending) {
          const write = { userId, payload: pending, storedPayload: previousWrite ? previousWrite.storedPayload : pending, sessionRevision }
          pendingWrite.current = write
          sendingWrite.current = write
          mutateRef.current(write)
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
  }, [isGuest, sessionRevision, userId])

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

    const saveShortcuts = (event: Event) => {
      const { userId, readerShortcuts } = (event as CustomEvent<{ userId: string; readerShortcuts: string }>).detail
      if (useAuthStore.getState().user?.id !== userId) return
      const pending = pendingWrite.current
      const payload = { ...(pending?.userId === userId ? pending.payload : undefined), readerShortcuts }
      pendingWrite.current = {
        userId, payload, storedPayload: persistPendingSettings(userId, payload), sessionRevision: getAuthSessionRevision(),
      }
      retryPending()
    }
    const broadcastShortcuts = () => {
      const currentUser = useAuthStore.getState().user
      if (currentUser && channel) channel.postMessage({ userId: currentUser.id, sessionId: SESSION_ID, settings: { readerShortcuts: JSON.stringify(readReaderShortcuts(currentUser.id)) } })
    }
    window.addEventListener('bd-settings-shortcuts-save', saveShortcuts)
    window.addEventListener('online', retryPending)
    window.addEventListener('bd-reader-shortcuts-updated', broadcastShortcuts)

    return () => {
      window.removeEventListener('bd-settings-shortcuts-save', saveShortcuts)
      window.removeEventListener('online', retryPending)
      window.removeEventListener('bd-reader-shortcuts-updated', broadcastShortcuts)
      channel?.close()
    }
  }, [retryPending])

  useEffect(() => {
    if (!userId || isGuest || !settingsRes?.data) return
    if (settingsRes === syncedQueryData.current) return
    const pending = pendingWrite.current?.payload

    suppressSyncRef.current = true
    applySettings({ ...settingsRes.data, ...pending })
    suppressSyncRef.current = false
    useSettingsSyncStore.setState({ userId, ready: true, failed: false })
    if (pending?.readerShortcuts !== undefined) return
    const normalizedShortcuts = JSON.stringify(readReaderShortcuts(userId))
    if (normalizedShortcuts !== settingsRes.data.readerShortcuts) {
      window.dispatchEvent(new CustomEvent('bd-settings-shortcuts-save', {
        detail: { userId, readerShortcuts: normalizedShortcuts },
      }))
    }
  }, [isGuest, settingsRes, userId])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
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
        const pending = pendingWrite.current
        const payload = { ...(pending?.userId === user.id ? pending.payload : undefined), ...pickSettings(state) }
        pendingWrite.current = {
          userId: user.id, payload, storedPayload: persistPendingSettings(user.id, payload), sessionRevision: getAuthSessionRevision(),
        }
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const latestState = useUiStore.getState()
        const payload = pickSettings(latestState)
        const user = useAuthStore.getState().user
        if (user?.id !== scheduledUserId) return
        // The device-local active preset is broadcast-only, never PUT
        retryPending()
        bcRef.current?.postMessage({ userId: user?.id ?? null, sessionId: SESSION_ID, settings: { ...payload, activePresetId: latestState.activePresetId } })
      }, 1000)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
      bcRef.current?.close()
    }
  }, [retryPending])

  return null
}
