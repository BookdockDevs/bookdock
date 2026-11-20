import { useMemo } from 'react'

import SmartMenu from '@/components/ui/SmartMenu'
import { useMenuAnchor } from '@/hooks/useMenuAnchor'
import { deriveReadingTheme } from '@/lib/reading-theme'
import { cn } from '@/lib/utils'

import { materializeTheme, type ReadingThemeLibrary } from './theme-library'

interface ThemeDefaultPickerProps {
  label: string
  value?: string
  library: ReadingThemeLibrary
  onChange: (themeId: string) => void
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-600 dark:text-stone-300">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

/**
 * Day/night default picker, in the settings page's button + chevron + menu
 * shape (the native select could not show a palette swatch and rendered
 * differently on every platform).
 */
export default function ThemeDefaultPicker({ label, value, library, onChange }: ThemeDefaultPickerProps) {
  const menu = useMenuAnchor()
  const themes = library.themes
  const selected = themes.find((theme) => theme.id === value)
  const swatches = useMemo(
    () => new Map(themes.map((theme) => [theme.id, deriveReadingTheme(materializeTheme(library, theme).colors)])),
    [themes, library],
  )

  function select(id: string) {
    onChange(id)
    menu.close()
  }

  return (
    <>
      {/* Same row as the rest of the settings page (`LibraryPreferenceRows`):
          text-sm medium label, py-3 breathing room, control at the far end. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
        <span className="min-w-0 text-sm font-medium text-stone-700 dark:text-stone-200">{label}</span>
        <button
          ref={menu.btnRef}
          type="button"
          onClick={(event) => menu.toggleFromButton(event, 'below')}
          aria-label={label}
          aria-haspopup="listbox"
          aria-expanded={menu.open}
          className={cn(
            'flex min-w-0 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-800 shadow-sm transition-colors hover:border-stone-300 hover:bg-stone-50 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700/60',
            menu.open && 'border-stone-400 dark:border-stone-500',
          )}
        >
          {selected && (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
              style={{ backgroundColor: swatches.get(selected.id)?.primary }}
            />
          )}
          <span className="max-w-[160px] truncate" title={selected?.name}>{selected?.name ?? '—'}</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn('shrink-0 text-stone-400 transition-transform dark:text-stone-500', menu.open && 'rotate-180')}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      {menu.open && (
        <SmartMenu
          triggerRef={menu.btnRef}
          innerRef={menu.menuRef}
          anchor={menu.anchor}
          size={{ width: 'auto', height: Math.min(280, themes.length * 34 + 16) }}
          // Wider than the trigger only when a theme name needs it; no floor
          // beyond the button's own width, or the menu floats in empty space.
          minWidth={Math.round(menu.btnRef.current?.getBoundingClientRect().width ?? 0)}
          maxWidth={320}
          onClose={menu.close}
        >
          <div role="listbox" aria-label={label} className="max-h-64 overflow-y-auto overscroll-contain py-1">
            {themes.map((theme) => {
              const isSelected = theme.id === value
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => select(theme.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors',
                    isSelected
                      ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                      : 'text-stone-600 hover:bg-stone-100/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
                      style={{ backgroundColor: swatches.get(theme.id)?.primary }}
                    />
                    <span className="truncate" title={theme.name}>{theme.name}</span>
                  </span>
                  {isSelected && <CheckIcon />}
                </button>
              )
            })}
          </div>
        </SmartMenu>
      )}
    </>
  )
}
