import { create } from 'zustand'

import type { FontListItem } from '@bookdock/shared'

import { BASE_URL } from '@/api/client'

import { FONT_OPTIONS } from './types'

export interface BuiltinFont {
  id: string
  name: string
  /** CSS family name as declared by the CDN stylesheet */
  family: string
  cssUrl: string
  license: { name: string; url: string }
}

export const BUILTIN_FONTS: BuiltinFont[] = [
  {
    id: 'lxgw-wenkai',
    name: '霞鹜文楷',
    family: '"LXGW WenKai", serif',
    cssUrl: 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css',
    license: { name: 'OFL-1.1', url: 'https://github.com/lxgw/LxgwWenKai/blob/main/LICENSE' },
  },
  {
    id: 'noto-serif-sc',
    name: '思源宋体',
    // Variable package: fontsource's static index.css ships weight 400 only,
    // so the reader's fontWeight would synthesize faux bold
    family: '"Noto Serif SC Variable", serif',
    cssUrl: 'https://cdn.jsdelivr.net/npm/@fontsource-variable/noto-serif-sc@5.3.0/index.css',
    license: { name: 'OFL-1.1', url: 'https://fonts.google.com/noto/specimen/Noto+Serif+SC/license' },
  },
  {
    id: 'noto-sans-sc',
    name: '思源黑体',
    family: '"Noto Sans SC Variable", sans-serif',
    cssUrl: 'https://cdn.jsdelivr.net/npm/@fontsource-variable/noto-sans-sc@5.3.0/index.css',
    license: { name: 'OFL-1.1', url: 'https://fonts.google.com/noto/specimen/Noto+Sans+SC/license' },
  },
]

export interface ResolvedFont {
  name: string
  /** Ready-to-use CSS font-family stack */
  stack: string
  builtin?: BuiltinFont
  uploaded?: FontListItem
}

/** Uploaded fonts get an alias family name so they can never be confused with
 *  a same-named system font */
export function uploadedFontAlias(id: string): string {
  return `bd-font-${id}`
}

export function resolveFont(id: string, uploaded: FontListItem[] = []): ResolvedFont {
  const system = FONT_OPTIONS.find((f) => f.id === id)
  if (system) return { name: system.name, stack: system.value }
  const builtin = BUILTIN_FONTS.find((f) => f.id === id)
  if (builtin) return { name: builtin.name, stack: builtin.family, builtin }
  const uploadedFont = uploaded.find((f) => f.id === id)
  if (uploadedFont) {
    return { name: uploadedFont.family, stack: `"${uploadedFontAlias(id)}", serif`, uploaded: uploadedFont }
  }
  return { name: FONT_OPTIONS[0].name, stack: FONT_OPTIONS[0].value }
}

const FONT_FORMAT_MAP: Record<FontListItem['format'], string> = {
  ttf: 'truetype',
  otf: 'opentype',
  woff: 'woff',
  woff2: 'woff2',
}

export function uploadedFontFileUrl(font: FontListItem): string {
  // Absolute URL: the foliate iframe is a blob document, so relative URLs
  // would not resolve back to this origin
  return `${window.location.origin}${BASE_URL}/fonts/${font.id}/file`
}

export function uploadedFaceCss(font: FontListItem): string {
  return `@font-face {
  font-family: "${uploadedFontAlias(font.id)}";
  src: url("${uploadedFontFileUrl(font)}") format("${FONT_FORMAT_MAP[font.format]}");
  font-display: swap;
}`
}

export function builtinImportCss(cssUrl: string): string {
  return `@import url("${cssUrl}");`
}

/** CSS snippet prepended to the iframe stylesheet for the resolved font;
 *  '' for system stacks which need no loading */
export function fontCssFor(resolved: ResolvedFont): string {
  if (resolved.builtin) return builtinImportCss(resolved.builtin.cssUrl)
  if (resolved.uploaded) return uploadedFaceCss(resolved.uploaded)
  return ''
}

const BUILTIN_LOADED_KEY = 'bd-builtin-fonts-loaded'

