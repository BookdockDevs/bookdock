import { useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'

import { apiGet, apiPut } from '@/api/client'
import { useUiStore } from '@/stores/ui.store'
import type { SettingsRes } from '@bookdock/shared'

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
  'textAlignJustify',
  'overrideBookFont',
  'overrideBookLayout',
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

  useEffect(() => {
    apiGet<{ data: SettingsRes }>('/settings')
      .then((res) => {
        if (res.data) useUiStore.setState(res.data as Partial<ReturnType<typeof useUiStore.getState>>)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsub = useUiStore.subscribe((state, prevState) => {
      if (!settingsChanged(state, prevState)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        mutateRef.current(pickSettings(state))
      }, 1000)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [])

  return null
}
