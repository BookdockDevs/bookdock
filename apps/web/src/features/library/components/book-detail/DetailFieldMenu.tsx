import { useId, useLayoutEffect, useRef, type ReactNode } from 'react'

import SmartMenu, { menuItemClass } from '@/components/ui/SmartMenu'
import { useMenuAnchor } from '@/hooks/useMenuAnchor'

interface DetailFieldMenuProps {
  label: ReactNode
  editLabel: string
  value: string | null
  options: Array<{ value: string | null; label: string; icon?: ReactNode }>
  editable: boolean
  busy?: boolean
  disabled?: boolean
  onFilter: () => void
  onSelect: (value: string | null) => void
}

export default function DetailFieldMenu({ label, editLabel, value, options, editable, busy = false, disabled = false, onFilter, onSelect }: DetailFieldMenuProps) {
  const id = useId()
  const menu = useMenuAnchor()
  const anchorRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  function close() {
    menu.close()
    triggerRef.current?.focus()
  }

  useLayoutEffect(() => {
    if (!menu.open) return
    const items = menu.menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    const selected = menu.menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
    const target = selected ?? items?.[0]
    target?.focus()
  }, [menu.open, menu.menuRef])

  return (
    <div
      ref={anchorRef}
      className="inline-flex items-center rounded-md bg-stone-100 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300"
      aria-busy={busy || undefined}
      onContextMenu={(event) => {
        if (!editable) return
        event.preventDefault()
        event.stopPropagation()
        if (!disabled) menu.openFromEvent(event)
      }}
    >
      <button ref={triggerRef} type="button" aria-haspopup={editable ? "menu" : undefined} aria-expanded={editable ? menu.open : undefined} aria-controls={menu.open ? id : undefined} onClick={onFilter} className="flex min-h-7 items-center gap-1.5 rounded-md px-2 py-0.5 hover:bg-stone-200 dark:hover:bg-stone-700">
        {label}
      </button>
      {editable && !disabled && menu.open && (
        <SmartMenu id={id} innerRef={menu.menuRef} triggerRef={anchorRef} anchor={menu.anchor} onClose={close} size={{ width: 'auto', height: Math.min(options.length * 36 + 8, 280) }} minWidth={148} maxWidth={280}>
          <div
            role="menu"
            aria-label={editLabel}
            className="max-h-64 overflow-y-auto"
            onKeyDown={(event) => {
              const items = Array.from(menu.menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
              const index = items.indexOf(document.activeElement as HTMLButtonElement)
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
                event.preventDefault()
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
                items[next]?.focus()
              } else if (event.key === 'Tab') {
                event.preventDefault()
                close()
              }
            }}
          >
            {options.map((option) => (
              <button
                key={option.value ?? 'unassigned'}
                type="button"
                role="menuitemradio"
                aria-checked={value === option.value}
                onClick={() => {
                  close()
                  if (value !== option.value) onSelect(option.value)
                }}
                className={menuItemClass}
              >
                {option.icon}
                <span className="min-w-0 flex-1 truncate" title={option.label}>{option.label}</span>
                {value === option.value && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="m4 12 5 5 11-11" /></svg>}
              </button>
            ))}
          </div>
        </SmartMenu>
      )}
    </div>
  )
}
