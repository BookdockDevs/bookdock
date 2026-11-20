import type { MouseEvent, ReactNode } from 'react'

import { cn } from '@/lib/utils'

import ThemeIcon from './ThemeIcon'

interface SelectChipProps {
  children: ReactNode
  /** `undefined` = the surface has no "current selection" concept (settings page) */
  selected?: boolean
  disabled?: boolean
  title?: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void
  /** Leading visual, e.g. a palette's colour dot */
  lead?: ReactNode
  /** Trailing meta shown before the check, e.g. the bound-preset badge */
  meta?: ReactNode
  className?: string
}

/**
 * The one selectable chip used by every reading-theme / reading-preset list:
 * themes, palettes' siblings (CSS / highlight), presets. States read from the
 * `--bd-sel-*` tokens, so a single rule set works on the settings page, inside
 * the reader and on any reading palette. The border stays 1.5px in every state
 * so the label never shifts when selection changes; the selected state is a
 * fill step plus a solid edge instead of the old border + ring double line.
 */
export default function SelectChip({
  children,
  selected,
  disabled,
  title,
  onClick,
  onContextMenu,
  lead,
  meta,
  className,
}: SelectChipProps) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        'inline-flex h-8 min-w-0 max-w-40 items-center gap-1.5 rounded-lg border-[1.5px] px-3 text-left text-xs transition-[background-color,border-color,color,opacity] duration-150 select-none outline-none active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-(--bd-sel-border-on) disabled:opacity-45',
        selected
          ? 'border-(--bd-sel-border-on) bg-(--bd-sel-bg-on) font-medium text-(--bd-sel-text-on)'
          : 'border-(--bd-sel-border) bg-(--bd-sel-bg) font-normal text-(--bd-sel-text) hover:border-(--bd-sel-border-hover) hover:bg-(--bd-sel-bg-hover) hover:text-(--bd-sel-text-on)',
        className,
      )}
    >
      {lead}
      <span className="min-w-0 truncate">{children}</span>
      {meta}
      {selected && <ThemeIcon name="check" size={12} className="shrink-0" />}
    </button>
  )
}
