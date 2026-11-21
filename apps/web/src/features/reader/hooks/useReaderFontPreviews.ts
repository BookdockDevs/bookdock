import { useCallback, useEffect, useRef } from 'react'

import { useDeviceFontStore } from '@/features/device-fonts/store'
import { useUiStore } from '@/stores/ui.store'

import { buildFontOptions, ensureDeviceFontFace, releaseDeviceFontFace, stackFirstFamily, useFontLoaderStore, waitForCardFont, type FontOption } from '../fonts'

const PREWARM_LIMIT = 7

export function useReaderFontPreviews(enabled = true) {
  const deviceFonts = useDeviceFontStore((state) => state.fonts)
  const devicePreferences = useDeviceFontStore((state) => state.preferences)
  const deviceOrder = useDeviceFontStore((state) => state.order)
  const deviceStatus = useDeviceFontStore((state) => state.status)
  const entries = useRef(new Map<string, { device: boolean; failed: boolean }>())

  const request = useCallback((fonts: readonly FontOption[], retry = false) => {
    for (const font of fonts) {
      const existing = entries.current.get(font.id)
      if (font.source === 'system' || (existing && !(retry && existing.failed && !existing.device))) continue
      const entry = { device: Boolean(font.device), failed: false }
      entries.current.set(font.id, entry)
      const load = async () => {
        if (font.device) {
          const url = await ensureDeviceFontFace(font.device)
          if (!url || entries.current.get(font.id) !== entry) return false
          if (typeof document.fonts?.load !== 'function') return false
          const faces = await document.fonts.load(`400 16px ${stackFirstFamily(font.stack)}`, font.name)
          return faces.length > 0
        }
        return waitForCardFont(font, font.name, [400])
      }
      void load().then((loaded) => {
        if (entries.current.get(font.id) !== entry) return
        entry.failed = !loaded
      }).catch(() => { entry.failed = true })
    }
  }, [])

  useEffect(() => {
    if (!enabled || deviceStatus !== 'ready') return
    const available = new Set(deviceFonts.filter((font) => devicePreferences[font.id]?.enabled !== false).map((font) => font.id))
    for (const [id, entry] of entries.current) {
      if (!entry.device || available.has(id)) continue
      entries.current.delete(id)
      releaseDeviceFontFace(id)
    }
  }, [deviceFonts, devicePreferences, deviceStatus, enabled])

  useEffect(() => {
    if (!enabled || deviceStatus !== 'ready') return
    const run = () => {
      const { fontPreferences, fontOrder } = useUiStore.getState()
      const options = buildFontOptions(
        [],
        useFontLoaderStore.getState(),
        fontPreferences,
        fontOrder,
        { fonts: deviceFonts, preferences: devicePreferences, order: deviceOrder },
        true,
      )
      // Prewarm only already-local or previously cached faces; never trigger
      // uncached builtin font downloads before the user opens the picker.
      const ready = options
        .filter((option) => option.enabled && (option.source === 'device' || (option.source === 'builtin' && option.status === 'ready')))
        .slice(0, PREWARM_LIMIT)
      if (ready.length > 0) request(ready)
    }
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(run, { timeout: 1500 })
      return () => window.cancelIdleCallback(handle)
    }
    const timer = window.setTimeout(run, 300)
    return () => window.clearTimeout(timer)
  }, [deviceFonts, deviceOrder, devicePreferences, deviceStatus, enabled, request])

  useEffect(() => {
    const held = entries.current
    return () => {
      for (const [id, entry] of held) if (entry.device) releaseDeviceFontFace(id)
      held.clear()
    }
  }, [])

  return request
}

export type ReaderFontPreviews = ReturnType<typeof useReaderFontPreviews>
