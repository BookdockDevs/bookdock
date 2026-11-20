// Phase-5 theme font references. Theme CSS names a font the reader already
// owns — it never ships bytes. The author form is a quoted family string
// `"bd-font:<fontId>"`, which the CSS validator treats as an ordinary family
// name (resource values and @import/@font-face stay rejected). The reader
// rewrites known ids to the resolved family stack and injects the matching
// face rules at the injection boundary.

import { useEffect, useMemo } from 'react'

import { useFonts } from '@/api/hooks/useFonts'
import { useInstanceInfo } from '@/features/auth/hooks'
import { useDeviceFontStore } from '@/features/device-fonts/store'
import { READER_GLYPH_FALLBACK, type ThemeFontSources } from '@/features/reader/types'
import type { FontOption } from '@/features/reader/fonts'
import {
  buildFontOptions,
  builtinImportCss,
  deviceFaceCss,
  stackFirstFamily,
  uploadedFaceCss,
  useFontLoaderStore,
} from '@/features/reader/fonts'
import { collectThemeFontRefs, rewriteThemeFontRefs, THEME_FONT_REF_PREFIX } from '@/lib/theme-css-guard'
import { useAuthStore } from '@/stores/auth.store'
import { useUiStore } from '@/stores/ui.store'

export type { ThemeFontSources }

export function useThemeFontList(): FontOption[] {
  const user = useAuthStore((state) => state.user)
  const fontsQuery = useFonts(Boolean(user))
  const uploadedFonts = useMemo(() => fontsQuery.data?.data ?? [], [fontsQuery.data])
  const fontPreferences = useUiStore((state) => state.fontPreferences)
  const fontOrder = useUiStore((state) => state.fontOrder)
  const deviceFonts = useDeviceFontStore((state) => state.fonts)
  const devicePreferences = useDeviceFontStore((state) => state.preferences)
  const deviceOrder = useDeviceFontStore((state) => state.order)
  useEffect(() => {
    void useDeviceFontStore.getState().ensureLoaded()
  }, [])
  const { data: instanceInfo } = useInstanceInfo()
  const builtinDownloadsAllowed = user?.role === 'owner' || instanceInfo?.data.allowUserResourceUpload !== false
  const loadedIds = useFontLoaderStore((state) => state.loadedIds)
  const loadingIds = useFontLoaderStore((state) => state.loadingIds)
  const latinIds = useFontLoaderStore((state) => state.latinIds)
  const deviceCatalog = useMemo(
    () => ({ fonts: deviceFonts, preferences: devicePreferences, order: deviceOrder }),
    [deviceFonts, devicePreferences, deviceOrder],
  )
  return useMemo(
    () => buildFontOptions(uploadedFonts, { loadedIds, loadingIds, latinIds }, fontPreferences, fontOrder, deviceCatalog, builtinDownloadsAllowed)
      .filter((font) => font.enabled),
    [uploadedFonts, loadedIds, loadingIds, latinIds, fontPreferences, fontOrder, deviceCatalog, builtinDownloadsAllowed],
  )
}

const NO_SOURCES: ThemeFontSources = { stacks: new Map(), faces: new Map() }

/**
 * The declaration the editor copies: system faces copy their real CSS family
 * stack, every Bookdock-managed face copies a stable id-based reference plus
 * that face's fallback, so the copy is readable before the reader resolves it.
 */
export function themeFontReference(option: FontOption): string {
  const stack = option.stack.replace(`, ${READER_GLYPH_FALLBACK}`, '')
  if (option.source === 'system') return `font-family: ${stack};`
  const fallback = stack.slice(stackFirstFamily(stack).length).trim().replace(/^,\s*/, '')
  const reference = `"${THEME_FONT_REF_PREFIX}${option.id}"`
  return `font-family: ${reference}${fallback ? `, ${fallback}` : ''};`
}

function faceCssFor(option: FontOption, deviceUrls: Record<string, string>): string {
  if (option.builtin) return builtinImportCss(option.builtin.cssUrl)
  if (option.uploaded) return uploadedFaceCss(option.uploaded)
  // A device face needs its pooled blob URL: absent means the file is not on
  // this device (or not read yet) and the reference simply falls back.
  if (option.device) {
    const url = deviceUrls[option.device.id] ?? deviceUrls[option.id]
    return url ? deviceFaceCss(option.device, url) : ''
  }
  return ''
}

/** Resolve each available reference to one family. The rest of the declaration
 *  owns the fallback order, including any other referenced fonts. */
export function themeFontSources(
  refIds: readonly string[],
  options: readonly FontOption[],
  deviceUrls: Record<string, string> = {},
): ThemeFontSources {
  if (!refIds.length) return NO_SOURCES
  const byId = new Map(options.filter((option) => option.enabled).map((option) => [option.id, option]))
  const stacks = new Map<string, string>()
  const faces = new Map<string, string>()
  for (const id of new Set(refIds)) {
    const option = byId.get(id)
    if (!option) continue
    const face = faceCssFor(option, deviceUrls)
    if (!face && option.source !== 'system') continue
    stacks.set(id, stackFirstFamily(option.stack))
    if (face) faces.set(id, face)
  }
  return { stacks, faces }
}

/** Rewrite the compiled sheet and collect the face rules of what it uses. */
export function resolveThemeFontRefs(css: string, sources?: ThemeFontSources): { css: string; faces: string } {
  if (!css || !sources || !sources.stacks.size) return { css, faces: '' }
  const refs = collectThemeFontRefs(css)
  if (!refs.length) return { css, faces: '' }
  const imports = new Set<string>()
  const faces = new Set<string>()
  for (const id of refs) {
    const face = sources.faces.get(id)
    if (face?.startsWith('@import ')) imports.add(face)
    else if (face) faces.add(face)
  }
  return { css: rewriteThemeFontRefs(css, sources.stacks), faces: [...imports, ...faces].join('\n') }
}
