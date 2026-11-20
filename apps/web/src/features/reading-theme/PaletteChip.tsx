import type { MouseEvent } from 'react'

import { deriveReadingTheme, type BaseThemeColors } from '@/lib/reading-theme'
import { cn } from '@/lib/utils'

import ThemeIcon from './ThemeIcon'

interface PaletteChipProps {
  name: string
  colors: BaseThemeColors
  /** The palette carries a wallpaper; the thumbnail slot shows even before its bytes load */
  hasWallpaper?: boolean
  /** Resolved wallpaper thumbnail, when the palette has one and its bytes are local */
  wallpaperUrl?: string
  /** Bytes still loading: placeholder pulses instead of showing the "broken" icon */
  wallpaperPending?: boolean
  wallpaperLabel: string
  /** `undefined` = the surface has no "current selection" concept (settings page) */
  selected?: boolean
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void
}

/**
 * One palette card: its own colours on the swatch, the surface's selection
 * tokens on the frame — the same 1.5px edge / fill step as `SelectChip`, so a
 * palette never looks like a different control from the chips beside it.
 */
export default function PaletteChip({ name, colors, hasWallpaper = false, wallpaperUrl, wallpaperPending = false, wallpaperLabel, selected, onClick, onContextMenu }: PaletteChipProps) {
  const color = deriveReadingTheme(colors)
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={name}
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{ backgroundColor: color.pageBg ?? color.bg, color: color.text }}
      className={cn(
        'group relative inline-flex h-8 w-full min-w-0 items-center gap-1.5 rounded-lg border-[1.5px] px-3 text-left text-xs transition-[background-color,border-color] duration-150 select-none outline-none active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current',
        selected
          ? 'border-current/55 bg-current/8 font-medium'
          : 'border-current/15 font-normal hover:border-current/30',
      )}
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10 shadow-2xs"
        style={{ backgroundColor: color.primary }}
      />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {hasWallpaper && (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded border border-current/15 bg-current/5" title={wallpaperLabel}>
          {wallpaperUrl ? (
            <img src={wallpaperUrl} alt={wallpaperLabel} className="h-full w-full object-cover" />
          ) : wallpaperPending ? (
            <span className="h-full w-full animate-pulse bg-current/20 motion-reduce:animate-none" />
          ) : (
            <ThemeIcon name="image" size={9} />
          )}
        </span>
      )}
      {selected && <ThemeIcon name="check" size={12} className="shrink-0" />}
    </button>
  )
}
