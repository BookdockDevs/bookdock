import { useRef, useState } from 'react'
import type { ReactNode } from 'react'

import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { computeFromAnchor, PADDING, type SmartPosition } from '@/lib/position'

import { ActionIcon } from './ui'

export interface MoreActionsMenuItem {
  key: string
  label: string
  /** Path elements for a 15px stroke icon, drawn in the menu's muted tone. */
  icon: ReactNode
  onSelect: () => void
}

/**
 * The dialog's overflow affordance. Content-maintenance actions live here at
 * the end of the action row on both sides of the library boundary, so opening
 * a book reads the same whether it lives in the private library or in a shared
 * one.
 */
export default function MoreActionsMenu({ items }: { items: MoreActionsMenuItem[] }) {
  const _ = useTranslation()
  const [menu, setMenu] = useState<SmartPosition | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  function toggle() {
    const el = anchorRef.current
    if (!el) return
    if (menu) {
      setMenu(null)
      return
    }
    const rect = el.getBoundingClientRect()
    const menuWidth = 176
    const position = computeFromAnchor(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      menuWidth,
      88,
    )
    setMenu({
      ...position,
      left: Math.max(PADDING, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - PADDING)),
    })
  }

  if (items.length === 0) return null

  return (
    <div ref={anchorRef} className="relative">
      <ActionIcon
        secondary
        label={_('library.moreActions')}
        onClick={toggle}
      >
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      </ActionIcon>
      {menu && (
        <SmartMenu innerRef={menuRef} position={menu} onClose={() => setMenu(null)}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setMenu(null)
                item.onSelect()
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-stone-700 transition-colors hover:bg-stone-500/10 dark:text-stone-200"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-stone-400">
                {item.icon}
              </svg>
              <span className="flex-1">{item.label}</span>
            </button>
          ))}
        </SmartMenu>
      )}
    </div>
  )
}