function readLoadedIds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(BUILTIN_LOADED_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

interface FontLoaderState {
  /** Builtin ids whose files were fetched before. Persisted so the pickers can
   *  show a download icon only for never-fetched fonts — HTTP cache state is
   *  not queryable from JS, and a stale marker after cache clearing is accepted */
  loadedIds: string[]
  /** Builtin ids with an in-flight stylesheet */
  loadingIds: string[]
}

export const useFontLoaderStore = create<FontLoaderState>(() => ({
  loadedIds: readLoadedIds(),
  loadingIds: [],
}))

export function isBuiltinFontLoaded(id: string): boolean {
  return useFontLoaderStore.getState().loadedIds.includes(id)
}

const injectedBuiltinIds = new Set<string>()

/** Idempotently inject the CDN stylesheet into the main document (settings
 *  panel / share card previews live outside the reader iframe). The persisted
 *  marker only means "files were fetched before" — the link is re-injected
 *  every session regardless, but only never-fetched fonts enter the loading
 *  state, and the marker is written once the stylesheet actually loads */
export function ensureBuiltinFontLoaded(id: string): void {
  if (injectedBuiltinIds.has(id)) return
  const font = BUILTIN_FONTS.find((f) => f.id === id)
  if (!font) return
  injectedBuiltinIds.add(id)
  if (!isBuiltinFontLoaded(id)) {
    useFontLoaderStore.setState((s) => ({ loadingIds: [...s.loadingIds, id] }))
  }
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = font.cssUrl
  link.dataset.bdFont = id
  link.onload = () => {
    useFontLoaderStore.setState((s) => {
      const loadedIds = s.loadedIds.includes(id) ? s.loadedIds : [...s.loadedIds, id]
      try {
        localStorage.setItem(BUILTIN_LOADED_KEY, JSON.stringify(loadedIds))
      } catch { /* private-mode quota failures are non-fatal */ }
      return { loadedIds, loadingIds: s.loadingIds.filter((v) => v !== id) }
    })
  }
  link.onerror = () => {
    useFontLoaderStore.setState((s) => ({ loadingIds: s.loadingIds.filter((v) => v !== id) }))
  }
  document.head.appendChild(link)
}

const loadedUploadedIds = new Set<string>()

/** Idempotently register an uploaded font in the main document via the
 *  FontFace API (a <link> cannot express the aliased family name) */
export async function ensureUploadedFontLoaded(font: FontListItem): Promise<void> {
  if (loadedUploadedIds.has(font.id)) return
  loadedUploadedIds.add(font.id)
  try {
    const face = new FontFace(
      uploadedFontAlias(font.id),
      `url("${uploadedFontFileUrl(font)}") format("${FONT_FORMAT_MAP[font.format]}")`,
    )
    await face.load()
    document.fonts.add(face)
  } catch (err) {
    // A failed load must not break the UI — the stack falls back to serif;
    // drop the marker so a later attempt can retry
    loadedUploadedIds.delete(font.id)
    console.warn(`[fonts] failed to load uploaded font ${font.id}:`, err)
  }
}

export type FontOptionSource = 'uploaded' | 'builtin' | 'system'
/** idle = builtin never fetched (download icon); loading = in flight
 *  (spinner); ready = nothing to show (uploaded/system are always ready) */
export type FontOptionStatus = 'idle' | 'loading' | 'ready'

export interface FontOption {
  id: string
  name: string
  stack: string
  source: FontOptionSource
  status: FontOptionStatus
}

/** Single ordered list shared by both font pickers: uploaded → builtin →
 *  system. The order is fixed on purpose — dynamic reordering breaks the
 *  user's position memory. The loader snapshot is an explicit parameter so
 *  callers can memoize on it (default: current store state) */
export function buildFontOptions(
  uploaded: FontListItem[] = [],
  loader: Pick<FontLoaderState, 'loadedIds' | 'loadingIds'> = useFontLoaderStore.getState(),
): FontOption[] {
  const { loadedIds, loadingIds } = loader
  return [
    ...uploaded.map((f) => ({
      id: f.id,
      name: f.family,
      stack: `"${uploadedFontAlias(f.id)}", serif`,
      source: 'uploaded' as const,
      status: 'ready' as const,
    })),
    ...BUILTIN_FONTS.map((f) => ({
      id: f.id,
      name: f.name,
      stack: f.family,
      source: 'builtin' as const,
      status: loadingIds.includes(f.id)
        ? ('loading' as const)
        : loadedIds.includes(f.id)
          ? ('ready' as const)
          : ('idle' as const),
    })),
    ...FONT_OPTIONS.map((f) => ({
      id: f.id,
      name: f.name,
      stack: f.value,
      source: 'system' as const,
      status: 'ready' as const,
    })),
  ]
}
