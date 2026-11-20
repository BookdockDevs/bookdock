import { useEffect } from 'react'

import Badge from '@/components/ui/Badge'
import {
  ensureBuiltinFontLoaded,
  ensureDeviceFontFace,
  ensureUploadedFontLoaded,
  releaseDeviceFontFace,
  type FontOption,
} from '@/features/reader/fonts'
import { DownloadIcon, SpinnerIcon } from '@/features/settings/components/FontRow'
import { useTranslation } from '@/hooks/useTranslation'
import { notify } from '@/lib/notifications'

import ThemeIcon from './ThemeIcon'
import { themeFontReference, useThemeFontList } from './font-refs'

const iconAction =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-current/60 hover:bg-stone-500/10 hover:text-current transition-colors disabled:opacity-35 cursor-pointer'

export interface ThemeFontLibraryProps {
  fonts?: FontOption[]
  onInsert?: (fontSnippet: string) => void
}

/**
 * The 字体 reference panel for the CSS editor. Reuses the reader's font
 * catalog with the same row styling as the font settings module.
 */
export default function ThemeFontLibrary({ fonts: propFonts, onInsert }: ThemeFontLibraryProps = {}) {
  const _ = useTranslation()
  const hookFonts = useThemeFontList()
  const fonts = propFonts ?? hookFonts

  // Uploaded and device faces render their own sample: both are already this
  // viewer's own files, so loading them here downloads nothing new.
  useEffect(() => {
    fonts.forEach((font) => {
      if (font.uploaded) void ensureUploadedFontLoaded(font.uploaded)
    })
  }, [fonts])
  const deviceKey = fonts.filter((font) => font.device).map((font) => font.id).join('\u0000')
  useEffect(() => {
    const listed = deviceKey
      ? deviceKey.split('\u0000').map((id) => fonts.find((font) => font.id === id)).filter((font): font is FontOption => Boolean(font?.device))
      : []
    listed.forEach((font) => { void ensureDeviceFontFace(font.device!) })
    return () => {
      listed.forEach((font) => releaseDeviceFontFace(font.id))
    }
    // deviceKey carries the identity of the listed device faces
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceKey])

  const copy = async (font: FontOption) => {
    try {
      await navigator.clipboard.writeText(themeFontReference(font))
      notify.success({ key: 'reader.themeFontsCopied' })
    } catch {
      notify.error({ key: 'reader.themeAssetsCopyFailed' })
    }
  }

  const sourceLabel = (font: FontOption): string => {
    if (font.uploaded) return _(font.uploaded.scope === 'instance' ? 'settings.resourceScopeInstance' : 'settings.resourceScopeUser')
    if (font.device) return _('settings.fontsScopeDevice')
    return _(font.source === 'builtin' ? 'settings.fontsBuiltIn' : 'settings.fontsSystem')
  }

  if (!fonts.length) {
    return (
      <p className="rounded-lg border border-dashed border-stone-300/60 p-4 text-center text-xs text-current/50 dark:border-stone-700/60">
        {_('reader.themeFontsEmpty')}
      </p>
    )
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <ul className="grid grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
        {fonts.map((font) => {
          const isBuiltinNotReady = font.source === 'builtin' && font.status !== 'ready'
          return (
            <li
              key={font.id}
              className="flex min-w-0 items-center gap-2.5 rounded-xl border border-stone-300/70 bg-stone-500/5 px-3 py-2.5 transition-colors dark:border-stone-700/80"
            >
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <span
                  className="truncate text-sm font-medium text-current"
                  style={{ fontFamily: font.stack }}
                  title={font.name}
                >
                  {font.name}
                </span>
                {isBuiltinNotReady && (
                  <button
                    type="button"
                    onClick={() => ensureBuiltinFontLoaded(font.id)}
                    disabled={font.status === 'loading'}
                    aria-label={_('settings.fontsLoad')}
                    title={_('settings.fontsLoad')}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-500/10 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:text-stone-200 cursor-pointer"
                  >
                    {font.status === 'loading' ? <SpinnerIcon /> : <DownloadIcon />}
                  </button>
                )}
              </div>

              <Badge className="border-stone-300 bg-stone-500/10 text-current/75 font-medium dark:border-stone-600 dark:bg-stone-500/20">
                {sourceLabel(font)}
              </Badge>

              <div className="flex shrink-0 items-center gap-1">
                {onInsert && (
                  <button
                    type="button"
                    className={iconAction}
                    aria-label={_('reader.themeAssetInsert')}
                    title={_('reader.themeAssetInsert')}
                    onClick={() => onInsert(themeFontReference(font))}
                  >
                    <ThemeIcon name="plus" size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className={iconAction}
                  aria-label={_('reader.themeFontsCopy', { name: font.name })}
                  onClick={() => void copy(font)}
                >
                  <ThemeIcon name="copy" size={14} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
