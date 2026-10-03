import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import SmartMenu, { menuItemClass } from '@/components/ui/SmartMenu'
import { computeAtPoint, type SmartPosition } from '@/lib/position'

interface DetailFieldMenuProps {
  label: ReactNode
  editLabel: string
  value: string | null
  options: Array<{ value: string | null; label: string; icon?: ReactNode }>
  editable: boolean
  disabled?: boolean
  onFilter: () => void
  onSelect: (value: string | null) => void
}

export default function DetailFieldMenu({ label, editLabel, value, options, editable, disabled = false, onFilter, onSelect }: DetailFieldMenuProps) {
  const id = useId()
  const [position, setPosition] = useState<SmartPosition | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  function close() {
    setPosition(null)
    triggerRef.current?.focus()
  }

  useLayoutEffect(() => {
    if (!position) return
    const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    const selected = menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')
    const target = selected ?? items?.[0]
    target?.focus()
  }, [position])

  useEffect(() => {
    if (!position) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !anchorRef.current?.contains(target)) setPosition(null)
    }
    const dismissOnScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setPosition(null)
    }
    const dismissOnResize = () => setPosition(null)
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('scroll', dismissOnScroll, true)
    window.addEventListener('resize', dismissOnResize)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('scroll', dismissOnScroll, true)
      window.removeEventListener('resize', dismissOnResize)
    }
  }, [position])

  return (
    <div
      ref={anchorRef}
      className="inline-flex items-center rounded-md bg-stone-100 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300"
      aria-busy={disabled || undefined}
      onContextMenu={(event) => {
        if (!editable) return
        event.preventDefault()
        event.stopPropagation()
        if (!disabled) setPosition(computeAtPoint({ x: event.clientX, y: event.clientY }, 184, Math.min(options.length * 36 + 8, 280)))
      }}
    >
      <button ref={triggerRef} type="button" aria-haspopup={editable ? "menu" : undefined} aria-expanded={editable ? Boolean(position) : undefined} aria-controls={position ? id : undefined} onClick={onFilter} className="flex min-h-7 items-center gap-1.5 rounded-md px-2 py-0.5 hover:bg-stone-200 dark:hover:bg-stone-700">
        {label}
      </button>
      {editable && !disabled && position && (
        <SmartMenu id={id} innerRef={menuRef} triggerRef={anchorRef} position={position} onClose={close} width={184}>
          <div
            role="menu"
            aria-label={editLabel}
            className="max-h-64 overflow-y-auto"
            onKeyDown={(event) => {
              const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
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
