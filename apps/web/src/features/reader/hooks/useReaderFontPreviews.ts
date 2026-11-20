import { useCallback, useEffect, useRef } from 'react'

import { useDeviceFontStore } from '@/features/device-fonts/store'

import { ensureDeviceFontFace, releaseDeviceFontFace, stackFirstFamily, waitForCardFont, type FontOption } from '../fonts'

export function useReaderFontPreviews(enabled = true) {
  const deviceFonts = useDeviceFontStore((state) => state.fonts)
  const devicePreferences = useDeviceFontStore((state) => state.preferences)
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
    const held = entries.current
    return () => {
      for (const [id, entry] of held) if (entry.device) releaseDeviceFontFace(id)
      held.clear()
    }
  }, [])

  return request
}

export type ReaderFontPreviews = ReturnType<typeof useReaderFontPreviews>
