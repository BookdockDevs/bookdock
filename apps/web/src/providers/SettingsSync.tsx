import { useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiGet, apiPut } from '@/api/client'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'
import type { SettingsRes } from '@bookdock/shared'

const SYNC_CHANNEL = 'bd-settings'
const SESSION_ID = Math.random().toString(36).slice(2)

const SETTINGS_KEYS = [
  'uiTheme',
  'readingThemeId',
  'lightReadingThemeId',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'paragraphSpacing',
  'letterSpacing',
  'indent',
  'pageWidth',
  'verticalPadding',
  'horizontalPadding',
  'scrollPageWidth',
  'scrollHorizontalPadding',
  'scrollVerticalPadding',
  'pagePageWidth',
  'pageHorizontalPadding',
  'pageVerticalPadding',
  'textAlignJustify',
  'overrideBookFont',
  'overrideBookLayout',
  'coverMode',
  'coverFit',
  'gridColumns',
  'toolbarLocked',
  'sidebarWidth',
  'readingMode',
  'pageColumns',
  'columnGap',
  'showHeader',
  'showFooter',
  'chineseConversion',
  'showWordCount',
  'continuousScroll',
  'pageAnimation',
]

function pickSettings(state: ReturnType<typeof useUiStore.getState>): SettingsRes {
  const settings: SettingsRes = {}
  for (const key of SETTINGS_KEYS) {
    // @ts-expect-error dynamic settings keys
    settings[key] = state[key]
  }
  return settings
}

function settingsChanged(
  state: ReturnType<typeof useUiStore.getState>,
  prevState: ReturnType<typeof useUiStore.getState>,
): boolean {
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
      if (!settingsChanged(state, prevState)) return
      if (!useAuthStore.getState().user) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const payload = pickSettings(state)
        mutateRef.current(payload)
        bcRef.current?.postMessage({ sessionId: SESSION_ID, settings: payload })
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
