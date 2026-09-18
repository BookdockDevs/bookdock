import type { CoverPaletteId } from '@bookdock/shared'

export interface CoverPalette {
  id: CoverPaletteId
  label: string
  className: string
}

export const MORANDI_PALETTES: CoverPalette[] = [
  { id: 'stone', label: 'Warm Stone', className: 'bg-stone-200/80 text-stone-700 dark:bg-stone-800 dark:text-stone-300' },
  { id: 'sage', label: 'Sage Green', className: 'bg-emerald-100/70 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' },
  { id: 'slate', label: 'Mist Slate', className: 'bg-slate-200/80 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  { id: 'amber', label: 'Warm Amber', className: 'bg-amber-100/70 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' },
  { id: 'rose', label: 'Dusty Rose', className: 'bg-rose-100/70 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300' },
  { id: 'teal', label: 'Clay Teal', className: 'bg-teal-100/70 text-teal-800 dark:bg-teal-950/50 dark:text-teal-300' },
  { id: 'sky', label: 'Hazy Sky', className: 'bg-sky-100/70 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300' },
  { id: 'violet', label: 'Muted Mauve', className: 'bg-violet-100/70 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300' },
  { id: 'orange', label: 'Terracotta', className: 'bg-orange-100/70 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300' },
  { id: 'zinc', label: 'Mineral Zinc', className: 'bg-zinc-200/80 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
]

export function hashHue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0
  }
  return h
}

export function getCoverPalette(key: string, customPaletteId?: CoverPaletteId | null): CoverPalette {
  if (customPaletteId) {
    const matched = MORANDI_PALETTES.find((p) => p.id === customPaletteId)
    if (matched) return matched
  }
  return MORANDI_PALETTES[hashHue(key) % MORANDI_PALETTES.length]
}