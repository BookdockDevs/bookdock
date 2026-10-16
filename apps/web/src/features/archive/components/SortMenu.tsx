import { useRef, useState } from 'react'

import SmartMenu, { menuItemClass } from '@/components/ui/SmartMenu'
import { CheckIcon } from '@/features/reader/components/annotation-icons'
import { computeFromAnchor, PADDING, type SmartPosition } from '@/lib/position'
import { cn } from '@/lib/utils'

export interface SortMenuOption<T extends string> {
  value: T
  label: string
}

/** Compact dropdown sorter shared by the archive book list and book notes views. */
export default function SortMenu<T extends string>({
  value,
  options,
  onChange,
  label,
  menuWidth = 130,
  triggerClassName,
}: {
  value: T
  options: Array<SortMenuOption<T>>
  onChange: (next: T) => void
  label: string
  menuWidth?: number
  triggerClassName?: string
}) {
  const [menu, setMenu] = useState<SmartPosition | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const active = options.find((option) => option.value === value) ?? options[0]!

  function toggle() {
    const anchor = anchorRef.current
    if (!anchor) return
    if (menu) {
      setMenu(null)
      return
    }
    const rect = anchor.getBoundingClientRect()
    const position = computeFromAnchor(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      menuWidth,
      options.length * 37 + 8,
    )
    setMenu({
      ...position,
      left: Math.max(PADDING, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - PADDING)),
    })
  }

  return (
    <div ref={anchorRef} className="shrink-0">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        title={label}
        className={cn(
          'flex items-center justify-between gap-2 transition-colors',
          triggerClassName ??
            'w-[160px] rounded-full border border-stone-200 bg-white px-4 py-2 text-sm text-stone-700 hover:border-stone-300 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:hover:border-stone-600',
        )}
      >
        <span className="min-w-0 truncate">{active.label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-stone-400">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {menu && (
        <SmartMenu
          innerRef={menuRef}
          triggerRef={anchorRef}
          position={menu}
          onClose={() => setMenu(null)}
          width={menuWidth}
        >
          <div role="menu" aria-label={label}>
            {options.map((option) => {
              const selected = value === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => {
                    setMenu(null)
                    onChange(option.value)
                  }}
                  className={cn(menuItemClass, selected && 'bg-stone-100 font-medium dark:bg-stone-800')}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {selected && <CheckIcon size={14} className="shrink-0 text-stone-500 dark:text-stone-400" />}
                </button>
              )
            })}
          </div>
        </SmartMenu>
      )}
    </div>
  )
}
